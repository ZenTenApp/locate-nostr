/**
 * The confirmation screen, and the run itself.
 *
 * This is the only screen in the app that changes anything on the network, so
 * it is written to be read rather than clicked through: it names the identity,
 * the relays, and the kinds in plain words before it offers a button, and the
 * button is behind a typed word because a destructive action reachable by
 * clicking is one a person can perform by accident.
 *
 * It is also careful about what it claims afterwards. A relay that answers
 * `OK true` has *accepted* a delete request; NIP-09 does not oblige it to
 * honour one, and nothing here says "deleted". Accepted, refused, and never
 * answered are three different outcomes, and the third is not a failure — it
 * is the absence of an answer, which is exactly what this app exists not to
 * round off.
 */
import { useState } from 'react';

import { KIND_SPECS, OTHER_KIND } from '@/config/kinds';
import { PURGE_CONFIRM_WORD, PURGE_REASON_MAX } from '@/config/purge';
import { compactCount } from '@/lib/format';
import { relayHost } from '@/services/relay/url';
import { shortIdentity } from '@/services/nostr/identity';
import type { RelayDescriptor } from '@/services/discovery/nip66';
import type { PurgePhase, PurgeRelayReport } from '@/services/purge/engine';
import { usePurgeStore } from '@/stores/purge-store';
import { SignerControls } from '@/components/purge/SignerControls';
import { REPORT_STATUS } from '@/components/purge/report-status';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';

/** Relay URLs listed in full before the count takes over. Enough to recognise
 *  a mistake — a purge aimed at the wrong handful is the mistake this list
 *  exists to catch. */
const PREVIEW_RELAYS = 12;

/** What each phase is doing, in the user's words. */
const PHASE_LABEL: Record<PurgePhase, string> = {
  gathering: 'Reading what these relays hold…',
  signing: 'Signing the delete requests — approve them if your extension asks…',
  publishing: 'Sending the delete requests…',
  done: 'Finished.',
};

function ReportLine({ report }: { report: PurgeRelayReport }) {
  const badge = REPORT_STATUS[report.status];
  return (
    <li className="flex flex-wrap items-baseline gap-sm border-t border-surface-border/60 py-xs first:border-t-0">
      <span className="font-mono text-sm text-ink-primary">{relayHost(report.url)}</span>
      <Badge tone={badge.tone} title={badge.title}>
        {badge.label}
      </Badge>
      <span className="text-xs text-ink-muted">
        {report.found} found
        {report.truncated && ' (more than could be named in one pass)'}
        {report.accepted > 0 && ` · ${report.accepted} accepted`}
        {report.rejected > 0 && ` · ${report.rejected} refused`}
        {report.unanswered > 0 && ` · ${report.unanswered} unanswered`}
      </span>
      {report.notes.map((note) => (
        <span key={note} className="w-full font-mono text-xs text-ink-muted">
          {note}
        </span>
      ))}
      {report.error !== null && (
        <span className="w-full text-xs text-state-error">{report.error}</span>
      )}
    </li>
  );
}

