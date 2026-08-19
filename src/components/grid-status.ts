/**
 * Why the result grid is empty — four different facts that looked like one.
 *
 * "No relay matches these filters" was shown for all of them, including while
 * the relay list was still being fetched, when there were no filters to blame
 * and nothing had been ruled out yet. An empty grid during work reads as a
 * finished answer of "nothing", which is the failure this whole app exists to
 * avoid.
 *
 * Its own module rather than living beside the grid: a file that exports both
 * components and plain functions cannot be fast-refreshed.
 */
export type GridStatus =
  /** No relay list yet — the trackers are still being asked. */
  | 'finding-relays'
  /** Asked, and no relay list came back. Not the filters' doing. */
  | 'no-relays'
  /** A check is running; these filters have simply matched nothing so far. */
  | 'checking'
  | 'idle';

/**
 * Which of the four an empty grid is.
 *
 * Pure and tested: every branch is a sentence the user reads in place of
 * results, and the wrong one turns "still working" into "there is nothing".
 */
export function gridStatusFor(input: {
  relayCount: number;
  directoryLoading: boolean;
  running: boolean;
}): GridStatus {
  if (input.relayCount === 0) return input.directoryLoading ? 'finding-relays' : 'no-relays';
  return input.running ? 'checking' : 'idle';
}
