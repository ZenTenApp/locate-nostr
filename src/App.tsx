/**
 * The whole app: one screen, one sweep, one grid.
 *
 * Composition only — every decision worth making lives in the store, the
 * engine or the row hook. What is here is the sequencing that makes a
 * three-minute network scan feel like a search box: cached answers paint
 * first, the directory refreshes behind them, and results stream into the
 * same grid rather than replacing it at the end.
 */
import { useEffect, useMemo, useState } from 'react';

import { selectionBreakdown, selectRelays } from '@/services/discovery/directory';
import type { RelayDescriptor } from '@/services/discovery/nip66';
import { queryKeyFor } from '@/services/sweep/types';
import { totalsOf } from '@/services/sweep/diff';
import { DEFAULT_FILTERS, useGridRows } from '@/hooks/use-grid-rows';
import type { GridFilters } from '@/hooks/use-grid-rows';
import { useSweepStore } from '@/stores/sweep-store';
import { CacheBanner } from '@/components/CacheBanner';
import { FilterBar } from '@/components/FilterBar';
import { QueryPanel } from '@/components/QueryPanel';
import { RelayDetail } from '@/components/RelayDetail';
import { ResultGrid } from '@/components/ResultGrid';
import { gridStatusFor } from '@/components/grid-status';
import { SummaryBar } from '@/components/SummaryBar';
import { TooltipLayer } from '@/components/ui/Tooltip';

/** Rows drawn before the "show more" button. Enough to fill any screen twice
 *  over; the cap exists so a thousand-row sweep does not re-layout the page on
 *  every flush. */
const PAGE_SIZE = 150;

/** Stable empty list, so "no directory yet" does not invalidate the selection
 *  memo on every render. */
const EMPTY_RELAYS: readonly RelayDescriptor[] = [];

export function App() {
  const store = useSweepStore();
  const [filters, setFilters] = useState<GridFilters>(DEFAULT_FILTERS);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);

  const { loadDirectory, restoreCached } = store;

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

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

  // One memo over the four inputs the selection depends on. Reading it off the
  // store instead would rebuild the list on every result flush — four times a
  // second, over thirteen hundred relays that have not changed since the run
  // started.
  const selection = useMemo(
    () => ({
      includeDarknet: store.includeDarknet,
      includeStale: store.includeStale,
      pasted: store.pastedRelays,
    }),
    [store.includeDarknet, store.includeStale, store.pastedRelays],
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
  const totals = useMemo(() => totalsOf([...store.results.values()]), [store.results]);

  // An empty grid means something different depending on what is in flight;
  // see `gridStatusFor`.
  const gridStatus = gridStatusFor({
    relayCount: relays.length,
    directoryLoading: store.directoryStatus === 'loading',
    running: store.status === 'running',
  });

  const selected = selectedUrl === null ? null : relays.find((relay) => relay.url === selectedUrl);
  const elapsedMs =
    store.startedAt !== null && store.finishedAt !== null
      ? store.finishedAt - store.startedAt
      : null;

  return (
    <div className="flex h-screen flex-col bg-surface-base text-ink-primary">
      <header className="flex items-baseline gap-md border-b border-surface-border px-lg py-md">
        <h1 className="text-xl font-semibold">Locate</h1>
        <p className="text-sm text-ink-muted">
          Find out which relays actually hold your data — or anyone&rsquo;s.
        </p>
        {store.directoryError !== null && (
          <span className="ml-auto text-sm text-state-error">{store.directoryError}</span>
        )}
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
        directory={store.directory}
        breakdown={breakdown}
        directoryLoading={store.directoryStatus === 'loading'}
        running={store.status === 'running'}
        onIdentityText={store.setIdentityText}
        onIdentity={store.setIdentity}
        onClearIdentity={store.clearIdentity}
        onChange={store.setQuery}
        onStart={() => {
          setLimit(PAGE_SIZE);
          void store.start();
        }}
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
          onRecheck={() => {
            setLimit(PAGE_SIZE);
            void store.start();
          }}
        />
      )}

      <FilterBar
        filters={filters}
        onChange={(patch) => {
          setFilters((current) => ({ ...current, ...patch }));
          setLimit(PAGE_SIZE);
        }}
        matched={rows.length}
        total={total}
        hasBaseline={store.baseline.size > 0}
      />

      <div className="flex min-h-0 flex-1">
        <ResultGrid
          rows={rows}
          limit={limit}
          onShowMore={() => setLimit((current) => current + PAGE_SIZE)}
          selectedUrl={selectedUrl}
          onSelect={(url) => setSelectedUrl((current) => (current === url ? null : url))}
          kinds={store.kinds}
          elapsedMs={elapsedMs}
          status={gridStatus}
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

      {/* One layer for the whole page — see `stores/tooltip-store.ts`. */}
      <TooltipLayer />
    </div>
  );
}
