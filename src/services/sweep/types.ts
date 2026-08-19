/**
 * The shape of an answer.
 *
 * Written down once, in one place, because three consumers have to agree on
 * it exactly: the engine that produces it, IndexedDB which stores it verbatim
 * between visits, and the diff that compares this run against the last one.
 */

/** How a count was arrived at — shown in the cell, because the two are not
 *  equally trustworthy and a user comparing two relays deserves to know which
 *  one merely stopped talking at the sample ceiling. */
export type CountMethod =
  /** NIP-45 `COUNT`: the relay's own index answered. Exact. */
  | 'count'
  /** Counted from sampled events. Exact below the sample ceiling, a floor at it. */
  | 'sample'
  /** No usable answer. */
  | 'none';

export type KindStatus =
  | 'ok'
  /** The relay served nothing because it wants a NIP-42 AUTH first. */
  | 'auth'
  /** `payment-required:` — a paid relay refusing an unpaid read. */
  | 'payment'
  /** `restricted:` or any other policy refusal. */
  | 'restricted'
  /** Nothing arrived inside the budget. Not the same as an answer of zero. */
  | 'timeout'
  | 'error';

export interface NewestEvent {
  id: string;
  pubkey: string;
  created_at: number;
  /**
   * Signature check result, or `null` when it was not attempted.
   *
   * Only checked in identity mode, and only for the newest event per kind:
   * the claim "this relay holds *your* profile" is one a relay can forge for
   * free, and it is the one claim a user will act on. Checked on the newest
   * event per kind only — six per relay, across a thousand relays.
   */
  verified: boolean | null;
}

export interface KindResult {
  kind: number;
  /** `null` when the relay gave no usable answer for this kind. */
  count: number | null;
  /** The count is a floor — the sample hit its ceiling, or the stream was cut
   *  short before EOSE. */
  approx: boolean;
  method: CountMethod;
  status: KindStatus;
  newest: NewestEvent | null;
  /**
   * Events the relay returned that do not match the filter it was sent.
   *
   * Relays that ignore `authors` or `kinds` exist, and without this they read
   * as the richest relays on the network. Anything above zero means the
   * relay's own count is not to be believed.
   */
  mismatched: number;
  /** Relay-supplied refusal text, verbatim and truncated. */
  note: string | null;
}

export type RelayStatus =
  | 'ok'
  /** The socket never opened. The browser gives no reason for this. */
  | 'unreachable'
  /** Not attempted: filtered out as Tor/i2p, or the sweep was cancelled. */
  | 'skipped'
  | 'error';

export interface RelayResult {
  url: string;
  status: RelayStatus;
  /** Time to open the socket, measured client-side — not the monitor's `rtt-open`. */
  connectMs: number | null;
  totalMs: number;
  /** Keyed by kind. Absent for a kind that was not part of the query. */
  kinds: Record<number, KindResult>;
  /** Sum of the counts that are known. `null` when nothing was answered. */
  total: number | null;
  /** Kinds with a count above zero — the "does this relay carry my data at
   *  all" number the grid sorts on by default. */
  hits: number;
  error: string | null;
}

export interface SweepQuery {
  /**
   * Hex pubkey. Required — there is no "count everything" mode.
   *
   * A run with no author asked every relay for its whole contents, which is a
   * question about relays rather than about anybody's data, took the same
   * three minutes to answer, and gave a page of numbers that no user could act
   * on. The tool answers one question: where does *this identity's* data live.
   */
  author: string;
  kinds: number[];
  sampleLimit: number;
  /** Tor and i2p relays are unreachable from an ordinary browser; opt in only
   *  if the browser proxies them. */
  includeDarknet: boolean;
  /** Sweep relays no monitor has reported recently. */
  includeStale: boolean;
}

/**
 * A finished or in-progress run, exactly as it is cached.
 *
 * `queryKey` deliberately excludes `sampleLimit`: raising the sample changes
 * how precise an answer is, not which question was asked, and keying on it
 * would throw away the baseline the diff needs the moment a user reaches for
 * more precision.
 */
export interface SweepSnapshot {
  queryKey: string;
  query: SweepQuery;
  startedAt: number;
  finishedAt: number | null;
  results: RelayResult[];
  /** False when the run was cancelled or is still going. */
  complete: boolean;
}

export function queryKeyFor(query: Pick<SweepQuery, 'author' | 'kinds'>): string {
  return `${query.author}|${[...query.kinds].sort((a, b) => a - b).join(',')}`;
}
