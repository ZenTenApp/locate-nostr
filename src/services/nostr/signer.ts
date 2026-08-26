/**
 * Signing — the one thing this app does that a sweep never needs.
 *
 * A purge publishes NIP-09 delete requests, and a delete request only counts
 * if it is signed by the identity whose events it names. So this module is the
 * single door between "we know your pubkey" and "we can act as you", and it is
 * deliberately narrow: two implementations, one interface, one place that can
 * end a session.
 *
 * | Signer      | Where the key is         | For how long                     |
 * | ----------- | ------------------------ | -------------------------------- |
 * | extension   | never in this app        | never                            |
 * | key         | inside its own worker    | until the purge is over          |
 *
 * The extension signer is the one to prefer and the one offered first: the key
 * never touches the page, and every request is approved in the extension's own
 * UI. Its cost is a prompt per delete request, which for a large purge is
 * several.
 *
 * The key signer exists because most identities are not in an extension. It
 * unlocks the key inside a **worker of its own** — not the one identity import
 * uses, which is terminated after every derivation and would take a live
 * signing session with it — and keeps it there for the length of a purge
 * rather than re-running a second of PBKDF2 (or a minute of bcrypt) per
 * signature. {@link Signer.close} terminates that worker, which is the only
 * way the key actually goes away, and every caller is expected to call it the
 * moment a purge ends.
 */
import { DELETE_KIND } from '@/config/purge';
import { KeyError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { EventTemplate, SignedEvent } from '@/services/nostr/events';
import { signWithExtension, pubkeyFromExtension } from '@/services/nostr/extension';
import { verifySignature } from '@/services/relay/verify';
import type { KeySource } from '@/services/worker/protocol';
import { KeyWorkerClient } from '@/services/worker/client';

/**
 * Every kind this app will put a signature on.
 *
 * A purge is the only thing here that signs, so the list is one entry long,
 * and it is enforced rather than assumed. A signer is the ability to act as
 * the user: whatever asks it to sign a kind 1 has either been changed without
 * this rule being revisited, or is not this app.
 */
const SIGNABLE_KINDS: ReadonlySet<number> = new Set([DELETE_KIND]);

/**
 * Check what came back before anything publishes it.
 *
 * The extension path makes this necessary. `window.nostr` is injected into the
 * page by software this app does not control and cannot audit, and it is asked
 * to sign with the user's own key — so its answer is treated like a relay's:
 * untrusted until checked. A provider that returned a *different* event than
 * the one it was shown would otherwise get that event signed by the user and
 * published to every relay in the target list.
 *
 * The worker path cannot fail these checks. It runs them anyway: the cost is a
 * millisecond, and a guarantee that holds only on some paths is one nobody can
 * rely on when reading the call site.
 */
function assertSignedAsAsked(
  signed: SignedEvent,
  template: EventTemplate,
  pubkey: string,
): SignedEvent {
  const asAsked =
    signed.pubkey === pubkey &&
    signed.kind === template.kind &&
    signed.created_at === template.created_at &&
    signed.content === template.content &&
    JSON.stringify(signed.tags) === JSON.stringify(template.tags);

  if (!asAsked) {
    throw new KeyError(
      'extension-refused',
      'The signer returned a different event than it was given',
    );
  }
  // Verified as a plain copy of its own fields, never as the object handed
  // over. `nostr-tools` caches its verdict in a symbol on the event it checks,
  // and an object arriving with that symbol already set would skip the check
  // entirely — the one thing this function exists to perform.
  const asData = {
    id: signed.id,
    pubkey: signed.pubkey,
    created_at: signed.created_at,
    kind: signed.kind,
    tags: signed.tags,
    content: signed.content,
    sig: signed.sig,
  };
  if (!verifySignature(asData)) {
    throw new KeyError(
      'extension-refused',
      'The signature on the returned event does not check out',
    );
  }
  return signed;
}

/** Refuse anything that is not one of {@link SIGNABLE_KINDS}, before a signer
 *  ever sees it. */
function assertSignable(template: EventTemplate): void {
  if (SIGNABLE_KINDS.has(template.kind)) return;
  throw new KeyError('internal', `This app does not sign kind ${template.kind} events`);
}

export type SignerKind = 'extension' | 'key';

export interface Signer {
  kind: SignerKind;
  /** Hex pubkey the signer will sign as. The purge refuses to run unless this
   *  is the identity being purged — see `purge/engine.ts`. */
  pubkey: string;
  npub: string;
  /** One line naming the signer, for the confirmation screen. */
  label: string;
  sign: (template: EventTemplate) => Promise<SignedEvent>;
  /** End the session. Terminates the key worker for a key signer; a no-op for
   *  an extension, which never had anything of ours to drop. */
  close: () => void;
}

/** The NIP-07 signer: nothing is held, every signature is approved in the
 *  extension. */
export async function extensionSigner(): Promise<Signer> {
  const identity = await pubkeyFromExtension();
  return {
    kind: 'extension',
    pubkey: identity.pubkey,
    npub: identity.npub,
    label: 'your browser extension',
    sign: async (template) => {
      assertSignable(template);
      return assertSignedAsAsked(
        await signWithExtension(template, identity.pubkey),
        template,
        identity.pubkey,
      );
    },
    close: () => undefined,
  };
}

/**
 * Unlock a recovery phrase, an nsec or an SSH key for signing.
 *
 * The secret crosses one `postMessage` into a private worker and never comes
 * back: the worker answers with a pubkey, then with signed events. Its heap —
 * including the phrase and passphrase strings, which are immutable and cannot
 * be wiped in place — is reclaimed by {@link Signer.close}.
 */
export async function keySigner(
  source: KeySource,
  secret: string,
  passphrase: string,
): Promise<Signer> {
  const worker = new KeyWorkerClient();
  try {
    const identity = await worker.request('unlock', { source, secret, passphrase });
    logger.key('Signing key unlocked', { source });
    return {
      kind: 'key',
      pubkey: identity.pubkey,
      npub: identity.npub,
      label: source === 'ssh' ? 'your SSH key' : 'your recovery phrase',
      sign: async (template) => {
        assertSignable(template);
        const { event } = await worker.request('sign', { template });
        return assertSignedAsAsked(event, template, identity.pubkey);
      },
      close: () => {
        logger.key('Signing key dropped');
        worker.terminate();
      },
    };
  } catch (err) {
    // A failed unlock still cloned the secret into that heap.
    worker.terminate();
    throw err;
  }
}

/**
 * Refuse to sign as somebody else.
 *
 * The identity being purged and the identity holding the key are two separate
 * inputs — an npub can be pasted, and an extension answers with whatever it
 * holds — so they can legitimately differ. A delete request signed by the
 * wrong key deletes nothing and tells the relay who tried, which is a worse
 * outcome than an error before anything is sent.
 */
export function assertSignerMatches(signer: Signer, author: string): void {
  if (signer.pubkey === author) return;
  throw new KeyError(
    'internal',
    `That key signs as ${signer.npub}, which is not the identity being purged`,
  );
}
