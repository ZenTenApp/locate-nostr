/**
 * The grid: one row per relay, one column per kind.
 *
 * Rendering is capped rather than virtualised. A window over thirteen hundred
 * rows would need row-height measurement and a scroll container that fights
 * the sticky header, for a table people mostly read the top of; a cap plus a
 * "show more" is a tenth of the code and honest about what it is doing —
 * `visible of matched` is always on screen.
 */
import { memo, useMemo } from 'react';

import { KIND_SPECS } from '@/config/kinds';
import type { KindSpec } from '@/config/kinds';
import { compactCount, duration } from '@/lib/format';
import { relayHost } from '@/services/relay/url';
import type { RelayChange } from '@/services/sweep/diff';
import type { GridRow } from '@/hooks/use-grid-rows';
import { CountCell } from '@/components/CountCell';
import { Badge } from '@/components/ui/Badge';
import type { BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { RelayLink } from '@/components/ui/RelayLink';
import { Spinner } from '@/components/ui/Spinner';
import type { GridStatus } from '@/components/grid-status';
import { tooltipHandlers } from '@/components/ui/tooltip-handlers';

const BUSY_MESSAGE: Record<'finding-relays' | 'checking', string> = {
  'finding-relays': 'Finding relays — asking the trackers which ones exist…',
  checking: 'Checking relays — nothing matches these filters yet…',
};

function EmptyState({ status }: { status: GridStatus }) {
  if (status === 'idle') {
    return (
      <p className="px-md py-xl text-center text-base text-ink-muted">
        No relay matches these filters.
      </p>
    );
  }

  if (status === 'no-relays') {
    return (
      <p className="px-md py-xl text-center text-base text-ink-muted">
        No relays to check — no tracker answered, and nothing was cached. Try Refresh.
      </p>
    );
  }

  return (
    <div className="flex items-center justify-center gap-md px-md py-xl text-base text-ink-muted">
      <Spinner />
      <span>{BUSY_MESSAGE[status]}</span>
    </div>
  );
}

/** Column widths, in one place: the header and every row build their grid
 *  template from this, so they cannot drift apart. */
function templateFor(kinds: readonly KindSpec[]): string {
  // Wide enough for `≥1.2k` plus the delta that sits under it on a re-check;
  // narrower and the two overlap on exactly the rows worth reading.
  return `minmax(220px,1fr) 64px ${kinds.map(() => '78px').join(' ')} 72px`;
}

/**
 * How a difference from the last check renders.
 *
 * Every label here describes **the relay**, never the data. An earlier version
 * called a relay that stopped answering "lost", in red, on a struck-through
 * row — which reads as "your data is gone" when the truth is the opposite:
 * nobody could reach the relay, so nothing at all is known about what it still
 * holds. That is the one thing this app must never imply.
 *
 * `same` is deliberately absent rather than a neutral badge: on a re-check
 * most rows are unchanged, and a badge on every one would bury the handful
 * that moved.
 */
const CHANGE_BADGE: Partial<
  Record<RelayChange, { tone: BadgeTone; label: string; title: string }>
> = {
  new: {
    tone: 'info',
    label: 'new relay',
    title:
      'This relay was not in the last check — the tracker list has grown since, so there is nothing to compare against.',
  },
  lost: {
    tone: 'warning',
    label: 'went quiet',
    title:
      'This relay answered last time and did not answer now. That says nothing about your data: it may still be there, but nobody could ask.',
  },
  recovered: {
    tone: 'success',
    label: 'answering again',
    title: 'This relay was unreachable in the last check and is responding now.',
  },
  changed: {
    tone: 'warning',
    label: 'numbers changed',
    title: 'This relay holds a different amount than it did at the last check.',
  },
};

function ChangeBadge({ change }: { change: RelayChange }) {
  const badge = CHANGE_BADGE[change];
  if (!badge) return null;
  return (
    <Badge tone={badge.tone} title={badge.title}>
      {badge.label}
    </Badge>
  );
}

function RelayLabel({ row }: { row: GridRow }) {
  const { relay, result } = row;
  const failed = result?.status === 'unreachable' || result?.status === 'error';

  return (
    <div className="flex min-w-0 items-center gap-sm">
      <span
        className={`truncate font-mono text-sm ${failed ? 'text-ink-muted line-through' : 'text-ink-primary'}`}
        // The full endpoint, since the column shows the host only: two relays
        // on one host differ by their path.
        {...tooltipHandlers({
          title: relay.url,
          lines: [
            relay.name === null ? 'No name published.' : relay.name,
            relay.software === null ? 'Software not reported.' : `Running ${relay.software}`,
            failed ? 'Struck through because it did not answer this time.' : '',
          ].filter((line) => line !== ''),
        })}
      >
        {relayHost(relay.url)}
      </span>
      {/* Opening the relay is its own control, and it stops the row's click so
          one gesture does one thing. This is also why the row is a div with a
          button role rather than a real `<button>`: an `<a>` nested inside a
          button is invalid HTML and behaves unpredictably across browsers.
          `RelayLink` owns the referrer handling — reproducing it here meant
          that reasoning had to be remembered in two files. */}
      <RelayLink
        url={relay.url}
        className="shrink-0 text-xs text-ink-muted opacity-0 transition group-hover:opacity-100"
      >
        ↗
      </RelayLink>
      {relay.requiresAuth === true && (
        <Badge tone="warning" title="Trackers report that this relay wants you signed in">
          sign-in
        </Badge>
      )}
      {relay.requiresPayment === true && (
        <Badge tone="warning" title="Trackers report that this relay only serves paying users">
          paid
        </Badge>
      )}
      {relay.pasted && (
        <Badge tone="info" title="Added by you — no tracker reports this relay">
          yours
        </Badge>
      )}
      {row.diff && <ChangeBadge change={row.diff.change} />}
    </div>
  );
}

const Row = memo(function Row({
  row,
  kinds,
  template,
  selected,
  onSelect,
}: {
  row: GridRow;
  kinds: readonly KindSpec[];
  /** Built once by the grid rather than per row — 150 identical strings. */
  template: string;
  selected: boolean;
  onSelect: (url: string) => void;
}) {
  const pending = row.result === undefined;
  const deltas = new Map(row.diff?.kinds.map((delta) => [delta.kind, delta]) ?? []);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(row.relay.url)}
      onKeyDown={(event) => {
        // A div with a button role has to re-implement what a button gives
        // free; without this the grid is unusable from the keyboard.
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(row.relay.url);
        }
      }}
      style={{ gridTemplateColumns: template }}
      className={`grid-row group w-full cursor-pointer gap-sm border-b border-surface-border/60 px-md py-1.5 text-left transition hover:bg-surface-card focus:outline focus:outline-1 focus:outline-brand-primary ${
        selected ? 'bg-surface-card' : ''
      }`}
    >
      <RelayLabel row={row} />
      <span className="text-right font-mono text-xs text-ink-muted">
        {row.result?.connectMs === null || row.result === undefined
          ? ''
          : `${row.result.connectMs}ms`}
      </span>
      {kinds.map((spec) => (
        <CountCell
          key={spec.kind}
          spec={spec}
          result={row.result?.kinds[spec.kind]}
          delta={deltas.get(spec.kind)}
          pending={pending}
        />
      ))}
      <span className="text-right font-mono text-sm text-ink-secondary">
        {row.result?.total === null || row.result === undefined
          ? ''
          : compactCount(row.result.total)}
      </span>
    </div>
  );
});

