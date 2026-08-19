/**
 * Main-thread handle on the key worker.
 *
 * The worker is created lazily and torn down aggressively. `bcrypt_pbkdf` is
 * one uninterruptible synchronous call, so {@link KeyWorkerClient.terminate}
 * is the only cancellation that exists — and it doubles as the only way to
 * reclaim the passphrase, PEM and mnemonic strings that `postMessage` cloned
 * into the worker heap and that no `fill(0)` can reach.
 *
 * Ported from `chat/src/services/worker/client.ts`, minus the transfer list:
 * nothing sent back from this worker is a secret, so there is no buffer worth
 * moving instead of copying.
 */
import { KeyError, errorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';

import type {
  KeyWorkerKind,
  KeyWorkerRequestMap,
  KeyWorkerResponse,
  KeyWorkerResultMap,
} from './protocol';

interface Pending {
  kind: KeyWorkerKind;
  resolve: (value: never) => void;
  reject: (reason: unknown) => void;
}

export class KeyWorkerClient {
  #worker: Worker | null = null;
  #nextId = 1;
  readonly #pending = new Map<number, Pending>();

  #ensureWorker(): Worker {
    if (this.#worker) return this.#worker;

    const worker = new Worker(new URL('./key-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<KeyWorkerResponse>) => this.#settle(event.data);
    worker.onerror = (event) => this.#failAll(new Error(event.message || 'Key worker crashed'));
    this.#worker = worker;
    return worker;
  }

  #settle(response: KeyWorkerResponse): void {
    const pending = this.#pending.get(response.id);
    if (!pending) return;
    this.#pending.delete(response.id);

    if (!response.ok) {
      pending.reject(new KeyError(response.code, response.message));
      return;
    }
    // The result type is keyed on the request kind, and the cast below erases
    // that link. A mismatched reply would otherwise hand the caller a
    // differently-shaped object with no error at all.
    if (response.kind !== pending.kind) {
      pending.reject(
        new KeyError('internal', `Worker answered ${response.kind} for a ${pending.kind} request`),
      );
      return;
    }
    pending.resolve(response.result as never);
  }

  #failAll(reason: unknown): void {
    for (const pending of this.#pending.values()) pending.reject(reason);
    this.#pending.clear();
  }

  /** Send a request and await its typed result. */
  request<K extends KeyWorkerKind>(
    kind: K,
    payload: KeyWorkerRequestMap[K],
  ): Promise<KeyWorkerResultMap[K]> {
    const worker = this.#ensureWorker();
    const id = this.#nextId;
    this.#nextId += 1;

    return new Promise<KeyWorkerResultMap[K]>((resolve, reject) => {
      this.#pending.set(id, { kind, resolve: resolve as (value: never) => void, reject });
      try {
        worker.postMessage({ id, kind, ...payload });
      } catch (err) {
        this.#pending.delete(id);
        reject(new KeyError('internal', errorMessage(err)));
      }
    });
  }

  /** Pre-evaluate the worker module so a later benchmark is not measuring a
   *  cold start. Failures are not worth surfacing — the real call will report. */
  warmup(): void {
    void this.request('warmup', {}).catch(() => undefined);
  }

  /**
   * Destroy the worker, rejecting anything in flight. Called on cancel and
   * after every successful derivation — a terminated worker takes its heap
   * with it, including the strings that cannot be zeroed.
   */
  terminate(): void {
    if (!this.#worker) return;
    logger.key('Terminating key worker', { pending: this.#pending.size });
    this.#worker.terminate();
    this.#worker = null;
    this.#failAll(new KeyError('internal', 'Key worker was terminated'));
  }
}

/** The app's single client. Recreates its worker on demand after a terminate. */
export const keyWorker = new KeyWorkerClient();
