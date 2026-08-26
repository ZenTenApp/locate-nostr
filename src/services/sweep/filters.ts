/**
 * Turning a kind into the filters a relay is asked, and checking what comes
 * back against them.
 *
 * Split out from the engine because it is the part with the protocol subtlety
 * in it and the part worth testing without a socket: which filters a kind
 * needs, and — the load-bearing half — whether a relay actually honoured
 * them. Relays that ignore `authors` or `kinds` are common enough that
 * counting whatever arrives would rank the broken ones highest.
 */
import { isNamedKind } from '@/config/kinds';
import type { KindSpec } from '@/config/kinds';
import type { RelayEvent, RelayFilter } from '@/services/relay/socket';

/**
 * The filters for one kind.
 *
 * Two of them for an AUTH-gated kind in identity mode: a kind 4 belongs to an
 * identity whether they wrote it or are its `p`-tagged recipient, and "where
 * are my DMs" means both. A relay unions the filters of a single `REQ`, so
 * this counts each event once.
 */
export function filtersFor(spec: KindSpec, author: string): RelayFilter[] {
  // The catch-all cannot be a `kinds` filter: NIP-01 has no "anything but
  // these". So the relay is asked for the author's events with no kind
  // restriction at all, and the named kinds are dropped on arrival — which is
  // why its count is a floor far more often than the others'.
  if (spec.catchAll) return [{ authors: [author] }];

  const base: RelayFilter = { kinds: [spec.kind] };
  if (spec.dTag !== undefined) base['#d'] = [spec.dTag];

  if (spec.authGated)
    return [
      { ...base, authors: [author] },
      { ...base, '#p': [author] },
    ];
  return [{ ...base, authors: [author] }];
}

/** Does this event belong in this kind's column? */
export function eventMatches(event: RelayEvent, spec: KindSpec, author: string): boolean {
  if (spec.catchAll) return event.pubkey === author && !isNamedKind(event.kind);
  if (event.kind !== spec.kind) return false;

  if (spec.dTag !== undefined) {
    const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1] ?? '';
    if (dTag !== spec.dTag) return false;
  }

  if (event.pubkey === author) return true;
  // The recipient half of the DM union.
  return spec.authGated && event.tags.some((tag) => tag[0] === 'p' && tag[1] === author);
}

/**
 * Did the relay serve what it was *asked* for?
 *
 * Not the same question as {@link eventMatches}, and the catch-all is why. Its
 * request carries no `kinds`, so a relay answering with a profile event has
 * honoured the filter exactly — that event simply belongs in another column.
 * Counting it as the relay ignoring the filter would put a red mark on every
 * honest relay on the network the moment `other` is switched on.
 */
export function filterHonoured(event: RelayEvent, spec: KindSpec, author: string): boolean {
  if (spec.catchAll) return event.pubkey === author;
  return eventMatches(event, spec, author);
}

export interface MatchSplit {
  matched: RelayEvent[];
  /** How many events the relay returned that its own filters exclude. Above
   *  zero, nothing this relay says about counts can be taken at face value. */
  mismatched: number;
}

export function splitMatches(
  events: readonly RelayEvent[],
  spec: KindSpec,
  author: string,
): MatchSplit {
  const matched: RelayEvent[] = [];
  let mismatched = 0;
  for (const event of events) {
    if (eventMatches(event, spec, author)) matched.push(event);
    // Served as asked but belonging to another column — the catch-all's view
    // of a profile event. Neither counted here nor held against the relay.
    else if (!filterHonoured(event, spec, author)) mismatched += 1;
  }
  return { matched, mismatched };
}

/** The newest of a sample. Relays are supposed to return newest-first under a
 *  `limit`; enough of them do not that the max is taken explicitly. */
export function newestOf(events: readonly RelayEvent[]): RelayEvent | null {
  let newest: RelayEvent | null = null;
  for (const event of events) {
    if (newest === null || event.created_at > newest.created_at) newest = event;
  }
  return newest;
}