export function ResultGrid({
  rows,
  limit,
  onShowMore,
  selectedUrl,
  onSelect,
  kinds,
  elapsedMs,
  status,
}: {
  rows: GridRow[];
  limit: number;
  onShowMore: () => void;
  selectedUrl: string | null;
  onSelect: (url: string) => void;
  /** The kinds actually queried, which is what the columns are. */
  kinds: number[];
  elapsedMs: number | null;
  /** Why an empty grid is empty. */
  status: GridStatus;
}) {
  // Memoised because it is passed to the memoised `Row`: a fresh array per
  // render made every row's props compare unequal, so all 150 visible rows
  // re-rendered whenever the selection or the page size changed.
  const specs = useMemo(() => KIND_SPECS.filter((spec) => kinds.includes(spec.kind)), [kinds]);
  const template = useMemo(() => templateFor(specs), [specs]);
  const shown = rows.slice(0, limit);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        style={{ gridTemplateColumns: template }}
        className="grid-row sticky top-0 z-10 gap-sm border-b border-surface-border bg-surface-panel px-md py-sm text-xs uppercase tracking-wide text-ink-muted"
      >
        <span>relay</span>
        <span
          className="text-right"
          {...tooltipHandlers({
            title: 'speed',
            lines: ['How long this relay took to accept a connection, measured just now.'],
          })}
        >
          speed
        </span>
        {specs.map((spec) => (
          <span
            key={spec.kind}
            className="text-center"
            {...tooltipHandlers({
              title: spec.label,
              lines: [spec.note, `${spec.nip}, event kind ${spec.kind}`],
            })}
          >
            {spec.label}
          </span>
        ))}
        <span
          className="text-right"
          {...tooltipHandlers({
            title: 'total',
            lines: ['Everything this relay holds for this person, added up across the columns.'],
          })}
        >
          total
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.map((row) => (
          <Row
            key={row.relay.url}
            row={row}
            kinds={specs}
            template={template}
            selected={row.relay.url === selectedUrl}
            onSelect={onSelect}
          />
        ))}

        {rows.length === 0 && <EmptyState status={status} />}

        {rows.length > shown.length && (
          <div className="flex items-center justify-center gap-md p-lg">
            <span className="text-sm text-ink-muted">
              {shown.length} of {rows.length} matching relays
            </span>
            <Button variant="secondary" onClick={onShowMore}>
              Show more
            </Button>
          </div>
        )}

        {elapsedMs !== null && rows.length > 0 && rows.length <= shown.length && (
          <p className="p-lg text-center text-sm text-ink-muted">
            {rows.length} relays · checked in {duration(elapsedMs)}
          </p>
        )}
      </div>
    </div>
  );
}
