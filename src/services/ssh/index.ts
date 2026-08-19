/**
 * SSH key import: an encrypted OpenSSH Ed25519 private key becomes the BIP39
 * mnemonic that roots the user's Nostr identity.
 *
 * Ported from `usdt-pay/services/ssh-service.ts:164-180`. The Ed25519 seed is
 * exactly 32 bytes, which is exactly the entropy a 24-word mnemonic needs, so
 * the conversion is a re-encoding rather than a derivation — the same SSH key
 * always yields the same identity, on any device and in any of these apps.
 */
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

import { copyBytes, wipe } from '@/lib/bytes';

import { decryptOpenSSHPrivateBlock } from './bcrypt';
import { extractEd25519Seed, parseOpenSSHPrivateKey } from './openssh';

export { estimateDecryptSeconds } from './bcrypt';
export { parseOpenSSHPrivateKey } from './openssh';

/**
 * Convert an OpenSSH Ed25519 private key to a 24-word mnemonic.
 *
 * **Unencrypted keys are accepted here, unlike in `chat`.** That app refuses
 * them, and is right to: it *stores* the PEM in `localStorage` so the user can
 * sign in again, and a passphrase-less key stored in the clear hands the
 * identity to anything that can read that origin's storage. This app stores
 * nothing. The key is read once, in a worker, to compute a public key, and
 * every buffer holding it is zeroed before the call returns — so refusing a
 * key the user already keeps unencrypted on their own disk would buy no
 * safety and simply lock them out.
 *
 * Runs bcrypt_pbkdf at the key's round count when there is one — seconds to
 * minutes. Call it from the key worker, never on the main thread.
 */
export function convertOpenSSHEd25519ToMnemonic(pemContent: string, passphrase: string): string {
  const parsedKey = parseOpenSSHPrivateKey(pemContent);

  // With no KDF the "encrypted" block is already the plaintext private block.
  // Copied rather than used in place so this function owns something it can
  // wipe; the decoded key bytes it came from are local to the parser and go
  // out of scope with it.
  const decryptedBlock =
    parsedKey.kdfName === 'none'
      ? copyBytes(parsedKey.encrypted)
      : decryptOpenSSHPrivateBlock(parsedKey, passphrase);
  try {
    // `extractEd25519Seed` returns a view into `decryptedBlock`, and
    // `entropyToMnemonic` retains nothing, so one copy is taken to keep the
    // wipe below unambiguous.
    const seed = copyBytes(extractEd25519Seed(decryptedBlock));
    try {
      return entropyToMnemonic(seed, wordlist);
    } finally {
      wipe(seed);
    }
  } finally {
    wipe(decryptedBlock);
  }
}
