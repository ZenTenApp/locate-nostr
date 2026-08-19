/**
 * SSH import vectors.
 *
 * This suite is what guards the Buffer → Uint8Array rewrite. That port is
 * silent-failure territory: `Buffer.slice()` returned a view and
 * `Uint8Array.slice()` returns a copy, so a mechanical translation can produce
 * a *different but plausible* seed, or leave key material alive past its wipe,
 * with nothing at runtime to notice.
 *
 * Two independent anchors, so a green run means more than "stable output":
 *
 *   1. EQUIVALENCE — `encrypted-ed25519.pem` derives the exact mnemonic that
 *      usdt-pay's original React Native `ssh-service.ts` derives from the same
 *      file. Verified by running the reference implementation directly.
 *   2. EXTERNAL TRUTH — the Ed25519 public key recomputed from our extracted
 *      seed matches what `ssh-keygen -y` reports. OpenSSH, not our own code,
 *      says the decryption was correct.
 *
 * See `__fixtures__/README.md` for how the keys were made.
 *
 * Ported wholesale from `chat/src/services/ssh/ssh.test.ts`. Same module, same
 * vectors, so the identity this app derives from an SSH key is provably the
 * one `chat` signs with — a tool that answered "your data is nowhere" because
 * it derived a different pubkey than the app that wrote the data would be
 * worse than no tool.
 */
import { readFileSync } from 'node:fs';

import { ed25519 } from '@noble/curves/ed25519.js';
import { base64 } from '@scure/base';
import { describe, expect, it } from 'vitest';

import { copyBytes } from '@/lib/bytes';
import { KeyError } from '@/lib/errors';
import { pubkeyFromMnemonic } from '@/services/crypto/nip06';

import { decryptOpenSSHPrivateBlock } from './bcrypt';
import { convertOpenSSHEd25519ToMnemonic, parseOpenSSHPrivateKey } from './index';
import { extractEd25519Seed } from './openssh';

const ASCII_PASSPHRASE = 'test-passphrase';
const UNICODE_PASSPHRASE = 'pässwörd-ünïcode-✓';

function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
}

/** The 32-byte raw key out of an `ssh-ed25519 AAAA...` public-key line. */
function sshPublicKeyBytes(line: string): Uint8Array {
  const blob = base64.decode(line.split(' ')[1] ?? '');
  // Framing: uint32 len + "ssh-ed25519" (11 bytes) + uint32 len + 32-byte key.
  return blob.subarray(blob.length - 32);
}

/** The encrypted fixture's base64 body, stripped of its PEM armour. Both the
 *  damage cases and the paste shapes are built from this one string. */
const ENCRYPTED_BODY = fixture('encrypted-ed25519.pem')
  .replace(/-----[^-]*-----/g, '')
  .replace(/\s+/g, '');

/** As reported by `ssh-keygen -y` for each fixture. */
const SSH_PUBLIC_KEYS = {
  ascii: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAII3Tw4Te8ZF6RGAsCJXXdQdl7XnqidBb8h+4nF5lX4+k',
  unicode: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAzm0IykH4IbPbZCbnpnBOc5YIO7iKnYTBjaSEr5H0tI',
  plain: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG/0hv2KIsv7Kyo3TgHJaYI8Mak86JS74ChRCqv+zirt',
} as const;

describe('parseOpenSSHPrivateKey', () => {
  it('reads the cipher and KDF parameters of an encrypted key', () => {
    const parsed = parseOpenSSHPrivateKey(fixture('encrypted-ed25519.pem'));
    expect(parsed.kdfName).toBe('bcrypt');
    expect(parsed.cipherName).toBe('aes256-ctr');
    if (parsed.kdfName !== 'bcrypt') throw new Error('unreachable');
    // Drives the pre-decrypt time estimate shown on the passphrase step.
    expect(parsed.kdfRounds).toBe(4);
    expect(parsed.kdfSalt.length).toBeGreaterThan(0);
  });

  it('classifies an unencrypted key rather than throwing', () => {
    // Parsing must succeed so the UI can explain *why* the key is refused.
    expect(parseOpenSSHPrivateKey(fixture('unencrypted-ed25519.pem')).kdfName).toBe('none');
  });

  it('rejects input that is not an OpenSSH key', () => {
    expect(() => parseOpenSSHPrivateKey('hello')).toThrow(
      expect.objectContaining({ code: 'bad-format' }),
    );
  });

  it('rejects a truncated key body', () => {
    const truncated = fixture('encrypted-ed25519.pem').split('\n', 3).join('\n');
    expect(() => parseOpenSSHPrivateKey(truncated)).toThrow(KeyError);
  });

  /**
   * A key that lost characters must not be reported as "not a key".
   *
   * The two cases need opposite advice — find a different file versus copy this
   * one again — and a partial clipboard selection is far the more common of the
   * two, so collapsing them sends people looking for a problem they don't have.
   */
  describe('damage is told apart from the wrong file', () => {
    it.each([
      // Characters dropped mid-body: base64 that no longer aligns.
      [
        'characters lost mid-body',
        `${ENCRYPTED_BODY.substring(0, 100)}${ENCRYPTED_BODY.substring(106)}`,
      ],
      // Aligned, decodes fine, but the framing then runs off the end.
      ['a body cut short', ENCRYPTED_BODY.substring(0, 200)],
    ])('reports %s as damage', (_label, damaged) => {
      expect(() => parseOpenSSHPrivateKey(damaged)).toThrow(
        expect.objectContaining({ code: 'damaged-key' }),
      );
    });
  });
});

