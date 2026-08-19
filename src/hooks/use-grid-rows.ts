/**
 * Turning the directory and the results into the rows the grid draws.
 *
 * Kept out of the components because it runs on every keystroke in the filter
 * box over thirteen hundred rows, and because "which relays match" is the
 * question the whole UI is a view of — worth one place, memoised, testable.
 */
import { useMemo } from 'react';

import type { RelayDescriptor } from '@/services/discovery/nip66';
import { diffRelay } from '@/services/sweep/diff';
import type { RelayDiff } from '@/services/sweep/diff';
import type { RelayResult } from '@/services/sweep/types';

export type SortKey = 'hits' | 'events' | 'latency' | 'url' | 'change';

/** What the grid can be narrowed to. Every field is a widening default so an
 *  untouched filter bar shows the whole sweep. */
export interface GridFilters {
  text: string;
  /** Only relays holding at least one event of at least one queried kind. */
  carryingOnly: boolean;
  /** Only relays that answered at all. */
  answeredOnly: boolean;
  /** Only relays holding this kind. `null` for any. */
  kind: number | null;
  /** Hide relays that want AUTH or payment before they will answer. */
  hideGated: boolean;
  /** Only relays whose counts changed since the cached baseline. */
  changedOnly: boolean;
  sort: SortKey;
  descending: boolean;
}

export const DEFAULT_FILTERS: GridFilters = {
  text: '',
  carryingOnly: false,
  answeredOnly: false,
  kind: null,
  hideGated: false,
  changedOnly: false,
  // Most events first. Sorting by how many *types* a relay carries buries the
  // relay holding four thousand of your messages under one holding a single
  // copy of each of six things.
  sort: 'events',
  descending: true,
};

export interface GridRow {
  relay: RelayDescriptor;
  /** Absent until this relay has been swept — during a run most rows are. */
  result: RelayResult | undefined;
  diff: RelayDiff | null;
}

function isGated(row: GridRow): boolean {
  if (row.relay.requiresAuth === true || row.relay.requiresPayment === true) return true;
  return Object.values(row.result?.kinds ?? {}).some(
    (kind) => kind.status === 'auth' || kind.status === 'payment',
  );
}

function matchesText(row: GridRow, needle: string): boolean {
  if (needle === '') return true;
  const lowered = needle.toLowerCase();
  return (
    row.relay.url.toLowerCase().includes(lowered) ||
    (row.relay.name?.toLowerCase().includes(lowered) ?? false) ||
    (row.relay.software?.toLowerCase().includes(lowered) ?? false)
  );
}

/** Rows with no result sort last whatever the key: a relay that has not been
 *  swept yet is not "the least interesting", it is unknown, and letting it
 *  sort as zero makes a running sweep reorder itself constantly. */
function compare(a: GridRow, b: GridRow, sort: SortKey): number {
  if (sort === 'url') return a.relay.url.localeCompare(b.relay.url);
  if (sort === 'change') {
    const rank = (row: GridRow) => (row.diff?.change === 'same' || !row.diff ? 0 : 1);
    return rank(a) - rank(b);
  }

  const value = (row: GridRow): number | null => {
    if (!row.result) return null;
    if (sort === 'hits') return row.result.hits;
    if (sort === 'events') return row.result.total;
    return row.result.connectMs === null ? null : -row.result.connectMs;
  };

  const left = value(a);
  const right = value(b);
  if (left === null && right === null) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left - right;
}

/**
 * The rows the grid draws, as a pure function.
 *
 * Separate from the hook so it can be tested without a renderer: this is the
 * whole of what the user sees — which relays appear, in what order — and it is
 * ordinary data in, ordinary data out.
 */
export function buildRows(
  relays: readonly RelayDescriptor[],
  results: Map<string, RelayResult>,
  baseline: Map<string, RelayResult>,
  filters: GridFilters,
): { rows: GridRow[]; total: number } {
  {
    const all: GridRow[] = relays.map((relay) => {
      const result = results.get(relay.url);
      return {
        relay,
        result,
        diff: result && baseline.size > 0 ? diffRelay(baseline.get(relay.url), result) : null,
      };
    });

    const rows = all.filter((row) => {
      if (!matchesText(row, filters.text)) return false;
      if (filters.answeredOnly && row.result?.status !== 'ok') return false;
      if (filters.carryingOnly && (row.result?.hits ?? 0) === 0) return false;
      if (filters.hideGated && isGated(row)) return false;
      if (filters.changedOnly && (row.diff === null || row.diff.change === 'same')) return false;
      if (filters.kind !== null) {
        const kindResult = row.result?.kinds[filters.kind];
        if (!kindResult || (kindResult.count ?? 0) === 0) return false;
      }
      return true;
    });

    rows.sort((a, b) => {
      const ordered = compare(a, b, filters.sort);
      return filters.descending ? -ordered : ordered;
    });

    return { rows, total: all.length };
  }
}

/** {@link buildRows}, memoised. It runs on every keystroke in the filter box
 *  over thirteen hundred rows. */
export function useGridRows(
  relays: readonly RelayDescriptor[],
  results: Map<string, RelayResult>,
  baseline: Map<string, RelayResult>,
  filters: GridFilters,
): { rows: GridRow[]; total: number } {
  return useMemo(
    () => buildRows(relays, results, baseline, filters),
    [relays, results, baseline, filters],
  );
}
