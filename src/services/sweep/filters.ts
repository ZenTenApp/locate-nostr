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
  const base: RelayFilter = { kinds: [spec.kind] };
  if (spec.dTag !== undefined) base['#d'] = [spec.dTag];

  if (spec.authGated)
    return [
      { ...base, authors: [author] },
      { ...base, '#p': [author] },
    ];
  return [{ ...base, authors: [author] }];
}

/** Does this event answer what was asked? */
export function eventMatches(event: RelayEvent, spec: KindSpec, author: string): boolean {
  if (event.kind !== spec.kind) return false;

  if (spec.dTag !== undefined) {
    const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1] ?? '';
    if (dTag !== spec.dTag) return false;
  }

  if (event.pubkey === author) return true;
  // The recipient half of the DM union.
  return spec.authGated && event.tags.some((tag) => tag[0] === 'p' && tag[1] === author);
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
    else mismatched += 1;
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