/**
 * The shapes a key actually arrives in.
 *
 * People do not paste files, they paste whatever their password manager, note
 * app or provisioning script hands them — armour intact, armour on one line, no
 * armour at all, or the body quoted inside a JSON wrapper. Every one of these
 * carries the identical key, so every one must derive the identical identity;
 * refusing on presentation alone would be refusing the user's real key.
 */
describe('paste shapes', () => {
  const body = ENCRYPTED_BODY;

  const shapes = {
    original: fixture('encrypted-ed25519.pem'),
    'one-liner with markers': `-----BEGIN OPENSSH PRIVATE KEY-----\n${body}\n-----END OPENSSH PRIVATE KEY-----`,
    'bare one-liner': body,
    // `OPENSSHPRIVATEKEY` is itself a run of base64 characters once whitespace
    // is gone, so this shape also pins that a wrapper's own words are never
    // mistaken for the body. Not valid JSON, deliberately: the wrapper is never
    // parsed, so a malformed one must read the same as a well-formed one.
    'json wrapper': `{\n[\n"OPENSSH PRIVATE KEY":"${body}"\n]\n}`,
    'json, well formed': JSON.stringify({ 'OPENSSH PRIVATE KEY': body }),
    // No punctuation at all between wrapper and body: `=` is base64 padding, so
    // `KEY=` runs straight into the key and there is no separator to split on.
    'shell or dotenv assignment': `SSH_KEY=${body}`,
    // A rich-text copy can smuggle a zero-width space into the middle of the
    // body, where `\s` would not catch it.
    'body split by a zero-width space': `${body.substring(0, 40)}\u200b${body.substring(40)}`,
  } as const;

  it.each(Object.keys(shapes))('parses the %s shape', (shape) => {
    const parsed = parseOpenSSHPrivateKey(shapes[shape as keyof typeof shapes]);
    expect(parsed.kdfName).toBe('bcrypt');
  });

  it('derives one identical identity from every shape', () => {
    const mnemonics = new Set(
      Object.values(shapes).map((text) => convertOpenSSHEd25519ToMnemonic(text, ASCII_PASSPHRASE)),
    );
    expect(mnemonics.size).toBe(1);
  });
});

