/**
 * The sweep: open every relay, ask it about every kind, report what it says.
 *
 * Three rules shape the whole file.
 *
 * **An unanswered question is not an answer of zero.** The failure this tool
 * exists to prevent is a user concluding their data is gone because a relay
 * timed out. Every result carries how it was obtained, and "no answer" has
 * its own status all the way to the cell.
 *
 * **The relay is not trusted.** It can ignore the filter, invent events,
 * attribute them to anyone and inflate its own `COUNT`. What comes back is
 * re-checked against what was asked, and in identity mode the newest event —
 * the one the user will act on — has its signature verified.
 *
 * **Results stream.** A three-minute sweep that shows nothing for three
 * minutes is indistinguishable from a broken one, so each relay is reported
 * the moment it finishes rather than at the end.
 */
import { verifyEvent } from 'nostr-tools/pure';

import { kindSpec } from '@/config/kinds';
import type { KindSpec } from '@/config/kinds';
import {
  COUNT_TIMEOUT_MS,
  CONNECT_TIMEOUT_MS,
  QUERY_TIMEOUT_MS,
  RELAY_BUDGET_MS,
} from '@/config/sweep';
import { runWithConcurrency } from '@/lib/concurrency';
import { errorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { RelayDescriptor } from '@/services/discovery/nip66';
import type { CloseReason, RelayEvent, SampleResult } from '@/services/relay/socket';
import { RelaySocket } from '@/services/relay/socket';
import { filtersFor, newestOf, splitMatches } from '@/services/sweep/filters';
import type { KindResult, KindStatus, RelayResult, SweepQuery } from '@/services/sweep/types';

export interface SweepHandlers {
  onResult: (result: RelayResult) => void;
  onProgress: (done: number, total: number) => void;
}

export interface SweepOptions {
  concurrency: number;
  signal: AbortSignal;
}

/** Refusal text → the status that explains the empty answer. The prefixes are
 *  NIP-01's machine-readable ones; the fallback catches relays that refuse in
 *  prose. */
function statusFromRefusal(refusal: CloseReason | null): KindStatus {
  if (refusal === null) return 'ok';
  if (refusal.kind === 'timeout') return 'timeout';
  if (refusal.kind === 'disconnected') return 'error';

  const message = refusal.message.toLowerCase();
  if (message.startsWith('auth-required')) return 'auth';
  if (message.startsWith('payment-required')) return 'payment';
  if (message.startsWith('restricted') || message.startsWith('blocked')) return 'restricted';
  return 'error';
}

function refusalNote(refusal: CloseReason | null): string | null {
  if (refusal === null || refusal.kind !== 'closed') return null;
  return refusal.message === '' ? null : refusal.message.slice(0, 160);
}

/**
 * Verify one event's signature, guarding against a malformed event crashing
 * the sweep. `nostr-tools` throws on a bad hex string rather than returning
 * false, and relay content is exactly where a bad hex string comes from.
 */
function verifySafely(event: RelayEvent): boolean {
  try {
    return verifyEvent(event);
  } catch {
    return false;
  }
}

/**
 * The sampled events, folded into a result for one kind.
 *
 * Exported for its tests: the rules for what a partial answer means are the
 * whole point of this file and are not observable from outside a live sweep.
 */
export function resultFromSample(
  spec: KindSpec,
  sample: SampleResult,
  query: SweepQuery,
): KindResult {
  const { matched, mismatched } = splitMatches(sample.events, spec, query.author);
  const status = statusFromRefusal(sample.refusal);

  // A sample that hit the ceiling, or was cut off before EOSE, has counted
  // what arrived rather than what exists.
  const approx = sample.events.length >= query.sampleLimit || !sample.complete;

  // Nothing arrived and the relay never said it was finished. That is not a
  // count of zero and must not render as one: `≥0` is what an unanswered
  // question looks like when a floor is put on an empty sample.
  if (matched.length === 0 && !sample.complete) {
    return {
      kind: spec.kind,
      count: null,
      approx: false,
      method: 'none',
      status,
      newest: null,
      mismatched,
      note: refusalNote(sample.refusal),
    };
  }

  const newestEvent = newestOf(matched);
  const newest =
    newestEvent === null
      ? null
      : {
          id: newestEvent.id,
          pubkey: newestEvent.pubkey,
          created_at: newestEvent.created_at,
          // This is the claim "your event is here", and forging it is free
          // for a relay. Checked on the newest event per kind only — the one
          // a user acts on — because a signature check costs ~1.5ms and there
          // are six of them per relay across a thousand relays.
          verified: verifySafely(newestEvent),
        };

  return {
    kind: spec.kind,
    count: matched.length,
    approx,
    method: 'sample',
    // A refusal that still produced matching events is not a refusal.
    status: matched.length > 0 ? 'ok' : status,
    newest,
    mismatched,
    note: refusalNote(sample.refusal),
  };
}

/**
 * One kind on one relay.
 *
 * Always sampled rather than counted. The events themselves are the answer —
 * *which* relay holds your current profile, and how old that copy is — and an
 * author-scoped sample is a handful of events rather than a ceiling's worth,
 * so asking for a bare total instead would save nothing and lose the dates and
 * the signature check.
 */
async function sweepKind(
  socket: RelaySocket,
  spec: KindSpec,
  query: SweepQuery,
): Promise<KindResult> {
  const filters = filtersFor(spec, query.author);
  const sample = await socket.sample(filters, query.sampleLimit, QUERY_TIMEOUT_MS);
  const result = resultFromSample(spec, sample, query);

  // A sample at its ceiling is a floor, and the relay may be able to turn it
  // into an exact number with NIP-45. Worth one more round trip; for a busy
  // inbox it is the difference between "≥25" and "498,407".
  //
  // Tried even when the relay does not advertise NIP-45, deliberately: the
  // trackers' NIP lists are incomplete (measured — relays answer `COUNT` that
  // no tracker lists as supporting 45), and the cost of being wrong is one
  // timeout on a relay that already returned a ceiling-capped sample. A relay
  // that never hit the ceiling is never asked twice.
  if (result.approx && result.count !== null && result.count > 0) {
    const exact = await socket.count(filters, COUNT_TIMEOUT_MS);
    if (exact !== null && exact >= result.count) {
      return { ...result, count: exact, approx: false, method: 'count' };
    }
  }

  return result;
}

function emptyResult(
  relay: RelayDescriptor,
  status: RelayResult['status'],
  error: string | null,
  totalMs: number,
  connectMs: number | null,
): RelayResult {
  return {
    url: relay.url,
    status,
    connectMs,
    totalMs,
    kinds: {},
    total: null,
    hits: 0,
    error,
  };
}

/** Every kind on one relay, over a single socket. */
export async function sweepRelay(
  relay: RelayDescriptor,
  query: SweepQuery,
  signal: AbortSignal,
): Promise<RelayResult> {
  const startedAt = performance.now();
  let socket: RelaySocket | null = null;
  let connectMs: number | null = null;

  try {
    const open = await RelaySocket.open(relay.url, CONNECT_TIMEOUT_MS, signal);
    socket = open;
    connectMs = Math.round(performance.now() - startedAt);

    const specs = query.kinds
      .map((kind) => kindSpec(kind))
      .filter((spec): spec is KindSpec => spec !== undefined);

    // Kinds go out in parallel over the one socket — they are independent
    // subscriptions, and serialising them would multiply the query timeout by
    // six on every slow relay.
    const settled = await Promise.all(specs.map(async (spec) => sweepKind(open, spec, query)));

    const kinds: Record<number, KindResult> = {};
    let total = 0;
    let known = false;
    let hits = 0;
    for (const result of settled) {
      kinds[result.kind] = result;
      if (result.count !== null) {
        total += result.count;
        known = true;
        if (result.count > 0) hits += 1;
      }
    }

    return {
      url: relay.url,
      status: 'ok',
      connectMs,
      totalMs: Math.round(performance.now() - startedAt),
      kinds,
      total: known ? total : null,
      hits,
      error: null,
    };
  } catch (err) {
    const totalMs = Math.round(performance.now() - startedAt);
    const status = connectMs === null ? 'unreachable' : 'error';
    logger.relay('Relay failed', { url: relay.url, status, error: errorMessage(err) });
    return emptyResult(relay, status, errorMessage(err), totalMs, connectMs);
  } finally {
    socket?.close();
  }
}

/**
 * Reject after `ms`, so one pathological relay cannot hold a concurrency slot
 * for the length of the sweep. The handle is returned so the winner can clear
 * it — a thousand orphaned timers would each keep their closure alive for the
 * full budget after the sweep has already finished.
 */
function budget(ms: number): { promise: Promise<never>; cancel: () => void } {
  let handle: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error('Relay budget exceeded')), ms);
  });
  return { promise, cancel: () => clearTimeout(handle) };
}

/**
 * Run the sweep. Resolves when every relay has been reported — including the
 * ones that failed, which are results too.
 */
export async function runSweep(
  relays: readonly RelayDescriptor[],
  query: SweepQuery,
  options: SweepOptions,
  handlers: SweepHandlers,
): Promise<void> {
  let done = 0;
  handlers.onProgress(0, relays.length);

  await runWithConcurrency(
    relays,
    options.concurrency,
    async (relay) => {
      if (options.signal.aborted) return;
      const deadline = budget(RELAY_BUDGET_MS);
      let result: RelayResult;
      try {
        result = await Promise.race([sweepRelay(relay, query, options.signal), deadline.promise]);
      } catch (err) {
        result = emptyResult(relay, 'error', errorMessage(err), RELAY_BUDGET_MS, null);
      } finally {
        deadline.cancel();
      }
      done += 1;
      handlers.onResult(result);
      handlers.onProgress(done, relays.length);
    },
    options.signal,
  );
}
