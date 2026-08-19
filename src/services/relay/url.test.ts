import { describe, expect, it } from 'vitest';

import {
  InvalidRelayUrlError,
  parseRelayUrl,
  parsePastedRelays,
  relayHost,
  relayHttpUrl,
} from './url';

describe('parseRelayUrl', () => {
  it('canonicalises the forms monitors publish for the same relay', () => {
    const forms = ['wss://Relay.Example.com/', 'wss://relay.example.com', 'relay.example.com'];
    const urls = new Set(forms.map((form) => parseRelayUrl(form).url));
    expect([...urls]).toEqual(['wss://relay.example.com']);
  });

  it('keeps a path, since a relay can live on one', () => {
    expect(parseRelayUrl('wss://host.example/inbox/').url).toBe('wss://host.example/inbox');
  });

  it('accepts ws:// — unlike the chat app, nothing here is signed or secret', () => {
    const parsed = parseRelayUrl('ws://abc.onion');
    expect(parsed.secure).toBe(false);
    expect(parsed.network).toBe('tor');
  });

  it('rejects a non-relay scheme', () => {
    expect(() => parseRelayUrl('https://example.com')).toThrow(InvalidRelayUrlError);
  });

  it('rejects a bare word, which the URL parser would happily call a host', () => {
    expect(() => parseRelayUrl('relay')).toThrow(InvalidRelayUrlError);
  });

  it('still accepts localhost and an IPv6 literal', () => {
    expect(parseRelayUrl('ws://localhost:7777').url).toBe('ws://localhost:7777');
    expect(parseRelayUrl('wss://[2001:db8::1]:443').host).toContain('2001:db8::1');
  });
});

describe('parsePastedRelays', () => {
  it('splits on newlines, spaces and commas and drops what does not parse', () => {
    const parsed = parsePastedRelays('wss://a.example\n  wss://b.example, nonsense://c\n\n');
    expect(parsed.map((entry) => entry.url)).toEqual(['wss://a.example', 'wss://b.example']);
  });

  it('drops prose instead of turning every word into a relay', () => {
    expect(parsePastedRelays('paste your relays here, not a sentence')).toEqual([]);
  });

  it('deduplicates, so pasting a list twice sweeps each relay once', () => {
    expect(parsePastedRelays('wss://a.example wss://a.example/')).toHaveLength(1);
  });
});

describe('relayHost', () => {
  it('drops the scheme for wss and keeps it for ws, which is the surprising one', () => {
    expect(relayHost('wss://relay.example')).toBe('relay.example');
    expect(relayHost('ws://relay.example')).toBe('ws://relay.example');
  });
});

describe('relayHttpUrl', () => {
  it('translates a relay to the address a browser can open', () => {
    expect(relayHttpUrl('wss://relay.example/inbox')).toBe('https://relay.example/inbox');
  });

  it('keeps a cleartext relay cleartext rather than silently upgrading it', () => {
    // An http:// link that claims to be https:// would misreport what the
    // relay actually serves.
    expect(relayHttpUrl('ws://localhost:7777')).toBe('http://localhost:7777');
  });
});
