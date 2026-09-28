# NostrBox Locate

A relay search engine. It asks **every relay the Nostr network knows about** what it holds, for
the kinds [`chat`](../chat) depends on — profile, follow list, DMs, both relay lists, and NIP-38
status — and reports the counts relay by relay.

It answers one question: **where did this identity's data actually land?** For every relay on the
network it reports how much of each kind that identity has there, and how old the newest copy is.

An identity is required. A second mode that counted everything every relay holds from everyone was
removed: it cost the same three minutes, asked a question about relays rather than about anybody's
data, and produced a page of numbers with nothing to do about them.

Once you know where it is, you can ask for it to go: a **purge** sends signed NIP-09 delete requests
to the relays you pick — or to every relay except the ones you pick — and reports what each of them
said. See [Purge](#purge).

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

**Searching never signs anything, and nothing is ever stored.** A sweep is
anonymous, so the only thing it wants from a seed or an SSH key is the public
half: `pubkeyFromMnemonic` keeps the private key as a local, hands it to
`getPublicKey`, and zeroes it in a `finally` before returning. A caller cannot
hold it, leak it into a React state tree, or forget to wipe it, because it is
never handed over. For a user who only searches, the window in which a private
key exists is measured in microseconds and closes before a single relay socket
opens.

**Purging signs — see [Purge](#purge).** A NIP-09 delete request
is an event, and an event has to be signed by the identity whose data it names.
So `secretKeyFromMnemonic` and `secretKeyFromNsec` exist, they are the only two
functions in the app that produce a secret, and they are called from exactly
one place: inside the key worker, from `unlock`. The main thread cannot reach
them — `services/nostr/signer.ts` is the only door, and what comes back through
it is a pubkey and signed events. Nothing is written to disk in either case.

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

Anything the monitors miss can be pasted in under **Options → Your own relay list**; a pasted relay
that the monitors already report keeps its metadata, and one nobody reports is swept with everything
about it honestly marked unknown. A relay you list by hand is never skipped for looking dead, which
is what the stale filter does to a relay nobody asked about.

That list can also be the **whole** list. The toggle under the box switches between _add to the
tracker list_ and _check only these_, because they are two different questions: "where on the
network is my data" takes three minutes over thirteen hundred relays, and "is my data on these four
relays" is answered in seconds. Sweeping the network to find out about four relays was the cost
that stopped people asking.

## The `other` column

The six named kinds are the question this tool was built for. `other` is
everything else that identity has on a relay — notes, reactions, lists,
articles, anything without a column of its own.

It is **on by default**, and it is the most expensive column here: a seventh
subscription per relay, with no `kinds` filter on it. Off by default it was
invisible — no column, one dim chip at the end of a row — and "where did my
data land" answered by excluding everything that is not one of six kinds is
not an answer. Switching it off is one click when the faster sweep matters.

It is heavier because NIP-01 cannot express it. A filter says `kinds: [...]`;
there is no "anything but these". So `other` is asked as an **author-only
query** and sorted client-side, which has three consequences the interface
states rather than hides:

- **`COUNT` cannot answer it.** A NIP-45 count over an author-only filter
  counts the named kinds too, so the retry that turns `≥25` into `498,407` is
  skipped for this column. Its numbers are floors far more often than the
  others'.
- **A full sample of named kinds means _unknown_, not zero.** If the ceiling
  fills with profile and follow events, whatever is behind them is unseen — so
  the cell draws `?`, not `0`. Raising the fetch limit under Options, or
  opening the raw view, is how to see past it.
- **A named kind coming back is not the relay misbehaving.** The request
  carried no `kinds`, so a profile event is an honest answer that belongs to
  another column. It is marked as such in the raw view and never counted
  against the relay — without that rule, switching `other` on would put the
  red "ignoring filters" mark on every relay on the network.

Purging `other` works the same way and carries one extra rule: "everything
else" is not a kind, so the delete request cannot declare it up front. The
kinds are discovered as each relay answers and go into the request's `k` tags
as real numbers. The column's own sentinel kind never reaches the wire.

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

## Purge

The other half of "where did my data land" is "get it off there". A purge sends
**NIP-09 delete requests** (kind 5) to the relays you choose, for the kinds you
choose, and reports what each relay said.

Nothing about it is implicit:

- **It is behind a mode.** `Purge…` in the filter bar turns on purge mode; only then does the grid
  grow a tick column. A permanent delete checkbox on every row is a deletion one misclick away.
- **Targets are ticked, and the ticks mean whichever way round you say.** _only ticked_ purges the
  relays you tick; _all except ticked_ purges everything the current sweep covers except those —
  which is how "clear it everywhere but my own relays" stays a two-click operation rather than nine
  hundred ticks. The count beside the switch always names the relays that will be written to.
- **Ticks are a selection, not a view.** They survive paging, filtering, sorting and a re-check, and
  select-all adds the rows the filter bar currently matches rather than replacing what is already
  ticked. Ticks the filters hide are counted on the bar — a selection nobody can see is one nobody
  can check.
- **It reads before it writes.** Every target is asked what it holds for the chosen kinds, ids are
  unioned across all of them, and **one** set of requests is signed and sent to every relay. That is
  one approval prompt per chunk instead of one per relay, and it means a relay quietly holding a
  copy this app only found elsewhere still gets that event's id.
- **Only your own events are named.** A relay honours a deletion from the key that wrote the event
  and from nobody else, so the gather filters on `authors` alone — never the `#p` half of the DM
  union the sweep uses. Messages other people sent you are nobody's to delete but theirs.
- **Replaceable kinds also go by address.** An `a` tag (`kind:pubkey:d`) covers the copies this app
  was never served, including one written between the read and the request landing. Ticked
  individual events never get one: "delete this status" must not become "delete every status I have
  ever set".
- **A typed word, not a click.** `PURGE`, into a box, on a screen that names the identity, the
  relay count and the kinds first.

### What it does not claim

`OK true` means a relay **accepted** the request. NIP-09 does not oblige it to honour one, and this
app never prints "deleted". Three outcomes, three words: accepted, refused, and no answer — and the
third is not a failure but the absence of one, which is the same rule the sweep is built on. Copies
on relays outside the target list are untouched, and the screen says so. The only way to find out
what actually happened is to check again, which the dialog offers as a button.

### Signing

| Signer                    | Where the key is      | For how long                       |
| ------------------------- | --------------------- | ---------------------------------- |
| **Extension** (NIP-07)    | never in this app     | never — one approval per request   |
| **Recovery phrase / SSH** | inside its own worker | until the purge ends, then dropped |

The key signer runs in a **separate worker** from the one identity import uses, which is terminated
after every derivation and would otherwise take a live signing session with it. It is terminated —
key and all — when the purge finishes, when purge mode is left, when a different key is chosen,
when the raw-JSON view that unlocked it closes, and when the identity on screen changes. Every
route that can unlock a key has one that ends it.

**What the signer returns is checked before anything publishes it.** `window.nostr` is injected by
software this app does not control and is handed your key, so its answer is treated the way a
relay's is — untrusted until verified. `services/nostr/signer.ts` is the one door every signature
passes through, and it refuses an event that is not the template it was shown (kind, timestamp,
content and tags compared field by field), a signature that does not verify, and any kind other
than 5: a purge is the only thing here that signs, and that is enforced rather than assumed. The
verification runs against a plain copy of the event's own fields, because `nostr-tools` caches its
verdict on the object it checks and an object arriving pre-marked would skip the check entirely.

A signer whose pubkey is not the identity on screen is refused before a socket opens: a delete
request signed by the wrong key deletes nothing and puts that key on record having tried.

Single events can also be deleted from the raw-JSON view of one relay: tick the ones you want, and
the request names those ids, on that relay, and nothing wider.

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

Every sweep timing above was taken at 48 concurrent sockets. The shipped default is 4 — gentler on
the network, and slower in proportion; the concurrency slider under Options goes back up to 96.

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
    purge/      NIP-09 request building, target resolution, the purge engine
    nostr/      npub/nprofile parsing, NIP-07 extension, key import, the signer facade
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
