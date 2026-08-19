/**
 * A minimal, hand-rolled NIP-01 client over one WebSocket.
 *
 * `nostr-tools`' `SimplePool` is the right tool for an app that talks to five
 * relays and trusts what they say. This sweep talks to thirteen hundred and
 * trusts none of them, and two of the pool's defaults are wrong here:
 *
 *  - it verifies the signature of every event it receives. Sampling 25 events
 *    of six kinds from a thousand relays is 150k schnorr verifications for a
 *    number that only needs to be *counted*. Verification still happens, but
 *    only on the newest event per kind, and only where the answer is shown as
 *    a fact about an identity — see `sweep/engine.ts`.
 *  - it keeps relays in a shared map with reconnect and idle handling, which
 *    is exactly what a bounded sweep must not do: a slot has to be released
 *    the moment its relay is done with.
 *
 * So this is deliberately small: open, ask, read, close. It never publishes,
 * never authenticates and never signs, which is also why it can be pointed at
 * an arbitrary list of strangers' hosts in the first place.
 */
import { errorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

/** A relay's event, as it arrived. Every field is untrusted. */
export interface RelayEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/** NIP-01 filter, narrowed to what this app sends. */
export interface RelayFilter {
  kinds?: number[];
  authors?: string[];
  limit?: number;
  /** Exclusive upper bound on `created_at`, for paging backwards through a
   *  result set larger than a relay will serve in one response. */
  until?: number;
  '#d'?: string[];
  '#p'?: string[];
}

export type CloseReason =
  /** The relay answered `CLOSED` — its reason string, verbatim. */
  | { kind: 'closed'; message: string }
  /** No answer inside the budget. */
  | { kind: 'timeout' }
  /** The socket dropped mid-request. */
  | { kind: 'disconnected' };

export interface SampleResult {
  events: RelayEvent[];
  /** True when the relay signalled end-of-stored-events, i.e. the sample is
   *  the whole answer rather than however much arrived before the clock ran
   *  out. A count off a sample that never EOSEd is a floor. */
  complete: boolean;
  refusal: CloseReason | null;
}

export class RelayConnectError extends Error {}

interface PendingSub {
  events: RelayEvent[];
  limit: number;
  settle: (result: SampleResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingCount {
  settle: (count: number | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** `["EVENT", <id>, {...}]` → the event, or null if the shape is wrong. A
 *  relay is free to send anything; nothing downstream may assume it did not. */
function readEvent(value: unknown): RelayEvent | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.pubkey !== 'string' ||
    typeof candidate.created_at !== 'number' ||
    typeof candidate.kind !== 'number' ||
    typeof candidate.content !== 'string' ||
    typeof candidate.sig !== 'string' ||
    !Array.isArray(candidate.tags)
  ) {
    return null;
  }
  const tags: string[][] = [];
  for (const tag of candidate.tags) {
    if (Array.isArray(tag) && tag.every((entry) => typeof entry === 'string')) tags.push(tag);
  }
  return {
    id: candidate.id,
    pubkey: candidate.pubkey,
    created_at: candidate.created_at,
    kind: candidate.kind,
    tags,
    content: candidate.content,
    sig: candidate.sig,
  };
}

export class RelaySocket {
  private readonly ws: WebSocket;
  private readonly subs = new Map<string, PendingSub>();
  private readonly counts = new Map<string, PendingCount>();
  private serial = 0;
  private closed = false;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (event) => this.onMessage(event);
    ws.onclose = () => this.abandonAll({ kind: 'disconnected' });
    ws.onerror = () => this.abandonAll({ kind: 'disconnected' });
  }

  /**
   * Open a socket, or throw {@link RelayConnectError}.
   *
   * The browser gives no reason for a failed WebSocket handshake — that is a
   * deliberate hole in the API, so no error here can distinguish DNS failure
   * from a bad certificate from a refused connection. The sweep reports the
   * distinction it can actually make: answered, or did not.
   */
  static open(url: string, connectTimeoutMs: number, signal?: AbortSignal): Promise<RelaySocket> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        reject(new RelayConnectError(errorMessage(err)));
        return;
      }

      const fail = (reason: string) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        try {
          ws.close();
        } catch {
          // Already closing.
        }
        reject(new RelayConnectError(reason));
      };
      const onAbort = () => fail('Cancelled');
      const timer = setTimeout(() => fail('Connect timed out'), connectTimeoutMs);

      ws.onopen = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(new RelaySocket(ws));
      };
      ws.onerror = () => fail('Connection failed');
      ws.onclose = () => fail('Closed before open');
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * NIP-45 `COUNT` over one or more filters, which a relay unions before
   * counting. Resolves to `null` when the relay does not answer — under
   * half of live relays implement it, and the ones that do not stay silent
   * rather than replying with an error, so silence is the signal to sample
   * instead.
   */
  count(filters: readonly RelayFilter[], timeoutMs: number): Promise<number | null> {
    if (this.closed) return Promise.resolve(null);
    const id = this.nextId('c');
    return new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        this.counts.delete(id);
        resolve(null);
      }, timeoutMs);
      this.counts.set(id, {
        timer,
        settle: (count) => {
          clearTimeout(timer);
          this.counts.delete(id);
          resolve(count);
        },
      });
      this.send(['COUNT', id, ...filters]);
    });
  }

  /**
   * `REQ` up to `limit` events per filter, then `CLOSE`.
   *
   * Several filters in one `REQ` are a union, which is how an identity's DMs
   * are counted: a kind 4 is that identity's whether they authored it or are
   * its `p`-tagged recipient, and asking twice would double-count the ones a
   * relay returns for both.
   *
   * Used both as the fallback count and, in identity mode, as the way to read
   * the newest event a relay holds. Events that arrive after EOSE are ignored:
   * the sample is defined as the stored set, and a relay streaming live events
   * into it would make the same query return a different number each run.
   */
  sample(filters: readonly RelayFilter[], limit: number, timeoutMs: number): Promise<SampleResult> {
    if (this.closed) {
      return Promise.resolve({ events: [], complete: false, refusal: { kind: 'disconnected' } });
    }
    const id = this.nextId('r');
    return new Promise<SampleResult>((resolve) => {
      const timer = setTimeout(() => {
        const pending = this.subs.get(id);
        this.subs.delete(id);
        this.send(['CLOSE', id]);
        resolve({
          events: pending?.events ?? [],
          complete: false,
          refusal: { kind: 'timeout' },
        });
      }, timeoutMs);

      this.subs.set(id, {
        events: [],
        limit,
        timer,
        settle: (result) => {
          clearTimeout(timer);
          this.subs.delete(id);
          resolve(result);
        },
      });
      this.send(['REQ', id, ...filters.map((filter) => ({ ...filter, limit }))]);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.abandonAll({ kind: 'disconnected' });
    try {
      this.ws.close();
    } catch {
      // Already closing.
    }
  }

  private nextId(prefix: string): string {
    this.serial += 1;
    return `${prefix}${this.serial}`;
  }

  private send(message: unknown[]): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(message));
    } catch (err) {
      logger.relay('Send failed', { url: this.ws.url, error: errorMessage(err) });
    }
  }

  private onMessage(event: MessageEvent<unknown>): void {
    if (typeof event.data !== 'string') return;
    let message: unknown;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!Array.isArray(message) || typeof message[0] !== 'string') return;

    const [verb, id] = message as [string, unknown];
    if (typeof id !== 'string') return;

    switch (verb) {
      case 'EVENT': {
        const sub = this.subs.get(id);
        const parsed = readEvent(message[2]);
        if (!sub || !parsed) return;
        // A relay that ignores `limit` — several do — must not be allowed to
        // stream unbounded into memory across a thousand-relay sweep.
        if (sub.events.length < sub.limit) sub.events.push(parsed);
        return;
      }
      case 'EOSE': {
        const sub = this.subs.get(id);
        if (!sub) return;
        this.send(['CLOSE', id]);
        sub.settle({ events: sub.events, complete: true, refusal: null });
        return;
      }
      case 'CLOSED': {
        // The reason string is the interesting part: `auth-required:`,
        // `restricted:` and `payment-required:` are how a relay says the empty
        // answer is a policy, not an absence.
        const reason = typeof message[2] === 'string' ? message[2] : '';
        const sub = this.subs.get(id);
        if (sub) {
          sub.settle({
            events: sub.events,
            complete: false,
            refusal: { kind: 'closed', message: reason },
          });
          return;
        }
        this.counts.get(id)?.settle(null);
        return;
      }
      case 'COUNT': {
        const payload = message[2];
        const value =
          typeof payload === 'object' && payload !== null
            ? (payload as { count?: unknown }).count
            : undefined;
        this.counts.get(id)?.settle(typeof value === 'number' ? value : null);
        return;
      }
      default:
        // NOTICE, OK, AUTH and anything non-standard: nothing here publishes
        // or authenticates, so there is nothing to do with them.
        return;
    }
  }

  private abandonAll(reason: CloseReason): void {
    for (const [, sub] of this.subs) {
      clearTimeout(sub.timer);
      sub.settle({ events: sub.events, complete: false, refusal: reason });
    }
    this.subs.clear();
    for (const [, pending] of this.counts) {
      clearTimeout(pending.timer);
      pending.settle(null);
    }
    this.counts.clear();
  }
}
