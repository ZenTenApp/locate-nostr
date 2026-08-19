/**
 * Relay URL canonicalisation.
 *
 * URLs reach this app from two untrusted places: the `d` tag of a monitor's
 * NIP-66 event, and whatever the user pastes. Both are normalised here so the
 * same relay is one row rather than three — monitors report `wss://x`,
 * `wss://x/` and `wss://X/` for the same host, and a directory that treats
 * those as distinct sweeps the same relay three times.
 *
 * Adapted from `chat/src/services/nostr/relay-urls.ts`. It differs in one
 * deliberate way: `ws://` is accepted. That app refuses cleartext because it
 * ships an AUTH challenge over the socket; this one signs nothing and sends no
 * secret. Several dozen relays the monitors report are plain `ws://` — mostly
 * bare IPs and self-hosted boxes on odd ports, plus the onion and i2p
 * addresses — and excluding them would be a hole in a tool whose whole claim
 * is completeness. Note they are unreachable from an `https:` page anyway, as
 * mixed content; see the README.
 */

export class InvalidRelayUrlError extends Error {}

export interface ParsedRelayUrl {
  /** Canonical form — what everything else keys on. */
  url: string;
  host: string;
  secure: boolean;
  /** `.onion` and `.i2p` hosts cannot be reached from an ordinary browser, so
   *  the sweep skips them unless the user is running a proxying browser and
   *  turns them back on. */
  network: 'clearnet' | 'tor' | 'i2p';
}

/**
 * Does this look like a host rather than a word?
 *
 * `new URL('wss://relay')` succeeds — a single label is a legal host — so
 * without this, pasting a sentence adds one relay per word. Measured on the
 * obvious case: "not a relay" became `wss://not`, `wss://a` and `wss://relay`,
 * three sockets to nowhere on every sweep. A dot, an IPv6 literal or the
 * loopback name is required; everything a real relay list contains has one.
 */
function isPlausibleHost(hostname: string): boolean {
  if (hostname === 'localhost') return true;
  if (hostname.startsWith('[')) return true;
  return hostname.includes('.');
}

/**
 * Longest relay URL accepted.
 *
 * Every other relay-controlled string is capped — the NIP-11 name at 64, the
 * software at 40, a refusal message at 160 — because all of them are rendered.
 * The URL was the exception, and it comes from a stranger's `d` tag and is
 * rendered in the grid, the detail header and every tooltip. Generous: the
 * longest real relay in the directory is well under a hundred characters.
 */
const MAX_URL_LENGTH = 512;

export function parseRelayUrl(input: string): ParsedRelayUrl {
  const trimmed = input.trim();
  if (trimmed === '') throw new InvalidRelayUrlError('Enter a relay URL');
  if (trimmed.length > MAX_URL_LENGTH) throw new InvalidRelayUrlError('Relay URL is absurdly long');

  let parsed: URL;
  try {
    parsed = new URL(trimmed.includes('://') ? trimmed : `wss://${trimmed}`);
  } catch {
    throw new InvalidRelayUrlError('Not a valid URL');
  }

  if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') {
    throw new InvalidRelayUrlError('A relay URL is wss:// or ws://');
  }
  if (parsed.hostname === '') throw new InvalidRelayUrlError('Missing hostname');
  if (!isPlausibleHost(parsed.hostname)) {
    throw new InvalidRelayUrlError('Not a hostname');
  }

  // Relays advertise themselves with and without a trailing slash; dropping it
  // keeps one relay from occupying two rows.
  const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
  const host = parsed.host.toLowerCase();

  return {
    url: `${parsed.protocol}//${host}${path}`,
    host,
    secure: parsed.protocol === 'wss:',
    network: host.endsWith('.onion') ? 'tor' : host.endsWith('.i2p') ? 'i2p' : 'clearnet',
  };
}

/** Parse and drop what does not parse. Used on monitor output and on pasted
 *  text, where one malformed entry must not cost the rest of the list. */
function parseRelayUrls(candidates: readonly unknown[]): ParsedRelayUrl[] {
  const byUrl = new Map<string, ParsedRelayUrl>();
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    try {
      const parsed = parseRelayUrl(candidate);
      byUrl.set(parsed.url, parsed);
    } catch {
      // Silent: a monitor reporting one bad `d` tag is routine.
    }
  }
  return [...byUrl.values()];
}

/** Splits pasted text on whitespace, commas and newlines. */
export function parsePastedRelays(text: string): ParsedRelayUrl[] {
  return parseRelayUrls(text.split(/[\s,]+/).filter((entry) => entry !== ''));
}

/**
 * The same relay over HTTP, which is the address a person can actually open.
 *
 * `wss://` is not a scheme a browser will navigate to, so a relay URL shown as
 * a link has to be translated. The HTTP form of a relay is also where its
 * NIP-11 document lives and, for most relays, a landing page — so it is the
 * honest target for "show me this relay" rather than a third-party directory
 * that may not list it.
 */
export function relayHttpUrl(url: string): string {
  return url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
}

/** A relay URL shortened for a table cell. Never for anything that connects —
 *  the full URL is what a socket needs and what identifies the relay. */
export function relayHost(url: string): string {
  return url.replace(/^wss:\/\//, '').replace(/^ws:\/\//, 'ws://');
}
