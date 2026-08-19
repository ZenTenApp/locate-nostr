/**
 * All sweep state, and the only place a sweep is started or stopped.
 *
 * The store owns the run rather than a component, for two reasons. Results
 * arrive from a thousand independent sockets and are buffered and flushed on
 * a timer — a component doing that would drop the tail of the run on every
 * unmount. And a sweep must survive navigating between the grid and a relay's
 * detail panel, which is a re-render of everything below the store.
 */
import { create } from 'zustand';

import { ALL_KINDS } from '@/config/kinds';
import {
  DEFAULT_SAMPLE_LIMIT,
  RESULT_FLUSH_MS,
  SWEEP_CONCURRENCY,
  SWEEP_CONCURRENCY_RANGE,
} from '@/config/sweep';
import { errorMessage } from '@/lib/errors';
import type { IdentitySource } from '@/services/nostr/key-import';
import { InvalidIdentityError, parseIdentity } from '@/services/nostr/identity';
import { logger } from '@/lib/logger';
import { sweepCache } from '@/services/cache/db';
import { cachedDirectory, fetchDirectory, selectRelays } from '@/services/discovery/directory';
import type { Directory } from '@/services/discovery/directory';
import type { RelayDescriptor } from '@/services/discovery/nip66';
import { runSweep } from '@/services/sweep/engine';
import { baselineOf } from '@/services/sweep/diff';
import type { RelayResult, SweepQuery, SweepSnapshot } from '@/services/sweep/types';
import { queryKeyFor } from '@/services/sweep/types';

export type RunStatus = 'idle' | 'running' | 'done' | 'cancelled';
export type DirectoryStatus = 'idle' | 'loading' | 'ready' | 'error';

interface Progress {
  done: number;
  total: number;
}

interface SweepState {
  directory: Directory | null;
  directoryStatus: DirectoryStatus;
  directoryError: string | null;

  /** Hex pubkey, or `null` when none has been given yet — in which case there
   *  is no question to ask and no sweep to run. Only written once something
   *  parses, so a half-typed npub leaves it unchanged rather than turning the
   *  whole page into an error. */
  author: string | null;
  /** The same identity as an npub, for display. */
  authorNpub: string | null;
  /** Where it came from — a pasted npub and a key the user proved they hold
   *  are different claims, and the header says which. */
  authorSource: IdentitySource | null;
  /** Raw contents of the identity box. Lives here rather than in the panel so
   *  a key import can fill it in, and so it survives the panel re-rendering
   *  under a streaming sweep. */
  identityText: string;
  identityError: string | null;
  kinds: number[];
  sampleLimit: number;
  concurrency: number;
  includeDarknet: boolean;
  includeStale: boolean;
  pastedRelays: string;

  status: RunStatus;
  progress: Progress;
  startedAt: number | null;
  finishedAt: number | null;
  results: Map<string, RelayResult>;
  /** Whether what the grid is showing came off disk or off the network. A
   *  cached grid is shown within a frame of a page load, and mislabelling it
   *  as live would turn a day-old answer into a current one. */
  resultsFrom: 'cache' | 'live' | null;
  resultsAt: number | null;
  /** Whether the run behind these results finished. A saved result that was
   *  stopped half-way is a different claim from a complete one, and the banner
   *  has to say which. `null` when there are no results. */
  resultsComplete: boolean | null;
  /** The previous run of the same query, for the diff. */
  baseline: Map<string, RelayResult>;
  baselineAt: number | null;

  loadDirectory: () => Promise<void>;
  /** Parse whatever is in the identity box. Empty means no identity, which
   *  means no sweep — see {@link SweepState.currentQuery}. */
  setIdentityText: (text: string) => void;
  /** Adopt an identity proved by a key or an extension. */
  setIdentity: (identity: { pubkey: string; npub: string }, source: IdentitySource) => void;
  clearIdentity: () => void;
  /** Show the last cached answer to the current question, if there is one. */
  restoreCached: () => Promise<void>;
  setQuery: (
    patch: Partial<
      Pick<
        SweepState,
        'kinds' | 'sampleLimit' | 'concurrency' | 'includeDarknet' | 'includeStale' | 'pastedRelays'
      >
    >,
  ) => void;
  start: () => Promise<void>;
  cancel: () => void;
  /** Relays the current settings would sweep — shown next to the button, so
   *  the cost of a run is known before it starts. */
  selectedRelays: () => RelayDescriptor[];
  currentQuery: () => SweepQuery | null;
}

