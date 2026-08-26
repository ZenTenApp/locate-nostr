/**
 * The raw JSON one relay serves for one kind.
 *
 * Opened from a relay's detail panel, and fetched live rather than read from
 * the sweep — see `services/sweep/raw-events.ts` for why.
 *
 * Mounted under a key of relay + kind, so switching to another kind is a new
 * component with empty state rather than one that clears itself in an effect
 * and briefly shows the previous kind's events under the new heading. Everything shown is
 * untrusted relay output, so it gets three things the grid cannot fit: the
 * events themselves, a signature verdict per event, and a mark on anything the
 * relay returned that its own filter excludes.
 */
import { useCallback, useEffect, useState } from 'react';

import { kindTag } from '@/config/kinds';
import type { KindSpec } from '@/config/kinds';
import { errorMessage } from '@/lib/errors';
import { since } from '@/lib/format';
import { fetchRelayEvents, eventsToJson } from '@/services/sweep/raw-events';
import type { InspectedEvent, RawEventsResult } from '@/services/sweep/raw-events';
import { purgeEvents } from '@/services/purge/engine';
import type { PurgeRelayReport } from '@/services/purge/engine';
import { usePurgeStore } from '@/stores/purge-store';
import { SignerControls } from '@/components/purge/SignerControls';
import { REPORT_STATUS } from '@/components/purge/report-status';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

/** Bigger than the sweep's default: nobody opens raw JSON to see the first 25
 *  of something, and this is one relay rather than thirteen hundred. */
const RAW_LIMIT = 100;

function EventBlock({
  entry,
  deletable,
  picked,
  onTogglePick,
}: {
  entry: InspectedEvent;
  /** Only the identity's own events can be deleted — a relay honours a
   *  deletion from the key that wrote the event and from nobody else, so a
   *  received DM has no tick box rather than a tick that does nothing. */
  deletable: boolean;
  picked: boolean;
  onTogglePick: (id: string) => void;
}) {
  const { event } = entry;
  return (
    <li className="border-t border-surface-border/60 py-sm first:border-t-0">
      <div className="mb-xs flex flex-wrap items-center gap-xs text-xs text-ink-muted">
        {deletable && (
          <input
            type="checkbox"
            checked={picked}
            onChange={() => onTogglePick(event.id)}
            aria-label={`Tick event ${event.id.slice(0, 16)} for deletion`}
            className="h-4 w-4 accent-state-error"
          />
        )}
        <span className="font-mono">{event.id.slice(0, 16)}…</span>
        <span>{since(event.created_at)}</span>
        {entry.verified ? (
          <Badge tone="success" title="The signature matches the pubkey on the event">
            signature ok
          </Badge>
        ) : (
          <Badge
            tone="error"
            title="The signature does not match — this relay is serving something that is not genuinely from this person"
          >
            bad signature
          </Badge>
        )}
        {entry.offFilter && (
          <Badge tone="warning" title="The relay returned this even though it was not asked for it">
            not what was asked for
          </Badge>
        )}
        {/* Only ever the catch-all's view: `other` is asked for without a
            `kinds` filter, so the relay correctly sends the named kinds too.
            Marking them keeps the list honest without branding the relay. */}
        {!entry.counted && !entry.offFilter && (
          <Badge
            tone="neutral"
            title="Served as asked, but this kind has a column of its own — it is counted there, not under other"
          >
            counted in its own column
          </Badge>
        )}
      </div>
      <pre className="overflow-x-auto rounded-md bg-surface-base p-sm font-mono text-xs leading-relaxed text-ink-secondary">
        {JSON.stringify(event, null, 2)}
      </pre>
    </li>
  );
}

