/**
 * Filtering and sorting, which is what the user actually looks at.
 *
 * `useGridRows` is `buildRows` plus a `useMemo`, so the logic is tested
 * directly and no renderer is involved.
 */
import { describe, expect, it } from 'vitest';

import type { RelayDescriptor } from '@/services/discovery/nip66';
import type { KindResult, RelayResult } from '@/services/sweep/types';

import { buildRows, DEFAULT_FILTERS, WIDE_FILTERS } from './use-grid-rows';
import type { GridFilters } from './use-grid-rows';

function relay(url: string, overrides: Partial<RelayDescriptor> = {}): RelayDescriptor {
  return {
    url,
    host: url.replace('wss://', ''),
    network: 'clearnet',
    secure: true,
    nips: [],
    requiresAuth: null,
    requiresPayment: null,
    rttOpenMs: null,
    name: null,
    software: null,
    monitoredAt: 1_770_000_000,
    monitorCount: 1,
    pasted: false,
    ...overrides,
  };
}

function kind(kindNumber: number, count: number | null): KindResult {
  return {
    kind: kindNumber,
    count,
    approx: false,
    method: 'sample',
    status: count === null ? 'timeout' : 'ok',
    newest: null,
    mismatched: 0,
    note: null,
  };
}

function result(url: string, overrides: Partial<RelayResult> = {}): RelayResult {
  return {
    url,
    status: 'ok',
    connectMs: 100,
    totalMs: 200,
    kinds: { 0: kind(0, 1) },
    total: 1,
    hits: 1,
    error: null,
    ...overrides,
  };
}

/**
 * Rows for one set of relays and results, with every filter widened.
 *
 * The baseline is deliberately not `DEFAULT_FILTERS`: `carryingOnly` ships on,
 * and leaving it on here would mean every test about some *other* filter had
 * two of them running, so an assertion could no longer say which one dropped a
 * row. The default itself is asserted on its own below.
 */
function rowsFor(
  relays: RelayDescriptor[],
  results: RelayResult[],
  filters: Partial<GridFilters> = {},
) {
  return buildRows(relays, new Map(results.map((entry) => [entry.url, entry])), new Map(), {
    ...DEFAULT_FILTERS,
    carryingOnly: false,
    ...filters,
  });
}

describe('buildRows', () => {
  const relays = [relay('wss://a.example'), relay('wss://b.example'), relay('wss://c.example')];

  it('keeps relays that have not been reached yet', () => {
    // Mid-run, most rows have no result. Dropping them would make the grid
    // appear to shrink as the check progresses.
    const { rows, total } = rowsFor(relays, [result('wss://a.example')]);
    expect(total).toBe(3);
    expect(rows).toHaveLength(3);
  });

  it('sorts by events held, with unswept relays last whatever the order', () => {
    // A relay that has not answered is unknown, not zero: sorting it as zero
    // makes a running check reorder itself constantly.
    const { rows } = rowsFor(relays, [
      result('wss://a.example', { total: 5 }),
      result('wss://b.example', { total: 900 }),
    ]);
    expect(rows.map((row) => row.relay.url)).toEqual([
      'wss://b.example',
      'wss://a.example',
      'wss://c.example',
    ]);
  });

  it('filters to relays that hold something', () => {
    const { rows } = rowsFor(
      relays,
      [result('wss://a.example', { hits: 0, total: 0 }), result('wss://b.example')],
      { carryingOnly: true },
    );
    expect(rows.map((row) => row.relay.url)).toEqual(['wss://b.example']);
  });

  it('holds something is on out of the box', () => {
    // The one filter that ships on: a full sweep is mostly relays holding
    // nothing, and the dozen that matter are unreadable underneath them.
    expect(DEFAULT_FILTERS.carryingOnly).toBe(true);
  });

  it('filters to relays that replied at all', () => {
    const { rows } = rowsFor(
      relays,
      [result('wss://a.example', { status: 'unreachable' }), result('wss://b.example')],
      { answeredOnly: true },
    );
    expect(rows.map((row) => row.relay.url)).toEqual(['wss://b.example']);
  });

  it('filters to a single kind, counting zero as not holding it', () => {
    const { rows } = rowsFor(
      relays,
      [
        result('wss://a.example', { kinds: { 4: kind(4, 0) } }),
        result('wss://b.example', { kinds: { 4: kind(4, 12) } }),
      ],
      { kind: 4 },
    );
    expect(rows.map((row) => row.relay.url)).toEqual(['wss://b.example']);
  });

  it('hides relays gated by auth or payment, from either source', () => {
    const gated = [
      relay('wss://auth.example', { requiresAuth: true }),
      relay('wss://paid.example', { requiresPayment: true }),
      relay('wss://open.example'),
    ];
    const { rows } = rowsFor(
      gated,
      [
        result('wss://auth.example'),
        result('wss://paid.example'),
        result('wss://open.example'),
        // Gating discovered during the check, not reported by a tracker.
        result('wss://open.example', {
          kinds: { 4: { ...kind(4, 0), status: 'auth' } },
        }),
      ],
      { hideGated: true },
    );
    expect(rows.map((row) => row.relay.url)).toEqual([]);
  });

  it('searches host, name and software together', () => {
    const named = [
      relay('wss://a.example', { name: 'Purple Pages' }),
      relay('wss://b.example', { software: 'strfry' }),
      relay('wss://strfry-lookalike.example'),
    ];
    expect(rowsFor(named, [], { text: 'purple' }).rows).toHaveLength(1);
    expect(rowsFor(named, [], { text: 'strfry' }).rows).toHaveLength(2);
    expect(rowsFor(named, [], { text: 'nothing-matches' }).rows).toHaveLength(0);
  });

  it('sorts by name when asked, ascending', () => {
    const { rows } = rowsFor(relays, [], { sort: 'url', descending: false });
    expect(rows.map((row) => row.relay.url)).toEqual([
      'wss://a.example',
      'wss://b.example',
      'wss://c.example',
    ]);
  });

  it('offers no diff when there is no previous run to compare against', () => {
    const { rows } = rowsFor(relays, [result('wss://a.example')]);
    expect(rows.every((row) => row.diff === null)).toBe(true);
  });
});

describe('the filter presets', () => {
  it('opens narrowed by exactly one thing, and widens to nothing', () => {
    // The pair is one object plus an override, so a seventh narrowing filter
    // added tomorrow is off in `WIDE_FILTERS` by construction. Spelled out
    // twice, "show all" could quietly keep one on and simply show fewer rows
    // than it promises — a failure with no symptom but a shorter list.
    const narrowed = Object.entries(WIDE_FILTERS).filter(([key]) => {
      const wide = WIDE_FILTERS[key as keyof typeof WIDE_FILTERS];
      return DEFAULT_FILTERS[key as keyof typeof WIDE_FILTERS] !== wide;
    });

    expect(narrowed.map(([key]) => key)).toEqual(['carryingOnly']);
    expect(
      Object.values(WIDE_FILTERS).every(
        (value) => value === '' || value === false || value === null,
      ),
    ).toBe(true);
  });
});
