/**
 * Ambient types for `bcrypt-pbkdf`, which ships no declarations. Replaces the
 * reference's `@ts-expect-error` import so the call site is actually checked —
 * in particular the `passlen`/`saltlen` arguments, which are easy to get
 * wrong and fail as a misleading "wrong passphrase".
 *
 * The package is pure JS over `Uint8Array` and needs no Node polyfill; its
 * only dependency, `tweetnacl`, declares `"browser": { "crypto": false,
 * "buffer": false }` and seeds from `self.crypto`, which exists in a Worker.
 */
declare module 'bcrypt-pbkdf' {
  /**
   * OpenSSH's bcrypt_pbkdf. Writes `keylen` bytes into `key`.
   * Returns 0 on success and -1 on invalid parameters — check it.
   */
  export function pbkdf(
    pass: Uint8Array,
    passlen: number,
    salt: Uint8Array,
    saltlen: number,
    key: Uint8Array,
    keylen: number,
    rounds: number,
  ): number;

  export const BLOCKS: number;
  export const HASHSIZE: number;
}
