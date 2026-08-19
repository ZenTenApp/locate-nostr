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

import type { KindSpec } from '@/config/kinds';
import { since } from '@/lib/format';
import { fetchRelayEvents, eventsToJson } from '@/services/sweep/raw-events';
import type { InspectedEvent, RawEventsResult } from '@/services/sweep/raw-events';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

/** Bigger than the sweep's default: nobody opens raw JSON to see the first 25
 *  of something, and this is one relay rather than thirteen hundred. */
const RAW_LIMIT = 100;

function EventBlock({ entry }: { entry: InspectedEvent }) {
  const { event } = entry;
  return (
    <li className="border-t border-surface-border/60 py-sm first:border-t-0">
      <div className="mb-xs flex flex-wrap items-center gap-xs text-xs text-ink-muted">
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

  useEffect(() => {
    const controller = new AbortController();
    void fetchRelayEvents(relayUrl, spec, author, RAW_LIMIT, controller.signal).then((next) => {
      if (!controller.signal.aborted) setResult(next);
    });
    // The socket is closed by the fetch itself; aborting only stops a late
    // answer from landing in an unmounted component.
    return () => controller.abort();
  }, [relayUrl, spec, author]);

  const copy = useCallback(() => {
    if (!result) return;
    void navigator.clipboard.writeText(eventsToJson(result.events)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [result]);

  return (
    <Modal
      title={`${spec.label} on ${relayUrl}`}
      subtitle={`Asked again just now — kind ${spec.kind}, up to ${RAW_LIMIT} events. This is what the relay serves at this moment, so it can differ from the number in the grid.`}
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

          <ul className="max-h-[60vh] overflow-y-auto">
            {result.events.map((entry) => (
              <EventBlock key={`${entry.event.id}-${entry.event.created_at}`} entry={entry} />
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
