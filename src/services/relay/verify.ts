/**
 * The signature check, in one place.
 *
 * Existed twice — once in the sweep, once in the raw-event view — with the
 * same six lines and two differently-worded rationales. It is the single claim
 * this app makes about authenticity ("this event really is from that
 * identity"), and the grid's verdict and the JSON viewer's badge disagreeing
 * because one copy drifted is the worst outcome available to it.
 */
import { verifyEvent } from 'nostr-tools/pure';

import type { RelayEvent } from '@/services/relay/socket';

/**
 * Does this event's signature match its pubkey?
 *
 * Never throws. `nostr-tools` raises on malformed hex rather than returning
 * false, and malformed hex is exactly what an untrusted relay sends — so a
 * forged event must read as "not verified", not as a crashed sweep.
 */
export function verifySignature(event: RelayEvent): boolean {
  try {
    return verifyEvent(event);
  } catch {
    return false;
  }
}
