/**
 * OpenSSH Ed25519 private-key types.
 *
 * Modelled as a discriminated union rather than the reference's optional
 * fields (`kdfSalt?`, consumed via `kdfSalt!`): under
 * `exactOptionalPropertyTypes` the optional form is hostile, and the union
 * turns "does this key need a passphrase" into a typed narrowing instead of a
 * runtime string check. Both arms are usable here — unlike in `chat`, which
 * refuses the unencrypted one; see `services/ssh/index.ts`.
 */

/** A key whose private block is stored in the clear — no passphrase needed,
 *  and no bcrypt wait. */
export interface UnencryptedParsedKey {
  kdfName: 'none';
  cipherName: string;
  encrypted: Uint8Array;
}

/** A passphrase-protected key: bcrypt_pbkdf KDF over an aes256-ctr block. */
export interface EncryptedParsedKey {
  kdfName: 'bcrypt';
  cipherName: string;
  kdfSalt: Uint8Array;
  kdfRounds: number;
  encrypted: Uint8Array;
}

export type ParsedKey = UnencryptedParsedKey | EncryptedParsedKey;
