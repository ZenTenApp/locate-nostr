import { describe, expect, it } from 'vitest';

import { KIND_SPECS } from '@/config/kinds';
import type { KindSpec } from '@/config/kinds';
import type { RelayEvent, SampleResult } from '@/services/relay/socket';

import { resultFromSample } from './engine';
import type { SweepQuery } from './types';

const AUTHOR = '1'.repeat(64);

function spec(kind: number): KindSpec {
  const found = KIND_SPECS.find((entry) => entry.kind === kind);
  if (!found) throw new Error(`no spec for kind ${kind}`);
  return found;
}

function query(overrides: Partial<SweepQuery> = {}): SweepQuery {
  return {
    author: AUTHOR,
    kinds: [0],
    sampleLimit: 25,
    includeDarknet: false,
    includeStale: false,
    ...overrides,
  };
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

function sample(overrides: Partial<SampleResult> = {}): SampleResult {
  return { events: [], complete: true, refusal: null, ...overrides };
}

describe('resultFromSample', () => {
  it('reports an EOSEd empty relay as an exact zero', () => {
    const result = resultFromSample(spec(0), sample(), query());
    expect(result).toMatchObject({ count: 0, approx: false, method: 'sample', status: 'ok' });
  });

  it('refuses to call an unanswered query zero', () => {
    // The failure this whole app exists to prevent: a timeout rendering as
    // "nothing published here".
    const result = resultFromSample(
      spec(0),
      sample({ complete: false, refusal: { kind: 'timeout' } }),
      query(),
    );
    expect(result.count).toBeNull();
    expect(result.approx).toBe(false);
    expect(result.status).toBe('timeout');
  });

  it('reads an AUTH refusal off the CLOSED reason', () => {
    const result = resultFromSample(
      spec(4),
      sample({ complete: false, refusal: { kind: 'closed', message: 'auth-required: need AUTH' } }),
      query({ kinds: [4] }),
    );
    expect(result.status).toBe('auth');
    expect(result.note).toBe('auth-required: need AUTH');
  });

  it('treats a payment demand as its own status, not as an error', () => {
    const result = resultFromSample(
      spec(0),
      sample({
        complete: false,
        refusal: { kind: 'closed', message: 'payment-required: 1000 sats' },
      }),
      query(),
    );
    expect(result.status).toBe('payment');
  });

  it('marks a ceiling-capped sample as a floor', () => {
    const result = resultFromSample(
      spec(0),
      sample({ events: Array.from({ length: 25 }, () => event()) }),
      query({ sampleLimit: 25 }),
    );
    expect(result).toMatchObject({ count: 25, approx: true });
  });

  it('counts a refusal that still produced matching events as an answer', () => {
    const result = resultFromSample(
      spec(0),
      sample({ events: [event()], complete: false, refusal: { kind: 'timeout' } }),
      query(),
    );
    expect(result).toMatchObject({ count: 1, approx: true, status: 'ok' });
  });

  it('excludes events the relay was not asked for and flags the relay', () => {
    const result = resultFromSample(
      spec(0),
      sample({ events: [event(), event({ kind: 1 }), event({ kind: 7 })] }),
      query(),
    );
    expect(result.count).toBe(1);
    expect(result.mismatched).toBe(2);
  });

  it('flags an event whose signature does not verify', () => {
    const result = resultFromSample(spec(0), sample({ events: [event()] }), query());
    // The fixture's signature is nonsense, which is exactly what a relay
    // inventing events under someone's key produces. Found on the live
    // network during development — see the README.
    expect(result.newest?.verified).toBe(false);
  });
});
