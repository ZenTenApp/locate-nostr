/**
 * Reading whatever the user pasted into the identity box as a pubkey.
 *
 * Four things get pasted in practice: hex, `npub1…`, `nprofile1…` (which
 * carries relay hints as well as the key) and an `nostr:`-prefixed version of
 * any of them. All four mean the same identity, and refusing three of them
 * because the fourth is canonical is a bad trade for a search box.
 */
import { decode, npubEncode } from 'nostr-tools/nip19';

export class InvalidIdentityError extends Error {}

export interface Identity {
  hex: string;
  npub: string;
  /** Relays the `nprofile` suggested, if any. They are offered as paste
   *  candidates rather than swept silently — a hint is the author's claim
   *  about where to look, which is one of the things being checked. */
  hints: string[];
}

const HEX_64 = /^[0-9a-f]{64}$/i;

export function parseIdentity(input: string): Identity {
  const trimmed = input.trim().replace(/^nostr:/i, '');
  if (trimmed === '') throw new InvalidIdentityError('Enter an npub or hex pubkey');

  if (HEX_64.test(trimmed)) {
    const hex = trimmed.toLowerCase();
    return { hex, npub: npubEncode(hex), hints: [] };
  }

  let decoded;
  try {
    decoded = decode(trimmed);
  } catch {
    throw new InvalidIdentityError('Not an npub, nprofile or 64-character hex key');
  }

  if (decoded.type === 'npub') {
    return { hex: decoded.data, npub: trimmed, hints: [] };
  }
  if (decoded.type === 'nprofile') {
    return {
      hex: decoded.data.pubkey,
      npub: npubEncode(decoded.data.pubkey),
      hints: decoded.data.relays ?? [],
    };
  }
  // note1, nevent, naddr and friends decode fine and are not identities.
  throw new InvalidIdentityError(`That is a ${decoded.type}, not a pubkey`);
}

/** `npub1abc…wxyz`, for a header where the whole key is noise. */
export function shortIdentity(npub: string): string {
  return npub.length <= 20 ? npub : `${npub.slice(0, 10)}…${npub.slice(-6)}`;
}
