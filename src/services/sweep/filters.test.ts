import { describe, expect, it } from 'vitest';

import { KIND_SPECS, USER_STATUS_D } from '@/config/kinds';
import type { KindSpec } from '@/config/kinds';
import type { RelayEvent } from '@/services/relay/socket';

import { eventMatches, filtersFor, newestOf, splitMatches } from './filters';

const AUTHOR = '1'.repeat(64);
const OTHER = '2'.repeat(64);

function spec(kind: number): KindSpec {
  const found = KIND_SPECS.find((entry) => entry.kind === kind);
  if (!found) throw new Error(`no spec for kind ${kind}`);
  return found;
}

function event(overrides: Partial<RelayEvent> = {}): RelayEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: AUTHOR,
    created_at: 1_770_000_000,
    kind: 0,
    tags: [],
    content: '',
    sig: 'b'.repeat(128),
    ...overrides,
  };
}

describe('filtersFor', () => {
  it('always filters by author — there is no unfiltered query', () => {
    expect(filtersFor(spec(0), AUTHOR)).toEqual([{ kinds: [0], authors: [AUTHOR] }]);
  });

  it('pins the status d tag, so the count is of this status type only', () => {
    expect(filtersFor(spec(30315), AUTHOR)).toEqual([
      { kinds: [30315], '#d': [USER_STATUS_D], authors: [AUTHOR] },
    ]);
  });

  it('asks for both halves of a DM: authored by, and addressed to', () => {
    expect(filtersFor(spec(4), AUTHOR)).toEqual([
      { kinds: [4], authors: [AUTHOR] },
      { kinds: [4], '#p': [AUTHOR] },
    ]);
  });

  it('asks only for authorship of a kind that is not addressed to anyone', () => {
    expect(filtersFor(spec(10002), AUTHOR)).toEqual([{ kinds: [10002], authors: [AUTHOR] }]);
  });
});

describe('eventMatches', () => {
  it('rejects a relay answering with the wrong kind', () => {
    expect(eventMatches(event({ kind: 1 }), spec(0), AUTHOR)).toBe(false);
  });

  it('rejects a relay ignoring the authors filter', () => {
    expect(eventMatches(event({ pubkey: OTHER }), spec(0), AUTHOR)).toBe(false);
  });

  it('accepts a DM addressed to the identity but written by someone else', () => {
    const dm = event({ kind: 4, pubkey: OTHER, tags: [['p', AUTHOR]] });
    expect(eventMatches(dm, spec(4), AUTHOR)).toBe(true);
  });

  it('does not extend the p-tag rule to kinds that are not addressed', () => {
    const meta = event({ kind: 0, pubkey: OTHER, tags: [['p', AUTHOR]] });
    expect(eventMatches(meta, spec(0), AUTHOR)).toBe(false);
  });

  it('rejects a status published under a different d tag', () => {
    const music = event({ kind: 30315, tags: [['d', 'music']] });
    expect(eventMatches(music, spec(30315), AUTHOR)).toBe(false);
  });
});

describe('splitMatches', () => {
  it('counts what the relay was not asked for separately', () => {
    const { matched, mismatched } = splitMatches(
      [event(), event({ kind: 1 }), event({ pubkey: OTHER })],
      spec(0),
      AUTHOR,
    );
    expect(matched).toHaveLength(1);
    expect(mismatched).toBe(2);
  });
});

describe('newestOf', () => {
  it('takes the max rather than trusting the relay to sort', () => {
    const newest = newestOf([
      event({ id: 'old', created_at: 10 }),
      event({ id: 'new', created_at: 99 }),
      event({ id: 'mid', created_at: 50 }),
    ]);
    expect(newest?.id).toBe('new');
  });

  it('returns null for an empty sample', () => {
    expect(newestOf([])).toBeNull();
  });
});
