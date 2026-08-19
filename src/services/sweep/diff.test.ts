import { describe, expect, it } from 'vitest';

import { diffRelay, totalsOf } from './diff';
import type { KindResult, RelayResult } from './types';

function kind(overrides: Partial<KindResult> & { kind: number }): KindResult {
  return {
    count: 1,
    approx: false,
    method: 'count',
    status: 'ok',
    newest: null,
    mismatched: 0,
    note: null,
    ...overrides,
  };
}

function relay(overrides: Partial<RelayResult> = {}): RelayResult {
  return {
    url: 'wss://r.example',
    status: 'ok',
    connectMs: 40,
    totalMs: 300,
    kinds: { 0: kind({ kind: 0 }) },
    total: 1,
    hits: 1,
    error: null,
    ...overrides,
  };
}

describe('diffRelay', () => {
  it('calls a relay new when the last run never saw it', () => {
    expect(diffRelay(undefined, relay()).change).toBe('new');
  });

  it('calls it lost when it answered before and does not now', () => {
    expect(diffRelay(relay(), relay({ status: 'unreachable' })).change).toBe('lost');
  });

  it('calls it recovered the other way round', () => {
    expect(diffRelay(relay({ status: 'unreachable' }), relay()).change).toBe('recovered');
  });

  it('reports a per-kind delta', () => {
    const before = relay({ kinds: { 0: kind({ kind: 0, count: 2 }) } });
    const after = relay({ kinds: { 0: kind({ kind: 0, count: 5 }) } });
    const diff = diffRelay(before, after);
    expect(diff.change).toBe('changed');
    expect(diff.kinds[0]).toMatchObject({ before: 2, after: 5, delta: 3 });
  });

  it('leaves the delta unknown when either side never answered — a timeout is not a deletion', () => {
    const before = relay({ kinds: { 0: kind({ kind: 0, count: 4 }) } });
    const after = relay({ kinds: { 0: kind({ kind: 0, count: null, status: 'timeout' }) } });
    const diff = diffRelay(before, after);
    expect(diff.kinds[0]?.delta).toBeNull();
    expect(diff.change).toBe('same');
  });
});

describe('totalsOf', () => {
  it('separates answered, carrying and unreachable', () => {
    const totals = totalsOf([
      relay(),
      relay({ url: 'wss://b.example', hits: 0, total: 0 }),
      relay({ url: 'wss://c.example', status: 'unreachable', hits: 0, total: null, kinds: {} }),
    ]);
    expect(totals).toMatchObject({
      relays: 3,
      answered: 2,
      carrying: 1,
      unreachable: 1,
      events: 1,
    });
  });

  it('flags relays that ignore filters and relays that demand AUTH', () => {
    const totals = totalsOf([
      relay({ kinds: { 0: kind({ kind: 0, mismatched: 3 }) } }),
      relay({ url: 'wss://b.example', kinds: { 4: kind({ kind: 4, count: 0, status: 'auth' }) } }),
    ]);
    expect(totals.misbehaving).toBe(1);
    expect(totals.authGated).toBe(1);
  });
});
