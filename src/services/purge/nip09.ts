/**
 * Building a NIP-09 delete request.
 *
 * A deletion on Nostr is not a deletion: it is a signed *request* (kind 5)
 * naming events the author wants gone, which each relay is free to honour,
 * ignore, or honour and then serve the event anyway. Everything in this file
 * is written so the app never overstates what it has done — the request is
 * built here, whether it worked is a per-relay fact reported by the engine.
 *
 * Three kinds of tag, and why each is there:
 *
 *  - **`e`** — the ids actually seen on the relays being purged. The only
 *    part a relay is required to act on.
 *  - **`a`** — an address (`kind:pubkey:d`) per replaceable kind, on a
 *    wholesale purge only. A replaceable event has one current copy per relay
 *    and this app only ever saw the ids it was served; the address covers the
 *    copies it never saw, including one written between the gather and the
 *    request landing. It is deliberately absent when the user ticked
 *    individual events — "delete this status" must not become "delete every
 *    status I have ever set".
 *  - **`k`** — the kinds named, which NIP-09 asks for so a relay can apply the
 *    request without first fetching every event it references.
 *
 * Split from the engine because it is pure and it is the part worth pinning in
 * tests: a request with the wrong tags is one that silently deletes nothing,
 * and a live relay is not somewhere to discover that.
 */
import { kindSpec } from '@/config/kinds';
import { DELETE_KIND, PURGE_IDS_PER_EVENT, PURGE_REASON_MAX } from '@/config/purge';
import type { EventTemplate } from '@/services/nostr/events';

export interface DeleteScope {
  /** Hex pubkey. A delete request is only honoured for the signer's own
   *  events, so this is both the author of the request and the author of
   *  everything it names. */
  author: string;
  /** Event ids gathered from the relays being purged. */
  ids: readonly string[];
  /** The kinds in scope, whether or not an id of that kind was found. */
  kinds: readonly number[];
  /** Shown by relays and other clients as the stated reason. */
  reason: string;
}

/**
 * The address form of a replaceable kind: `kind:pubkey:d`, with an empty `d`
 * for the plainly-replaceable kinds that have none.
 *
 * Only replaceable and addressable kinds get one. An `a` tag naming a regular
 * kind — kind 4, say — asks a relay to delete every event of that kind the
 * author ever wrote, which is not what any screen in this app offers.
 */
function addressesFor(kinds: readonly number[], author: string): string[] {
  const addresses: string[] = [];
  for (const kind of kinds) {
    // The grid's catch-all column carries a sentinel kind. It is excluded on
    // its own terms rather than by way of its spec happening to be marked
    // non-replaceable: an address built from a sentinel would ask a relay to
    // delete a range that does not exist.
    if (kind < 0) continue;
    const spec = kindSpec(kind);
    if (spec === undefined || !spec.replaceable) continue;
    addresses.push(`${kind}:${author}:${spec.dTag ?? ''}`);
  }
  return addresses;
}

/**
 * `k` tags, real kinds only.
 *
 * Negative numbers are filtered rather than trusted: the grid's catch-all
 * column carries a sentinel kind, and a `["k", "-1"]` tag on a signed event
 * published to a thousand relays is nonsense that cannot be recalled. The
 * engine resolves the catch-all to the kinds it actually found; this is the
 * backstop for anyone who forgets.
 */
function kindTags(kinds: readonly number[]): string[][] {
  return [...new Set(kinds)]
    .filter((kind) => kind >= 0)
    .sort((a, b) => a - b)
    .map((kind) => ['k', String(kind)]);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * One template per chunk of ids, with the shared tags repeated on each.
 *
 * Chunked because relays impose their own size limits and a request rejected
 * for being too large is a request that deleted nothing while looking sent.
 * The shared tags ride on every chunk deliberately: a purge where only the
 * first chunk reached a relay must still be a valid, complete request in its
 * own right.
 *
 * `createdAt` is a parameter rather than a call to `Date.now()` so this stays
 * pure — and it matters on the wire, since a relay applies an address deletion
 * only to events at or before the request's own timestamp.
 */
function build(
  ids: readonly string[],
  addresses: readonly string[],
  kinds: readonly number[],
  reason: string,
  createdAt: number,
): EventTemplate[] {
  // Nothing to name is not a request worth signing, let alone sending to a
  // thousand relays. `k` tags alone do not count: they say what the request is
  // about, not what it deletes, and a kind-5 carrying only those asks every
  // relay to do nothing while putting a signed event of yours on all of them.
  if (ids.length === 0 && addresses.length === 0) return [];

  const shared = [...addresses.map((address) => ['a', address]), ...kindTags(kinds)];
  const chunks = chunk(ids, PURGE_IDS_PER_EVENT);

  // Capped here, where every template is built, rather than at the input: a
  // reason set by any other route is signed and published just the same.
  const content = reason.slice(0, PURGE_REASON_MAX);

  if (chunks.length === 0) {
    return [{ kind: DELETE_KIND, created_at: createdAt, tags: shared, content }];
  }

  return chunks.map((batch) => ({
    kind: DELETE_KIND,
    created_at: createdAt,
    tags: [...batch.map((id) => ['e', id]), ...shared],
    content,
  }));
}

/**
 * A wholesale purge: every id found, plus an address for each replaceable
 * kind so the copies this app never saw go too.
 */
export function deleteRequests(scope: DeleteScope, createdAt: number): EventTemplate[] {
  return build(
    scope.ids,
    addressesFor(scope.kinds, scope.author),
    scope.kinds,
    scope.reason,
    createdAt,
  );
}

/**
 * A hand-picked purge: exactly the ids given, and nothing wider.
 *
 * No `a` tags — see the file header. The kinds are still declared, because a
 * relay is entitled to use them and because a request that names ids without
 * saying what they are makes a relay fetch each one before it can act.
 */
export function deleteRequestsForIds(scope: DeleteScope, createdAt: number): EventTemplate[] {
  return build(scope.ids, [], scope.kinds, scope.reason, createdAt);
}
