import { describe, expect, it } from 'vitest';

import { InvalidIdentityError, parseIdentity, shortIdentity } from './identity';

// jack's key, the most-pasted npub on the network.
const HEX = '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2';
const NPUB = 'npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m';

describe('parseIdentity', () => {
  it('reads hex, and gives back the npub for display', () => {
    expect(parseIdentity(HEX)).toMatchObject({ hex: HEX, npub: NPUB });
  });

  it('reads an npub', () => {
    expect(parseIdentity(NPUB).hex).toBe(HEX);
  });

  it('reads uppercase hex, which is what a copy from a block explorer gives', () => {
    expect(parseIdentity(HEX.toUpperCase()).hex).toBe(HEX);
  });

  it('strips the nostr: prefix a client link carries', () => {
    expect(parseIdentity(`nostr:${NPUB}`).hex).toBe(HEX);
  });

  it('rejects an nevent, which decodes fine and is not an identity', () => {
    expect(() =>
      parseIdentity(
        'nevent1qqstna2yrezu5wghjvswqqculvvwxsrcvu7uc0f78gan4xqhvz49d9spr3mhxue69uhkummnw3ez6un9d3shjtn4de6x2argwghx6egpr4mhxue69uhkummnw3ez6ur4vgh8wetvd3hhyer9wghxuet5nxnepm',
      ),
    ).toThrow(InvalidIdentityError);
  });

  it('rejects nonsense', () => {
    expect(() => parseIdentity('not a key')).toThrow(InvalidIdentityError);
  });

  it('rejects an empty box with a message that says what to paste', () => {
    expect(() => parseIdentity('  ')).toThrow('Enter an npub or hex pubkey');
  });
});

describe('shortIdentity', () => {
  it('keeps both ends, which is what a person recognises', () => {
    expect(shortIdentity(NPUB)).toBe('npub1sg6pl…0uf63m');
  });
});
