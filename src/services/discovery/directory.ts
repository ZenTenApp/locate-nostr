/**
 * Building the relay list.
 *
 * The list is the product here as much as the sweep is: a search engine that
 * misses a relay reports "your data is not on the network" when it is. So the
 * directory is a union of every monitor that answers, not the first one — see
 * `DISCOVERY_RELAYS` for the measured yields, which differ by hundreds.
 *
 * Failure is partial by design. One monitor down loses its exclusive relays
 * and nothing else; all of them down falls back to whatever is cached, and
 * only an empty cache is a hard failure the user has to be told about.
 */
import {
  DISCOVERY_FLOOR_S,
  DISCOVERY_LIMIT,
  DISCOVERY_MAX_PAGES,
  DISCOVERY_RELAYS,
  DISCOVERY_STALE_AFTER_S,
  DISCOVERY_TIMEOUT_MS,
  RELAY_DISCOVERY_KIND,
} from '@/config/sweep';
import { errorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { directoryCache } from '@/services/cache/db';
import { mergeDiscoveryEvents, pastedDescriptor } from '@/services/discovery/nip66';
import type { RelayDescriptor } from '@/services/discovery/nip66';
import type { RelayEvent } from '@/services/relay/socket';
import { RelaySocket } from '@/services/relay/socket';
import { CONNECT_TIMEOUT_MS } from '@/config/sweep';
import { parsePastedRelays } from '@/services/relay/url';
import type { ParsedRelayUrl } from '@/services/relay/url';

export interface DirectorySourceResult {
  relay: string;
  events: number;
  error: string | null;
}

export interface Directory {
  relays: RelayDescriptor[];
  fetchedAt: number;
  /** Per-source outcome, shown in the UI so "1317 relays" is never an
   *  unattributed number. */
  sources: DirectorySourceResult[];
  /** True when nothing was fetched and this came off disk. */
  fromCache: boolean;
}

/**
 * Every discovery event one monitoring relay will serve, paged backwards.
 *
 * Paging is not an optimisation here, it is correctness: around thirty
 * monitors publish a report per relay each, so a single request comes back at
 * its ceiling with no way to tell which relays fell off the end. Each page
 * asks for reports older than the oldest one seen so far, and the walk stops
 * on a short page, on the age floor, or at the page cap — whichever comes
 * first, so a monitor with a bottomless archive cannot stall startup.
 */
async function fetchFromMonitor(
  url: string,
  signal?: AbortSignal,
): Promise<{ events: RelayEvent[]; error: string | null }> {
  let socket: RelaySocket | null = null;
  const events: RelayEvent[] = [];
  const floor = Math.floor(Date.now() / 1000) - DISCOVERY_FLOOR_S;
  let until: number | undefined;

  try {
    socket = await RelaySocket.open(url, CONNECT_TIMEOUT_MS, signal);

    for (let page = 0; page < DISCOVERY_MAX_PAGES; page += 1) {
      if (signal?.aborted) break;

      const filter =
        until === undefined
          ? { kinds: [RELAY_DISCOVERY_KIND] }
          : { kinds: [RELAY_DISCOVERY_KIND], until };
      const result = await socket.sample([filter], DISCOVERY_LIMIT, DISCOVERY_TIMEOUT_MS);
      events.push(...result.events);

      // A short page is the end of the set. So is a page that produced no new
      // lower bound, which is how a relay that ignores `until` presents.
      if (result.events.length < DISCOVERY_LIMIT) break;
      const oldest = result.events.reduce(
        (lowest, event) => Math.min(lowest, event.created_at),
        Number.POSITIVE_INFINITY,
      );
      if (!Number.isFinite(oldest) || oldest <= floor) break;
      const next = oldest - 1;
      if (until !== undefined && next >= until) break;
      until = next;
    }

    return { events, error: events.length === 0 ? 'empty' : null };
  } catch (err) {
    // Pages already collected are kept: a monitor that dies on page four still
    // contributed three pages of relays.
    return { events, error: events.length === 0 ? errorMessage(err) : null };
  } finally {
    socket?.close();
  }
}

/** Fetch the directory from every monitor, falling back to cache. */
export async function fetchDirectory(signal?: AbortSignal): Promise<Directory> {
  const fetched = await Promise.all(
    DISCOVERY_RELAYS.map(async (relay) => ({ relay, ...(await fetchFromMonitor(relay, signal)) })),
  );

  const events = fetched.flatMap((source) => source.events);
  const sources: DirectorySourceResult[] = fetched.map((source) => ({
    relay: source.relay,
    events: source.events.length,
    error: source.error,
  }));

  if (events.length === 0) {
    const cached = await directoryCache.read();
    logger.directory('No monitor answered; using cache', { cached: cached?.relays.length ?? 0 });
    return {
      relays: cached?.relays ?? [],
      fetchedAt: cached?.fetchedAt ?? 0,
      sources,
      fromCache: true,
    };
  }

  const relays = mergeDiscoveryEvents(events).sort((a, b) => a.url.localeCompare(b.url));
  const fetchedAt = Date.now();
  await directoryCache.write({ relays, fetchedAt });
  logger.directory('Directory built', { relays: relays.length, sources });

  return { relays, fetchedAt, sources, fromCache: false };
}

/** The cached directory, for the first paint. */
export async function cachedDirectory(): Promise<Directory | null> {
  const cached = await directoryCache.read();
  if (!cached || cached.relays.length === 0) return null;
  return { relays: cached.relays, fetchedAt: cached.fetchedAt, sources: [], fromCache: true };
}

/** A monitor has not reported this relay recently enough to call it live. */
export function isStale(relay: RelayDescriptor, now = Date.now()): boolean {
  if (relay.pasted) return false;
  return now / 1000 - relay.monitoredAt > DISCOVERY_STALE_AFTER_S;
}

/**
 * Fold user-pasted relays into the directory.
 *
 * A pasted relay that a monitor already knows keeps the monitor's metadata —
 * pasting a well-known relay must not blank out its NIP list. One nobody
 * reports is added with everything unknown, which is also the honest answer.
 */
export function withPastedRelays(
  relays: readonly RelayDescriptor[],
  pasted: readonly ParsedRelayUrl[],
): RelayDescriptor[] {
  const byUrl = new Map(relays.map((relay) => [relay.url, relay]));
  for (const entry of pasted) {
    if (byUrl.has(entry.url)) continue;
    byUrl.set(entry.url, pastedDescriptor(entry.url, entry.host, entry.network, entry.secure));
  }
  return [...byUrl.values()];
}

/** What the user has excluded from the sweep. */
export interface RelaySelection {
  includeDarknet: boolean;
  includeStale: boolean;
  /** Raw textarea contents; parsed here so the caller never has to. */
  pasted: string;
}

/**
 * Why the number of relays about to be swept is smaller than the number in the
 * directory.
 *
 * "1,679 relays found, 1,353 will be swept" is a question the UI must answer
 * before the user asks it, because the alternative reading is that the tool
 * silently lost three hundred relays. Every exclusion is counted and named.
 */
export interface SelectionBreakdown {
  /** Everything known, monitors plus pasted. */
  total: number;
  /** Excluded as Tor or i2p — unreachable from an ordinary browser. */
  darknet: number;
  /** Excluded as stale: no monitor has reported them recently. */
  stale: number;
  /** Added by the user rather than reported by a monitor. */
  pasted: number;
  /** What is left, and what the sweep will actually open. */
  selected: number;
}

export function selectionBreakdown(
  relays: readonly RelayDescriptor[],
  selection: RelaySelection,
  now = Date.now(),
): SelectionBreakdown {
  const all = withPastedRelays(relays, parsePastedRelays(selection.pasted));
  const breakdown: SelectionBreakdown = {
    total: all.length,
    darknet: 0,
    stale: 0,
    pasted: 0,
    selected: 0,
  };

  for (const relay of all) {
    if (relay.pasted) breakdown.pasted += 1;
    // Counted as the reason that actually excluded it, in the order the filter
    // applies — a stale onion relay is one exclusion, not two.
    const isDarknet = relay.network !== 'clearnet';
    if (!selection.includeDarknet && isDarknet) {
      breakdown.darknet += 1;
      continue;
    }
    if (!selection.includeStale && isStale(relay, now)) {
      breakdown.stale += 1;
      continue;
    }
    breakdown.selected += 1;
  }

  return breakdown;
}

/**
 * The relays a sweep would actually open, from the directory and the user's
 * selection.
 *
 * A pure function rather than a store method so the grid can memoise it on the
 * five inputs it truly depends on. Derived from the store's whole state it
 * would recompute on every result flush — four times a second, over thirteen
 * hundred relays, for a list that has not changed since the run began.
 */
export function selectRelays(
  relays: readonly RelayDescriptor[],
  selection: RelaySelection,
  now = Date.now(),
): RelayDescriptor[] {
  const all = withPastedRelays(relays, parsePastedRelays(selection.pasted));
  return all.filter((relay) => {
    if (!selection.includeDarknet && relay.network !== 'clearnet') return false;
    if (!selection.includeStale && isStale(relay, now)) return false;
    return true;
  });
}
