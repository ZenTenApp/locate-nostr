/**
 * Which relays a purge would actually write to.
 *
 * One tick read the wrong way round is a deletion aimed at every relay the
 * user meant to keep, so the two modes are pinned rather than trusted to a
 * ternary in a component.
 */
import { describe, expect, it } from 'vitest';

import type { RelayDescriptor } from '@/services/discovery/nip66';

import { resolveTargets } from './targets';

function relay(url: string): RelayDescriptor {
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
    monitoredAt: 0,
    monitorCount: 1,
    pasted: false,
  };
}

const RELAYS = [relay('wss://a.example'), relay('wss://b.example'), relay('wss://c.example')];

describe('resolveTargets', () => {
  it('takes the ticked relays and nothing else', () => {
    const targets = resolveTargets(RELAYS, 'only', new Set(['wss://b.example']));
    expect(targets.map((entry) => entry.url)).toEqual(['wss://b.example']);
  });

  it('takes everything but the ticked relays', () => {
    const targets = resolveTargets(RELAYS, 'except', new Set(['wss://b.example']));
    expect(targets.map((entry) => entry.url)).toEqual(['wss://a.example', 'wss://c.example']);
  });

  it('targets nothing when nothing is ticked in only mode', () => {
    // The safe end of the switch: an empty selection deletes from nowhere,
    // and the button that runs it is disabled at zero.
    expect(resolveTargets(RELAYS, 'only', new Set())).toEqual([]);
  });

  it('targets everything when nothing is ticked in except mode', () => {
    expect(resolveTargets(RELAYS, 'except', new Set())).toHaveLength(3);
  });

  it('ignores ticks for relays that are not in the list', () => {
    // The list is the sweep's selection; a tick left over from a wider one
    // must not resurrect a relay the current settings exclude.
    const targets = resolveTargets(RELAYS, 'only', new Set(['wss://gone.example']));
    expect(targets).toEqual([]);
  });
});
