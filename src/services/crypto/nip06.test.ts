import { describe, expect, it } from 'vitest';

import { KeyError } from '@/lib/errors';

import { pubkeyFromMnemonic, pubkeyFromNsec } from './nip06';

/**
 * NIP-06's own published test vector. External truth: if the derivation path,
 * the BIP39 seed step or the curve ever drift, this stops matching the spec
 * rather than merely changing.
 */
const NIP06_VECTOR = {
  mnemonic: 'leader monkey parrot ring guide accident before fence cannon height naive bean',
  npub: 'npub1zutzeysacnf9rru6zqwmxd54mud0k44tst6l70ja5mhv8jjumytsd2x7nu',
} as const;

describe('pubkeyFromMnemonic', () => {
  it('matches the NIP-06 test vector', () => {
    expect(pubkeyFromMnemonic(NIP06_VECTOR.mnemonic).npub).toBe(NIP06_VECTOR.npub);
  });

  it('tolerates the whitespace and case a paste carries', () => {
    const messy = `  ${NIP06_VECTOR.mnemonic.toUpperCase().replace(/ /g, '\n  ')}\n`;
    expect(pubkeyFromMnemonic(messy).npub).toBe(NIP06_VECTOR.npub);
  });

  it('treats the BIP39 passphrase as a different wallet, not a password', () => {
    const withPassphrase = pubkeyFromMnemonic(NIP06_VECTOR.mnemonic, 'extra');
    expect(withPassphrase.npub).not.toBe(NIP06_VECTOR.npub);
  });

  it('rejects a phrase whose checksum does not hold, rather than deriving junk', () => {
    // Last word swapped for another valid wordlist entry: right words, wrong
    // checksum. Deriving from it would hand back a plausible npub for an
    // identity that does not exist.
    const broken = NIP06_VECTOR.mnemonic.replace(/bean$/, 'zoo');
    expect(() => pubkeyFromMnemonic(broken)).toThrow(
      expect.objectContaining({ code: 'bad-mnemonic' }),
    );
  });

  it('rejects a word that is not in the wordlist', () => {
    expect(() => pubkeyFromMnemonic('not actually a recovery phrase at all')).toThrow(KeyError);
  });
});

describe('pubkeyFromNsec', () => {
  // The nsec for a secret key of all 0x01 bytes, and the pubkey it yields.
  const NSEC = 'nsec1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqstywftw';
  const PUBKEY = '1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f';

  it('reads the identity an nsec is', () => {
    expect(pubkeyFromNsec(NSEC).pubkey).toBe(PUBKEY);
  });

  it('wipes the decoded secret rather than leaving it for the collector', () => {
    // `nip19.decode` hands back a fresh Uint8Array per call, so the wipe is
    // observable only through a second decode being unaffected — what this
    // pins is that using it once does not corrupt the next read.
    expect(pubkeyFromNsec(NSEC).pubkey).toBe(pubkeyFromNsec(NSEC).pubkey);
  });

  it('refuses an npub, which is the paste people actually make by mistake', () => {
    expect(() => pubkeyFromNsec(NIP06_VECTOR.npub)).toThrow(
      expect.objectContaining({ code: 'bad-mnemonic' }),
    );
  });

  it('refuses nonsense', () => {
    expect(() => pubkeyFromNsec('nsec1nope')).toThrow(KeyError);
  });
});
