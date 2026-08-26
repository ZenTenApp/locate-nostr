/**
 * The grid: one row per relay, one column per kind.
 *
 * Rendering is capped rather than virtualised. A window over thirteen hundred
 * rows would need row-height measurement and a scroll container that fights
 * the sticky header, for a table people mostly read the top of; a cap plus
 * paging is a tenth of the code and honest about what it is doing —
 * `visible of matched` is always on screen.
 *
 * The cap grows on its own as the scroll approaches the end, so the bottom of
 * the list is never a wall of nothing. The buttons stay: a list shorter than
 * its pane fires no scroll at all, and "show all" is there because paging a
 * hundred at a time through a list you intend to tick in full is not paging,
 * it is clicking.
 *
 * Scroll position rather than an `IntersectionObserver`: observers are not
 * delivered at all while a document is hidden, which is a background tab, a
 * screenshotting harness, and any browser that throttles one — and a paging
 * mechanism that silently stops in those cases is the dead end this replaced.
 */
import { memo, useEffect, useMemo, useRef } from 'react';
import type { UIEvent } from 'react';

import { KIND_SPECS, kindTag } from '@/config/kinds';
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

function EmptyState({
  status,
  hidden,
  total,
  onClearFilters,
}: {
  status: GridStatus;
  /** Swept relays the filters are holding back. */
  hidden: number;
  /** Everything swept — what the button will show. Named off the same number
   *  as the footer's copy of it, so one action cannot be labelled two ways. */
  total: number;
  onClearFilters: () => void;
}) {
  if (status === 'idle') {
    return (
      <div className="flex flex-col items-center gap-sm px-md py-xl text-center text-base text-ink-muted">
        <span>
          No relay matches these filters
          {hidden > 0 && ` — ${compactCount(hidden)} are hidden by them`}.
        </span>
        {hidden > 0 && (
          <Button variant="secondary" onClick={onClearFilters}>
            Show all {compactCount(total)}
          </Button>
        )}
      </div>
    );
  }

  // Relays known, nothing asked of them yet — the grid is empty because
  // `holds something` is on, not because a check came back with nothing.
  if (status === 'not-checked') {
    return (
      <p className="px-md py-xl text-center text-base text-ink-muted">
        Nothing checked yet — enter an npub above and press Check.
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
 *  template from this, so they cannot drift apart. The tick column exists
 *  only in purge mode — a permanent delete checkbox on every row is a delete
 *  one misclick away. */
/** How close to the end of the list counts as "the end", in pixels. Roughly a
 *  screen, so the next page is drawn before the user reaches the bottom. */
const LOAD_AHEAD_PX = 600;

function templateFor(kinds: readonly KindSpec[], picking: boolean): string {
  // Wide enough for `≥1.2k` plus the delta that sits under it on a re-check;
  // narrower and the two overlap on exactly the rows worth reading.
  return `${picking ? '28px ' : ''}minmax(220px,1fr) 64px ${kinds.map(() => '78px').join(' ')} 72px`;
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

/**
 * The header's select-all, in three states rather than two.
 *
 * "Some of these are ticked" is a real state and the native checkbox only
 * shows it through a property no attribute can set, so it is written to the
 * node. Without it a partial selection reads as an empty one, and the obvious
 * next click looks like it will tick everything when it will in fact untick
 * what is there.
 */
function HeaderTickBox({
  all,
  some,
  count,
  onChange,
}: {
  all: boolean;
  some: boolean;
  count: number;
  onChange: () => void;
}) {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current !== null) box.current.indeterminate = some;
  }, [some]);

  return (
    <input
      ref={box}
      type="checkbox"
      checked={all}
      onChange={onChange}
      aria-label={
        all
          ? `Untick all ${count} relays these filters match`
          : `Tick all ${count} relays these filters match`
      }
      className="h-4 w-4 shrink-0 self-center accent-state-error"
    />
  );
}

const Row = memo(function Row({
  row,
  kinds,
  template,
  selected,
  onSelect,
  picking,
  picked,
  onTogglePick,
}: {
  row: GridRow;
  kinds: readonly KindSpec[];
  /** Built once by the grid rather than per row — 150 identical strings. */
  template: string;
  selected: boolean;
  onSelect: (url: string) => void;
  /** Purge mode: the row grows a tick box, and ticking is not selecting. */
  picking: boolean;
  picked: boolean;
  onTogglePick: (url: string) => void;
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
      {picking && (
        // Its own click handler and its own stopPropagation: ticking a relay
        // for deletion and opening its detail panel are different intentions,
        // and one gesture must not do both.
        <input
          type="checkbox"
          checked={picked}
          onClick={(event) => event.stopPropagation()}
          onChange={() => onTogglePick(row.relay.url)}
          aria-label={`Tick ${row.relay.url}`}
          className="h-4 w-4 shrink-0 self-center accent-state-error"
        />
      )}
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
  total,
  limit,
  onShowMore,
  onShowAll,
  onClearFilters,
  selectedUrl,
  onSelect,
  kinds,
  elapsedMs,
  status,
  picking,
  picked,
  onTogglePick,
  onPickMany,
  onUnpickMany,
}: {
  rows: GridRow[];
  /** Relays in the sweep, before filtering. The run summary counts these —
   *  `rows` is what survived the filter bar, which is a different number and
   *  a much smaller one now that `holds something` is on by default. */
  total: number;
  limit: number;
  onShowMore: () => void;
  /** Drop the cap entirely for this list. Costly by design and asked for
   *  explicitly — a thousand rows is a real layout. */
  onShowAll: () => void;
  /** Widen the filter bar back to everything swept. The counterpart to the
   *  hidden count: a number the user cannot act on is a number that reads as
   *  a limitation of the tool. */
  onClearFilters: () => void;
  selectedUrl: string | null;
  onSelect: (url: string) => void;
  /** The kinds actually queried, which is what the columns are. */
  kinds: number[];
  elapsedMs: number | null;
  /** Why an empty grid is empty. */
  status: GridStatus;
  /** Purge mode: every row gets a tick box and the header gets select-all. */
  picking: boolean;
  picked: ReadonlySet<string>;
  onTogglePick: (url: string) => void;
  /**
   * Tick, or untick, every row the filter bar is currently showing.
   *
   * Every *matching* row, not every drawn one: a purge aimed at "everything I
   * can see" must not quietly mean "the first 150 of them". Both are additive
   * against the rest of the selection — ticks made under another filter are
   * not something a select-all here may throw away.
   */
  onPickMany: (urls: readonly string[]) => void;
  onUnpickMany: (urls: readonly string[]) => void;
}) {
  // Memoised because it is passed to the memoised `Row`: a fresh array per
  // render made every row's props compare unequal, so all 150 visible rows
  // re-rendered whenever the selection or the page size changed.
  const specs = useMemo(() => KIND_SPECS.filter((spec) => kinds.includes(spec.kind)), [kinds]);
  const template = useMemo(() => templateFor(specs, picking), [specs, picking]);
  const shown = rows.slice(0, limit);
  const more = rows.length > shown.length;
  // Swept relays the filter bar is holding back. `total` is the sweep, `rows`
  // is what survived the filters — the gap is the whole reason the end of the
  // list looks like a dead end.
  const hidden = Math.max(0, total - rows.length);

  // Every matching row's URL, and how many of them are already ticked. Built
  // only in purge mode: it is a pass over the whole filtered list, and outside
  // purge mode nothing reads it.
  const matchedUrls = useMemo(
    () => (picking ? rows.map((row) => row.relay.url) : []),
    [picking, rows],
  );
  const pickedHere = useMemo(
    () => matchedUrls.reduce((count, url) => (picked.has(url) ? count + 1 : count), 0),
    [matchedUrls, picked],
  );
  const allPicked = matchedUrls.length > 0 && pickedHere === matchedUrls.length;

  /**
   * Grow the page as the end of the list comes near, once per page.
   *
   * The latch is the point: a scroll held at the bottom fires dozens of
   * events, and one page per event would take a 150-row list to the whole
   * thousand in a flick. It is released whenever the list actually changes —
   * a new page arrived, or the filters produced a different set of rows.
   *
   * A latch, and not "remember which cap was last grown". That version
   * compared against `limit`, and widening the filters resets `limit` to the
   * first page — landing on the exact value already remembered, which jammed
   * paging until the user found a button. The dead end this exists to remove.
   */
  const requested = useRef(false);
  useEffect(() => {
    requested.current = false;
  }, [limit, rows.length]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    if (!more || requested.current) return;
    const pane = event.currentTarget;
    if (pane.scrollHeight - pane.scrollTop - pane.clientHeight > LOAD_AHEAD_PX) return;
    requested.current = true;
    onShowMore();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        style={{ gridTemplateColumns: template }}
        className="grid-row sticky top-0 z-10 gap-sm border-b border-surface-border bg-surface-panel px-md py-sm text-xs uppercase tracking-wide text-ink-muted"
      >
        {picking && (
          <HeaderTickBox
            all={allPicked}
            some={pickedHere > 0 && !allPicked}
            count={matchedUrls.length}
            onChange={() => (allPicked ? onUnpickMany(matchedUrls) : onPickMany(matchedUrls))}
          />
        )}
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
              lines: [spec.note, kindTag(spec)],
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

      <div className="min-h-0 flex-1 overflow-y-auto" onScroll={onScroll}>
        {shown.map((row) => (
          <Row
            key={row.relay.url}
            row={row}
            kinds={specs}
            template={template}
            selected={row.relay.url === selectedUrl}
            onSelect={onSelect}
            picking={picking}
            picked={picked.has(row.relay.url)}
            onTogglePick={onTogglePick}
          />
        ))}

        {rows.length === 0 && (
          <EmptyState
            status={status}
            hidden={hidden}
            total={total}
            onClearFilters={onClearFilters}
          />
        )}

        {more && (
          <div className="flex flex-wrap items-center justify-center gap-md p-lg">
            <span className="text-sm text-ink-muted">
              {compactCount(shown.length)} of {compactCount(rows.length)} matching relays — more
              load as you scroll
            </span>
            <Button variant="secondary" onClick={onShowMore}>
              Show more
            </Button>
            <Button variant="ghost" onClick={onShowAll}>
              Show all {compactCount(rows.length)}
            </Button>
          </div>
        )}

        {/* The end of a list that has one, and — the important half — why it
            ends where it does. "end of 50 matching relays" under a sweep of
            1,318 reads as a paging limit, and the first thing anyone does is
            look for the button that loads the rest. There is no such button:
            the other 1,268 are behind a checkbox in the filter bar, so the
            number and the way out both belong here. */}
        {!more && rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-sm p-lg text-center text-sm text-ink-muted">
            <span>
              end of {compactCount(rows.length)} matching relays
              {elapsedMs !== null && ` · checked ${compactCount(total)} in ${duration(elapsedMs)}`}
            </span>
            {hidden > 0 && (
              <>
                <span aria-hidden>·</span>
                <span>{compactCount(hidden)} more hidden by the filters above</span>
                <Button
                  variant="secondary"
                  className="px-md py-0.5 text-sm"
                  onClick={onClearFilters}
                >
                  Show all {compactCount(total)}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
