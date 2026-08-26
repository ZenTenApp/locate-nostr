/**
 * Choosing who signs, and saying what that costs.
 *
 * Both screens that delete — the bulk purge and the ticked-events one — need
 * exactly this and need it worded identically, because it is the point where
 * an app that has never signed anything asks for the ability to sign. The
 * three options are not interchangeable and the differences are stated rather
 * than implied: an extension keeps the key and prompts per request, a phrase
 * or an SSH key is unlocked into a worker and kept there until the purge ends.
 *
 * The wrong-identity case is handled here too, and loudly. Signing as somebody
 * other than the identity on screen produces a delete request no relay will
 * honour, sent under a key that is now on record as having tried.
 */
import { useState } from 'react';

import { shortIdentity } from '@/services/nostr/identity';
import { usePurgeStore } from '@/stores/purge-store';
import { KeyImportDialog } from '@/components/identity/KeyImportDialog';
import type { KeyImportMode } from '@/components/identity/KeyImportDialog';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

export function SignerControls({ author }: { author: string }) {
  const signer = usePurgeStore((state) => state.signer);
  const busy = usePurgeStore((state) => state.signerBusy);
  const error = usePurgeStore((state) => state.signerError);
  const chooseExtension = usePurgeStore((state) => state.chooseExtension);
  const unlock = usePurgeStore((state) => state.unlock);
  const forget = usePurgeStore((state) => state.forgetSigner);

  const [dialog, setDialog] = useState<KeyImportMode | null>(null);

  if (signer !== null) {
    const wrong = signer.pubkey !== author;
    return (
      <div className="flex flex-wrap items-center gap-sm rounded-md border border-surface-border bg-surface-card px-md py-sm">
        <span className="text-sm text-ink-secondary">
          Signing with {signer.label} as {shortIdentity(signer.npub)}
        </span>
        {wrong ? (
          <Badge tone="error" title="A delete request is only honoured for the key that signed it">
            wrong identity
          </Badge>
        ) : (
          <Badge tone="success">ready</Badge>
        )}
        <Button variant="ghost" className="ml-auto px-sm py-0" onClick={forget}>
          use a different key
        </Button>
        {wrong && (
          <p className="w-full text-sm text-state-error">
            This key signs as {shortIdentity(signer.npub)}, but the events on screen belong to
            someone else. Relays honour a deletion only from the key that wrote the event, so
            nothing would be deleted.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-sm rounded-md border border-surface-border bg-surface-card px-md py-sm">
      <span className="text-sm text-ink-secondary">
        Deleting needs your key — a delete request is an event you sign.
      </span>
      <div className="flex flex-wrap items-center gap-xs">
        <Button variant="secondary" disabled={busy} onClick={() => void chooseExtension()}>
          {busy ? 'Asking…' : 'Extension'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setDialog('seed')}>
          Recovery phrase
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setDialog('ssh')}>
          SSH key
        </Button>
      </div>
      <p className="text-xs text-ink-muted">
        An extension never hands over your key and asks you to approve each request. A phrase or an
        SSH key is unlocked inside a worker and dropped the moment the purge ends.
      </p>
      {error !== null && <p className="text-sm text-state-error">{error}</p>}

      {dialog !== null && (
        <KeyImportDialog
          mode={dialog}
          intent="sign"
          // The signer it returns is the identity the dialog then shows.
          onSubmit={async (source, secret, passphrase) => unlock(source, secret, passphrase)}
          onDone={() => setDialog(null)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
