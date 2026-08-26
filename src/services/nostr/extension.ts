/**
 * NIP-07: reading the public key out of a browser extension.
 *
 * This is the one identity source where **no key material touches this app at
 * all** — the extension holds the key, the page asks for the public half, and
 * the user approves it in the extension's own UI. It is therefore the source
 * to prefer, and the one listed first.
 *
 * `chat` cannot use NIP-07 and says so at length: its joint-account groups are
 * derived from the raw ECDH secret, which an extension will never expose. This
 * app has the opposite requirement — a pubkey and nothing else — so the thing
 * that rules the extension out there makes it ideal here.
 *
 * Two practical problems, both handled below rather than left to fail as a
 * blank screen: the extension injects `window.nostr` asynchronously and may
 * not be there on the first frame, and `getPublicKey()` may never settle if
 * the user ignores the approval prompt.
 */
import { KeyError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { publicIdentity } from '@/services/crypto/nip06';
import { HEX_64 } from '@/services/nostr/identity';
import type { PublicIdentity } from '@/services/crypto/nip06';
import type { EventTemplate, SignedEvent } from '@/services/nostr/events';

/**
 * The sliver of NIP-07 this app uses.
 *
 * `signEvent` is optional because it genuinely is: a sweep never calls it, and
 * a provider that only answers `getPublicKey` is a perfectly good identity
 * source. Only a purge reaches for it, and it fails with an explanation rather
 * than a `TypeError` when it is not there.
 */
interface Nip07Provider {
  getPublicKey: () => Promise<string>;
  signEvent?: (event: UnsignedEvent) => Promise<SignedEvent>;
}

/** What NIP-07 takes: a template plus the pubkey it will be signed as. */
type UnsignedEvent = EventTemplate & { pubkey: string };

declare global {
  interface Window {
    nostr?: Nip07Provider;
  }
}

/** How long to keep looking for a late-injecting extension. Alby and nos2x
 *  both inject well inside this; the wait is only paid when there is nothing
 *  to find. */
const DETECT_TIMEOUT_MS = 1_500;
const DETECT_INTERVAL_MS = 100;

/**
 * How long to wait for the user to approve. The extension shows its own
 * prompt, and a user who walks away must not leave the button spinning
 * forever — but the window has to be long enough to actually read the prompt.
 */
const APPROVAL_TIMEOUT_MS = 90_000;

/** Is an extension present *right now*? Used to word the button's tooltip, so
 *  it answers immediately rather than waiting for a late injection. The button
 *  itself is always offered — pressing it is how a late-injecting extension
 *  gets found. */
export function hasNostrExtension(): boolean {
  return typeof window !== 'undefined' && typeof window.nostr?.getPublicKey === 'function';
}

/** Wait briefly for a late injection. Resolves to the provider or null. */
async function waitForProvider(): Promise<Nip07Provider | null> {
  const deadline = Date.now() + DETECT_TIMEOUT_MS;
  for (;;) {
    if (hasNostrExtension() && window.nostr) return window.nostr;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, DETECT_INTERVAL_MS));
  }
}

/**
 * Ask the extension who the user is.
 *
 * Throws {@link KeyError} `no-extension` when nothing answers and
 * `extension-refused` when something did but would not produce a usable key —
 * the user declining, and an extension returning junk, are the same outcome
 * from here and the same advice applies.
 */
export async function pubkeyFromExtension(): Promise<PublicIdentity> {
  const provider = await waitForProvider();
  if (!provider) {
    throw new KeyError('no-extension', 'No window.nostr provider');
  }

  let raw: string;
  try {
    raw = await Promise.race([
      provider.getPublicKey(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new KeyError('extension-refused', 'The extension did not answer')),
          APPROVAL_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (err) {
    if (err instanceof KeyError) throw err;
    // Extensions reject with all sorts of things when a user clicks "no".
    logger.key('Extension refused', { error: String(err) });
    throw new KeyError('extension-refused', 'The extension refused');
  }

  // NIP-07 says hex, and every extension agrees, but one returning an npub is
  // a five-line fix here versus an unreadable failure for the user.
  const trimmed = raw.trim();
  if (!HEX_64.test(trimmed)) {
    throw new KeyError('extension-refused', 'The extension returned something that is not a key');
  }
  return publicIdentity(trimmed.toLowerCase());
}

/**
 * Ask the extension to sign one event.
 *
 * Every call is a prompt the user has to approve, which is the point: a purge
 * signed through an extension cannot happen without the person watching it
 * happen. The same approval timeout applies — a walked-away user must not
 * leave a purge half-published and spinning.
 *
 * What comes back gets a shape check here — enough to fail with a sentence
 * rather than a `TypeError` two frames later. It is **not** the real check:
 * whether the extension signed the event it was shown, under the right key,
 * with a signature that verifies, is decided in `services/nostr/signer.ts`,
 * which is the one door every signature passes through. Doing half of it here
 * as well would leave two places to keep in step and neither claiming to be
 * the authority.
 */
export async function signWithExtension(
  template: EventTemplate,
  pubkey: string,
): Promise<SignedEvent> {
  const provider = await waitForProvider();
  if (!provider) throw new KeyError('no-extension', 'No window.nostr provider');
  if (typeof provider.signEvent !== 'function') {
    throw new KeyError('extension-refused', 'This extension cannot sign — it only reads your key');
  }

  let signed: SignedEvent;
  try {
    signed = await Promise.race([
      provider.signEvent({ ...template, pubkey }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new KeyError('extension-refused', 'The extension did not answer')),
          APPROVAL_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (err) {
    if (err instanceof KeyError) throw err;
    logger.key('Extension refused to sign', { error: String(err) });
    throw new KeyError('extension-refused', 'The extension refused to sign');
  }

  if (typeof signed?.id !== 'string' || typeof signed.sig !== 'string') {
    throw new KeyError(
      'extension-refused',
      'The extension returned something that is not an event',
    );
  }
  return signed;
}
