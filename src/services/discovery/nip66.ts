/**
 * Reading a NIP-66 kind-30166 relay-discovery event.
 *
 * A monitor publishes one of these per relay it watches, and it is the whole
 * directory: the `d` tag is the relay URL, `N` tags are its supported NIPs,
 * `R` tags are what it requires of a client, `rtt-*` are the monitor's
 * measured round-trips, and the content is the relay's NIP-11 document as the
 * monitor last read it.
 *
 * Pure parsing, kept apart from the fetching in `directory.ts` so the tag
 * conventions — which are loose in practice, since several monitors publish
 * these and they do not agree on every tag — can be tested against real
 * events without a socket.
 */
import type { RelayEvent } from '@/services/relay/socket';
import { parseRelayUrl } from '@/services/relay/url';
import type { ParsedRelayUrl } from '@/services/relay/url';

export interface RelayDescriptor {
  /** Canonical URL — the directory's key. */
  url: string;
  host: string;
  network: 'clearnet' | 'tor' | 'i2p';
  secure: boolean;
  /** NIP numbers the relay claims. `45` here is why a sweep tries `COUNT`. */
  nips: number[];
  /** `null` when no monitor said either way. */
  requiresAuth: boolean | null;
  requiresPayment: boolean | null;
  /** Monitor-measured connect round-trip, in ms. */
  rttOpenMs: number | null;
  name: string | null;
  software: string | null;
  /** `created_at` of the freshest monitor report. */
  monitoredAt: number;
  /** How many distinct monitors reported this relay. One monitor is one
   *  opinion; the count is how much of the network agrees the relay exists. */
  monitorCount: number;
  /** True when the relay was only ever reported by the user, not by a
   *  monitor — pasted relays have no NIP-66 metadata at all. */
  pasted: boolean;
}

function tagValues(event: RelayEvent, name: string): string[] {
  const values: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] === name && tag[1] !== undefined) values.push(tag[1]);
  }
  return values;
}

function firstTag(event: RelayEvent, name: string): string | null {
  // Not `tagValues(...)[0]`: this runs five times per event across forty
  // thousand discovery events on every cold start, and building the whole
  // array to read its head is the bulk of that.
  for (const tag of event.tags) {
    if (tag[0] === name && tag[1] !== undefined) return tag[1];
  }
  return null;
}

/** `R` tags say what a relay demands: `auth` requires it, `!auth` does not,
 *  and absent means no monitor said either way. One rule, two callers. */
function requirement(requirements: ReadonlySet<string>, name: string): boolean | null {
  if (requirements.has(name)) return true;
  if (requirements.has(`!${name}`)) return false;
  return null;
}

/** NIP-11 fields the grid shows. The document is relay-authored text, so
 *  everything is checked rather than cast. */
function readNip11(content: string): { name: string | null; software: string | null } {
  if (content === '') return { name: null, software: null };
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null) return { name: null, software: null };
    const doc = parsed as Record<string, unknown>;
    const software = typeof doc.software === 'string' ? doc.software : null;
    return {
      name: typeof doc.name === 'string' ? doc.name.slice(0, 64) : null,
      // Published as a repository URL far more often than as a name.
      software: software === null ? null : (software.split('/').pop() ?? software).slice(0, 40),
    };
  } catch {
    return { name: null, software: null };
  }
}

/**
 * One monitor's report → a descriptor, or `null` when the event is not usable
 * as one (no `d` tag, or a `d` tag that is not a relay URL).
 */
export function readDiscoveryEvent(event: RelayEvent): RelayDescriptor | null {
  const dTag = firstTag(event, 'd');
  if (dTag === null) return null;

  let parsed;
  try {
    parsed = parseRelayUrl(dTag);
  } catch {
    return null;
  }

  const requirements = new Set(tagValues(event, 'R'));
  const nips = tagValues(event, 'N')
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value));
  const rtt = Number.parseInt(firstTag(event, 'rtt-open') ?? '', 10);
  const nip11 = readNip11(event.content);

  // The monitor's own `n` tag wins over the URL heuristic: it knows whether it
  // reached the relay over Tor, and a clearnet host can be published as an
  // onion mirror.
  const declaredNetwork = firstTag(event, 'n');
  const network =
    declaredNetwork === 'tor' || declaredNetwork === 'i2p' || declaredNetwork === 'clearnet'
      ? declaredNetwork
      : parsed.network;

  return {
    url: parsed.url,
    host: parsed.host,
    network,
    secure: parsed.secure,
    nips: [...new Set(nips)].sort((a, b) => a - b),
    requiresAuth: requirement(requirements, 'auth'),
    requiresPayment: requirement(requirements, 'payment'),
    rttOpenMs: Number.isFinite(rtt) ? rtt : null,
    name: nip11.name,
    software: nip11.software ?? firstTag(event, 's'),
    monitoredAt: event.created_at,
    monitorCount: 1,
    pasted: false,
  };
}

/**
 * Collapse every monitor's report into one descriptor per relay.
 *
 * The freshest report wins for the scalar fields, because a relay that added
 * AUTH last week is described correctly by last week's monitor and wrongly by
 * a stale one. The NIP list is unioned instead: monitors probe different
 * things, and a NIP one of them never tested is missing from its report rather
 * than absent from the relay.
 */
export function mergeDiscoveryEvents(events: readonly RelayEvent[]): RelayDescriptor[] {
  const byUrl = new Map<
    string,
    { descriptor: RelayDescriptor; monitors: Set<string>; nips: Set<number> }
  >();

  for (const event of events) {
    const descriptor = readDiscoveryEvent(event);
    if (!descriptor) continue;

    const existing = byUrl.get(descriptor.url);
    if (!existing) {
      byUrl.set(descriptor.url, {
        descriptor,
        monitors: new Set([event.pubkey]),
        nips: new Set(descriptor.nips),
      });
      continue;
    }

    // Accumulated in sets and sorted once per relay at the end. Sorting and
    // re-spreading per event meant tens of thousands of throwaway arrays on
    // every cold start, and a `monitorCount` written here only to be
    // recomputed below.
    existing.monitors.add(event.pubkey);
    for (const nip of descriptor.nips) existing.nips.add(nip);
    if (descriptor.monitoredAt > existing.descriptor.monitoredAt) {
      existing.descriptor = descriptor;
    }
  }

  return [...byUrl.values()].map((entry) => ({
    ...entry.descriptor,
    nips: [...entry.nips].sort((a, b) => a - b),
    monitorCount: entry.monitors.size,
  }));
}

/** A relay the user pasted, with the metadata a monitor would have supplied
 *  left explicitly unknown rather than guessed. */
export function pastedDescriptor(parsed: ParsedRelayUrl): RelayDescriptor {
  return {
    url: parsed.url,
    host: parsed.host,
    network: parsed.network,
    secure: parsed.secure,
    nips: [],
    requiresAuth: null,
    requiresPayment: null,
    rttOpenMs: null,
    name: null,
    software: null,
    monitoredAt: 0,
    monitorCount: 0,
    pasted: true,
  };
}
