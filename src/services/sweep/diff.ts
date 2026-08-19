/**
 * What changed since the last time this question was asked.
 *
 * The cache exists so a repeat sweep is instant; the diff is what makes the
 * cache worth having. "This relay dropped your profile" and "this relay
 * appeared" are the findings a user comes back for, and neither is visible in
 * a grid that only ever shows the current run.
 *
 * Compared per relay and per kind rather than on totals: a relay that gained
 * 400 kind-4s and lost the user's kind-0 has an unremarkable total and a
 * change worth a red cell.
 */
import type { KindResult, RelayResult, SweepSnapshot } from '@/services/sweep/types';

export type RelayChange =
  /** Not in the previous run at all. */
  | 'new'
  /** Answered last time, did not this time. */
  | 'lost'
  /** Did not answer last time, does now. */
  | 'recovered'
  | 'changed'
  | 'same';

export interface KindDelta {
  kind: number;
  before: number | null;
  after: number | null;
  /** `null` when either side is unknown — an unanswered kind has no delta,
   *  and rendering one as `-6` would report a timeout as a deletion. */
  delta: number | null;
}

export interface RelayDiff {
  change: RelayChange;
  kinds: KindDelta[];
}

function countOf(result: KindResult | undefined): number | null {
  return result?.count ?? null;
}

export function diffRelay(before: RelayResult | undefined, after: RelayResult): RelayDiff {
  if (!before) return { change: 'new', kinds: [] };

  const kinds: KindDelta[] = [];
  let changed = false;
  for (const key of Object.keys(after.kinds)) {
    const kind = Number(key);
    const beforeCount = countOf(before.kinds[kind]);
    const afterCount = countOf(after.kinds[kind]);
    const delta = beforeCount === null || afterCount === null ? null : afterCount - beforeCount;
    if (delta !== null && delta !== 0) changed = true;
    kinds.push({ kind, before: beforeCount, after: afterCount, delta });
  }

  if (before.status === 'ok' && after.status !== 'ok') return { change: 'lost', kinds };
  if (before.status !== 'ok' && after.status === 'ok') return { change: 'recovered', kinds };
  return { change: changed ? 'changed' : 'same', kinds };
}

/** Index a cached run by relay URL, for lookup while the next one streams. */
export function baselineOf(snapshot: SweepSnapshot | null): Map<string, RelayResult> {
  if (!snapshot) return new Map();
  return new Map(snapshot.results.map((result) => [result.url, result]));
}

export interface SweepTotals {
  relays: number;
  answered: number;
  unreachable: number;
  /** Relays holding at least one event of at least one queried kind. */
  carrying: number;
  /** Summed across relays, so an event stored on five relays counts five
   *  times. That is the intended reading — this is a measure of where data
   *  lives, not of how many distinct events exist. */
  events: number;
  /** Relays that returned events not matching the filter they were sent. */
  misbehaving: number;
  authGated: number;
}

export function totalsOf(results: readonly RelayResult[]): SweepTotals {
  const totals: SweepTotals = {
    relays: results.length,
    answered: 0,
    unreachable: 0,
    carrying: 0,
    events: 0,
    misbehaving: 0,
    authGated: 0,
  };

  for (const result of results) {
    if (result.status === 'ok') totals.answered += 1;
    if (result.status === 'unreachable') totals.unreachable += 1;
    if (result.hits > 0) totals.carrying += 1;
    if (result.total !== null) totals.events += result.total;

    const kinds = Object.values(result.kinds);
    if (kinds.some((kind) => kind.mismatched > 0)) totals.misbehaving += 1;
    if (kinds.some((kind) => kind.status === 'auth')) totals.authGated += 1;
  }

  return totals;
}
