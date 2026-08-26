import { describe, expect, it } from 'vitest';

import type { RelayDescriptor } from './nip66';
import { isStale, selectRelays, selectionBreakdown, withPastedRelays } from './directory';

const NOW = 1_780_000_000_000;

function relay(overrides: Partial<RelayDescriptor> = {}): RelayDescriptor {
  return {
    url: 'wss://a.example',
    host: 'a.example',
    network: 'clearnet',
    secure: true,
    nips: [1],
    requiresAuth: null,
    requiresPayment: null,
    rttOpenMs: null,
    name: null,
    software: null,
    monitoredAt: Math.floor(NOW / 1000) - 60,
    monitorCount: 3,
    pasted: false,
    ...overrides,
  };
}

describe('isStale', () => {
  it('is false for a relay a monitor saw a minute ago', () => {
    expect(isStale(relay(), NOW)).toBe(false);
  });

  it('is true past a day', () => {
    expect(isStale(relay({ monitoredAt: Math.floor(NOW / 1000) - 90_000 }), NOW)).toBe(true);
  });

  it('never calls a pasted relay stale — no monitor was ever going to report it', () => {
    expect(isStale(relay({ pasted: true, monitoredAt: 0 }), NOW)).toBe(false);
  });
});

describe('withPastedRelays', () => {
  it('keeps monitor metadata for a relay the user also pasted', () => {
    const merged = withPastedRelays(
      [relay({ nips: [1, 45] })],
      [{ url: 'wss://a.example', host: 'a.example', secure: true, network: 'clearnet' }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.nips).toEqual([1, 45]);
    expect(merged[0]?.pasted).toBe(false);
  });

  it('adds an unknown relay with its metadata marked unknown rather than guessed', () => {
    const merged = withPastedRelays(
      [],
      [{ url: 'wss://new.example', host: 'new.example', secure: true, network: 'clearnet' }],
    );
    expect(merged[0]).toMatchObject({
      pasted: true,
      nips: [],
      requiresAuth: null,
      monitorCount: 0,
    });
  });
});

describe('selectRelays', () => {
  const directory = [
    relay(),
    relay({ url: 'wss://tor.example', network: 'tor' }),
    relay({ url: 'wss://old.example', monitoredAt: Math.floor(NOW / 1000) - 90_000 }),
  ];

  it('sweeps only fresh clearnet relays by default', () => {
    const selected = selectRelays(
      directory,
      { source: 'both', includeDarknet: false, includeStale: false, pasted: '' },
      NOW,
    );
    expect(selected.map((entry) => entry.url)).toEqual(['wss://a.example']);
  });

  it('opts darknet and stale relays back in', () => {
    const selected = selectRelays(
      directory,
      { source: 'both', includeDarknet: true, includeStale: true, pasted: '' },
      NOW,
    );
    expect(selected).toHaveLength(3);
  });

  it('never skips a pasted relay for looking dead — the user named it', () => {
    const selected = selectRelays(
      directory,
      {
        source: 'both',
        includeDarknet: false,
        includeStale: false,
        pasted: 'wss://old.example',
      },
      NOW,
    );
    expect(selected.map((entry) => entry.url)).toEqual(['wss://a.example', 'wss://old.example']);
  });

  it('checks only the pasted list when told to, keeping what the trackers know', () => {
    const selected = selectRelays(
      directory,
      {
        source: 'pasted',
        includeDarknet: false,
        includeStale: false,
        pasted: 'wss://a.example\nwss://mine.example',
      },
      NOW,
    );
    expect(selected.map((entry) => entry.url)).toEqual(['wss://a.example', 'wss://mine.example']);
    // The tracker's metadata survives being named by hand — a pasted relay the
    // monitors know is not blanked out.
    expect(selected[0]?.pasted).toBe(false);
    expect(selected[1]?.pasted).toBe(true);
  });

  it('includes pasted relays and drops the unparseable ones', () => {
    const selected = selectRelays(
      directory,
      {
        source: 'both',
        includeDarknet: false,
        includeStale: false,
        pasted: 'wss://mine.example\nnot a relay',
      },
      NOW,
    );
    expect(selected.map((entry) => entry.url)).toEqual(['wss://a.example', 'wss://mine.example']);
  });
});

describe('selectionBreakdown', () => {
  const directory = [
    relay(),
    relay({ url: 'wss://tor.example', network: 'tor' }),
    relay({ url: 'wss://old.example', monitoredAt: Math.floor(NOW / 1000) - 90_000 }),
  ];

  it('accounts for every relay, so the two numbers on screen reconcile', () => {
    const breakdown = selectionBreakdown(
      directory,
      { source: 'both', includeDarknet: false, includeStale: false, pasted: '' },
      NOW,
    );
    expect(breakdown).toMatchObject({ total: 3, darknet: 1, stale: 1, pasted: 0, selected: 1 });
    expect(breakdown.darknet + breakdown.stale + breakdown.selected).toBe(breakdown.total);
  });

  it('counts a stale onion relay once, under the reason that excluded it', () => {
    const breakdown = selectionBreakdown(
      [relay({ url: 'wss://old.onion', network: 'tor', monitoredAt: 0 })],
      { source: 'both', includeDarknet: false, includeStale: false, pasted: '' },
      NOW,
    );
    expect(breakdown.darknet).toBe(1);
    expect(breakdown.stale).toBe(0);
  });

  it('counts pasted relays and still sweeps them', () => {
    const breakdown = selectionBreakdown(
      directory,
      { source: 'both', includeDarknet: false, includeStale: false, pasted: 'wss://mine.example' },
      NOW,
    );
    expect(breakdown.pasted).toBe(1);
    expect(breakdown.selected).toBe(2);
  });
});
