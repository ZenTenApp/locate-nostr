/**
 * The socket's message handling, against a fake WebSocket.
 *
 * This is the app's entire attack surface: every byte here is written by a
 * stranger's relay, and the parsing decides what the grid then reports as
 * fact. The pieces worth pinning are the ones a well-behaved relay never
 * exercises — a relay ignoring `limit`, events that are not events, a `CLOSED`
 * arriving instead of an answer.
 */
import { describe, expect, it, vi } from 'vitest';

import { RelaySocket } from './socket';

type Handler = ((event: unknown) => void) | null;

/** Minimal stand-in for the browser's WebSocket, driven from the test. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;

  readyState = 1;
  sent: string[] = [];
  onopen: Handler = null;
  onmessage: Handler = null;
  onclose: Handler = null;
  onerror: Handler = null;

  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(message: string): void {
    this.sent.push(message);
  }

  close(): void {
    this.readyState = 3;
  }

  /** Deliver a relay message, as the browser would. */
  deliver(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  /** Deliver something that is not JSON at all. */
  deliverRaw(data: unknown): void {
    this.onmessage?.({ data });
  }
}

/** Open a socket against the fake, resolving once the test lets it connect. */
async function openSocket(): Promise<{ socket: RelaySocket; ws: FakeWebSocket }> {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const opening = RelaySocket.open('wss://relay.example', 1000);
  const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (!ws) throw new Error('no socket was constructed');
  ws.onopen?.({});
  return { socket: await opening, ws };
}

function subscriptionId(ws: FakeWebSocket): string {
  const req: unknown = JSON.parse(ws.sent[ws.sent.length - 1] ?? '[]');
  return Array.isArray(req) && typeof req[1] === 'string' ? req[1] : '';
}

const EVENT = {
  id: 'a'.repeat(64),
  pubkey: 'b'.repeat(64),
  created_at: 1_770_000_000,
  kind: 0,
  tags: [['d', 'general']],
  content: '',
  sig: 'c'.repeat(128),
};

describe('RelaySocket.sample', () => {
  it('collects events until EOSE and closes the subscription', async () => {
    const { socket, ws } = await openSocket();
    const pending = socket.sample([{ kinds: [0] }], 10, 1000);
    const id = subscriptionId(ws);

    ws.deliver(['EVENT', id, EVENT]);
    ws.deliver(['EOSE', id]);

    const result = await pending;
    expect(result.events).toHaveLength(1);
    expect(result.complete).toBe(true);
    expect(ws.sent.some((message) => message.includes('"CLOSE"'))).toBe(true);
    socket.close();
  });

  it('refuses to buffer past the limit a relay was given', async () => {
    // Relays that ignore `limit` exist. Unbounded, one of them would stream
    // into memory across a thousand-relay sweep.
    const { socket, ws } = await openSocket();
    const pending = socket.sample([{ kinds: [0] }], 2, 1000);
    const id = subscriptionId(ws);

    for (let i = 0; i < 50; i += 1) ws.deliver(['EVENT', id, { ...EVENT, id: String(i) }]);
    ws.deliver(['EOSE', id]);

    expect((await pending).events).toHaveLength(2);
    socket.close();
  });

  it('drops malformed events rather than passing them on', async () => {
    const { socket, ws } = await openSocket();
    const pending = socket.sample([{ kinds: [0] }], 10, 1000);
    const id = subscriptionId(ws);

    ws.deliver(['EVENT', id, { ...EVENT, created_at: 'yesterday' }]);
    ws.deliver(['EVENT', id, { ...EVENT, tags: 'not-an-array' }]);
    ws.deliver(['EVENT', id, null]);
    ws.deliver(['EVENT', id, EVENT]);
    ws.deliver(['EOSE', id]);

    expect((await pending).events).toEqual([EVENT]);
    socket.close();
  });

  it('keeps only string entries of a tag', async () => {
    const { socket, ws } = await openSocket();
    const pending = socket.sample([{ kinds: [0] }], 10, 1000);
    const id = subscriptionId(ws);

    ws.deliver(['EVENT', id, { ...EVENT, tags: [['d', 'general'], ['p', 42], 'loose'] }]);
    ws.deliver(['EOSE', id]);

    expect((await pending).events[0]?.tags).toEqual([['d', 'general']]);
    socket.close();
  });

  it('reports a CLOSED refusal verbatim, without inventing an answer', async () => {
    const { socket, ws } = await openSocket();
    const pending = socket.sample([{ kinds: [4] }], 10, 1000);
    const id = subscriptionId(ws);

    ws.deliver(['CLOSED', id, 'auth-required: we only serve members']);

    const result = await pending;
    expect(result.complete).toBe(false);
    expect(result.refusal).toEqual({
      kind: 'closed',
      message: 'auth-required: we only serve members',
    });
    socket.close();
  });

  it('survives junk that is not JSON, and messages for unknown subscriptions', async () => {
    const { socket, ws } = await openSocket();
    const pending = socket.sample([{ kinds: [0] }], 10, 1000);
    const id = subscriptionId(ws);

    ws.deliverRaw('<html>not a relay</html>');
    ws.deliverRaw({ notAString: true });
    ws.deliver(['EVENT', 'some-other-sub', EVENT]);
    ws.deliver(['NOTICE', 'ignored']);
    ws.deliver(['EOSE', id]);

    expect((await pending).events).toEqual([]);
    socket.close();
  });

  it('gives every request its own subscription id', async () => {
    const { socket, ws } = await openSocket();
    void socket.sample([{ kinds: [0] }], 1, 1000);
    const first = subscriptionId(ws);
    void socket.sample([{ kinds: [3] }], 1, 1000);
    expect(subscriptionId(ws)).not.toBe(first);
    socket.close();
  });
});

