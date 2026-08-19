/**
 * NIP-06 key derivation: BIP39 mnemonic → seed → `m/44'/1237'/0'/0/0`.
 *
 * Ported from `chat/src/services/crypto/nip06.ts`, with the API turned inside
 * out for what this app is.
 *
 * `chat` derives a secret key and keeps it: it signs events and answers relay
 * AUTH. **This app signs nothing.** It sweeps relays anonymously, and the only
 * thing it needs out of a seed is the public key to filter on. So no function
 * here returns a secret — the private key exists as a local inside
 * {@link pubkeyFromMnemonic}, is consumed by `getPublicKey`, and is zeroed in
 * a `finally` before the call returns. A caller cannot hold it, leak it into a
 * React state tree, or forget to wipe it, because it is never handed over.
 *
 * That is the whole security posture of the key features: the window in which
 * this app holds a private key is measured in microseconds, and it is closed
 * before a single relay socket is open.
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

import { wipe } from '@/lib/bytes';
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
 * Walk the BIP32 ladder and return the public key. **Consumes and wipes
 * `seed`**, and wipes every private buffer it touches on the way.
 *
 * `HDKey` keeps the private key in its own internal buffer, and `derive`
 * leaves one behind at each level of the path; both are zeroed here rather
 * than left for the garbage collector, which makes no promises about when — or
 * whether — the bytes stop being readable.
 */
function pubkeyFromSeed(seed: Uint8Array): string {
  try {
    const master = HDKey.fromMasterSeed(seed);
    try {
      const derived = master.derive(NOSTR_PATH);
      if (!derived.privateKey) throw new KeyError('internal', 'Failed to derive the Nostr key');
      try {
        return getPublicKey(derived.privateKey);
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
  const words = mnemonic.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!validateMnemonic(words, wordlist)) {
    throw new KeyError('bad-mnemonic', 'Not a valid BIP39 recovery phrase');
  }
  return publicIdentity(pubkeyFromSeed(mnemonicToSeedSync(words, passphrase)));
}

/**
 * An `nsec` → the identity it is.
 *
 * Not a derivation — an nsec *is* the secret key — but it belongs beside the
 * mnemonic because it is the other thing people paste when asked for "the
 * key", and because it gets the same treatment: decoded, used once, wiped.
 */
export function pubkeyFromNsec(nsec: string): PublicIdentity {
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
    return publicIdentity(getPublicKey(decoded.data));
  } finally {
    wipe(decoded.data);
  }
}