/** Buffer between the engine and React. A thousand relays answering
 *  individually would otherwise be a thousand renders of a thousand rows —
 *  progress included, which ticks once per relay and would re-render the grid
 *  on its own even if no result had arrived. */
let pending: RelayResult[] = [];
let pendingProgress: Progress | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let controller: AbortController | null = null;

export const useSweepStore = create<SweepState>((set, get) => ({
  directory: null,
  directoryStatus: 'idle',
  directoryError: null,

  author: null,
  authorNpub: null,
  authorSource: null,
  identityText: '',
  identityError: null,
  kinds: [...ALL_KINDS],
  sampleLimit: DEFAULT_SAMPLE_LIMIT,
  concurrency: SWEEP_CONCURRENCY,
  includeDarknet: false,
  includeStale: false,
  pastedRelays: '',

  status: 'idle',
  progress: { done: 0, total: 0 },
  startedAt: null,
  finishedAt: null,
  results: new Map(),
  resultsFrom: null,
  resultsAt: null,
  resultsComplete: null,
  baseline: new Map(),
  baselineAt: null,

  async loadDirectory() {
    set({ directoryStatus: 'loading', directoryError: null });

    // Results written by an older counting version are not comparable with
    // current ones, and a stale baseline produces confident nonsense in the
    // diff. Dropped before anything can read them.
    void sweepCache.purgeOldVersions();

    // Paint the cached list first: the monitors take a few seconds and the
    // relay count is the first thing anyone looks at.
    const cached = await cachedDirectory();
    if (cached && get().directory === null) set({ directory: cached });

    try {
      const directory = await fetchDirectory();
      if (directory.relays.length === 0) {
        set({
          directoryStatus: 'error',
          directoryError: 'No relay monitor answered, and nothing is cached.',
        });
        return;
      }
      set({ directory, directoryStatus: 'ready' });
    } catch (err) {
      set({ directoryStatus: 'error', directoryError: errorMessage(err) });
    }
  },

  async restoreCached() {
    // Only ever fills an idle grid. Dropping a live run's partial results back
    // to yesterday's cache because a checkbox moved would lose the run.
    if (get().status === 'running') return;

    const query = get().currentQuery();
    const snapshot = query === null ? null : await sweepCache.read(queryKeyFor(query));
    if (!snapshot) {
      set({
        results: new Map(),
        resultsFrom: null,
        resultsAt: null,
        resultsComplete: null,
        progress: { done: 0, total: 0 },
      });
      return;
    }
    set({
      results: new Map(snapshot.results.map((result) => [result.url, result])),
      resultsFrom: 'cache',
      resultsAt: snapshot.finishedAt,
      resultsComplete: snapshot.complete,
      progress: { done: snapshot.results.length, total: snapshot.results.length },
      status: 'idle',
      baseline: new Map(),
      baselineAt: null,
    });
  },

  setIdentityText(text) {
    const trimmed = text.trim();
    if (trimmed === '') {
      set({
        identityText: text,
        identityError: null,
        author: null,
        authorNpub: null,
        authorSource: null,
      });
      return;
    }
    try {
      const identity = parseIdentity(trimmed);
      set({
        identityText: text,
        identityError: null,
        author: identity.hex,
        authorNpub: identity.npub,
        authorSource: 'text',
      });
    } catch (err) {
      // Typing in progress is not a failure worth shouting about, but the
      // sweep must not quietly run as a census because the npub is one
      // character short — so the author is cleared and the button reads the
      // error, not the empty author.
      set({
        identityText: text,
        identityError: err instanceof InvalidIdentityError ? err.message : 'Unreadable key',
        author: null,
        authorNpub: null,
        authorSource: null,
      });
    }
  },

  setIdentity(identity, source) {
    set({
      author: identity.pubkey,
      authorNpub: identity.npub,
      authorSource: source,
      // The box shows the npub the key proved, so the derivation is visible
      // and copyable rather than something that happened invisibly.
      identityText: identity.npub,
      identityError: null,
    });
  },

  clearIdentity() {
    set({
      author: null,
      authorNpub: null,
      authorSource: null,
      identityText: '',
      identityError: null,
    });
  },

  setQuery(patch) {
    const next = { ...patch };
    if (next.concurrency !== undefined) {
      next.concurrency = Math.min(
        SWEEP_CONCURRENCY_RANGE.max,
        Math.max(SWEEP_CONCURRENCY_RANGE.min, next.concurrency),
      );
    }
    set(next);
  },

  /**
   * The question being asked, or `null` when no identity has been given.
   *
   * There is no "everyone" query to fall back on: a run with no author asked
   * every relay for its entire contents, which is a question about relays
   * rather than about anyone's data, and produced a page of numbers no user
   * could act on. So the absence of an identity is a state with no query, not
   * a query with no filter.
   */
  currentQuery() {
    const { author, kinds, sampleLimit, includeDarknet, includeStale } = get();
    if (author === null) return null;
    return { author, kinds, sampleLimit, includeDarknet, includeStale };
  },

  selectedRelays() {
    const state = get();
    return selectRelays(state.directory?.relays ?? [], {
      includeDarknet: state.includeDarknet,
      includeStale: state.includeStale,
      pasted: state.pastedRelays,
    });
  },

  async start() {
    const state = get();
    if (state.status === 'running') return;

    const relays = state.selectedRelays();
    if (relays.length === 0) return;

    const query = state.currentQuery();
    // No identity, no sweep. The button is disabled in this state; this is the
    // guard that makes that a fact rather than a UI convention.
    if (query === null) return;
    const queryKey = queryKeyFor(query);

    // The previous run of this exact question becomes the diff baseline. A
    // different question has no baseline rather than a misleading one.
    const previous = await sweepCache.read(queryKey);

    controller = new AbortController();
    pending = [];
    pendingProgress = null;
    set({
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      progress: { done: 0, total: relays.length },
      results: new Map(),
      resultsFrom: 'live',
      resultsAt: null,
      resultsComplete: null,
      baseline: baselineOf(previous),
      baselineAt: previous?.finishedAt ?? null,
    });

    const flush = () => {
      const batch = pending;
      const progress = pendingProgress;
      if (batch.length === 0 && progress === null) return;
      pending = [];
      pendingProgress = null;
      set((current) => {
        const patch: Partial<SweepState> = {};
        if (progress !== null) patch.progress = progress;
        if (batch.length > 0) {
          const results = new Map(current.results);
          for (const result of batch) results.set(result.url, result);
          patch.results = results;
        }
        return patch;
      });
    };
    flushTimer = setInterval(flush, RESULT_FLUSH_MS);

    try {
      await runSweep(
        relays,
        query,
        { concurrency: state.concurrency, signal: controller.signal },
        {
          onResult: (result) => pending.push(result),
          onProgress: (done, total) => {
            pendingProgress = { done, total };
          },
        },
      );
    } finally {
      if (flushTimer !== null) clearInterval(flushTimer);
      flushTimer = null;
      flush();

      const aborted = controller?.signal.aborted ?? false;
      const finishedAt = Date.now();
      const results = [...get().results.values()];
      set({
        status: aborted ? 'cancelled' : 'done',
        finishedAt,
        resultsAt: finishedAt,
        resultsComplete: !aborted,
      });

      const snapshot: SweepSnapshot = {
        queryKey,
        query,
        startedAt: get().startedAt ?? finishedAt,
        finishedAt,
        results,
        complete: !aborted,
      };
      // A cancelled run is still cached: a partial answer is a better baseline
      // than none, and the snapshot records that it is partial.
      void sweepCache.write(snapshot);
      logger.sweep('Sweep finished', { relays: results.length, aborted });
      controller = null;
    }
  },

  cancel() {
    controller?.abort();
  },
}));
