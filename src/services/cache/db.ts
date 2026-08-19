/**
 * IndexedDB persistence, via idb-keyval.
 *
 * Two things are worth keeping between visits, for the same reason: a full
 * sweep costs three minutes and thirteen hundred TLS handshakes, so a page
 * reload must not silently start over. The directory is cached so the app has
 * a relay list in the first frame, and the last sweep per query is cached so a
 * repeat search shows its previous answer immediately and can then say what
 * changed.
 *
 * Everything here is best-effort. IndexedDB is unavailable in a private window
 * in some browsers and can throw on quota; a cache miss must degrade to a
 * slower app, never to a broken one.
 */
import { get, set, del, keys } from 'idb-keyval';

import { logger } from '@/lib/logger';
import type { RelayDescriptor } from '@/services/discovery/nip66';
import type { SweepSnapshot } from '@/services/sweep/types';

const DIRECTORY_KEY = 'directory.v1';

/**
 * Bumped whenever the *meaning* of a stored result changes.
 *
 * A cached run is not just data, it is data plus the logic that produced it,
 * and the diff compares the two runs as if they were equivalent. They were
 * not: an earlier version recorded a relay that never answered as `0` rather
 * than as "no answer", so after that was fixed every one of those relays
 * showed `+10` against a phantom zero — a change that never happened,
 * displayed exactly like one that did.
 *
 * Old versions are ignored on read and deleted on startup rather than
 * migrated. Everything here is re-derivable by asking the network again, and a
 * migration would have to invent what the old code meant.
 *
 * v2 — counting fixed so an unanswered query is `null`, not `0`.
 */
const SWEEP_VERSION = 2;
const SWEEP_PREFIX = `sweep.v${SWEEP_VERSION}:`;
/** Every prefix ever used, so startup can clear the ones that are not ours. */
const SWEEP_PREFIX_ANY = /^sweep\.v(\d+):/;

/** Bump when a stored shape changes. Old keys are dropped rather than
 *  migrated: everything here is re-derivable by asking the network again. */
export interface CachedDirectory {
  relays: RelayDescriptor[];
  fetchedAt: number;
}

async function safeGet<T>(key: string): Promise<T | null> {
  try {
    return (await get<T>(key)) ?? null;
  } catch (err) {
    logger.cache('Read failed', { key, err: String(err) });
    return null;
  }
}

async function safeSet(key: string, value: unknown): Promise<void> {
  try {
    await set(key, value);
  } catch (err) {
    // Quota is the likely cause, and a sweep of a thousand relays is the
    // likely reason. Losing the cache is survivable; losing the run is not.
    logger.cache('Write failed', { key, err: String(err) });
  }
}

export const directoryCache = {
  read: () => safeGet<CachedDirectory>(DIRECTORY_KEY),
  write: (value: CachedDirectory) => safeSet(DIRECTORY_KEY, value),
};

export const sweepCache = {
  read: (queryKey: string) => safeGet<SweepSnapshot>(SWEEP_PREFIX + queryKey),
  write: (snapshot: SweepSnapshot) => safeSet(SWEEP_PREFIX + snapshot.queryKey, snapshot),
  /**
   * Delete results written by an older version of the counting logic.
   *
   * Called once at startup. Leaving them in place would be worse than a cache
   * miss: they are silently diffable against current results and produce
   * confident, wrong answers about what changed.
   */
  async purgeOldVersions(): Promise<number> {
    try {
      const all = await keys();
      const stale = all.filter((key): key is string => {
        if (typeof key !== 'string') return false;
        const match = SWEEP_PREFIX_ANY.exec(key);
        return match !== null && match[1] !== String(SWEEP_VERSION);
      });
      await Promise.all(stale.map((key) => del(key)));
      if (stale.length > 0)
        logger.cache('Purged results from an older version', { count: stale.length });
      return stale.length;
    } catch {
      return 0;
    }
  },
};
