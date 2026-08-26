/**
 * The purge, end to end against a fake relay.
 *
 * This is the destructive path, so the properties pinned here are the ones
 * whose failure is invisible until it is too late: that only the author's own
 * events are ever named, that one signature is reused across every target
 * rather than one prompt per relay, and that a relay's silence is reported as
 * silence rather than rounded to success or failure.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OTHER_KIND } from '@/config/kinds';
import type { RelayDescriptor } from '@/services/discovery/nip66';
import type { EventTemplate, SignedEvent } from '@/services/nostr/events';
import type { Signer } from '@/services/nostr/signer';

import { runPurge } from './engine';

const AUTHOR = 'a'.repeat(64);
const STRANGER = 'b'.repeat(64);
const NOW = 1_770_000_000;

function event(id: string, pubkey: string, kind: number) {
  return { id, pubkey, created_at: NOW, kind, tags: [], content: '', sig: 'c'.repeat(128) };
}

/** How the fake relays behave for one test. */
const relayBehaviour = {
  /** What every relay serves for a `REQ`. */
  events: [] as ReturnType<typeof event>[],
  /** `true` → `OK true`, `false` → `OK false`, `null` → the socket drops
   *  without answering, which is the fast stand-in for a relay that never
   *  acknowledges (the slow one is the ten-second publish timeout). */
  ack: true as boolean | null,
  /** Every event published, per relay URL. */
  published: new Map<string, SignedEvent[]>(),
};

/** A relay that answers on its own, so the engine can be driven end to end. */
class FakeRelay {
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readyState = 1;
  static readonly OPEN = 1;

  readonly url: string;

  constructor(url: string) {
    this.url = url;
    setTimeout(() => this.onopen?.({}), 0);
  }

  send(raw: string): void {
    const message: unknown = JSON.parse(raw);
    if (!Array.isArray(message)) return;
    const [verb, payload] = message as [string, unknown];

    if (verb === 'REQ') {
      const id = payload as string;
      setTimeout(() => {
        for (const served of relayBehaviour.events) {
          this.deliver(['EVENT', id, served]);
        }
        this.deliver(['EOSE', id]);
      }, 0);
      return;
    }

    if (verb === 'EVENT') {
      const published = payload as SignedEvent;
      const seen = relayBehaviour.published.get(this.url) ?? [];
      seen.push(published);
      relayBehaviour.published.set(this.url, seen);
      if (relayBehaviour.ack === null) {
        setTimeout(() => this.onclose?.({}), 0);
        return;
      }
      setTimeout(() => this.deliver(['OK', published.id, relayBehaviour.ack, 'noted']), 0);
    }
  }

  close(): void {
    this.readyState = 3;
  }

  private deliver(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

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
    monitoredAt: NOW,
    monitorCount: 1,
    pasted: false,
  };
}

function signer(pubkey = AUTHOR): Signer & { signed: EventTemplate[] } {
  const signed: EventTemplate[] = [];
  return {
    kind: 'key',
    pubkey,
    npub: 'npub1test',
    label: 'a test key',
    signed,
    sign: (template) => {
      signed.push(template);
      return Promise.resolve({
        ...template,
        id: `${signed.length}`.padStart(64, '0'),
        pubkey,
        sig: 'd'.repeat(128),
      });
    },
    close: () => undefined,
  };
}

const HANDLERS = {
  onPhase: () => undefined,
  onRelay: () => undefined,
  onProgress: () => undefined,
};

function purge(relays: RelayDescriptor[], key: Signer, kinds = [0]) {
  return runPurge(
    relays,
    { author: AUTHOR, kinds, reason: 'because' },
    key,
    { concurrency: 2, signal: new AbortController().signal },
    HANDLERS,
    NOW,
  );
}

afterEach(() => {
  relayBehaviour.events = [];
  relayBehaviour.ack = true;
  relayBehaviour.published = new Map();
  vi.unstubAllGlobals();
});

