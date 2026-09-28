/**
 * Everything known about one relay, opened from its row.
 *
 * The grid is deliberately six numbers wide; this is where the things that
 * did not fit go — the relay's own refusal text, whether the newest event it
 * served actually carries a valid signature, and which NIPs it claims. The
 * signature line is the important one in identity mode: a relay serving a
 * forged kind 0 under someone's pubkey is indistinguishable from a real one
 * in every other view.
 */
import { useState } from 'react';

import { kindSpec, kindTag } from '@/config/kinds';
import type { KindSpec } from '@/config/kinds';
import { compactCount, since } from '@/lib/format';
import type { RelayDescriptor } from '@/services/discovery/nip66';
import type { KindResult, RelayResult } from '@/services/sweep/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { RawEventsDialog } from '@/components/RawEventsDialog';
import { RelayLink } from '@/components/ui/RelayLink';
import { tooltipHandlers } from '@/components/ui/tooltip-handlers';

/** The label column, and the indent every line under it lines up with. One
 *  pair rather than three literals: they only mean anything together. */
const LABEL_COLUMN = 'w-28';
const LABEL_INDENT = 'pl-28';

const METHOD_NOTE: Record<KindResult['method'], string> = {
  count: 'exact — the relay gave a total',
  sample: 'counted one by one',
  none: 'no answer',
};

function KindLine({
  result,
  onViewRaw,
}: {
  result: KindResult;
  /** Absent when there is no identity to re-query with. */
  onViewRaw: ((spec: KindSpec) => void) | null;
}) {
  // The keyed lookup, not a scan: `kindSpec` exists for exactly this.
  const spec = kindSpec(result.kind);
  const count = result.count;

  return (
    <div className="border-b border-surface-border/60 py-sm">
      <div className="flex flex-wrap items-baseline gap-sm">
        {/* Plain name over protocol name: "messages" is what was asked for,
            "kind 4 · NIP-04" is what it takes to search the spec, report a
            relay bug, or match this against another client's output. Stacked
            rather than inline because the panel is 380px wide and the count
            beside it is the thing being read. A kind this build does not know
            has no plain name to give, so it gets the number once. */}
        <span className={`${LABEL_COLUMN} shrink-0 text-base text-ink-primary`}>
          {spec === undefined ? (
            `kind ${result.kind}`
          ) : (
            <span className="flex flex-col">
              {spec.label}
              <span className="font-mono text-xs text-ink-muted">{kindTag(spec)}</span>
            </span>
          )}
        </span>
        <span className="font-mono text-base text-ink-primary">
          {count === null ? '—' : `${result.approx ? '≥' : ''}${compactCount(count)}`}
        </span>
        <span className="text-sm text-ink-muted">{METHOD_NOTE[result.method]}</span>
        {result.status !== 'ok' && <Badge tone="warning">{result.status}</Badge>}
        {result.mismatched > 0 && (
          <Badge tone="error" title="Things this relay sent back that nobody asked for">
            {result.mismatched} off-filter
          </Badge>
        )}
        {/* Offered whenever the relay answered at all, not only when it found
            something: "show me the nothing" is a legitimate check, and the
            dialog re-asks live so an empty count here can still turn up an
            event. */}
        {spec !== undefined && onViewRaw !== null && (
          <button
            type="button"
            onClick={() => onViewRaw(spec)}
            className="ml-auto shrink-0 text-xs text-ink-muted underline decoration-dotted underline-offset-2 hover:text-brand-primary"
          >
            view raw
          </button>
        )}
      </div>

      {result.newest && (
        <div className={`mt-xs ${LABEL_INDENT} text-sm text-ink-secondary`}>
          most recent {since(result.newest.created_at)}{' '}
          <span className="font-mono text-xs text-ink-muted">{result.newest.id.slice(0, 16)}…</span>{' '}
          {result.newest.verified === true && <Badge tone="success">signature ok</Badge>}
          {result.newest.verified === false && (
            <Badge
              tone="error"
              title="This relay handed over something signed with the wrong key — it is not genuinely from this person"
            >
              fake
            </Badge>
          )}
        </div>
      )}

      {result.note !== null && (
        <p className={`mt-xs ${LABEL_INDENT} font-mono text-xs text-ink-muted`}>{result.note}</p>
      )}
    </div>
  );
}

