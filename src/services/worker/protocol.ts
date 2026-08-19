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
 * `chat` ships secret keys back across this boundary because it has to sign
 * with them; **nothing here does.** Every response carries a pubkey and an
 * npub — public strings — and the private key dies inside the worker in the
 * same call that derived it. There is deliberately no message shape capable of
 * carrying a secret out.
 *
 * Failures travel as a {@link KeyErrorCode} rather than a message string: the
 * UI branches on wrong-passphrase versus damaged-key, and an `Error` subclass
 * does not survive structured cloning anyway.
 */
import type { KeyErrorCode } from '@/lib/errors';
import type { PublicIdentity } from '@/services/crypto/nip06';

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
}

export type KeyWorkerKind = keyof KeyWorkerRequestMap;

export type KeyWorkerRequest = {
  [K in KeyWorkerKind]: { id: number; kind: K } & KeyWorkerRequestMap[K];
}[KeyWorkerKind];

export interface KeyWorkerResultMap {
  warmup: Record<string, never>;
  estimate: { seconds: number };
  'ssh-pubkey': PublicIdentity;
  'seed-pubkey': PublicIdentity;
}

export type KeyWorkerResponse =
  | {
      [K in KeyWorkerKind]: { id: number; ok: true; kind: K; result: KeyWorkerResultMap[K] };
    }[KeyWorkerKind]
  | { id: number; ok: false; code: KeyErrorCode; message: string };
