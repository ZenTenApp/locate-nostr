/**
 * OpenSSH Ed25519 private-key types.
 *
 * Modelled as a discriminated union rather than the reference's optional
 * fields (`kdfSalt?`, consumed via `kdfSalt!`): under
 * `exactOptionalPropertyTypes` the optional form is hostile, and the union
 * makes "an unencrypted key is not acceptable" a typed narrowing instead of a
 * runtime string check.
 */

/** A key whose private block is stored in the clear. Rejected at login. */
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
