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
import { errorMessage, keyErrorCode } from '@/lib/errors';
import { pubkeyFromMnemonic } from '@/services/crypto/nip06';
import { convertOpenSSHEd25519ToMnemonic, estimateDecryptSeconds } from '@/services/ssh';

import type { KeyWorkerRequest, KeyWorkerResponse } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

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
