/**
 * The whole app: one screen, one sweep, one grid.
 *
 * Composition only — every decision worth making lives in the store, the
 * engine or the row hook. What is here is the sequencing that makes a
 * three-minute network scan feel like a search box: cached answers paint
 * first, the directory refreshes behind them, and results stream into the
 * same grid rather than replacing it at the end.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { WIDE_MEDIA_QUERY } from '@/config/theme';
import { selectionBreakdown, selectRelays } from '@/services/discovery/directory';
import type { RelayDescriptor } from '@/services/discovery/nip66';
import { queryKeyFor } from '@/services/sweep/types';
import { totalsOf } from '@/services/sweep/diff';
import { DEFAULT_FILTERS, WIDE_FILTERS, useGridRows } from '@/hooks/use-grid-rows';
import type { GridFilters } from '@/hooks/use-grid-rows';
import { useSweepStore } from '@/stores/sweep-store';
import { usePurgeStore } from '@/stores/purge-store';
import { CacheBanner } from '@/components/CacheBanner';
import { FilterBar, MatchCount } from '@/components/FilterBar';
import { QueryPanel } from '@/components/QueryPanel';
import { RelayDetail } from '@/components/RelayDetail';
import { ResultGrid } from '@/components/ResultGrid';
import { gridStatusFor } from '@/components/grid-status';
import { SummaryBar } from '@/components/SummaryBar';
import { PurgeBar } from '@/components/purge/PurgeBar';
import { PurgeDialog } from '@/components/purge/PurgeDialog';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { TooltipLayer } from '@/components/ui/Tooltip';

/** Rows drawn per page. Enough to fill any screen twice over; the cap exists
 *  so a thousand-row sweep does not re-layout the page on every flush. The
 *  grid grows it on its own as the bottom comes into view. */
const PAGE_SIZE = 150;

/** Stable empty list, so "no directory yet" does not invalidate the selection
 *  memo on every render. */
const EMPTY_RELAYS: readonly RelayDescriptor[] = [];

