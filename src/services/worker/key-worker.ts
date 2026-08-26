/// <reference lib="webworker" />
/**
 * The key worker. Runs every blocking derivation off the main thread, and is
 * where private key material begins and ends.
 *
 * The secret exists inside one synchronous call — `pubkeyFromMnemonic` wipes
 * every private buffer it touches — and only a pubkey travels back. What
 * cannot be cleaned up in place is the PEM, the passphrase and the mnemonic:
 * `postMessage` clones them into this heap as immutable strings, unreachable
 * to `fill(0)`. Terminating the worker is the only real remedy, which is why
 * the client does exactly that after every derivation.
 *
 * Adapted from `chat/src/services/worker/key-worker.ts`.
 */
import { KeyError, errorMessage, keyErrorCode } from '@/lib/errors';
import { wipe } from '@/lib/bytes';
import {
  publicIdentity,
  pubkeyFromMnemonic,
  secretKeyFromMnemonic,
  secretKeyFromNsec,
} from '@/services/crypto/nip06';
import { convertOpenSSHEd25519ToMnemonic, estimateDecryptSeconds } from '@/services/ssh';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';

import type { KeySource, KeyWorkerRequest, KeyWorkerResponse } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

/**
 * The unlocked signing key, or `null`.
 *
 * The one piece of long-lived secret state in the app, and it lives here
 * rather than on the main thread for the reason the whole worker exists: this
 * heap is not reachable from React, from devtools' component inspector, or
 * from anything an extension injects into the page, and terminating the worker
 * discards it wholesale.
 *
 * It is set only by `unlock`, used only by `sign`, and never travels back
 * across `postMessage` — the protocol has no shape that could carry it.
 */
let signingKey: Uint8Array | null = null;

/** Wipe whatever key is held. Called before a new unlock; the worker being
 *  terminated is what ends a session, so there is no message that reaches
 *  this on its own. */
function lock(): void {
  wipe(signingKey);
  signingKey = null;
}

/**
 * A pasted secret → the signing key it roots.
 *
 * The three inputs converge deliberately: an SSH key is converted to the
 * mnemonic it encodes and then derived exactly as a typed phrase is, so the
 * same key yields the same identity here as in `chat` — the property the whole
 * SSH path exists for. An nsec is not derived at all; it *is* the key.
 */
function deriveSigningKey(source: KeySource, secret: string, passphrase: string): Uint8Array {
  if (source === 'ssh') {
    return secretKeyFromMnemonic(convertOpenSSHEd25519ToMnemonic(secret, passphrase));
  }
  const trimmed = secret.trim();
  if (trimmed.toLowerCase().startsWith('nsec1')) return secretKeyFromNsec(trimmed);
  return secretKeyFromMnemonic(trimmed, passphrase);
}

function handle(request: KeyWorkerRequest): KeyWorkerResponse {
  switch (request.kind) {
    case 'warmup':
      // One round is enough to evaluate the module and let the JIT settle;
      // the result is discarded.
      estimateDecryptSeconds(1);
      return { id: request.id, ok: true, kind: 'warmup', result: {} };

    case 'estimate':
      return {
        id: request.id,
        ok: true,
        kind: 'estimate',
        result: { seconds: estimateDecryptSeconds(request.rounds) },
      };

    case 'ssh-pubkey':
      return {
        id: request.id,
        ok: true,
        kind: 'ssh-pubkey',
        // The mnemonic is a string and cannot be wiped; it dies with the
        // worker, which the client terminates as soon as this returns.
        result: pubkeyFromMnemonic(
          convertOpenSSHEd25519ToMnemonic(request.pem, request.passphrase),
        ),
      };

    case 'seed-pubkey':
      return {
        id: request.id,
        ok: true,
        kind: 'seed-pubkey',
        result: pubkeyFromMnemonic(request.mnemonic, request.passphrase),
      };

    case 'unlock': {
      // Any previously unlocked key is wiped first: unlocking a second
      // identity must not leave the first one alive in this heap.
      lock();
      signingKey = deriveSigningKey(request.source, request.secret, request.passphrase);
      return {
        id: request.id,
        ok: true,
        kind: 'unlock',
        result: publicIdentity(getPublicKey(signingKey)),
      };
    }

    case 'sign': {
      if (signingKey === null) throw new KeyError('internal', 'No key is unlocked');
      // `finalizeEvent` fills in the pubkey, the id and the signature. The
      // event it returns is entirely public — it is about to be handed to
      // thirteen hundred strangers.
      return {
        id: request.id,
        ok: true,
        kind: 'sign',
        result: { event: finalizeEvent(request.template, signingKey) },
      };
    }
  }
}

scope.onmessage = (event: MessageEvent<KeyWorkerRequest>) => {
  const request = event.data;
  let response: KeyWorkerResponse;
  try {
    response = handle(request);
  } catch (err) {
    response = { id: request.id, ok: false, code: keyErrorCode(err), message: errorMessage(err) };
  }
  scope.postMessage(response);
};
