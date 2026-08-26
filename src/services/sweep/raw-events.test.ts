import { describe, expect, it } from 'vitest';

import type { RelayEvent } from '@/services/relay/socket';

import { eventsToJson } from './raw-events';
import type { InspectedEvent } from './raw-events';

function event(overrides: Partial<RelayEvent> = {}): RelayEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_770_000_000,
    kind: 0,
    tags: [['d', 'general']],
    content: '{"name":"someone"}',
    sig: 'c'.repeat(128),
    ...overrides,
  };
}

function inspected(overrides: Partial<InspectedEvent> = {}): InspectedEvent {
  return { event: event(), verified: true, offFilter: false, counted: true, ...overrides };
}

describe('eventsToJson', () => {
  it('emits the events as a relay served them, without this app’s annotations', () => {
    // What gets copied has to be pasteable into another Nostr tool, so the
    // `verified` and `offFilter` verdicts — which are ours, not the relay's —
    // must not appear in it.
    const json = eventsToJson([inspected({ verified: false, offFilter: true })]);
    const parsed: unknown = JSON.parse(json);

    expect(Array.isArray(parsed)).toBe(true);
    expect(json).not.toContain('verified');
    expect(json).not.toContain('offFilter');
    expect(json).not.toContain('counted');
    expect((parsed as RelayEvent[])[0]).toEqual(event());
  });

  it('pretty-prints, because the point is reading it', () => {
    expect(eventsToJson([inspected()])).toContain('\n  ');
  });

  it('is an empty array when the relay served nothing', () => {
    expect(eventsToJson([])).toBe('[]');
  });
});
