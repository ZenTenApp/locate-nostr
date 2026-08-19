import { describe, expect, it } from 'vitest';

import { KIND_SPECS } from '@/config/kinds';
import type { KindSpec } from '@/config/kinds';
import type { KindResult } from '@/services/sweep/types';
import { tooltipText } from '@/stores/tooltip-store';

import { cellTooltip, unreachableTooltip } from './cell-tooltip';

function spec(kind: number): KindSpec {
  const found = KIND_SPECS.find((entry) => entry.kind === kind);
  if (!found) throw new Error(`no spec for kind ${kind}`);
  return found;
}

function result(overrides: Partial<KindResult> = {}): KindResult {
  return {
    kind: 0,
    count: 1,
    approx: false,
    method: 'sample',
    status: 'ok',
    newest: null,
    mismatched: 0,
    note: null,
    ...overrides,
  };
}

describe('tooltipText', () => {
  it('does not double up punctuation on lines that are already sentences', () => {
    const spoken = tooltipText(cellTooltip(spec(0), result(), undefined));
    expect(spoken).not.toMatch(/\.\./);
  });

  it('still ends fragments with a stop, so a screen reader pauses', () => {
    expect(tooltipText({ title: 'profile', lines: ['1 item'] })).toBe('profile. 1 item.');
  });
});

describe('cellTooltip', () => {
  it('tells a locked relay apart from an empty one — the whole point of the glyph', () => {
    const locked = cellTooltip(spec(4), result({ count: 0, status: 'auth' }), undefined);
    const empty = cellTooltip(spec(4), result({ count: 0 }), undefined);

    expect(locked.title).toMatch(/sign-in required/i);
    expect(tooltipText(locked)).toMatch(/may well hold your data/i);
    expect(tooltipText(empty)).toMatch(/answered, and holds no/i);
    expect(locked.title).not.toBe(empty.title);
  });

  it('quotes the relay’s own refusal, which is the part worth reading', () => {
    const content = cellTooltip(
      spec(4),
      result({ count: 0, status: 'auth', note: 'auth-required: restricted to members' }),
      undefined,
    );
    expect(tooltipText(content)).toContain('auth-required: restricted to members');
  });

  it('says a timeout is not an answer of zero', () => {
    const content = cellTooltip(spec(0), result({ count: null, status: 'timeout' }), undefined);
    expect(tooltipText(content)).toMatch(/not the same as "nothing here"/i);
  });

  it('marks a capped count as a floor', () => {
    const content = cellTooltip(spec(4), result({ count: 25, approx: true }), undefined);
    expect(tooltipText(content)).toMatch(/at least 25 items/i);
    expect(content.tone).toBe('warning');
  });

  it('flags a forged newest event loudly', () => {
    const content = cellTooltip(
      spec(0),
      result({ newest: { id: 'a', pubkey: 'b', created_at: 1, verified: false } }),
      undefined,
    );
    expect(tooltipText(content)).toMatch(/signed with the wrong key/i);
    expect(content.tone).toBe('error');
  });

  it('flags a relay that answered with things nobody asked for', () => {
    const content = cellTooltip(spec(0), result({ mismatched: 3 }), undefined);
    expect(tooltipText(content)).toMatch(/cannot be trusted/i);
    expect(content.tone).toBe('error');
  });

  it('tells an active rejection apart from a dropped connection', () => {
    // Both arrive as status `error`; only one is the network's fault. Measured
    // on the live network — several relays refuse a kind-30315 filter outright.
    const rejected = cellTooltip(
      spec(30315),
      result({
        count: null,
        status: 'error',
        note: 'ERROR: bad req: filter validation failed: kind not allowed: 30315',
      }),
      undefined,
    );
    const dropped = cellTooltip(spec(30315), result({ count: null, status: 'error' }), undefined);

    expect(rejected.title).toMatch(/rejected the question/i);
    expect(tooltipText(rejected)).toMatch(/reachable and refused/i);
    expect(tooltipText(rejected)).toContain('kind not allowed: 30315');
    expect(tooltipText(dropped)).toMatch(/connection broke/i);
  });

  it('reports the change since the last check, and what it was before', () => {
    const content = cellTooltip(spec(0), result({ count: 5 }), {
      kind: 0,
      before: 2,
      after: 5,
      delta: 3,
    });
    expect(tooltipText(content)).toMatch(/\+3 since the last check \(was 2\)/i);
  });

  it('says "all of them are new" rather than "+10" when the last check found none', () => {
    // `+10` next to a total of 10 was read as "ten were added on top", which
    // is the one thing it does not mean.
    const content = cellTooltip(spec(4), result({ kind: 4, count: 10 }), {
      kind: 4,
      before: 0,
      after: 10,
      delta: 10,
    });
    expect(tooltipText(content)).toMatch(/last check found none here/i);
    expect(tooltipText(content)).toMatch(/all 10 items are new/i);
  });

  it('says nothing about a change when there is no baseline', () => {
    const content = cellTooltip(spec(0), result(), {
      kind: 0,
      before: null,
      after: 1,
      delta: null,
    });
    expect(tooltipText(content)).not.toMatch(/since the last check/i);
  });

  it('does not claim emptiness for a relay that never connected', () => {
    expect(tooltipText(unreachableTooltip(spec(0)))).toMatch(/could not connect/i);
  });
});
