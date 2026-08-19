# Locate

A relay search engine. It asks **every relay the Nostr network knows about** what it holds, for
the kinds [`chat`](../chat) depends on — profile, follow list, DMs, both relay lists, and NIP-38
status — and reports the counts relay by relay.

It answers one question: **where did this identity's data actually land?** For every relay on the
network it reports how much of each kind that identity has there, and how old the newest copy is.

An identity is required. A second mode that counted everything every relay holds from everyone was
removed: it cost the same three minutes, asked a question about relays rather than about anybody's
data, and produced a page of numbers with nothing to do about them.

The whole thing runs in the browser. There is no backend, no API key and no account: the page opens
a socket to each relay itself, and the results are cached in IndexedDB so a repeat search paints
instantly and can say what changed since last time.

## Identity: four ways in

The app needs one thing to run — a public key. It can be typed, or proved:

| Source              | What you give it                              | Where the private key lives                     |
| ------------------- | --------------------------------------------- | ----------------------------------------------- |
| **npub / hex**      | `npub1…`, `nprofile1…`, or 64 hex characters  | nowhere — nothing secret is involved            |
| **Extension**       | one approval in your NIP-07 signer            | never leaves the extension                      |
| **Recovery phrase** | 12 or 24 BIP39 words, or an `nsec`            | inside the key worker, for one synchronous call |
| **SSH key**         | an encrypted OpenSSH Ed25519 key + passphrase | inside the key worker, for one synchronous call |

**This app never signs anything and never stores a key.** It sweeps relays
anonymously, so the only thing it wants from a seed or an SSH key is the public
half. So no function in `services/crypto/nip06.ts` returns a secret: the
private key exists as a local, is consumed by `getPublicKey`, and is zeroed in
a `finally` before the call returns. A caller cannot hold it, leak it into a
React state tree, or forget to wipe it, because it is never handed over. The
window in which a private key exists is measured in microseconds, and it closes
before a single relay socket opens.

What cannot be wiped in place — the PEM, the passphrase, the mnemonic — are
immutable strings that `postMessage` cloned into the worker heap. The worker is
therefore **terminated after every derivation**, successful or not; dropping
the heap is the only way to reclaim them. Secrets also never enter React state,
only refs and DOM nodes, because state is retained in the Fiber tree and
printed by devtools.

Secret fields opt out of autofill, password managers, spellcheck and writing
assistants by name. That last one is not theoretical: Grammarly attached itself
to the SSH key textarea during development and would have **uploaded a private
key** for analysis. See `SECRET_PROPS` in `components/ui/Field.tsx`.

Unlike `chat`, a key with **no passphrase is accepted**. That app refuses one because it stores the
PEM in `localStorage` so the user can sign in again, and a passphrase-less key kept in the clear
there hands the identity to anything that can read the origin's storage. This app stores nothing —
the key is read once, in a worker, and zeroed — so refusing a key the user already keeps
unencrypted on their own disk would buy no safety and simply lock them out. The dialog says so
rather than staying silent about it.

The SSH path is `chat`'s, ported whole with its test vectors: the same key
yields the same identity in both apps, verified against `ssh-keygen -y` and
against the mnemonic `usdt-pay`'s React Native original derives. A tool that
derived a _different_ pubkey than the app that wrote the data would confidently
report that your data is nowhere.

### Why an extension works here and not in `chat`

`chat` cannot support NIP-07 and explains why at length: its joint-account
groups are derived from a raw ECDH secret that an extension will never expose.
This app has the opposite requirement — a public key and nothing else — so the
thing that rules extensions out there makes them the _best_ option here, and
they are listed first.

## Where the relay list comes from

**NIP-66 relay discovery (kind 30166).** Monitors continuously probe the network and publish one
event per relay they watch; the event carries the relay's URL, its supported NIPs, whether it
demands AUTH or payment, a measured round-trip and its whole NIP-11 document. Three monitoring
relays are queried and their answers unioned — see `DISCOVERY_RELAYS`.

This replaced the nostr.watch HTTP API, which no longer works: `api.nostr.watch/v1/online` answers
`502` and `api.nostr.watch/v2/relays` answers `402 Payment Required` (checked August 2026). NIP-66
is the better source anyway — the NIP list and the AUTH flags arrive with the URL, so building the
directory costs one subscription rather than 1,500 cross-origin fetches.

Anything the monitors miss can be pasted in under **Options → Extra relays**; a pasted relay that
the monitors already report keeps its metadata, and one nobody reports is swept with everything
about it honestly marked unknown.

## What a count means

A relay is asked in one of two ways, and the grid always says which:

- **`COUNT`** (NIP-45) — the relay's own index answers. Exact.
- **sample** — a bounded `REQ`, counted client-side. Exact below the sample ceiling, a **floor** at
  it, shown as `≥25`. A capped sample is followed by one `COUNT` attempt even when the relay does
  not advertise NIP-45, because the monitors' NIP lists are incomplete and the retry is what turns
  `≥25` into `498,407`.

Three rules the engine will not bend:

1. **An unanswered question is never an answer of zero.** A timeout, an AUTH demand and a payment
   demand each get their own cell state (`⏱`, `🔒`, `💸`). Rendering any of them as `0` would tell a
   user their data is gone when the relay simply refused to look.
