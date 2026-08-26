/**
 * The purge: find what the targets hold, sign one set of delete requests, send
 * it to every target, and report what each relay said.
 *
 * Three rules shape this file, and two of them are the sweep's.
 *
 * **Never claim more than a relay said.** A relay that accepts a delete
 * request has *said* it will honour it; it has not proved it, and NIP-09
 * leaves it free to serve the event anyway. Nothing here reports "deleted" —
 * it reports accepted, refused, or no answer, and the UI says so in those
 * words. A relay that never answered is not a relay that refused.
 *
 * **The gather and the request are separate.** Ids are collected from every
 * target first, unioned, and signed once; the same signed requests then go to
 * every relay. That is not an optimisation, though it is one — signing per
 * relay would mean a NIP-07 approval prompt per relay, hundreds of them. It is
 * correctness: a relay that quietly holds a copy of an event this app only
 * discovered elsewhere still receives that event's id, and clears it.
 *
 * **Only the author's own events.** A delete request is honoured for the
 * signer's own events and nothing else, so the gather asks for `authors`
 * alone — never the `#p` half of the DM union the sweep uses. Counting a
 * received DM as purgeable would put an id in the request that no relay will
 * ever act on, and show the user a number that will not go down.
 */
import { isNamedKind, kindSpec, OTHER_KIND } from '@/config/kinds';
import type { KindSpec } from '@/config/kinds';
import { CONNECT_TIMEOUT_MS } from '@/config/sweep';
import {
  PUBLISH_TIMEOUT_MS,
  PURGE_MAX_PER_KIND,
  PURGE_PAGE_LIMIT,
  PURGE_QUERY_TIMEOUT_MS,
} from '@/config/purge';
import { runWithConcurrency } from '@/lib/concurrency';
import { errorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { RelayDescriptor } from '@/services/discovery/nip66';
import type { SignedEvent } from '@/services/nostr/events';
import type { Signer } from '@/services/nostr/signer';
import { assertSignerMatches } from '@/services/nostr/signer';
import type { PublishAck, RelayEvent, RelayFilter } from '@/services/relay/socket';
import { RelaySocket } from '@/services/relay/socket';
import { deleteRequests, deleteRequestsForIds } from '@/services/purge/nip09';

/** What a purge is asking for, minus the relays it will ask. */
export interface PurgePlan {
  /** Hex pubkey. Both the author of everything being deleted and the identity
   *  the signer must hold — enforced before a socket opens. */
  author: string;
  kinds: number[];
  /** `content` of the delete requests: the reason relays and clients show. */
  reason: string;
}

export type PurgePhase = 'gathering' | 'signing' | 'publishing' | 'done';

/** How a relay's part of the purge ended. */
export type PurgeRelayStatus =
  /** Every request sent was accepted. */
  | 'accepted'
  /** Some accepted, some not — mixed answers from one relay. */
  | 'partial'
  /** The relay refused every request, and said so. */
  | 'refused'
  /** Requests were sent and the relay never acknowledged them. Nothing is
   *  known: it may have applied them. */
  | 'unanswered'
  | 'unreachable'
  | 'error';

export interface PurgeRelayReport {
  url: string;
  /** Event ids this relay served for the chosen kinds. */
  found: number;
  /** The gather hit its per-kind ceiling here: the relay holds more than this
   *  purge named. Surfaced, never hidden — a second run clears the rest. */
  truncated: boolean;
  accepted: number;
  rejected: number;
  unanswered: number;
  /** The relay's own words, deduplicated. The interesting half of a refusal. */
  notes: string[];
  status: PurgeRelayStatus;
  error: string | null;
}

export interface PurgeHandlers {
  onPhase: (phase: PurgePhase) => void;
  /** Called twice per relay — once when its gather finishes, once when its
   *  publish does — so the screen fills in as the work happens. */
  onRelay: (report: PurgeRelayReport) => void;
  onProgress: (done: number, total: number) => void;
}

export interface PurgeOptions {
  concurrency: number;
  signal: AbortSignal;
}

export interface PurgeOutcome {
  /** Distinct event ids across every target. */
  gathered: number;
  /** Delete requests signed and sent. */
  requests: number;
  reports: PurgeRelayReport[];
}

function blankReport(url: string): PurgeRelayReport {
  return {
    url,
    found: 0,
    truncated: false,
    accepted: 0,
    rejected: 0,
    unanswered: 0,
    notes: [],
    status: 'unanswered',
    error: null,
  };
}

/**
 * The filter for one kind, authored by one identity.
 *
 * Deliberately not `sweep/filters.ts`' `filtersFor`: that one unions in the
 * `#p` half for DMs, which is right for "where are my messages" and wrong for
 * "what can I delete" — see this file's header.
 */
function authoredFilter(spec: KindSpec, author: string): RelayFilter {
  // The catch-all has no `kinds` to send — NIP-01 cannot express "anything but
  // these" — so it asks for the author's events and sorts them here.
  if (spec.catchAll === true) return { authors: [author] };

  const filter: RelayFilter = { kinds: [spec.kind], authors: [author] };
  if (spec.dTag !== undefined) filter['#d'] = [spec.dTag];
  return filter;
}

/**
 * Is this event one the request may name?
 *
 * Authored by this identity, and belonging to the kind being purged. Written
 * out rather than reusing the sweep's `eventMatches` because that one counts a
 * DM addressed *to* the author as theirs, which is right for "where are my
 * messages" and wrong here: nobody can delete somebody else's event, and an id
 * in the request that no relay will act on is a number that never goes down.
 */
function deletable(event: RelayEvent, spec: KindSpec, author: string): boolean {
  if (event.pubkey !== author) return false;
  if (spec.catchAll === true) return !isNamedKind(event.kind);
  if (event.kind !== spec.kind) return false;
  if (spec.dTag === undefined) return true;
  return (event.tags.find((tag) => tag[0] === 'd')?.[1] ?? '') === spec.dTag;
}

interface GatherResult {
  ids: string[];
  /** The kinds actually seen. Only interesting for the catch-all, where the
   *  kinds being deleted are not known until the relay answers — and a delete
   *  request has to declare them in its `k` tags. */
  kinds: number[];
  truncated: boolean;
}

/**
 * Every id one relay will serve for one kind, paged backwards.
 *
 * Paged for the same reason the directory is: a relay will not serve half a
 * million DMs in one response, and a purge that names only the newest five
 * hundred of them looks complete and is not. The walk stops on a short page,
 * on the ceiling, or when the relay stops moving the `until` boundary — which
 * is how a relay that ignores `until` presents, and which would otherwise loop
 * on the same page until the ceiling.
 */
async function gatherKind(
  socket: RelaySocket,
  spec: KindSpec,
  author: string,
  signal: AbortSignal,
): Promise<GatherResult> {
  const ids = new Set<string>();
  const kinds = new Set<number>();
  const base = authoredFilter(spec, author);
  let until: number | undefined;

  while (ids.size < PURGE_MAX_PER_KIND) {
    if (signal.aborted) break;
    const filter = until === undefined ? base : { ...base, until };
    const page = await socket.sample([filter], PURGE_PAGE_LIMIT, PURGE_QUERY_TIMEOUT_MS);

    // Only the author's own events, and only of the kind asked for. A relay
    // that answers with somebody else's event has failed the same check the
    // sweep applies, and its id must not end up in a signed request.
    for (const event of page.events) {
      if (!deletable(event, spec, author)) continue;
      ids.add(event.id);
      kinds.add(event.kind);
    }

    if (page.events.length < PURGE_PAGE_LIMIT) break;
    const oldest = page.events.reduce(
      (lowest, event) => Math.min(lowest, event.created_at),
      Number.POSITIVE_INFINITY,
    );
    if (!Number.isFinite(oldest)) break;
    const next = oldest - 1;
    if (until !== undefined && next >= until) break;
    until = next;
  }

  // The loop exits at the ceiling with the relay still serving: what was
  // named is a prefix of what it holds, and the report has to say so.
  return { ids: [...ids], kinds: [...kinds], truncated: ids.size >= PURGE_MAX_PER_KIND };
}

/** Everything one relay holds, across every kind in the plan. */
async function gatherRelay(
  relay: RelayDescriptor,
  plan: PurgePlan,
  signal: AbortSignal,
): Promise<{ report: PurgeRelayReport; ids: string[]; kinds: number[] }> {
  const report = blankReport(relay.url);
  let socket: RelaySocket | null = null;

  try {
    socket = await RelaySocket.open(relay.url, CONNECT_TIMEOUT_MS, signal);
    const specs = plan.kinds
      .map((kind) => kindSpec(kind))
      .filter((spec): spec is KindSpec => spec !== undefined);

    const ids = new Set<string>();
    const kinds = new Set<number>();
    for (const spec of specs) {
      const result = await gatherKind(socket, spec, plan.author, signal);
      for (const id of result.ids) ids.add(id);
      for (const kind of result.kinds) kinds.add(kind);
      report.truncated ||= result.truncated;
    }
    report.found = ids.size;
    return { report, ids: [...ids], kinds: [...kinds] };
  } catch (err) {
    // A relay nobody can reach is still a target: it may come back, and the
    // request is published to it regardless — this only records why its
    // contribution to the id list is empty.
    return {
      report: { ...report, status: 'unreachable', error: errorMessage(err) },
      ids: [],
      kinds: [],
    };
  } finally {
    socket?.close();
  }
}

/**
 * Fold one relay's answer into its report.
 *
 * Both publishing paths — the bulk purge and the ticked-events one — count the
 * same three outcomes and keep the same relay messages, and the distinction
 * they draw between a refusal and a silence is the whole claim this screen
 * makes. Written twice, that claim could drift on one path only.
 */
function recordAck(report: PurgeRelayReport, ack: PublishAck | null): void {
  if (ack === null) {
    report.unanswered += 1;
    return;
  }
  if (ack.accepted) report.accepted += 1;
  else report.rejected += 1;
  if (ack.message !== '' && !report.notes.includes(ack.message)) report.notes.push(ack.message);
}

/** Which of the three publish outcomes a relay's answers add up to. */
function statusFor(report: PurgeRelayReport): PurgeRelayStatus {
  if (report.accepted > 0 && report.rejected === 0 && report.unanswered === 0) return 'accepted';
  if (report.accepted > 0) return 'partial';
  if (report.rejected > 0) return 'refused';
  return 'unanswered';
}

/** Send every signed request to one relay and record what it said. */
async function publishToRelay(
  relay: RelayDescriptor,
  requests: readonly SignedEvent[],
  previous: PurgeRelayReport,
  signal: AbortSignal,
): Promise<PurgeRelayReport> {
  const report: PurgeRelayReport = { ...previous, notes: [...previous.notes], error: null };
  let socket: RelaySocket | null = null;

  try {
    socket = await RelaySocket.open(relay.url, CONNECT_TIMEOUT_MS, signal);
    for (const request of requests) {
      if (signal.aborted) break;
      recordAck(report, await socket.publish(request, PUBLISH_TIMEOUT_MS));
    }
    report.status = statusFor(report);
    return report;
  } catch (err) {
    return { ...report, status: 'unreachable', error: errorMessage(err) };
  } finally {
    socket?.close();
  }
}

/**
 * Run a purge. Resolves when every target has been reported, including the
 * ones that could not be reached — those are results too.
 *
 * `createdAt` is passed in rather than read from the clock here so the
 * timestamp on every request in one purge is identical, which is what makes
 * the `a`-tag deletions cover the same instant on every relay.
 */
export async function runPurge(
  relays: readonly RelayDescriptor[],
  plan: PurgePlan,
  signer: Signer,
  options: PurgeOptions,
  handlers: PurgeHandlers,
  createdAt = Math.floor(Date.now() / 1000),
): Promise<PurgeOutcome> {
  // Before a single socket opens: the key has to be the identity being
  // purged. Everything after this point is irreversible on somebody's relay.
  assertSignerMatches(signer, plan.author);

  const reports = new Map<string, PurgeRelayReport>(
    relays.map((relay) => [relay.url, blankReport(relay.url)]),
  );
  const ids = new Set<string>();
  /**
   * The kinds the request will declare.
   *
   * The named kinds come from the plan; the catch-all's come from what the
   * relays actually served, because "everything else" is not a kind and
   * cannot be declared until something has been found. The sentinel itself is
   * never among them — it is this app's bookkeeping, not a nostr kind, and a
   * `["k", "-1"]` tag on a signed event would be nonsense on the wire.
   */
  const kinds = new Set<number>(plan.kinds.filter((kind) => kind !== OTHER_KIND));

  handlers.onPhase('gathering');
  let gathered = 0;
  handlers.onProgress(0, relays.length);
  await runWithConcurrency(
    relays,
    options.concurrency,
    async (relay) => {
      if (options.signal.aborted) return;
      const result = await gatherRelay(relay, plan, options.signal);
      for (const id of result.ids) ids.add(id);
      for (const kind of result.kinds) kinds.add(kind);
      reports.set(relay.url, result.report);
      gathered += 1;
      handlers.onRelay(result.report);
      handlers.onProgress(gathered, relays.length);
    },
    options.signal,
  );

  handlers.onPhase('signing');
  const templates = deleteRequests(
    { author: plan.author, ids: [...ids], kinds: [...kinds], reason: plan.reason },
    createdAt,
  );

  const requests: SignedEvent[] = [];
  for (const template of templates) {
    if (options.signal.aborted) break;
    // Sequential, and it has to be: an extension shows one approval prompt per
    // signature, and firing a dozen at once is how a user ends up approving
    // something they never saw.
    requests.push(await signer.sign(template));
  }
  logger.sweep('Purge signed', { requests: requests.length, ids: ids.size });

  if (requests.length === 0) {
    handlers.onPhase('done');
    return { gathered: ids.size, requests: 0, reports: [...reports.values()] };
  }

  handlers.onPhase('publishing');
  let published = 0;
  handlers.onProgress(0, relays.length);
  await runWithConcurrency(
    relays,
    options.concurrency,
    async (relay) => {
      if (options.signal.aborted) return;
      const previous = reports.get(relay.url) ?? blankReport(relay.url);
      const report = await publishToRelay(relay, requests, previous, options.signal);
      reports.set(relay.url, report);
      published += 1;
      handlers.onRelay(report);
      handlers.onProgress(published, relays.length);
    },
    options.signal,
  );

  handlers.onPhase('done');
  return { gathered: ids.size, requests: requests.length, reports: [...reports.values()] };
}

/**
 * Delete a hand-picked set of events from one relay.
 *
 * The other entry point, from the raw-event viewer: one relay, ids the user
 * ticked, no gather. Kept beside the bulk purge rather than in the component
 * because it is the same protocol act — one signed kind-5, one relay's `OK` —
 * and the wording of what happened has to match.
 */
export async function purgeEvents(
  relayUrl: string,
  plan: PurgePlan,
  ids: readonly string[],
  signer: Signer,
  signal?: AbortSignal,
  createdAt = Math.floor(Date.now() / 1000),
): Promise<PurgeRelayReport> {
  assertSignerMatches(signer, plan.author);

  const report = blankReport(relayUrl);
  report.found = ids.length;

  // Named ids only, never an address: a ticked event is a request to delete
  // that event, not every copy of its kind the identity ever published.
  const templates = deleteRequestsForIds(
    {
      author: plan.author,
      ids,
      kinds: plan.kinds.filter((kind) => kind !== OTHER_KIND),
      reason: plan.reason,
    },
    createdAt,
  );

  let socket: RelaySocket | null = null;
  try {
    const requests: SignedEvent[] = [];
    for (const template of templates) requests.push(await signer.sign(template));

    socket = await RelaySocket.open(relayUrl, CONNECT_TIMEOUT_MS, signal);
    for (const request of requests) {
      recordAck(report, await socket.publish(request, PUBLISH_TIMEOUT_MS));
    }
    report.status = statusFor(report);
    return report;
  } catch (err) {
    return { ...report, status: 'error', error: errorMessage(err) };
  } finally {
    socket?.close();
  }
}
