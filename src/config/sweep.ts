/**
 * Sweep tuning, and the relays the relay list itself comes from.
 *
 * Every number here was measured against the live network in August 2026
 * (see README, "Measurements"), not guessed. They trade wall-clock against
 * false negatives: a budget too tight reports a slow relay as empty, which is
 * the one failure mode this tool must not have — it exists to tell "nothing
 * published" apart from "nobody answered".
 */

/**
 * Where the relay list comes from: relays that carry NIP-66 kind-30166 relay
 * discovery events.
 *
 * This replaced the nostr.watch HTTP API, which is gone — `api.nostr.watch/v1`
 * answers 502 and the v2 endpoint is 402 Payment Required. The NIP-66 events
 * are strictly better anyway: each one carries the relay's supported NIPs,
 * its AUTH and payment requirements, a monitor-measured round-trip and its
 * whole NIP-11 document, so building the directory costs one subscription
 * instead of a thousand cross-origin fetches.
 *
 * Measured yield, one query each: monitorlizard 1262, relay.nostr.watch 1246,
 * relaypag.es 856, union 1317. The overlap is heavy and deliberate — a single
 * monitor going quiet must not empty the directory.
 */
export const DISCOVERY_RELAYS: readonly string[] = [
  'wss://monitorlizard.nostr1.com',
  'wss://relay.nostr.watch',
  'wss://relaypag.es',
];

/** NIP-66 relay discovery. One event per (monitor, relay) pair. */
export const RELAY_DISCOVERY_KIND = 30166;

/**
 * Discovery events pulled per request, and how many requests deep to page.
 *
 * The cap is not per relay but per *report*, and around thirty monitors each
 * publish one per relay they watch — so a single request of 5000 comes back
 * full and silently short of hundreds of relays. Measured over the three
 * monitors: one un-paged request yields 1306 relays, eight pages yield 1567,
 * and twenty pages yield 1570 — so the page cap sits where the curve flattens
 * and costs ~20s on a cold directory. Pages stop early on a short one.
 */
export const DISCOVERY_LIMIT = 2000;
export const DISCOVERY_MAX_PAGES = 8;

/** Age floor for paging. Reports older than this describe a network state
 *  nobody should act on, and paging into them is unbounded work. */
export const DISCOVERY_FLOOR_S = 7 * 24 * 60 * 60;

/** A discovery event older than this is a relay the monitors have stopped
 *  seeing. Kept in the directory, marked stale, excluded from a sweep by
 *  default — measured freshness on the live monitors is under two hours. */
export const DISCOVERY_STALE_AFTER_S = 24 * 60 * 60;

export const DISCOVERY_TIMEOUT_MS = 20_000;

/**
 * Concurrent relay sockets during a sweep.
 *
 * Chrome caps WebSocket connections at 255 per host but has no global cap;
 * the real ceiling is the machine's file descriptors and the CPU cost of a
 * thousand TLS handshakes. Measured over the full directory at 48 sockets:
 * 1,353 relays in 79s from Node, 1,339 in 3m54s from Chrome, which queues the
 * handshakes. Results stream in from the first second either way.
 *
 * The default is deliberately far below that ceiling, and equal to the range's
 * floor: a handful of sockets is gentle on the network and on the relays, and
 * costs wall-clock rather than accuracy. Sweeping the whole directory in one
 * sitting means moving the slider up.
 */
export const SWEEP_CONCURRENCY = 4;

/** Bounds on what the concurrency slider offers. The floor is the default —
 *  the slider only goes up. Above ~96 the handshakes start queueing behind
 *  each other and the sweep gets slower, not faster. */
export const SWEEP_CONCURRENCY_RANGE = { min: 4, max: 96 } as const;

/**
 * How long to wait for the socket to open.
 *
 * Set from a browser measurement, not from what a relay "should" take. The
 * measurement was taken at 48 concurrent sockets, which Chrome does not open
 * at once — it queues them — so the clock here covers time spent waiting for a
 * slot as well as the handshake itself. Measured over the full directory: at
 * 4s, **21%** of relays were reported unreachable; at 9s, **2%**, matching what
 * the same sweep sees from Node with no browser socket queue. The other
 * nineteen percent were alive the whole time.
 *
 * The default concurrency is now far below that, so there is no queue to wait
 * through and the budget is pure headroom — but the slider goes back up to 48
 * and beyond, where the queue is real again.
 *
 * That makes this the most dangerous number in the file: too low and the app
 * confidently reports live relays as dead, which is the exact failure it
 * exists to prevent. Do not lower it without re-running the full sweep in a
 * browser and comparing the unreachable count.
 */
export const CONNECT_TIMEOUT_MS = 9_000;

/**
 * How long to wait for `COUNT` responses after the socket is open.
 *
 * NIP-45 is answered from an index, so a relay that supports it answers fast.
 * Under half of live relays implement it at all (measured: 27 of 57), and the
 * ones that do not simply never reply — this timeout is what turns that
 * silence into "fall back to sampling".
 */
export const COUNT_TIMEOUT_MS = 3_500;

/** How long to wait for sampled events and their EOSE. */
export const QUERY_TIMEOUT_MS = 6_000;

/**
 * Hard ceiling on one relay, whatever it is doing. Keeps one pathological host
 * from holding a concurrency slot for the whole sweep.
 *
 * Derived rather than written down, because the parts are the real bound: a
 * relay may legitimately spend the connect timeout, then the query timeout,
 * then one `COUNT` retry. A hand-set ceiling below that sum does not bound the
 * pathological case, it truncates the slow-but-working one — and a truncated
 * relay reports as an error, which is the lie this file exists to avoid.
 */
export const RELAY_BUDGET_MS = CONNECT_TIMEOUT_MS + QUERY_TIMEOUT_MS + COUNT_TIMEOUT_MS + 2_000;

/**
 * Events pulled per kind when a relay cannot answer `COUNT`.
 *
 * This is the count, so a bigger number is a more exact answer and a slower,
 * heavier sweep: it is multiplied by six kinds and a thousand relays. The
 * default detects presence and reads the newest event, and reports anything
 * at the ceiling as "at least N" rather than pretending to be exact.
 */
export const SAMPLE_LIMIT_CHOICES: readonly number[] = [25, 100, 500];
export const DEFAULT_SAMPLE_LIMIT = 25;

/** Flush streamed results into the store on this interval. A thousand relays
 *  answering individually would otherwise be a thousand React renders. */
export const RESULT_FLUSH_MS = 250;
