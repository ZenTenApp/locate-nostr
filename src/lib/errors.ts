/**
 * Error plumbing.
 *
 * Two audiences. Relay code throws whatever a socket library throws, so
 * {@link errorMessage} exists to get a string out of an `unknown` catch. Key
 * import is different: the UI has to tell a wrong passphrase from a damaged
 * key from a key type this app cannot read, and each one has different advice
 * attached — so the reason travels as a typed code, not as a message string
 * that a reword would break.
 *
 * The code also has to survive a `postMessage` hop out of the key worker,
 * which a subclass of `Error` does not.
 *
 * Ported from `chat/src/lib/errors.ts`.
 */

/** A thrown value's message. `catch` binds `unknown`, and non-Error throws are
 *  routine across relay and WebSocket libraries. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

/** Why a key could not be turned into an identity. */
export type KeyErrorCode =
  /** Nothing in the text resembles an OpenSSH v1 private key. */
  | 'bad-format'
  /**
   * An OpenSSH key was found, but its bytes do not hold up — characters lost
   * to a partial selection, a line-wrapping mailer, or an editor that "fixed"
   * the text. Distinct from `bad-format` because the advice is opposite: the
   * user has the right key and needs to copy it again, not find another one.
   */
  | 'damaged-key'
  | 'unsupported-cipher'
  | 'unsupported-kdf'
  | 'unsupported-keytype'
  /** OpenSSH check-int mismatch — the canonical wrong-passphrase signal. */
  | 'wrong-passphrase'
  /**
   * The key is encrypted and no passphrase was given.
   *
   * Its own code because `bcrypt_pbkdf` rejects a zero-length passphrase as
   * invalid *parameters*, which used to surface as `bad-format` — the app
   * telling the user their key was not a key, when the key was fine and the
   * passphrase box was empty.
   */
  | 'passphrase-required'
  /** BIP39 words that are not a valid mnemonic, or an nsec that is not one. */
  | 'bad-mnemonic'
  /** No NIP-07 extension answered. */
  | 'no-extension'
  /** The extension was there and the user said no. */
  | 'extension-refused'
  | 'internal';

export class KeyError extends Error {
  readonly code: KeyErrorCode;

  constructor(code: KeyErrorCode, message: string) {
    super(message);
    this.name = 'KeyError';
    this.code = code;
  }
}

/** Message shown to the user for each failure. Kept beside the codes so the UI
 *  never has to invent wording for a case it does not know about. */
export const KEY_ERROR_TEXT: Record<KeyErrorCode, string> = {
  'bad-format': 'That does not look like an OpenSSH private key.',
  'damaged-key':
    'This is an OpenSSH key, but the text is incomplete or altered. Copy the whole key again — ' +
    'from the first character to the last.',
  'unsupported-cipher': 'Unsupported cipher — this app reads aes256-ctr keys.',
  'unsupported-kdf': 'Unsupported key derivation — this app reads bcrypt keys.',
  'unsupported-keytype': 'Unsupported key type — this app reads Ed25519 keys.',
  'wrong-passphrase': 'Wrong passphrase — could not decrypt the key.',
  'passphrase-required': 'This key is encrypted. Enter its passphrase to read it.',
  'bad-mnemonic': 'That is not a valid BIP39 recovery phrase or nsec.',
  'no-extension':
    'No Nostr extension answered. Install one (Alby, nos2x, …), or paste your npub instead.',
  'extension-refused': 'The extension did not hand over a public key.',
  internal: 'Something went wrong while reading the key.',
};

/** Narrow an unknown throw to its code, defaulting to `internal`. */
export function keyErrorCode(err: unknown): KeyErrorCode {
  return err instanceof KeyError ? err.code : 'internal';
}