export function RawEventsDialog({
  relayUrl,
  spec,
  author,
  onClose,
}: {
  relayUrl: string;
  spec: KindSpec;
  author: string;
  onClose: () => void;
}) {
  const [result, setResult] = useState<RawEventsResult | null>(null);
  const [copied, setCopied] = useState(false);
  /** Ids ticked for deletion. Reset by the reload below, since an id that is
   *  no longer served must not stay ticked. */
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [report, setReport] = useState<PurgeRelayReport | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const signer = usePurgeStore((state) => state.signer);
  const reason = usePurgeStore((state) => state.reason);

  /**
   * Closing this dialog ends the key session it started.
   *
   * A key unlocked here can be unlocked without purge mode ever being entered,
   * so nothing else would ever drop it — the worker would sit holding the key
   * for as long as the tab stayed open. Read imperatively rather than
   * subscribed to, so the cleanup sees the signer as it is at unmount; and a
   * bulk purge in flight is left alone, since it is signing with that key.
   */
  useEffect(
    () => () => {
      const purge = usePurgeStore.getState();
      if (purge.signer !== null && purge.status !== 'running') purge.forgetSigner();
    },
    [],
  );

  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetchRelayEvents(relayUrl, spec, author, RAW_LIMIT, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setResult(next);
      // Ticks are cleared with the answer they belonged to: an id the relay
      // no longer serves must not stay ticked for a second delete request.
      setPicked(new Set());
    });
    // The socket is closed by the fetch itself; aborting only stops a late
    // answer from landing in an unmounted component.
    return () => controller.abort();
    // `reloads` is the re-ask after a deletion: the honest way to show what
    // the relay serves now, rather than crossing rows out locally and hoping.
  }, [relayUrl, spec, author, reloads]);

  const togglePick = (id: string) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deletePicked = async () => {
    if (signer === null || picked.size === 0) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      // The kinds of the ticked events, not the column's: under `other` the
      // column has no kind of its own, and a delete request declares what it
      // actually names.
      const kinds = [
        ...new Set(
          (result?.events ?? [])
            .filter((entry) => picked.has(entry.event.id))
            .map((entry) => entry.event.kind),
        ),
      ];
      setReport(await purgeEvents(relayUrl, { author, kinds, reason }, [...picked], signer));
      setReloads((count) => count + 1);
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  const copy = useCallback(() => {
    if (!result) return;
    void navigator.clipboard.writeText(eventsToJson(result.events)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [result]);

  return (
    <Modal
      // The heading names the thing and the relay, nothing else: it is also
      // the dialog's accessible name, and a wrapped one pushes the URL — the
      // identifying half — onto a second line. The protocol detail belongs to
      // the subtitle, which already carried it.
      title={`${spec.label} on ${relayUrl}`}
      subtitle={`Asked again just now — ${kindTag(spec)}, up to ${RAW_LIMIT} events. This is what the relay serves at this moment, so it can differ from the number in the grid.`}
      onClose={onClose}
    >
      {result === null && <p className="py-lg text-base text-ink-muted">Asking the relay…</p>}

      {result !== null && (
        <>
          <div className="mb-md flex flex-wrap items-center gap-md">
            <span className="text-sm text-ink-secondary">
              {result.events.length} event{result.events.length === 1 ? '' : 's'}
              {!result.complete && result.events.length >= RAW_LIMIT && ` (first ${RAW_LIMIT})`}
            </span>
            {result.events.length > 0 && (
              <Button variant="secondary" onClick={copy}>
                {copied ? 'Copied' : 'Copy JSON'}
              </Button>
            )}
          </div>

          {result.error !== null && (
            <p className="rounded-md bg-state-error/15 px-md py-sm text-sm text-state-error">
              Could not reach this relay just now: {result.error}
            </p>
          )}

          {result.error === null && result.events.length === 0 && (
            <p className="text-sm text-ink-muted">
              The relay returned nothing this time.
              {result.refusal?.kind === 'closed' && result.refusal.message !== ''
                ? ` It said: "${result.refusal.message}"`
                : result.refusal !== null
                  ? ' It did not finish answering.'
                  : ''}
            </p>
          )}

          <ul className="max-h-[50vh] overflow-y-auto">
            {result.events.map((entry) => (
              <EventBlock
                key={`${entry.event.id}-${entry.event.created_at}`}
                entry={entry}
                deletable={entry.event.pubkey === author}
                picked={picked.has(entry.event.id)}
                onTogglePick={togglePick}
              />
            ))}
          </ul>

          {/* Deleting from here is the precise counterpart to the bulk purge:
              these ids, this relay, nothing wider. It appears only once
              something is ticked, so the JSON view stays a read-only view
              until the user asks for otherwise. */}
          {picked.size > 0 && (
            <div className="mt-md flex flex-col gap-sm border-t border-surface-border pt-md">
              <SignerControls author={author} />
              <div className="flex flex-wrap items-center gap-sm">
                <span className="text-sm text-ink-secondary">
                  {picked.size} event{picked.size === 1 ? '' : 's'} ticked. This asks {relayUrl} to
                  delete them — it is a signed request to one relay, and copies on other relays are
                  untouched.
                </span>
                <Button
                  variant="danger"
                  className="ml-auto"
                  disabled={deleting || signer === null || signer.pubkey !== author}
                  onClick={() => void deletePicked()}
                >
                  {deleting ? 'Sending…' : `Purge ${picked.size} from this relay`}
                </Button>
              </div>
            </div>
          )}

          {deleteError !== null && (
            <p className="mt-md rounded-md bg-state-error/15 px-md py-sm text-sm text-state-error">
              {deleteError}
            </p>
          )}

          {report !== null && (
            <p className="mt-md rounded-md border border-surface-border bg-surface-card px-md py-sm text-sm text-ink-secondary">
              {/* The engine's own verdict, worded by the table both purge
                  screens share — not re-derived from the counters here, which
                  read a partly-accepted relay as accepted and an unreachable
                  one as silent. */}
              The relay {REPORT_STATUS[report.status].sentence}
              {report.notes.length > 0 && `: "${report.notes.join('; ')}"`}. The list above was
              re-read afterwards — what it shows now is what the relay serves now.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
