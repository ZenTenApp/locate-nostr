/**
 * Fetching the actual events behind a number, for one relay and one kind.
 *
 * The sweep deliberately throws events away: it samples up to 25 per kind
 * across six kinds and thirteen hundred relays, and keeping them would mean
 * holding — and caching to disk — a couple of hundred thousand events to
 * display a handful. So the grid stores counts, and this re-asks the single
 * relay the user actually clicked.
 *
 * The re-ask is also more honest than a cached copy would be: what it shows is
 * what that relay serves *now*, which is the thing a person opening raw JSON
 * is trying to establish. It is labelled as a fresh read for that reason, and
 * the count it returns can legitimately differ from the one in the grid.
 */
import { verifyEvent } from 'nostr-tools/pure';

import type { KindSpec } from '@/config/kinds';
import { CONNECT_TIMEOUT_MS, QUERY_TIMEOUT_MS } from '@/config/sweep';
import { errorMessage } from '@/lib/errors';
import type { CloseReason, RelayEvent } from '@/services/relay/socket';
import { RelaySocket } from '@/services/relay/socket';
import { filtersFor, splitMatches } from '@/services/sweep/filters';

/** One event as fetched, with the checks this app can make about it. */
export interface InspectedEvent {
  event: RelayEvent;
  /**
   * Signature check. A relay can invent an event under anyone's pubkey for
   * free, and raw JSON is exactly where someone goes to decide whether to
   * believe one — so every event shown is verified, not just the newest.
   */
  verified: boolean;
  /** The relay returned it despite it not matching the filter it was sent. */
  offFilter: boolean;
}

export interface RawEventsResult {
  events: InspectedEvent[];
  refusal: CloseReason | null;
  /** True when the relay signalled it had sent everything it had. */
  complete: boolean;
  error: string | null;
}

function verifySafely(event: RelayEvent): boolean {
  try {
    return verifyEvent(event);
  } catch {
    // `nostr-tools` throws rather than returning false on malformed hex, and
    // malformed hex is exactly what an untrusted relay might send.
    return false;
  }
}

/**
 * Ask one relay for one kind, and hand back everything it says.
 *
 * Off-filter events are kept rather than dropped — unlike in the sweep, where
 * they are only counted. Here they are the evidence: seeing the event a relay
 * returned when it was asked for something else is the whole reason to open
 * the JSON.
 */
export async function fetchRelayEvents(
  relayUrl: string,
  spec: KindSpec,
  author: string,
  limit: number,
  signal?: AbortSignal,
): Promise<RawEventsResult> {
  let socket: RelaySocket | null = null;
  try {
    socket = await RelaySocket.open(relayUrl, CONNECT_TIMEOUT_MS, signal);
    const sample = await socket.sample(filtersFor(spec, author), limit, QUERY_TIMEOUT_MS);
    const { matched } = splitMatches(sample.events, spec, author);
    const matchedIds = new Set(matched.map((event) => event.id));

    return {
      events: sample.events.map((event) => ({
        event,
        verified: verifySafely(event),
        offFilter: !matchedIds.has(event.id),
      })),
      refusal: sample.refusal,
      complete: sample.complete,
      error: null,
    };
  } catch (err) {
    return { events: [], refusal: null, complete: false, error: errorMessage(err) };
  } finally {
    socket?.close();
  }
}

/** The events as the JSON a person would paste elsewhere: the array a relay
 *  conceptually served, without this app's own annotations. */
export function eventsToJson(events: readonly InspectedEvent[]): string {
  return JSON.stringify(
    events.map((entry) => entry.event),
    null,
    2,
  );
}
