import { describe, expect, it } from 'vitest';

import type { RelayEvent } from '@/services/relay/socket';

import { mergeDiscoveryEvents, readDiscoveryEvent } from './nip66';

/** Shaped after a real monitor event — see the tag set on
 *  `wss://spatia-arcana.com` in the August 2026 measurement run. */
function event(overrides: Partial<RelayEvent> = {}): RelayEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_770_000_000,
    kind: 30166,
    tags: [
      ['d', 'wss://relay.example.com/'],
      ['n', 'clearnet'],
      ['N', '1'],
      ['N', '45'],
      ['R', '!auth'],
      ['R', 'payment'],
      ['rtt-open', '506'],
    ],
    content: '{"name":"Example","software":"git+https://github.com/hoytech/strfry"}',
    sig: 'c'.repeat(128),
    ...overrides,
  };
}

describe('readDiscoveryEvent', () => {
  it('reads the relay, its NIPs and its requirements', () => {
    const descriptor = readDiscoveryEvent(event());
    expect(descriptor).toMatchObject({
      url: 'wss://relay.example.com',
      nips: [1, 45],
      requiresAuth: false,
      requiresPayment: true,
      rttOpenMs: 506,
      name: 'Example',
      software: 'strfry',
    });
  });

  it('leaves a requirement no monitor mentioned as unknown, not as false', () => {
    const descriptor = readDiscoveryEvent(event({ tags: [['d', 'wss://relay.example.com']] }));
    expect(descriptor?.requiresAuth).toBeNull();
    expect(descriptor?.requiresPayment).toBeNull();
  });

  it('survives a NIP-11 document that is not JSON', () => {
    expect(readDiscoveryEvent(event({ content: 'not json' }))?.name).toBeNull();
  });

  it('drops an event with no relay in it', () => {
    expect(readDiscoveryEvent(event({ tags: [['n', 'clearnet']] }))).toBeNull();
  });

  it('trusts the monitor’s network tag over the hostname', () => {
    const descriptor = readDiscoveryEvent(
      event({
        tags: [
          ['d', 'wss://relay.example.com'],
          ['n', 'tor'],
        ],
      }),
    );
    expect(descriptor?.network).toBe('tor');
  });
});

describe('mergeDiscoveryEvents', () => {
  it('counts distinct monitors and unions their NIP lists', () => {
    const merged = mergeDiscoveryEvents([
      event(),
      event({
        pubkey: 'd'.repeat(64),
        created_at: 1_770_000_100,
        tags: [
          ['d', 'wss://relay.example.com'],
          ['N', '50'],
        ],
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.monitorCount).toBe(2);
    // Unioned: a NIP one monitor never probed is missing from its report, not
    // absent from the relay.
    expect(merged[0]?.nips).toEqual([1, 45, 50]);
  });

  it('takes scalar fields from the freshest report', () => {
    const merged = mergeDiscoveryEvents([
      event({
        created_at: 1_770_000_000,
        tags: [
          ['d', 'wss://r.example'],
          ['R', '!auth'],
        ],
      }),
      event({
        pubkey: 'e'.repeat(64),
        created_at: 1_770_000_500,
        tags: [
          ['d', 'wss://r.example'],
          ['R', 'auth'],
        ],
      }),
    ]);
    expect(merged[0]?.requiresAuth).toBe(true);
  });

  it('treats the trailing-slash and bare forms as one relay', () => {
    const merged = mergeDiscoveryEvents([
      event({ tags: [['d', 'wss://r.example/']] }),
      event({ pubkey: 'f'.repeat(64), tags: [['d', 'wss://r.example']] }),
    ]);
    expect(merged).toHaveLength(1);
  });
});
