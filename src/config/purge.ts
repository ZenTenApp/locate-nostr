/**
 * Purge tuning.
 *
 * A purge is the one thing this app does that cannot be undone by running it
 * again, so every number here is a bound on damage or on how much of the
 * damage is *visible*, not a performance dial:
 *
 *  - how many events are gathered before a delete request is built, so a
 *    relay holding half a million DMs cannot silently produce a request that
 *    covers the first two hundred of them and reads as complete;
 *  - how many ids go into one signed request, so a relay does not drop the
 *    whole thing as oversized and answer `OK true` to nothing;
 *  - how long a relay gets to acknowledge, because an unacknowledged delete
 *    is reported as unknown rather than as done.
 */

/**
 * NIP-09 delete request.
 *
 * Here rather than beside the builder because it is also the allowlist the
 * signer enforces: this app signs kind 5 and nothing else, and that check
 * cannot import from `services/purge` without pointing the identity layer at
 * the feature that uses it. `RELAY_DISCOVERY_KIND` sits in `config/sweep.ts`
 * for the same reason.
 */
export const DELETE_KIND = 5;

/**
 * Longest `content` a delete request carries.
 *
 * The reason is free text, and it is signed and sent to every targeted relay.
 * A pasted essay would be published a thousand times over; relays that cap
 * event size would reject the request wholesale, which reads as "the purge
 * failed" for a reason nobody can see.
 */
export const PURGE_REASON_MAX = 280;

/** Events pulled per kind, per relay, when working out what to delete.
 *
 *  Paged: the gather asks repeatedly with `until` until a short page arrives
 *  or {@link PURGE_MAX_PER_KIND} is reached. A relay that serves fewer than
 *  asked is finished; one that keeps serving is truncated, and the report
 *  says so rather than implying the purge was exhaustive. */
export const PURGE_PAGE_LIMIT = 500;

/** Ceiling on gathered ids per kind per relay. Ten pages of the above. A
 *  bigger number is a longer gather and a bigger signed request; the ceiling
 *  is reported, never hidden. */
export const PURGE_MAX_PER_KIND = 5_000;

/**
 * Ids per kind-5 event.
 *
 * NIP-09 puts no bound on `e` tags and relays do: several reject events above
 * a size limit outright, and a rejected delete request that nobody reads is
 * indistinguishable from a successful one. Chunking keeps each request small
 * enough to be accepted and turns "the delete failed" into a per-chunk `OK`
 * this app can show.
 */
export const PURGE_IDS_PER_EVENT = 200;

/** How long a relay gets to answer `OK` after a delete request is sent.
 *  Longer than a query timeout: a relay writing a deletion touches its index,
 *  and an unanswered request is reported as unknown, which is the worst
 *  outcome for the user to read. */
export const PUBLISH_TIMEOUT_MS = 10_000;

/** How long the gather waits for one page of ids. Matches the sweep's query
 *  budget — same relays, same question, bigger `limit`. */
export const PURGE_QUERY_TIMEOUT_MS = 8_000;

/** Typed by hand to confirm a purge. A destructive action reached by clicking
 *  through is one a user can perform by accident; typing this cannot be. It is
 *  the word the screen calls the action, so nobody is asked to type one thing
 *  while the button says another. */
export const PURGE_CONFIRM_WORD = 'PURGE';

/** Default `content` of the kind-5 request. Relays and other clients display
 *  it as the stated reason. */
export const PURGE_DEFAULT_REASON = 'Requested by the author from Locate';
