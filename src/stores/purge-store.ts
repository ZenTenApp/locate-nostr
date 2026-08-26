/**
 * Purge state: what is about to be deleted, who is signing, and what the
 * relays said.
 *
 * Separate from the sweep store rather than folded into it, because the two
 * have opposite failure modes and it is worth them not sharing a reset. A
 * sweep that goes wrong costs three minutes; a purge that goes wrong is a
 * signed request sitting on a thousand strangers' relays. Keeping it apart
 * means no sweep action can start, extend or retarget a purge by accident.
 *
 * The signer lives here — the object, never a key. An extension signer holds
 * nothing; a key signer is a handle on a worker that holds the key on its own
 * side of a `postMessage` boundary. {@link PurgeState.forgetSigner} terminates
 * that worker, which is the only way the key actually goes away. Three things
 * here call it — leaving purge mode, finishing a purge, choosing a different
 * key — and two outside do: closing the raw-events dialog, and changing
 * identity. Every route that can unlock a key has one that ends it.
 */
import { create } from 'zustand';

import { PURGE_DEFAULT_REASON } from '@/config/purge';
import { errorMessage } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { RelayDescriptor } from '@/services/discovery/nip66';
import { extensionSigner, keySigner } from '@/services/nostr/signer';
import type { Signer } from '@/services/nostr/signer';
import type { KeySource } from '@/services/worker/protocol';
import { runPurge } from '@/services/purge/engine';
import type { PurgePhase, PurgeRelayReport } from '@/services/purge/engine';
import type { TargetMode } from '@/services/purge/targets';
import { resolveTargets } from '@/services/purge/targets';

export type PurgeStatus = 'idle' | 'running' | 'done' | 'cancelled';

interface Progress {
  done: number;
  total: number;
}

interface PurgeState {
  /** Purge mode: the grid grows a tick column and the purge bar appears.
   *  Off by default, and every screen that deletes is behind it. */
  picking: boolean;
  mode: TargetMode;
  /** Ticked relay URLs. Read as targets or as exceptions depending on
   *  {@link PurgeState.mode}. */
  picked: Set<string>;
  /** Kinds to delete. Starts empty on purpose: a purge screen that opens with
   *  everything selected is one where the dangerous option is the default. */
  kinds: number[];
  reason: string;

  signer: Signer | null;
  signerBusy: boolean;
  signerError: string | null;

  status: PurgeStatus;
  phase: PurgePhase | null;
  progress: Progress;
  reports: Map<string, PurgeRelayReport>;
  /** Distinct ids named by the requests that were sent. */
  gathered: number;
  requests: number;
  error: string | null;

  setPicking: (picking: boolean) => void;
  setMode: (mode: TargetMode) => void;
  togglePick: (url: string) => void;
  /**
   * Add these to the ticks, leaving every other tick alone.
   *
   * Deliberately additive. The grid's select-all covers whatever the filter
   * bar is showing, and a filter is a view, not the selection: ticking ten
   * relays, narrowing the filter and ticking ten more used to throw the first
   * ten away — silently, with the count on the bar as the only clue.
   */
  pickMany: (urls: readonly string[]) => void;
  /** Untick these, leaving every other tick alone — the other half of the
   *  grid's select-all, for when everything shown is already ticked. */
  unpickMany: (urls: readonly string[]) => void;
  clearPicks: () => void;
  toggleKind: (kind: number) => void;
  setReason: (reason: string) => void;

  chooseExtension: () => Promise<void>;
  /** Resolves with the signer so the dialog that collected the secret can
   *  show which identity it turned out to be. */
  unlock: (source: KeySource, secret: string, passphrase: string) => Promise<Signer>;
  forgetSigner: () => void;

  /** Targets for the current mode and ticks, out of the relays the sweep
   *  covers. The same list the confirmation screen counts and the run uses. */
  targets: (relays: readonly RelayDescriptor[]) => RelayDescriptor[];
  start: (relays: readonly RelayDescriptor[], author: string, concurrency: number) => Promise<void>;
  cancel: () => void;
  /** Clear the last run's results, keeping the selection. */
  clearResults: () => void;
}

let controller: AbortController | null = null;