describe('convertOpenSSHEd25519ToMnemonic', () => {
  it('matches the mnemonic usdt-pay derives from the same key', () => {
    // Verified against the reference React Native implementation; see header.
    expect(
      convertOpenSSHEd25519ToMnemonic(fixture('encrypted-ed25519.pem'), ASCII_PASSPHRASE),
    ).toBe(
      'six dose case inflict collect melody major business across pact wasp reunion ' +
        'find capable robust weird state toe flight tank cabbage profit million picnic',
    );
  });

  it('derives the identity that mnemonic roots', () => {
    const mnemonic = convertOpenSSHEd25519ToMnemonic(
      fixture('encrypted-ed25519.pem'),
      ASCII_PASSPHRASE,
    );
    const identity = pubkeyFromMnemonic(mnemonic);
    expect(identity.pubkey).toBe(
      '7c52c14bcdcdbbaad867fab72e72dc290b8ddb924f360d428b2e4e550a51fe60',
    );
    expect(identity.npub).toBe('npub103fvzj7deka64kr8l2mjuuku9y9cmkujfumq6s5t9e892zj3lesqzj6uh6');
  });

  it('handles a non-ASCII passphrase', () => {
    // The reference implementation FAILS this case: it passed
    // `passphrase.length` (UTF-16 code units) as bcrypt's `passlen` while
    // passing UTF-8 bytes, so anything non-ASCII hashed a truncated prefix and
    // surfaced as a spurious wrong-passphrase error.
    const mnemonic = convertOpenSSHEd25519ToMnemonic(
      fixture('encrypted-unicode-ed25519.pem'),
      UNICODE_PASSPHRASE,
    );
    expect(mnemonic.split(' ')).toHaveLength(24);
    expect(pubkeyFromMnemonic(mnemonic).pubkey).toBe(
      'a24e9f79f075b39e1340bede97eef66cb431ddc919359efa91fbe33b2da5bfe6',
    );
  });

  it('reads a key with no passphrase at all', () => {
    // `chat` refuses these, because it stores the PEM and a passphrase-less
    // key in `localStorage` gives the identity away. This app stores nothing
    // and only derives a public key, so refusing would lock the user out of
    // their own key for no gain.
    const mnemonic = convertOpenSSHEd25519ToMnemonic(fixture('unencrypted-ed25519.pem'), '');
    expect(mnemonic.split(' ')).toHaveLength(24);
  });

  it('derives the same identity from an unencrypted key however it is pasted', () => {
    const armoured = fixture('unencrypted-ed25519.pem');
    const bare = armoured.replace(/-----[^-]*-----/g, '').replace(/\s+/g, '');
    expect(convertOpenSSHEd25519ToMnemonic(bare, '')).toBe(
      convertOpenSSHEd25519ToMnemonic(armoured, ''),
    );
  });

  it('ignores a passphrase typed for a key that has none', () => {
    expect(convertOpenSSHEd25519ToMnemonic(fixture('unencrypted-ed25519.pem'), 'ignored')).toBe(
      convertOpenSSHEd25519ToMnemonic(fixture('unencrypted-ed25519.pem'), ''),
    );
  });

  it('reports an empty passphrase as a missing passphrase, not as a broken key', () => {
    // `bcrypt_pbkdf` rejects a zero-length passphrase as invalid parameters,
    // which used to surface as `bad-format` — the app telling the user their
    // key was not a key, moments after parsing it and reading its bcrypt
    // round count off it.
    expect(() => convertOpenSSHEd25519ToMnemonic(fixture('encrypted-ed25519.pem'), '')).toThrow(
      expect.objectContaining({ code: 'passphrase-required' }),
    );
  });

  it('reports a wrong passphrase as such', () => {
    expect(() => convertOpenSSHEd25519ToMnemonic(fixture('encrypted-ed25519.pem'), 'nope')).toThrow(
      expect.objectContaining({ code: 'wrong-passphrase' }),
    );
  });

  it('treats a passphrase truncated at the first non-ASCII byte as wrong', () => {
    // The precise shape of the old bug: the UTF-16 count cut the passphrase
    // short. If `passlen` ever regresses, this prefix starts succeeding.
    expect(() =>
      convertOpenSSHEd25519ToMnemonic(fixture('encrypted-unicode-ed25519.pem'), 'p'),
    ).toThrow(expect.objectContaining({ code: 'wrong-passphrase' }));
  });
});

describe('decrypted seed', () => {
  it.each([
    ['encrypted-ed25519.pem', ASCII_PASSPHRASE, SSH_PUBLIC_KEYS.ascii],
    ['encrypted-unicode-ed25519.pem', UNICODE_PASSPHRASE, SSH_PUBLIC_KEYS.unicode],
  ])('reproduces the public key ssh-keygen reports for %s', (file, passphrase, publicKeyLine) => {
    const parsed = parseOpenSSHPrivateKey(fixture(file));
    if (parsed.kdfName !== 'bcrypt') throw new Error('fixture should be encrypted');

    const block = decryptOpenSSHPrivateBlock(parsed, passphrase);
    const seed = copyBytes(extractEd25519Seed(block));

    expect(ed25519.getPublicKey(seed)).toEqual(sshPublicKeyBytes(publicKeyLine));
  });

  it('reads the seed straight out of an unencrypted key, and OpenSSH agrees', () => {
    // The no-KDF path skips bcrypt entirely and treats the "encrypted" block
    // as plaintext. External truth that it lands on the right 32 bytes: the
    // public key recomputed here matches what `ssh-keygen -y` reports.
    const parsed = parseOpenSSHPrivateKey(fixture('unencrypted-ed25519.pem'));
    if (parsed.kdfName !== 'none') throw new Error('fixture should be unencrypted');

    const seed = copyBytes(extractEd25519Seed(parsed.encrypted));
    expect(ed25519.getPublicKey(seed)).toEqual(sshPublicKeyBytes(SSH_PUBLIC_KEYS.plain));
  });

  it('wipes the decrypted block, taking every view into it with it', () => {
    const parsed = parseOpenSSHPrivateKey(fixture('encrypted-ed25519.pem'));
    if (parsed.kdfName !== 'bcrypt') throw new Error('fixture should be encrypted');

    const block = decryptOpenSSHPrivateBlock(parsed, ASCII_PASSPHRASE);
    // A view, not a copy — this is the whole reason `.slice()` is banned here.
    const seed = extractEd25519Seed(block);
    expect(seed.some((byte) => byte !== 0)).toBe(true);

    block.fill(0);
    expect(seed.every((byte) => byte === 0)).toBe(true);
  });
});
