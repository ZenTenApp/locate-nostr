/**
 * Key-worker message contract, shared by both sides of the `postMessage` hop.
 *
 * Two derivations here are synchronous and uninterruptible, and both would
 * freeze the page outright on the main thread:
 *
 *   - `bcrypt_pbkdf` at an SSH key's round count — seconds to minutes.
 *   - `mnemonicToSeedSync` (PBKDF2-HMAC-SHA512 × 2048) — about a second.
 *
 * Adapted from `chat/src/services/worker/protocol.ts` and cut down hard.
 * `chat` ships secret keys back across this boundary; **nothing here does.**
 * Every response carries a pubkey, an npub or a signed event — all public —
 * and there is deliberately no message shape capable of carrying a secret out.
 * That is what makes `unlock` safe to add: the key it derives stays on the
 * worker side of this boundary and is only ever *used* there, by `sign`.
 *
 * Two families of request, and the difference is how long a key lives:
 *
 *  - `ssh-pubkey` / `seed-pubkey` derive a public key and wipe the secret
 *    before returning. The client terminates the worker straight after.
 *  - `unlock` / `sign` keep the secret alive between calls, because a purge
 *    signs once per chunk of a delete request and re-deriving from a mnemonic
 *    would mean a second of PBKDF2 — or a minute of bcrypt — for each one.
 *    Terminating the worker is what ends that, and it is the only thing that
 *    does: there is no "forget the key but keep the worker" message, because
 *    a heap that once held a phrase is not something to keep warm.
 *
 * Failures travel as a {@link KeyErrorCode} rather than a message string: the
 * UI branches on wrong-passphrase versus damaged-key, and an `Error` subclass
 * does not survive structured cloning anyway.
 */
import type { KeyErrorCode } from '@/lib/errors';
import type { PublicIdentity } from '@/services/crypto/nip06';
import type { EventTemplate, SignedEvent } from '@/services/nostr/events';

export interface KeyWorkerRequestMap {
  /** Force module evaluation and JIT warm-up so `estimate` is not measuring a
   *  cold worker. Fired when the key dialog opens. */
  warmup: Record<string, never>;
  /** Benchmark bcrypt and project the wait for `rounds`. */
  estimate: { rounds: number };
  /** Decrypt an OpenSSH key and derive the pubkey it roots. */
  'ssh-pubkey': { pem: string; passphrase: string };
  /** Derive the pubkey a BIP39 phrase roots. */
  'seed-pubkey': { mnemonic: string; passphrase: string };
  /**
   * Derive a secret and **keep it** in the worker, for signing.
   *
   * `secret` is a recovery phrase, an nsec or an OpenSSH PEM, told apart by
   * `source` and by its own shape — one field because it is one field to the
   * user, "the secret you were given".
   */
  unlock: { source: KeySource; secret: string; passphrase: string };
  /** Sign one event with the unlocked key. Fails if nothing is unlocked. */
  sign: { template: EventTemplate };
}

/** Which kind of secret an {@link KeyWorkerRequestMap.unlock} carries. */
export type KeySource = 'seed' | 'ssh';

export type KeyWorkerKind = keyof KeyWorkerRequestMap;

export type KeyWorkerRequest = {
  [K in KeyWorkerKind]: { id: number; kind: K } & KeyWorkerRequestMap[K];
}[KeyWorkerKind];

export interface KeyWorkerResultMap {
  warmup: Record<string, never>;
  estimate: { seconds: number };
  'ssh-pubkey': PublicIdentity;
  'seed-pubkey': PublicIdentity;
  unlock: PublicIdentity;
  sign: { event: SignedEvent };
}

export type KeyWorkerResponse =
  | {
      [K in KeyWorkerKind]: { id: number; ok: true; kind: K; result: KeyWorkerResultMap[K] };
    }[KeyWorkerKind]
  | { id: number; ok: false; code: KeyErrorCode; message: string };
