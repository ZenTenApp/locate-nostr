/**
 * OpenSSH v1 private-key parsing.
 *
 * Ported from `usdt-pay/services/ssh-service.ts:19-60,107-129`, Buffer-free.
 * Parsing is separated from decryption so the UI can inspect a pasted key —
 * is it encrypted? how many bcrypt rounds? — before asking for a passphrase
 * and committing to a multi-second derivation.
 */
import { base64 } from '@scure/base';

import { equalBytes, utf8 } from '@/lib/bytes';
import { KeyError } from '@/lib/errors';
import type { ParsedKey } from '@/types/ssh';

import { SSHReader } from './reader';

/** The `openssh-key-v1\0` magic that opens every OpenSSH v1 key file. */
const MAGIC = utf8('openssh-key-v1\0');

/**
 * How that same magic looks base64-encoded, which is how every OpenSSH v1 key
 * body opens. Finding this is what lets the body be located without trusting
 * whatever wrapper is around it.
 *
 * Derived from {@link MAGIC} rather than transcribed, so the two cannot drift.
 * Twelve bytes because base64 only lines up on 3-byte boundaries: 12 encodes to
 * exactly 16 characters with no padding, which is therefore a true prefix of the
 * encoding of the whole key however it continues.
 */
const BODY_PREFIX = base64.encode(MAGIC.subarray(0, 12));

/** Anything outside the base64 alphabet, which is where the body ends. */
const NOT_BASE64 = /[^A-Za-z0-9+/=]/;

/**
 * Whitespace, plus the zero-width characters `\s` does not cover \u2014 a copy out of
 * a rich-text editor or a web page can smuggle one into the middle of the body,
 * where it would otherwise split the key in half.
 */
const NON_CONTENT = /[\s\u200b-\u200d\u2060]+/g;

/**
 * Find the key body in whatever the user pasted.
 *
 * Four shapes turn up in practice: armoured PEM, armoured PEM collapsed onto one
 * line, a bare one-line body, and a body quoted inside a JSON wrapper. Rather
 * than teach the parser each one, drop everything whitespace-like, find where
 * the encoded magic starts, and take base64 from there until the wrapper's
 * punctuation ends it.
 *
 * Anchoring on the prefix rather than on a whole base64 run matters: a wrapper
 * can butt straight up against the body with no punctuation between them —
 * `SSH_KEY=b3Blbn…` leaves `KEY=b3Blbn…` as one run, since `=` is base64
 * padding — and a run-based match would miss a key that is plainly there.
 *
 * Being permissive here costs nothing: the armour was never a security check.
 * What a key is gets decided after the base64 decode, by {@link MAGIC} and the
 * length-prefixed framing below.
 */
function findKeyBody(pasted: string): string | null {
  const compact = pasted.replace(NON_CONTENT, '');
  const start = compact.indexOf(BODY_PREFIX);
  if (start === -1) return null;

  const body = compact.substring(start);
  const end = body.search(NOT_BASE64);
  return end === -1 ? body : body.substring(0, end);
}

/** Ed25519 private keys hold a 32-byte seed followed by the 32-byte pubkey. */
const ED25519_SEED_BYTES = 32;

/**
 * Parse an OpenSSH private key into its cipher, KDF parameters and
 * still-encrypted private block. Accepts any wrapping — see {@link findKeyBody}.
 *
 * Throws {@link KeyError} `bad-format` when the text holds no OpenSSH v1 key at
 * all, `damaged-key` when it holds one whose bytes do not hold up, and
 * `unsupported-kdf` for a KDF we cannot run.
 */
export function parseOpenSSHPrivateKey(pasted: string): ParsedKey {
  const body = findKeyBody(pasted);
  if (body === null) {
    throw new KeyError('bad-format', 'No OpenSSH private key found in that text');
  }

  // Past this point the text IS a key — it opened with the OpenSSH magic — so
  // every framing failure is damage to it, not a case of mistaken identity.
  // Only an intact key the app cannot *use* gets a more specific code.
  let raw: Uint8Array;
  try {
    raw = base64.decode(body);
  } catch {
    throw new KeyError('damaged-key', 'Key body is not valid base64');
  }

  if (raw.length <= MAGIC.length || !equalBytes(raw.subarray(0, MAGIC.length), MAGIC)) {
    throw new KeyError('damaged-key', 'Key body does not open with the OpenSSH magic');
  }

  const reader = new SSHReader(raw.subarray(MAGIC.length));

  const cipherName = reader.readString();
  const kdfName = reader.readString();
  const kdfData = reader.readBlob();
  const nkeys = reader.readUInt32();

  // `ssh-keygen` only ever writes 1. Anything else past a valid magic is a body
  // that decoded but no longer lines up, which is damage rather than an exotic
  // file — and "copy the key again" is the advice that actually helps.
  if (nkeys !== 1) {
    throw new KeyError('damaged-key', `Expected a single key, framing says ${nkeys}`);
  }

  reader.skipBlob(); // public key blob
  const encrypted = reader.readBlob();

  if (kdfName === 'none') {
    return { kdfName: 'none', cipherName, encrypted };
  }
  if (kdfName !== 'bcrypt') {
    throw new KeyError('unsupported-kdf', `Unsupported KDF: ${kdfName}`);
  }

  const kdfReader = new SSHReader(kdfData);
  const kdfSalt = kdfReader.readBlob();
  const kdfRounds = kdfReader.readUInt32();

  return { kdfName: 'bcrypt', cipherName, kdfSalt, kdfRounds, encrypted };
}

/**
 * Extract the 32-byte Ed25519 seed from a decrypted private block. That seed
 * becomes the BIP39 entropy, so it is the root of the user's whole identity.
 *
 * The returned value is a **view** into `decryptedBlock`; wiping the block
 * wipes it too.
 */
export function extractEd25519Seed(decryptedBlock: Uint8Array): Uint8Array {
  const reader = new SSHReader(decryptedBlock);

  // OpenSSH writes the same random uint32 twice at the head of the private
  // block. Decrypting with the wrong passphrase yields noise, so a mismatch is
  // the canonical wrong-passphrase signal rather than a format problem.
  const check1 = reader.readUInt32();
  const check2 = reader.readUInt32();
  if (check1 !== check2) {
    throw new KeyError('wrong-passphrase', 'Invalid checkints — wrong passphrase');
  }

  const keyType = reader.readString();
  if (keyType !== 'ssh-ed25519') {
    throw new KeyError('unsupported-keytype', `Unsupported key type: ${keyType}`);
  }

  reader.skipBlob(); // public key
  const privateField = reader.readBlob(); // 32-byte seed followed by the pubkey

  // The checkints matched, so this block decrypted correctly — a seed that is
  // nonetheless short is damage, not the wrong file.
  if (privateField.length < ED25519_SEED_BYTES) {
    throw new KeyError('damaged-key', 'Invalid Ed25519 seed length');
  }
  return privateField.subarray(0, ED25519_SEED_BYTES);
}