describe('RelaySocket.count', () => {
  it('reads the number out of a COUNT response', async () => {
    const { socket, ws } = await openSocket();
    const pending = socket.count([{ kinds: [4] }], 1000);
    const id = subscriptionId(ws);

    ws.deliver(['COUNT', id, { count: 176_059 }]);
    expect(await pending).toBe(176_059);
    socket.close();
  });

  it('resolves null when a relay answers COUNT with nonsense', async () => {
    // Silence and junk mean the same thing to the caller: fall back to
    // sampling rather than trust it.
    const { socket, ws } = await openSocket();
    const pending = socket.count([{ kinds: [4] }], 1000);
    ws.deliver(['COUNT', subscriptionId(ws), { count: 'lots' }]);
    expect(await pending).toBeNull();
    socket.close();
  });

  it('resolves null when the relay CLOSEDs the count', async () => {
    const { socket, ws } = await openSocket();
    const pending = socket.count([{ kinds: [4] }], 1000);
    ws.deliver(['CLOSED', subscriptionId(ws), 'unsupported: COUNT']);
    expect(await pending).toBeNull();
    socket.close();
  });
});

describe('RelaySocket lifecycle', () => {
  it('settles everything in flight when the socket drops', async () => {
    const { socket, ws } = await openSocket();
    const sample = socket.sample([{ kinds: [0] }], 10, 5000);
    const count = socket.count([{ kinds: [0] }], 5000);

    ws.onclose?.({});

    expect((await sample).refusal).toEqual({ kind: 'disconnected' });
    expect(await count).toBeNull();
    socket.close();
  });

  it('answers immediately once closed, rather than hanging', async () => {
    const { socket } = await openSocket();
    socket.close();
    const result = await socket.sample([{ kinds: [0] }], 10, 5000);
    expect(result.refusal).toEqual({ kind: 'disconnected' });
    expect(await socket.count([{ kinds: [0] }], 5000)).toBeNull();
  });
});

describe('RelaySocket.publish', () => {
  const SIGNED = { ...EVENT, kind: 5, content: 'because I said so' };

  it('reports what the relay said about the event', async () => {
    const { socket, ws } = await openSocket();
    const pending = socket.publish(SIGNED, 1000);

    ws.deliver(['OK', SIGNED.id, true, 'accepted']);

    expect(await pending).toEqual({ accepted: true, message: 'accepted' });
    expect(ws.sent.some((message) => message.startsWith('["EVENT"'))).toBe(true);
    socket.close();
  });

  it('keeps a refusal apart from an acceptance, in the relay’s own words', async () => {
    const { socket, ws } = await openSocket();
    const pending = socket.publish(SIGNED, 1000);

    ws.deliver(['OK', SIGNED.id, false, 'blocked: not your event']);

    expect(await pending).toEqual({ accepted: false, message: 'blocked: not your event' });
    socket.close();
  });

  it('answers null when the relay never acknowledges — silence is not a refusal', async () => {
    // The distinction the whole purge report rests on: a relay that said
    // nothing may have applied the deletion, and must not read as a refusal.
    const { socket, ws } = await openSocket();
    const pending = socket.publish(SIGNED, 5000);

    ws.onclose?.({});

    expect(await pending).toBeNull();
    socket.close();
  });

  it('ignores an OK for an event it never sent', async () => {
    const { socket, ws } = await openSocket();
    const pending = socket.publish(SIGNED, 1000);

    ws.deliver(['OK', 'f'.repeat(64), true, "someone else's event"]);
    ws.deliver(['OK', SIGNED.id, true, 'mine']);

    expect(await pending).toEqual({ accepted: true, message: 'mine' });
    socket.close();
  });
});
