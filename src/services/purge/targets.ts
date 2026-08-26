/**
 * Which relays a purge is aimed at.
 *
 * Two ways of saying it, because the two questions people actually have are
 * opposites: "delete it from these three relays" and "delete it from
 * everywhere except my own". Expressing the second as the first means ticking
 * nine hundred boxes, and a user who gives up half way through has built a
 * purge that misses relays they meant to clear.
 *
 * Pure, and separate from the engine, because "what did I just point this at"
 * is the question a destructive action has to answer exactly.
 */
import type { RelayDescriptor } from '@/services/discovery/nip66';

export type TargetMode =
  /** Purge the ticked relays and nothing else. */
  | 'only'
  /** Purge everything in the list except the ticked relays. */
  | 'except';

/**
 * The relays a purge would touch.
 *
 * `relays` is the candidate list the user is looking at — the same selection
 * the sweep ran over — so a relay excluded from the sweep is excluded from the
 * purge, and the two screens cannot disagree about what "everything" means.
 */
export function resolveTargets(
  relays: readonly RelayDescriptor[],
  mode: TargetMode,
  picked: ReadonlySet<string>,
): RelayDescriptor[] {
  if (mode === 'only') return relays.filter((relay) => picked.has(relay.url));
  return relays.filter((relay) => !picked.has(relay.url));
}
