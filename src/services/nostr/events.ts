/**
 * The two shapes of an event this app *writes*, as opposed to reads.
 *
 * Everything arriving from a relay is a {@link RelayEvent} — untrusted, parsed
 * defensively. These are the other direction: a template this app built and
 * intends to sign, and the signed result it will publish. They are separate
 * types on purpose, so a function that publishes cannot be handed something
 * nobody has signed yet.
 */

/** An event before it has an author, an id or a signature. */
export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

/** A template after signing — the wire form NIP-01 `EVENT` carries. */
export interface SignedEvent extends EventTemplate {
  id: string;
  pubkey: string;
  sig: string;
}