export const usePurgeStore = create<PurgeState>((set, get) => ({
  picking: false,
  mode: 'only',
  picked: new Set<string>(),
  kinds: [],
  reason: PURGE_DEFAULT_REASON,

  signer: null,
  signerBusy: false,
  signerError: null,

  status: 'idle',
  phase: null,
  progress: { done: 0, total: 0 },
  reports: new Map(),
  gathered: 0,
  requests: 0,
  error: null,

  setPicking(picking) {
    // Leaving purge mode drops the key with it. A signer that outlives the
    // screen that asked for it is a key held for no stated reason.
    if (!picking) get().forgetSigner();
    set({ picking });
  },

  setMode(mode) {
    set({ mode });
  },

  togglePick(url) {
    const picked = new Set(get().picked);
    if (picked.has(url)) picked.delete(url);
    else picked.add(url);
    set({ picked });
  },

  pickMany(urls) {
    const picked = new Set(get().picked);
    for (const url of urls) picked.add(url);
    set({ picked });
  },

  unpickMany(urls) {
    const picked = new Set(get().picked);
    for (const url of urls) picked.delete(url);
    set({ picked });
  },

  clearPicks() {
    set({ picked: new Set<string>() });
  },

  toggleKind(kind) {
    const kinds = get().kinds;
    set({
      kinds: kinds.includes(kind) ? kinds.filter((entry) => entry !== kind) : [...kinds, kind],
    });
  },

  setReason(reason) {
    set({ reason });
  },

  async chooseExtension() {
    get().forgetSigner();
    set({ signerBusy: true, signerError: null });
    try {
      set({ signer: await extensionSigner() });
    } catch (err) {
      set({ signerError: errorMessage(err) });
    } finally {
      set({ signerBusy: false });
    }
  },

  async unlock(source, secret, passphrase) {
    get().forgetSigner();
    set({ signerBusy: true, signerError: null });
    try {
      const signer = await keySigner(source, secret, passphrase);
      set({ signer });
      return signer;
    } catch (err) {
      set({ signerError: errorMessage(err) });
      // Rethrown as well as recorded: the dialog that holds the secret fields
      // keeps them on screen for a retry, and only a throw tells it to.
      throw err;
    } finally {
      set({ signerBusy: false });
    }
  },

  forgetSigner() {
    get().signer?.close();
    set({ signer: null, signerError: null });
  },

  targets(relays) {
    return resolveTargets(relays, get().mode, get().picked);
  },

  async start(relays, author, concurrency) {
    const state = get();
    if (state.status === 'running') return;
    const signer = state.signer;
    if (signer === null || state.kinds.length === 0) return;

    const targets = state.targets(relays);
    if (targets.length === 0) return;

    controller = new AbortController();
    set({
      status: 'running',
      phase: 'gathering',
      progress: { done: 0, total: targets.length },
      reports: new Map(),
      gathered: 0,
      requests: 0,
      error: null,
    });

    try {
      const outcome = await runPurge(
        targets,
        { author, kinds: state.kinds, reason: state.reason },
        signer,
        { concurrency, signal: controller.signal },
        {
          onPhase: (phase) => set({ phase }),
          // Written straight through rather than buffered like the sweep's
          // results: a purge is tens of relays, not thirteen hundred, and
          // watching each one answer is most of the reassurance on offer.
          onRelay: (report) => {
            const reports = new Map(get().reports);
            reports.set(report.url, report);
            set({ reports });
          },
          onProgress: (done, total) => set({ progress: { done, total } }),
        },
      );
      set({ gathered: outcome.gathered, requests: outcome.requests });
      logger.sweep('Purge finished', {
        relays: targets.length,
        gathered: outcome.gathered,
        requests: outcome.requests,
      });
    } catch (err) {
      set({ error: errorMessage(err) });
    } finally {
      const aborted = controller?.signal.aborted ?? false;
      set({ status: aborted ? 'cancelled' : 'done', phase: 'done' });
      controller = null;
      // The key has done everything it was unlocked for. Holding it past the
      // end of the run buys nothing and is exactly the state this app spent
      // its whole design avoiding.
      get().forgetSigner();
    }
  },

  cancel() {
    controller?.abort();
  },

  clearResults() {
    set({
      status: 'idle',
      phase: null,
      progress: { done: 0, total: 0 },
      reports: new Map(),
      gathered: 0,
      requests: 0,
      error: null,
    });
  },
}));