export function App() {
  const store = useSweepStore();
  const purge = usePurgeStore();
  const [filters, setFilters] = useState<GridFilters>(DEFAULT_FILTERS);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  /** The phone menu: filters, sort and purge, which have no room on the page. */
  const [menuOpen, setMenuOpen] = useState(false);

  const { loadDirectory, restoreCached } = store;

  // The menu only exists on a phone. Widening the window past the breakpoint
  // puts the filters back on the page, so the menu holding them goes away
  // rather than lingering as an invisible modal with a live Escape handler.
  useEffect(() => {
    const wide = window.matchMedia(WIDE_MEDIA_QUERY);
    const onChange = () => {
      if (wide.matches) setMenuOpen(false);
    };
    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  // A key is unlocked to act as one identity. Switching to another leaves it
  // with nothing to sign for, so it is dropped rather than left in a worker.
  // Read off the store imperatively: subscribing to the signer here would
  // re-render the whole page on every purge report.
  useEffect(() => {
    const state = usePurgeStore.getState();
    if (state.signer !== null) state.forgetSigner();
  }, [store.author]);

  // A change of question makes the grid show that question's last answer,
  // rather than leaving the previous question's results under a new heading.
  // With no identity there is no question, and nothing to restore. Built with
  // `queryKeyFor` rather than by hand: this is the cache key, and a second
  // copy of its format would silently stop matching the stored one.
  const query = store.currentQuery();
  const questionKey = query === null ? '' : queryKeyFor(query);
  useEffect(() => {
    void restoreCached();
  }, [questionKey, restoreCached]);

  // A new question is a new list, so paging starts over. A *re-check* of the
  // same question is not: it refills the rows already on screen, and collapsing
  // the list back to the first page under someone who had scrolled — and, in
  // purge mode, ticked their way down it — is the state loss this guards.
  // Adjusted during render rather than in an effect so no collapsed pass is
  // committed to the DOM first.
  const [pagedFor, setPagedFor] = useState(questionKey);
  if (pagedFor !== questionKey) {
    setPagedFor(questionKey);
    setLimit(PAGE_SIZE);
  }

  // Stable, so the grid's bottom-of-list observer is not torn down and rebuilt
  // on every result flush.
  const showMore = useCallback(() => setLimit((current) => current + PAGE_SIZE), []);
  const showAll = useCallback(() => setLimit(Number.MAX_SAFE_INTEGER), []);
  // Widen back to the whole sweep, keeping the sort: the ask is "where are the
  // other twelve hundred", not "reorder these fifty".
  const clearFilters = useCallback(() => {
    setFilters((current) => ({ ...current, ...WIDE_FILTERS }));
    setLimit(PAGE_SIZE);
  }, []);

  // One memo over the four inputs the selection depends on. Reading it off the
  // store instead would rebuild the list on every result flush — four times a
  // second, over thirteen hundred relays that have not changed since the run
  // started.
  const selection = useMemo(
    () => ({
      source: store.relaySource,
      includeDarknet: store.includeDarknet,
      includeStale: store.includeStale,
      pasted: store.pastedRelays,
    }),
    [store.relaySource, store.includeDarknet, store.includeStale, store.pastedRelays],
  );
  const directoryRelays = store.directory?.relays ?? EMPTY_RELAYS;
  const relays = useMemo(
    () => selectRelays(directoryRelays, selection),
    [directoryRelays, selection],
  );

  const breakdown = useMemo(
    () => selectionBreakdown(directoryRelays, selection),
    [directoryRelays, selection],
  );

  const { rows, total } = useGridRows(relays, store.results, store.baseline, filters);
  // Ticks the current filters hide. A selection that is partly invisible is
  // fine — it is why select-all is additive — but it must not be silent, or a
  // purge runs against relays the user cannot see on the screen behind it.
  const pickedInView = useMemo(
    () => rows.reduce((count, row) => (purge.picked.has(row.relay.url) ? count + 1 : count), 0),
    [rows, purge.picked],
  );
  const totals = useMemo(() => totalsOf([...store.results.values()]), [store.results]);

  // An empty grid means something different depending on what is in flight;
  // see `gridStatusFor`.
  const gridStatus = gridStatusFor({
    relayCount: relays.length,
    resultCount: store.results.size,
    directoryLoading: store.directoryStatus === 'loading',
    running: store.status === 'running',
  });

  // A check keeps the page depth and the ticks: it is the same relays being
  // asked again, and the rows a user had already worked through are the rows
  // they want to watch update.
  const startCheck = () => {
    void store.start();
  };

  // One set of props for both places the bar appears: inline on a wide screen,
  // in the menu on a phone. Each placement is its own mount; the breakpoint
  // effect above keeps them from being on screen together.
  const filterBar = (
    <FilterBar
      filters={filters}
      onChange={(patch) => {
        setFilters((current) => ({ ...current, ...patch }));
        setLimit(PAGE_SIZE);
      }}
      matched={rows.length}
      total={total}
      hasBaseline={store.baseline.size > 0}
      canPurge={store.author !== null && !purge.picking}
      onPurgeMode={() => {
        purge.setPicking(true);
        setMenuOpen(false);
      }}
    />
  );

  const selected = selectedUrl === null ? null : relays.find((relay) => relay.url === selectedUrl);
  const elapsedMs =
    store.startedAt !== null && store.finishedAt !== null
      ? store.finishedAt - store.startedAt
      : null;

  return (
    // Wide screens pin the page to the viewport and scroll only the grid; a
    // phone has no room for fixed panels above it, so the whole page scrolls.
    <div className="flex min-h-screen flex-col bg-surface-base text-ink-primary md:h-screen">
      {/* On a phone this is the title bar: pinned while the page scrolls under
          it, with the menu that holds what the page has no room for. */}
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-md gap-y-xs border-b border-surface-border bg-surface-panel px-lg py-sm md:static md:items-baseline md:bg-surface-base md:py-md">
        <h1 className="text-lg font-semibold md:text-xl">Nostr Locate</h1>
        <p className="hidden text-sm text-ink-muted md:block">
          Find out which relays actually hold your data — or anyone&rsquo;s.
        </p>
        {store.directoryError !== null && (
          <span className="order-last w-full text-sm text-state-error md:order-none md:ml-auto md:w-auto">
            {store.directoryError}
          </span>
        )}
        <Button
          variant="ghost"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          aria-haspopup="dialog"
          className="-mr-sm ml-auto px-sm py-0 text-xl leading-none md:hidden"
        >
          ☰
        </Button>
      </header>

      <QueryPanel
        author={store.author}
        authorNpub={store.authorNpub}
        authorSource={store.authorSource}
        identityText={store.identityText}
        identityError={store.identityError}
        kinds={store.kinds}
        sampleLimit={store.sampleLimit}
        concurrency={store.concurrency}
        includeDarknet={store.includeDarknet}
        includeStale={store.includeStale}
        pastedRelays={store.pastedRelays}
        relaySource={store.relaySource}
        directory={store.directory}
        breakdown={breakdown}
        directoryLoading={store.directoryStatus === 'loading'}
        running={store.status === 'running'}
        onIdentityText={store.setIdentityText}
        onIdentity={store.setIdentity}
        onClearIdentity={store.clearIdentity}
        onChange={store.setQuery}
        onStart={startCheck}
        onCancel={store.cancel}
        onRefreshDirectory={() => void loadDirectory()}
      />

      <SummaryBar
        totals={totals}
        progress={store.progress}
        running={store.status === 'running'}
        elapsedMs={elapsedMs}
        resultsFrom={store.resultsFrom}
        resultsAt={store.resultsAt}
        complete={store.resultsComplete}
      />

      {/* Sits above the filters, not in a corner: the whole grid below it is
          old, and that has to be read before the numbers are. */}
      {store.resultsFrom === 'cache' && store.results.size > 0 && (
        <CacheBanner
          checkedAt={store.resultsAt}
          complete={store.resultsComplete}
          relayCount={store.results.size}
          busy={store.status === 'running'}
          onRecheck={startCheck}
        />
      )}

      <div className="hidden md:block">{filterBar}</div>
      {/* The phone's stand-in for the filter bar: what the filters are hiding
          stays on the page, and the way to change them is one tap away. */}
      <div className="flex items-center justify-between gap-sm border-b border-surface-border bg-surface-panel px-lg py-xs text-sm text-ink-muted md:hidden">
        <MatchCount matched={rows.length} total={total} />
        <Button variant="ghost" className="px-sm py-xs text-sm" onClick={() => setMenuOpen(true)}>
          Filter &amp; sort
        </Button>
      </div>
      {menuOpen && (
        <Modal title="Filter & sort" placement="side" onClose={() => setMenuOpen(false)}>
          <div className="-mx-lg">{filterBar}</div>
        </Modal>
      )}

      {/* Between the filters and the grid, because it describes the grid: the
          ticks are on those rows, and "all except ticked" is measured against
          the same list the sweep covered. */}
      {purge.picking && (
        <PurgeBar
          relays={relays}
          hiddenPicks={purge.picked.size - pickedInView}
          disabled={store.author === null || store.status === 'running'}
          onReview={() => setPurgeOpen(true)}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <ResultGrid
          rows={rows}
          total={total}
          limit={limit}
          onShowMore={showMore}
          onShowAll={showAll}
          onClearFilters={clearFilters}
          selectedUrl={selectedUrl}
          onSelect={(url) => setSelectedUrl((current) => (current === url ? null : url))}
          kinds={store.kinds}
          elapsedMs={elapsedMs}
          status={gridStatus}
          picking={purge.picking}
          picked={purge.picked}
          onTogglePick={purge.togglePick}
          onPickMany={purge.pickMany}
          onUnpickMany={purge.unpickMany}
        />
        {selected && (
          <RelayDetail
            relay={selected}
            result={store.results.get(selected.url)}
            author={store.author}
            onClose={() => setSelectedUrl(null)}
          />
        )}
      </div>

      {purgeOpen && store.author !== null && store.authorNpub !== null && (
        <PurgeDialog
          relays={relays}
          author={store.author}
          authorNpub={store.authorNpub}
          concurrency={store.concurrency}
          onClose={() => {
            setPurgeOpen(false);
            purge.clearResults();
          }}
          onRecheck={startCheck}
        />
      )}

      {/* One layer for the whole page — see `stores/tooltip-store.ts`. */}
      <TooltipLayer />
    </div>
  );
}
