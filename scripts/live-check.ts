/**
 * A real sweep, from the command line, against the live network.
 *
 * Not part of the test suite: it opens hundreds of sockets to strangers' hosts
 * and its result depends on who is up. It exists because every timeout in
 * `config/sweep.ts` is a claim about the real network, and the only way to
 * keep those honest is to re-measure them.
 *
 *   npx vite-node scripts/live-check.ts -- [relayLimit] [npub-or-hex]
 */
import { fetchDirectory, isStale } from '../src/services/discovery/directory';
import { parseIdentity } from '../src/services/nostr/identity';
import { runSweep } from '../src/services/sweep/engine';
import { totalsOf } from '../src/services/sweep/diff';
import type { RelayResult } from '../src/services/sweep/types';
import { DEFAULT_SAMPLE_LIMIT, SWEEP_CONCURRENCY } from '../src/config/sweep';
import { ALL_KINDS, KIND_SPECS } from '../src/config/kinds';

const [limitArg, identityArg] = process.argv.slice(2);
const relayLimit = Number(limitArg ?? '120');
const author = identityArg === undefined ? null : parseIdentity(identityArg).hex;

const started = Date.now();
const directory = await fetchDirectory();
console.log(
  `directory: ${directory.relays.length} relays in ${Date.now() - started}ms`,
  directory.sources.map((source) => `${source.relay}=${source.events}`).join(' '),
);

const now = Date.now();
const clearnet = directory.relays.filter(
  (relay) => relay.network === 'clearnet' && !isStale(relay, now),
);
// Spread across the alphabetised directory rather than taking the head, which
// would sample one hoster's relays over and over.
const step = Math.max(1, Math.floor(clearnet.length / relayLimit));
const sample = clearnet.filter((_, index) => index % step === 0).slice(0, relayLimit);

const results: RelayResult[] = [];
const sweepStarted = Date.now();
await runSweep(
  sample,
  {
    author,
    kinds: [...ALL_KINDS],
    sampleLimit: DEFAULT_SAMPLE_LIMIT,
    includeDarknet: false,
    includeStale: false,
  },
  { concurrency: SWEEP_CONCURRENCY, signal: new AbortController().signal },
  {
    onResult: (result) => results.push(result),
    onProgress: (done, total) => {
      if (done % 50 === 0) console.log(`  ${done}/${total}`);
    },
  },
);
const elapsed = Date.now() - sweepStarted;

const totals = totalsOf(results);
console.log(`\nswept ${results.length} relays in ${(elapsed / 1000).toFixed(1)}s`, totals);

const methods = { count: 0, sample: 0, none: 0 };
for (const result of results) {
  for (const kind of Object.values(result.kinds)) methods[kind.method] += 1;
}
console.log('count method per kind-query:', methods);

console.log('\ntop relays by events held:');
for (const result of [...results]
  .filter((entry) => entry.total !== null)
  .sort((a, b) => (b.total ?? 0) - (a.total ?? 0))
  .slice(0, 12)) {
  const cells = KIND_SPECS.map((spec) => {
    const kind = result.kinds[spec.kind];
    if (!kind) return `${spec.label}:-`;
    if (kind.count === null) return `${spec.label}:${kind.status}`;
    return `${spec.label}:${kind.approx ? '≥' : ''}${kind.count}`;
  }).join(' ');
  console.log(`  ${result.url.padEnd(40)} ${cells}`);
}

const forged = results.flatMap((result) =>
  Object.values(result.kinds)
    .filter((kind) => kind.newest?.verified === false)
    .map((kind) => `${result.url} kind ${kind.kind}`),
);
console.log('\nrelays serving unverifiable events:', forged.length ? forged : 'none');
process.exit(0);