2. **The relay is not trusted.** Everything returned is re-checked against the filter it was sent;
   a relay that ignores `authors` or `kinds` gets a red dot and is counted in "ignoring filters"
   rather than ranked as the richest relay on the network. In identity mode the newest event per
   kind has its **signature verified** — a relay serving a forged kind 0 under someone's pubkey is
   indistinguishable from an honest one in every other view. (One such relay was found on the live
   network during development.)
3. **Kind 4 counts are floors.** A correct relay serves a DM only to its author or its `p`-tagged
   recipient, and this app never authenticates. A relay that hands DMs to an anonymous reader is
   the finding, not a bug in the sweep.

In identity mode kind 4 is queried as a union of `authors` and `#p`, so "your DMs" means the ones
you sent _and_ the ones addressed to you, counted once each.

## Measurements

Everything in `src/config/sweep.ts` is a claim about the real network. Re-measure with:

```
npx vite-node scripts/live-check.ts -- [relayCount] [npub]
```

August 2026, from a residential connection:

| Measurement                               | Value                                                       |
| ----------------------------------------- | ----------------------------------------------------------- |
| Relays in the directory                   | 1,679 (1,353 clearnet and fresh)                            |
| Directory build, cold                     | ~24s paged — 1,306 relays unpaged, 1,567 at 8 pages         |
| Full census sweep, 1,353 relays (Node)    | **79s** at 48 concurrent sockets                            |
| Full census sweep, 1,339 relays (Chrome)  | **3m 54s** — browsers queue TLS handshakes                  |
| Relays that answered                      | 1,304 · 49 unreachable (2.8% in Chrome)                     |
| Relays carrying at least one queried kind | 1,007                                                       |
| Events found (summed across relays)       | 36.8M                                                       |
| Relays demanding AUTH for some kind       | 86                                                          |
| Relays returning off-filter events        | 4                                                           |
| NIP-45 `COUNT` answered                   | 49% of kind-queries (3,323 of 6,798 after the sample retry) |

The connect timeout is the number to be careful with. At 4s a full in-browser sweep called **275
of 1,339 relays unreachable**; at 9s the same sweep called **38** unreachable, matching what Node
sees with no socket queue in front of it. The other ~19% were alive the whole time.

## Wording

The interface deliberately does not use this document's vocabulary. On screen
it is "check", not "sweep"; "profile", "follows", "messages", "inbox", not
"kind 0/3/4/10050"; "trackers", not "NIP-66 monitors"; "want you signed in",
not "auth-gated". A user came to the app to find their data, not to learn the
protocol, and every one of those terms was invented here or borrowed from a
spec rather than being something they already knew.

The precise terms are still one hover away, in tooltips, and the code keeps
them throughout — `sweep`, `kind`, `monitor` and `census` remain the names in
`src/`. The split is intentional: code says what it means to a maintainer, the
screen says what it means to a visitor.

## Development

```
npm run dev        # vite dev server
npm run typecheck  # tsc -b
npm run lint       # eslint, zero warnings tolerated
npm test           # vitest
npm run build      # typecheck + production bundle into dist/
```

`scripts/live-check.ts` runs a real sweep from the command line. It is deliberately **not** part of
`npm test`: it opens hundreds of sockets to strangers' hosts and its result depends on who is up.

## Deploying to locate.nostr.box

`npm run build` produces a fully static `dist/` — no server, no environment variables. Upload it to
any static host and point `locate.nostr.box` at it.

Two things the host must not break:

- **The CSP in `index.html`** ships with the page, so it applies even where response headers cannot
  be set. `connect-src` allows `wss:`/`ws:` (the entire point) and `https:` (NIP-11); `script-src`
  is `'self'` plus the `chrome-extension:` and `moz-extension:` schemes, which is how a NIP-07
  signer injects `window.nostr` — no remote origin can match those, so no third-party script from
  the network is admitted. A host that injects an analytics script will break the page rather than
  be silently allowed.
- **`ws:` connections from an `https:` page are blocked as mixed content** by every browser. The
  ~40 relays the monitors report over plain `ws:` are therefore unreachable from the deployed site
  and will show as unreachable; they resolve only when the page is served over plain HTTP, which is
  not worth doing. Tor and i2p relays are off by default for the same class of reason.

## Layout

```
src/
  config/       kinds swept, sweep tuning, design tokens
  lib/          concurrency, formatting, logging
  services/
    relay/      URL canonicalisation; a minimal hand-rolled NIP-01 socket client
    discovery/  NIP-66 parsing and directory assembly
    sweep/      filters, engine, diff, result types
    nostr/      npub/nprofile parsing, NIP-07 extension, the key-import facade
    crypto/     NIP-06 derivation — returns public keys only, by construction
    ssh/        OpenSSH Ed25519 import (ported from `chat`, with its vectors)
    worker/     the key worker: every blocking derivation, terminated after use
    cache/      IndexedDB, best-effort
  stores/       the sweep run and everything it produces
  hooks/        row filtering and sorting
  components/   grid, cells, panels
```

`nostr-tools`' `SimplePool` is deliberately **not** used for the sweep. It verifies the signature of
every event it receives — 150k schnorr checks for numbers that only need counting — and keeps
relays in a shared map with reconnect and idle handling, which is the opposite of what a bounded
sweep needs. It is still used for `nip19` and for the one verification that matters. See the header
of `src/services/relay/socket.ts`.
