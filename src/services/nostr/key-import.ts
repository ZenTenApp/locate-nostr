/**
 * The three ways in, behind one API.
 *
 * Each source ends at the same place — a hex pubkey — and each one is a
 * different bargain about where the private key lives while that happens:
 *
 * | Source    | Where the secret is       | For how long                |
 * | --------- | ------------------------- | --------------------------- |
 * | extension | never in this app         | never                       |
 * | seed      | inside the key worker     | one synchronous call        |
 * | ssh key   | inside the key worker     | one synchronous call        |
 *
 * The worker is terminated after every derivation, successful or not. That is
 * not tidiness: the PEM, the passphrase and the mnemonic are immutable strings
 * cloned into the worker heap by `postMessage`, and dropping the heap is the
 * only way to reclaim them. Everything that *can* be zeroed in place already
 * is, in `crypto/nip06.ts` and `ssh/bcrypt.ts`.
 */
import { logger } from '@/lib/logger';
import type { PublicIdentity } from '@/services/crypto/nip06';
import { pubkeyFromNsec } from '@/services/crypto/nip06';
import { pubkeyFromExtension } from '@/services/nostr/extension';
import { parseOpenSSHPrivateKey } from '@/services/ssh/openssh';
import { keyWorker } from '@/services/worker/client';

/** Where an identity came from. Shown next to the npub, because "this is your
 *  key" and "this is a key you pasted" are different claims. */
export type IdentitySource = 'text' | 'extension' | 'seed' | 'ssh';

/** What the UI needs to know about a pasted SSH key before asking for a
 *  passphrase and committing to a multi-second derivation. */
export interface SshKeyInfo {
  /** False for a key stored in the clear, which needs no passphrase and no
   *  bcrypt wait. */
  encrypted: boolean;
  /** bcrypt_pbkdf rounds — drives the time estimate. Zero when unencrypted. */
  rounds: number;
}

/**
 * Validate a pasted key and read its KDF parameters, on the main thread.
 *
 * Parsing is base64 plus framing — microseconds — and pulls in none of
 * `bcrypt-pbkdf`, so a malformed key is rejected the instant it is pasted
 * rather than after a passphrase prompt the user should never have seen.
 *
 * An unencrypted key is reported, not refused: this app never stores a key, so
 * the passphrase requirement `chat` enforces would protect nothing here. The
 * dialog uses this to stop asking for a passphrase that does not exist.
 */
export function inspectSshKey(pem: string): SshKeyInfo {
  const parsed = parseOpenSSHPrivateKey(pem);
  return parsed.kdfName === 'none'
    ? { encrypted: false, rounds: 0 }
    : { encrypted: true, rounds: parsed.kdfRounds };
}

/** Project how long {@link pubkeyFromSshKey} will take, in seconds. */
export function estimateSshSeconds(rounds: number): Promise<number> {
  return keyWorker.request('estimate', { rounds }).then((result) => result.seconds);
}

/** Warm the worker so a later estimate is not timing a cold start. */
export function prepareKeyWorker(): void {
  keyWorker.warmup();
}

/** Abandon a derivation in progress. The only cancellation `bcrypt_pbkdf`
 *  admits: it is one synchronous call that cannot be interrupted. */
export function cancelKeyWork(): void {
  keyWorker.terminate();
}

async function throughWorker<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } finally {
    // Terminated on success and on failure alike — a wrong passphrase leaves
    // the same unwipeable strings in that heap as a right one.
    keyWorker.terminate();
  }
}

/** An OpenSSH Ed25519 key → the identity it roots. `passphrase` is ignored
 *  for a key that has none; see {@link inspectSshKey}. */
export function pubkeyFromSshKey(pem: string, passphrase: string): Promise<PublicIdentity> {
  logger.key('Deriving from SSH key');
  return throughWorker(keyWorker.request('ssh-pubkey', { pem, passphrase }));
}

/**
 * A BIP39 phrase, or an nsec, → the identity it roots.
 *
 * An nsec is not a seed and needs no PBKDF2, so it is resolved here on the
 * main thread in microseconds rather than paying for a worker round trip. Both
 * live behind one entry point because they are one field to the user: "the
 * secret you were given".
 */
export function pubkeyFromSeed(secret: string, passphrase: string): Promise<PublicIdentity> {
  const trimmed = secret.trim();
  if (trimmed.toLowerCase().startsWith('nsec1')) {
    logger.key('Reading an nsec');
    return Promise.resolve(pubkeyFromNsec(trimmed));
  }
  logger.key('Deriving from a recovery phrase');
  return throughWorker(keyWorker.request('seed-pubkey', { mnemonic: trimmed, passphrase }));
}

export { pubkeyFromExtension };