export function RelayDetail({
  relay,
  result,
  author,
  onClose,
}: {
  relay: RelayDescriptor;
  result: RelayResult | undefined;
  /** Hex pubkey the results are about; the raw view re-queries with it. */
  author: string | null;
  onClose: () => void;
}) {
  const [rawKind, setRawKind] = useState<KindSpec | null>(null);

  return (
    // A side panel beside the grid on a wide screen; on a phone there is no
    // "beside", so it covers the page until closed.
    <aside className="fixed inset-0 z-40 flex flex-col overflow-y-auto overscroll-contain bg-surface-panel md:static md:w-[380px] md:shrink-0 md:border-l md:border-surface-border">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-sm border-b border-surface-border bg-surface-panel p-lg">
        <div className="min-w-0">
          {/* The endpoint in full — scheme, port and path included, since
              `wss://host/inbox` and `wss://host` are different relays that a
              host-only label would collapse into one. */}
          <h2 className="break-all text-base text-ink-primary">
            <RelayLink url={relay.url} />
          </h2>
          <p className="mt-xs text-sm text-ink-secondary">
            {relay.name ?? 'unnamed'}
            {relay.software !== null && ` · ${relay.software}`}
          </p>
        </div>
        <Button variant="ghost" onClick={onClose} aria-label="Close relay detail">
          ✕
        </Button>
      </header>

      <div className="flex flex-wrap gap-xs border-b border-surface-border p-lg">
        <Badge tone={relay.network === 'clearnet' ? 'neutral' : 'info'}>{relay.network}</Badge>
        {relay.requiresAuth === true && <Badge tone="warning">auth required</Badge>}
        {relay.requiresPayment === true && <Badge tone="warning">paid</Badge>}
        {relay.pasted ? (
          <Badge tone="info">added by you</Badge>
        ) : (
          <Badge title="How many trackers report this relay, and when it was last seen">
            {relay.monitorCount} tracker{relay.monitorCount === 1 ? '' : 's'} ·{' '}
            {since(relay.monitoredAt)}
          </Badge>
        )}
        {result?.connectMs !== null && result?.connectMs !== undefined && (
          <Badge title="How long this browser took to connect, just now">
            {result.connectMs}ms
          </Badge>
        )}
        {relay.rttOpenMs !== null && (
          <Badge title="How long a tracker took to connect, when it last tested this relay">
            {relay.rttOpenMs}ms by tracker
          </Badge>
        )}
      </div>

      <div className="px-lg">
        {result === undefined ? (
          <p className="py-lg text-base text-ink-muted">Not checked yet.</p>
        ) : result.status !== 'ok' ? (
          <p className="py-lg text-base text-ink-muted">
            {result.status === 'unreachable'
              ? 'Could not connect. Browsers do not say why a connection failed, so this does not tell you whether the relay is down, blocked, or just slow.'
              : (result.error ?? 'Failed.')}
          </p>
        ) : (
          Object.values(result.kinds)
            .sort((a, b) => a.kind - b.kind)
            .map((kind) => (
              <KindLine
                key={kind.kind}
                result={kind}
                onViewRaw={author === null ? null : setRawKind}
              />
            ))
        )}
      </div>

      {rawKind !== null && author !== null && (
        <RawEventsDialog
          // A different relay or kind is a different question: a fresh
          // component starts empty instead of showing the last answer.
          key={`${relay.url}:${rawKind.kind}`}
          relayUrl={relay.url}
          spec={rawKind}
          author={author}
          onClose={() => setRawKind(null)}
        />
      )}

      {relay.nips.length > 0 && (
        <div className="p-lg">
          <h3
            className="text-xs uppercase tracking-wide text-ink-muted"
            {...tooltipHandlers({
              title: 'features it claims',
              lines: ['Parts of the Nostr protocol this relay says it supports (NIP numbers).'],
            })}
          >
            features it claims
          </h3>
          <p className="mt-xs font-mono text-sm text-ink-secondary">{relay.nips.join(', ')}</p>
        </div>
      )}
    </aside>
  );
}