describe('runPurge', () => {
  it('names only the author’s own events, whatever the relay serves', async () => {
    vi.stubGlobal('WebSocket', FakeRelay);
    relayBehaviour.events = [
      event('1'.repeat(64), AUTHOR, 0),
      // A relay is free to answer with somebody else's event. Its id must
      // never reach a signed delete request: no relay would honour it, and it
      // would put a request naming a stranger's event on record under this key.
      event('2'.repeat(64), STRANGER, 0),
    ];

    const key = signer();
    const outcome = await purge([relay('wss://one.example')], key);

    expect(outcome.gathered).toBe(1);
    const ids = key.signed[0]?.tags.filter((tag) => tag[0] === 'e').map((tag) => tag[1]);
    expect(ids).toEqual(['1'.repeat(64)]);
  });

  it('signs once and sends the same request to every relay', async () => {
    // The alternative — signing per relay — is a NIP-07 approval prompt per
    // relay, and it also loses the point of the union: a relay holding a copy
    // this app only saw elsewhere still gets that id.
    vi.stubGlobal('WebSocket', FakeRelay);
    relayBehaviour.events = [event('1'.repeat(64), AUTHOR, 0)];

    const key = signer();
    const outcome = await purge([relay('wss://one.example'), relay('wss://two.example')], key);

    expect(key.signed).toHaveLength(1);
    expect(outcome.requests).toBe(1);
    expect(relayBehaviour.published.get('wss://one.example')).toHaveLength(1);
    expect(relayBehaviour.published.get('wss://two.example')).toHaveLength(1);
    expect(outcome.reports.every((report) => report.status === 'accepted')).toBe(true);
  });

  it('reports a refusal as a refusal, with the relay’s words', async () => {
    vi.stubGlobal('WebSocket', FakeRelay);
    relayBehaviour.events = [event('1'.repeat(64), AUTHOR, 0)];
    relayBehaviour.ack = false;

    const outcome = await purge([relay('wss://one.example')], signer());

    expect(outcome.reports[0]?.status).toBe('refused');
    expect(outcome.reports[0]?.notes).toEqual(['noted']);
  });

  it('reports an unacknowledged request as unanswered, not as success or failure', async () => {
    vi.stubGlobal('WebSocket', FakeRelay);
    relayBehaviour.events = [event('1'.repeat(64), AUTHOR, 0)];
    relayBehaviour.ack = null;

    const outcome = await purge([relay('wss://one.example')], signer());

    expect(outcome.reports[0]?.status).toBe('unanswered');
    expect(outcome.reports[0]?.accepted).toBe(0);
    expect(outcome.reports[0]?.rejected).toBe(0);
  });

  it('sends nothing when the relays hold nothing of a non-replaceable kind', async () => {
    vi.stubGlobal('WebSocket', FakeRelay);
    const key = signer();

    const outcome = await purge([relay('wss://one.example')], key, [4]);

    expect(key.signed).toHaveLength(0);
    expect(outcome.requests).toBe(0);
    expect(relayBehaviour.published.size).toBe(0);
  });

  it('still asks a replaceable kind to go, even with no id in hand', async () => {
    // A relay may hold a copy this app was never served — an address covers
    // it, and is why an empty gather is not an empty purge for kind 0.
    vi.stubGlobal('WebSocket', FakeRelay);
    const key = signer();

    const outcome = await purge([relay('wss://one.example')], key, [0]);

    expect(outcome.requests).toBe(1);
    expect(key.signed[0]?.tags).toContainEqual(['a', `0:${AUTHOR}:`]);
  });

  it('refuses to sign as anyone but the identity being purged', async () => {
    vi.stubGlobal('WebSocket', FakeRelay);
    await expect(purge([relay('wss://one.example')], signer(STRANGER))).rejects.toThrow(
      /not the identity being purged/,
    );
    // Nothing opened, nothing sent: the check runs before the first socket.
    expect(relayBehaviour.published.size).toBe(0);
  });

  it('purges kinds with no column of their own, and declares the ones it found', async () => {
    vi.stubGlobal('WebSocket', FakeRelay);
    relayBehaviour.events = [
      event('1'.repeat(64), AUTHOR, 1),
      event('2'.repeat(64), AUTHOR, 7),
      // Has a column of its own: purging `other` must not take it.
      event('3'.repeat(64), AUTHOR, 0),
      event('4'.repeat(64), STRANGER, 1),
    ];

    const key = signer();
    const outcome = await purge([relay('wss://one.example')], key, [OTHER_KIND]);

    const tags = key.signed[0]?.tags ?? [];
    const ids = tags.filter((tag) => tag[0] === 'e').map((tag) => tag[1]);
    expect(new Set(ids)).toEqual(new Set(['1'.repeat(64), '2'.repeat(64)]));
    expect(outcome.gathered).toBe(2);

    // The kinds are discovered, not declared up front — "everything else" is
    // not a kind and cannot be named until a relay has answered.
    expect(tags.filter((tag) => tag[0] === 'k')).toEqual([
      ['k', '1'],
      ['k', '7'],
    ]);
    // The sentinel is this app's bookkeeping. A `["k", "-1"]` on a signed
    // event sent to a thousand relays is nonsense that cannot be recalled.
    expect(tags.some((tag) => tag[1] === String(OTHER_KIND))).toBe(false);
    // Nor an address: `other` is not replaceable, and an `a` tag here would
    // ask for far more than the ids named.
    expect(tags.some((tag) => tag[0] === 'a')).toBe(false);
  });

  it('sends nothing for the catch-all when the relays hold nothing else', async () => {
    vi.stubGlobal('WebSocket', FakeRelay);
    relayBehaviour.events = [event('1'.repeat(64), AUTHOR, 0)];
    const key = signer();

    const outcome = await purge([relay('wss://one.example')], key, [OTHER_KIND]);

    expect(key.signed).toHaveLength(0);
    expect(outcome.requests).toBe(0);
  });
});
