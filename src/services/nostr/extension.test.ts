import { afterEach, describe, expect, it, vi } from 'vitest';

import { KeyError } from '@/lib/errors';

import { hasNostrExtension, pubkeyFromExtension } from './extension';

const HEX = '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2';

function withProvider(getPublicKey: () => Promise<string>): void {
  vi.stubGlobal('window', { nostr: { getPublicKey } });
}

afterEach(() => vi.unstubAllGlobals());

describe('hasNostrExtension', () => {
  it('is false when nothing injected a provider', () => {
    vi.stubGlobal('window', {});
    expect(hasNostrExtension()).toBe(false);
  });

  it('is false for a provider that cannot answer', () => {
    // An object called `nostr` is not a signer.
    vi.stubGlobal('window', { nostr: {} });
    expect(hasNostrExtension()).toBe(false);
  });
});

describe('pubkeyFromExtension', () => {
  it('reads the key and derives its npub', async () => {
    withProvider(async () => HEX);
    const identity = await pubkeyFromExtension();
    expect(identity.pubkey).toBe(HEX);
    expect(identity.npub.startsWith('npub1')).toBe(true);
  });

  it('accepts uppercase hex, which some extensions return', async () => {
    withProvider(async () => HEX.toUpperCase());
    expect((await pubkeyFromExtension()).pubkey).toBe(HEX);
  });

  it('reports a refusal as a refusal, not as a missing extension', async () => {
    // The user clicking "no" and having no extension need different advice.
    withProvider(async () => {
      throw new Error('User rejected');
    });
    await expect(pubkeyFromExtension()).rejects.toThrow(
      expect.objectContaining({ code: 'extension-refused' }),
    );
  });

  it('rejects an answer that is not a key', async () => {
    withProvider(async () => 'definitely-not-a-pubkey');
    await expect(pubkeyFromExtension()).rejects.toThrow(
      expect.objectContaining({ code: 'extension-refused' }),
    );
  });

  it('gives up with no-extension when nothing ever appears', async () => {
    vi.stubGlobal('window', {});
    await expect(pubkeyFromExtension()).rejects.toThrow(KeyError);
  }, 10_000);
});
