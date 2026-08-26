/**
 * NIP-06 key derivation: BIP39 mnemonic → seed → `m/44'/1237'/0'/0/0`.
 *
 * Ported from `chat/src/services/crypto/nip06.ts`, with the API turned inside
 * out for what this app is.
 *
 * **Sweeping signs nothing.** It reads relays anonymously, and the only thing
 * it needs out of a seed is the public key to filter on — so
 * {@link pubkeyFromMnemonic} and {@link pubkeyFromNsec} hand back a pubkey and
 * nothing else. The private key exists as a local, is consumed by
 * `getPublicKey`, and is zeroed in a `finally` before the call returns. A
 * caller cannot hold it, leak it into a React state tree, or forget to wipe
 * it, because it is never handed over.
 *
 * **Purging signs.** A NIP-09 delete request is a signed event, so purging
 * from a seed or an SSH key genuinely needs the secret, and
 * {@link secretKeyFromMnemonic} and {@link secretKeyFromNsec} are the only two
 * functions in this app that produce one. They exist for the key worker and
 * are called from nowhere else: the secret is derived inside the worker, kept
 * there for the length of one purge, and dropped when the worker is
 * terminated. Nothing that returns a secret is reachable from the main thread
 * — see `services/nostr/signer.ts`, which is the only door.
 *
 * The sweep's posture is unchanged by that: a user who never purges is a user
 * whose private key exists for microseconds, before a single relay socket is
 * open.
 *
 * The derivation path itself must not drift from the reference apps — the same
 * seed has to yield the same identity here, in `chat`, in `1of2-app` and in
 * `usdt-pay`, or this tool would confidently report that a user's data is
 * nowhere on the network.
 */
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { nip19 } from 'nostr-tools';
import { getPublicKey } from 'nostr-tools/pure';

import { copyBytes, wipe } from '@/lib/bytes';
import { KeyError } from '@/lib/errors';

const NOSTR_PATH = "m/44'/1237'/0'/0/0";

/** The public half of an identity. Deliberately the only thing this module
 *  returns — see the file header. */
export interface PublicIdentity {
  pubkey: string;
  npub: string;
}

export function publicIdentity(pubkey: string): PublicIdentity {
  return { pubkey, npub: nip19.npubEncode(pubkey) };
}

/**
 * Walk the BIP32 ladder and return the secret key. **Consumes and wipes
 * `seed`**, and wipes every private buffer it touches on the way.
 *
 * `HDKey` keeps the private key in its own internal buffer, and `derive`
 * leaves one behind at each level of the path; both are zeroed here rather
 * than left for the garbage collector, which makes no promises about when — or
 * whether — the bytes stop being readable. What comes back is a copy the
 * caller owns and must wipe — `copyBytes` rather than a view, precisely so the
 * wipes above cannot reach through it later and blank a key mid-signature.
 */
function secretFromSeed(seed: Uint8Array): Uint8Array {
  try {
    const master = HDKey.fromMasterSeed(seed);
    try {
      const derived = master.derive(NOSTR_PATH);
      if (!derived.privateKey) throw new KeyError('internal', 'Failed to derive the Nostr key');
      try {
        return copyBytes(derived.privateKey);
      } finally {
        wipe(derived.privateKey);
      }
    } finally {
      wipe(master.privateKey);
    }
  } finally {
    wipe(seed);
  }
}

/** The public half only, with the secret wiped before this returns. */
function pubkeyFromSeed(seed: Uint8Array): string {
  const secret = secretFromSeed(seed);
  try {
    return getPublicKey(secret);
  } finally {
    wipe(secret);
  }
}

/** Validate a phrase and stretch it into a BIP39 seed. PBKDF2-HMAC-SHA512 ×
 *  2048 — about a second, which is why every caller is inside the worker. */
function seedFromMnemonic(mnemonic: string, passphrase: string): Uint8Array {
  const words = mnemonic.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!validateMnemonic(words, wordlist)) {
    throw new KeyError('bad-mnemonic', 'Not a valid BIP39 recovery phrase');
  }
  return mnemonicToSeedSync(words, passphrase);
}

/**
 * A BIP39 recovery phrase → the identity it roots.
 *
 * `mnemonicToSeedSync` is PBKDF2-HMAC-SHA512 × 2048 and takes about a second,
 * so this runs in the key worker rather than on the main thread.
 *
 * The optional passphrase is BIP39's 25th word. It is *not* the SSH key
 * passphrase and not an encryption password: a different value here is a
 * different wallet entirely, silently, which is why the field says so.
 */
export function pubkeyFromMnemonic(mnemonic: string, passphrase = ''): PublicIdentity {
  return publicIdentity(pubkeyFromSeed(seedFromMnemonic(mnemonic, passphrase)));
}

/**
 * The same derivation, stopping one step earlier: the secret key itself.
 *
 * **Key-worker only.** This is one of the two functions in the app that hands
 * a private key to its caller, and it exists solely so a purge can sign a
 * NIP-09 delete request. The caller owns the buffer and must wipe it; in
 * practice the caller is the worker, which holds it for one purge session and
 * dies with it. Nothing on the main thread imports this.
 */
export function secretKeyFromMnemonic(mnemonic: string, passphrase = ''): Uint8Array {
  return secretFromSeed(seedFromMnemonic(mnemonic, passphrase));
}

/**
 * An `nsec` → the identity it is.
 *
 * Not a derivation — an nsec *is* the secret key — but it belongs beside the
 * mnemonic because it is the other thing people paste when asked for "the
 * key", and because it gets the same treatment: decoded, used once, wiped.
 */
export function pubkeyFromNsec(nsec: string): PublicIdentity {
  const secret = secretKeyFromNsec(nsec);
  try {
    return publicIdentity(getPublicKey(secret));
  } finally {
    wipe(secret);
  }
}

/**
 * The secret an `nsec` encodes.
 *
 * **Key-worker only**, for the same reason and under the same rules as
 * {@link secretKeyFromMnemonic}: signing a delete request is the only thing in
 * this app that needs it, and the buffer belongs to the caller to wipe. The
 * bytes are copied out of the decode result so wiping that result — which
 * happens immediately — cannot blank the key the worker is about to sign with.
 */
export function secretKeyFromNsec(nsec: string): Uint8Array {
  let decoded;
  try {
    decoded = nip19.decode(nsec.trim());
  } catch {
    throw new KeyError('bad-mnemonic', 'Not a valid nsec');
  }
  if (decoded.type !== 'nsec') {
    throw new KeyError('bad-mnemonic', `That is an ${decoded.type}, not an nsec`);
  }
  try {
    return copyBytes(decoded.data);
  } finally {
    wipe(decoded.data);
  }
}