export function PurgeDialog({
  relays,
  author,
  authorNpub,
  concurrency,
  onClose,
  onRecheck,
}: {
  relays: readonly RelayDescriptor[];
  author: string;
  authorNpub: string;
  /** The sweep's politeness dial, reused: same relays, same network. */
  concurrency: number;
  onClose: () => void;
  /** Re-run the sweep, so the grid stops showing counts from before the
   *  purge. The only honest way to find out what a relay actually did. */
  onRecheck: () => void;
}) {
  const store = usePurgeStore();
  const [confirm, setConfirm] = useState('');

  const targets = store.targets(relays);
  const reports = [...store.reports.values()];
  const kinds = KIND_SPECS.filter((spec) => store.kinds.includes(spec.kind));
  // Named once: the subtitle, the warning and the footnote all list the same
  // kinds, and building it three times had them print in two different orders
  // — spec order in two places, click order in the third.
  const kindList = kinds.map((spec) => spec.label).join(', ');
  const running = store.status === 'running';
  const finished = store.status === 'done' || store.status === 'cancelled';

  // "other" is every kind without a column — notes, reactions, lists, whatever
  // else the identity has written. It is the one selection whose contents the
  // user cannot enumerate before agreeing to it, so it is called out rather
  // than left to be inferred from a chip labelled `other`.
  const purgingOther = store.kinds.includes(OTHER_KIND);
  const signerReady = store.signer !== null && store.signer.pubkey === author;
  const blocked = !signerReady || confirm.trim().toUpperCase() !== PURGE_CONFIRM_WORD;

  const totals = reports.reduce(
    (sum, report) => ({
      accepted: sum.accepted + report.accepted,
      rejected: sum.rejected + report.rejected,
      unanswered: sum.unanswered + report.unanswered,
    }),
    { accepted: 0, rejected: 0, unanswered: 0 },
  );

  return (
    <Modal
      title="Purge these relays"
      subtitle={`${shortIdentity(authorNpub)} · ${compactCount(targets.length)} relays · ${kindList}`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-md">
        {store.status === 'idle' && (
          <>
            <div className="rounded-md border border-state-error/40 bg-state-error/10 px-md py-sm text-sm text-ink-secondary">
              <p>
                This asks {compactCount(targets.length)} relay
                {targets.length === 1 ? '' : 's'} to delete your {kindList}. It is a signed request,
                sent to strangers&rsquo; servers, and there is no way to take it back — a relay that
                has honoured it cannot un-delete anything, and copies already on relays outside this
                list are untouched.
              </p>
              <p className="mt-xs">
                Relays are not obliged to honour a deletion. What you will get back is what each one
                said, not proof that anything is gone.
              </p>
              {purgingOther && (
                <p className="mt-xs font-medium text-state-error">
                  &ldquo;other&rdquo; is every kind without a column of its own — notes, reactions,
                  lists, anything else you have written. It is read off each relay as the purge
                  runs, so what it covers is not knowable from this screen: the counts in the grid
                  are the closest you can get before agreeing to it.
                </p>
              )}
            </div>

            <div>
              <h3 className="text-xs uppercase tracking-wide text-ink-muted">relays</h3>
              <ul className="mt-xs max-h-40 overflow-y-auto font-mono text-sm text-ink-secondary">
                {targets.slice(0, PREVIEW_RELAYS).map((relay) => (
                  <li key={relay.url}>{relayHost(relay.url)}</li>
                ))}
              </ul>
              {targets.length > PREVIEW_RELAYS && (
                <p className="mt-xs text-sm text-ink-muted">
                  and {compactCount(targets.length - PREVIEW_RELAYS)} more.
                </p>
              )}
            </div>

            <label className="flex flex-col text-sm text-ink-secondary">
              Reason, sent with the request
              <Input
                className="mt-xs"
                maxLength={PURGE_REASON_MAX}
                value={store.reason}
                onChange={(event) => store.setReason(event.target.value)}
              />
            </label>

            <SignerControls author={author} />

            <label className="flex flex-col text-sm text-ink-secondary">
              Type {PURGE_CONFIRM_WORD} to confirm
              <Input
                className="mt-xs"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder={PURGE_CONFIRM_WORD}
                aria-label={`Type ${PURGE_CONFIRM_WORD} to confirm`}
              />
            </label>
          </>
        )}

        {running && (
          <div className="flex items-center gap-md text-base text-ink-secondary">
            <Spinner />
            <span>{store.phase === null ? '' : PHASE_LABEL[store.phase]}</span>
            <span className="font-mono text-sm text-ink-muted">
              {store.progress.done}/{store.progress.total}
            </span>
          </div>
        )}

        {finished && (
          <div className="rounded-md border border-surface-border bg-surface-card px-md py-sm text-sm text-ink-secondary">
            <p>
              {store.requests === 0
                ? 'Nothing was sent — these relays held nothing of yours for the kinds you chose.'
                : `${store.requests} delete request${store.requests === 1 ? '' : 's'} naming ${compactCount(
                    store.gathered,
                  )} event${store.gathered === 1 ? '' : 's'}: ${totals.accepted} accepted, ${
                    totals.rejected
                  } refused, ${totals.unanswered} unanswered.`}
              {store.status === 'cancelled' && ' Stopped part-way — some relays were never asked.'}
            </p>
            <p className="mt-xs text-ink-muted">
              Re-check the relays to see what they serve now. That is the only way to find out
              whether a relay that accepted the request acted on it.
            </p>
          </div>
        )}

        {store.error !== null && (
          <p className="rounded-md bg-state-error/15 px-md py-sm text-sm text-state-error">
            {store.error}
          </p>
        )}

        {reports.length > 0 && (
          <ul className="max-h-[40vh] overflow-y-auto">
            {reports.map((report) => (
              <ReportLine key={report.url} report={report} />
            ))}
          </ul>
        )}

        <div className="flex flex-wrap justify-end gap-sm">
          {finished && (
            <Button
              variant="secondary"
              onClick={() => {
                onRecheck();
                onClose();
              }}
            >
              Re-check relays
            </Button>
          )}
          {running ? (
            <Button variant="secondary" onClick={store.cancel}>
              Stop
            </Button>
          ) : (
            <Button variant="ghost" onClick={onClose}>
              {finished ? 'Close' : 'Cancel'}
            </Button>
          )}
          {store.status === 'idle' && (
            <Button
              variant="danger"
              disabled={blocked}
              onClick={() => void store.start(relays, author, concurrency)}
            >
              Purge {compactCount(targets.length)} relay{targets.length === 1 ? '' : 's'}
            </Button>
          )}
        </div>

        {store.status === 'idle' && (
          <p className="text-xs text-ink-muted">
            Only your own events can be deleted. Messages other people sent you are named in no
            request — a relay honours a deletion for the key that wrote the event, and that key is
            theirs. Kinds in this purge: {kindList}.
          </p>
        )}
      </div>
    </Modal>
  );
}
