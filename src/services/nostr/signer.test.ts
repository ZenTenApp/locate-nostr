/**
 * The door between "we know your pubkey" and "we can act as you".
 *
 * The extension path is the one worth pinning: `window.nostr` is injected by
 * software this app does not control, it is handed the user's own key, and
 * whatever it returns is about to be published to every relay in a purge's
 * target list. So its answer is checked like a relay's — and these tests are
 * the check on the check.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';

import { DELETE_KIND } from '@/config/purge';
import type { EventTemplate, SignedEvent } from '@/services/nostr/events';

import { extensionSigner } from './signer';

const SECRET = generateSecretKey();
const PUBKEY = getPublicKey(SECRET);
const IMPOSTOR = generateSecretKey();

function template(overrides: Partial<EventTemplate> = {}): EventTemplate {
  return {
    kind: DELETE_KIND,
    created_at: 1_770_000_000,
    tags: [['e', 'a'.repeat(64)]],
    content: 'because',
    ...overrides,
  };
}

/** A NIP-07 provider that signs however the test tells it to. */
function withProvider(signEvent: (event: EventTemplate & { pubkey: string }) => unknown): void {
  vi.stubGlobal('window', {
    nostr: { getPublicKey: async () => PUBKEY, signEvent: async (e: never) => signEvent(e) },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('extensionSigner', () => {
  it('returns the signed event when the extension signs what it was given', async () => {
    withProvider((event) => finalizeEvent(event, SECRET));
    const signed = await (await extensionSigner()).sign(template());

    expect(signed.pubkey).toBe(PUBKEY);
    expect(signed.kind).toBe(DELETE_KIND);
    expect(signed.id).toHaveLength(64);
  });

  it('refuses an event the extension quietly rewrote', async () => {
    // Correctly signed, by the right key — and not the event that was shown.
    // Without this check a hostile provider gets anything it likes signed by
    // the user and published to every targeted relay.
    withProvider((event) => finalizeEvent({ ...event, content: 'gotcha' }, SECRET));
    const signer = await extensionSigner();

    await expect(signer.sign(template())).rejects.toThrow(/different event/);
  });

  it('refuses an event whose tags were swapped for other people’s', async () => {
    withProvider((event) => finalizeEvent({ ...event, tags: [['e', 'f'.repeat(64)]] }, SECRET));
    const signer = await extensionSigner();

    await expect(signer.sign(template())).rejects.toThrow(/different event/);
  });

  it('refuses a signature that does not check out, even when the event claims otherwise', async () => {
    // The spread carries `nostr-tools`' own "already verified" symbol across,
    // which is exactly how a check that trusted the object rather than its
    // fields would be talked out of running.
    withProvider((event) => {
      const real = finalizeEvent(event, SECRET) as SignedEvent;
      return { ...real, sig: '0'.repeat(128) };
    });
    const signer = await extensionSigner();

    await expect(signer.sign(template())).rejects.toThrow(/does not check out/);
  });

  it('refuses an event signed by a different key', async () => {
    withProvider((event) => finalizeEvent(event, IMPOSTOR));
    const signer = await extensionSigner();

    await expect(signer.sign(template())).rejects.toThrow();
  });

  it('will not sign a kind this app has no business signing', async () => {
    // A purge is the only thing here that signs. Anything asking for a note
    // under the user's key is either a mistake or not this app.
    let asked = false;
    withProvider((event) => {
      asked = true;
      return finalizeEvent(event, SECRET);
    });
    const signer = await extensionSigner();

    await expect(signer.sign(template({ kind: 1, content: 'gm' }))).rejects.toThrow(
      /does not sign/,
    );
    expect(asked).toBe(false);
  });
});
