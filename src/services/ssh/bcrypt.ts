/**
 * bcrypt_pbkdf decryption of an OpenSSH private block, and the benchmark that
 * lets the UI predict how long it will take.
 *
 * Ported from `usdt-pay/services/ssh-service.ts:66-101,135-147` with two
 * changes:
 *
 *  - `passlen` is the UTF-8 **byte** length. The reference passed
 *    `passphrase.length`, which is UTF-16 code units, so any passphrase with a
 *    non-ASCII character hashed only a truncated prefix and surfaced as a
 *    spurious "wrong passphrase".
 *  - `key`/`iv` are `subarray` views, not copies, so the `keyMaterial.fill(0)`
 *    in the `finally` block actually reaches them.
 *
 * This module is the reason the key worker exists: `pbkdf` is one
 * uninterruptible synchronous call that runs for seconds to minutes.
 */
import { ctr } from '@noble/ciphers/aes.js';
import bcrypt_pbkdf from 'bcrypt-pbkdf';

import { utf8, wipe } from '@/lib/bytes';
import { KeyError } from '@/lib/errors';
import type { EncryptedParsedKey } from '@/types/ssh';

/** aes256-ctr needs a 32-byte key plus a 16-byte IV, derived as one block. */
const AES_KEY_BYTES = 32;
const AES_IV_BYTES = 16;
const KEY_MATERIAL_BYTES = AES_KEY_BYTES + AES_IV_BYTES;

/**
 * Decrypt the private key block. The returned buffer holds the Ed25519 seed
 * and MUST be wiped by the caller once the seed has been consumed.
 */
export function decryptOpenSSHPrivateBlock(
  parsedKey: EncryptedParsedKey,
  passphrase: string,
): Uint8Array {
  if (parsedKey.cipherName !== 'aes256-ctr') {
    throw new KeyError('unsupported-cipher', `Unsupported cipher: ${parsedKey.cipherName}`);
  }

  // `bcrypt_pbkdf` treats a zero-length passphrase as invalid parameters and
  // returns -1, indistinguishable from a malformed salt or round count. Caught
  // here so an empty box is reported as an empty box: the old path surfaced it
  // as `bad-format`, i.e. "that is not an OpenSSH key", about a key that had
  // just been parsed successfully.
  if (passphrase === '') {
    throw new KeyError('passphrase-required', 'This key is encrypted and needs a passphrase');
  }

  const passBytes = utf8(passphrase);
  const keyMaterial = new Uint8Array(KEY_MATERIAL_BYTES);

  try {
    const status = bcrypt_pbkdf.pbkdf(
      passBytes,
      passBytes.length,
      parsedKey.kdfSalt,
      parsedKey.kdfSalt.length,
      keyMaterial,
      KEY_MATERIAL_BYTES,
      parsedKey.kdfRounds,
    );
    if (status !== 0) {
      throw new KeyError('bad-format', 'bcrypt_pbkdf rejected the key parameters');
    }

    // Views, not copies — see the file header.
    const key = keyMaterial.subarray(0, AES_KEY_BYTES);
    const iv = keyMaterial.subarray(AES_KEY_BYTES);
    return ctr(key, iv).decrypt(parsedKey.encrypted);
  } finally {
    wipe(passBytes, keyMaterial);
  }
}

/**
 * Estimate how long {@link decryptOpenSSHPrivateBlock} will take, by timing a
 * two-round run and scaling. Deliberately biased high: the fixed EksBlowfish
 * setup is counted once per sampled round, so the per-round cost comes out
 * above the real amortised figure, and the UI over-promises the wait rather
 * than under-promising it.
 *
 * Runs with the same key and salt lengths as the real call so the sample is
 * representative.
 */
export function estimateDecryptSeconds(rounds: number): number {
  const SAMPLE_ROUNDS = 2;
  const pass = utf8('bench');
  const salt = new Uint8Array(16);
  const out = new Uint8Array(KEY_MATERIAL_BYTES);

  const start = performance.now();
  bcrypt_pbkdf.pbkdf(pass, pass.length, salt, salt.length, out, KEY_MATERIAL_BYTES, SAMPLE_ROUNDS);
  const elapsedMs = performance.now() - start;

  wipe(out);
  return ((elapsedMs / SAMPLE_ROUNDS) * rounds) / 1000;
}
