/**
 * What a delete request names — the part that decides whether a purge deletes
 * anything at all.
 *
 * Worth testing without a socket because every failure here is silent on the
 * wire: a request with the wrong tags is accepted by a relay, answered
 * `OK true`, and removes nothing. The live network is not somewhere to find
 * that out.
 */
import { describe, expect, it } from 'vitest';

import { DELETE_KIND, PURGE_IDS_PER_EVENT } from '@/config/purge';

import { deleteRequests, deleteRequestsForIds } from './nip09';

const AUTHOR = 'a'.repeat(64);
const NOW = 1_770_000_000;

function tags(template: { tags: string[][] }, name: string): string[] {
  return template.tags.filter((tag) => tag[0] === name).map((tag) => tag[1] ?? '');
}

describe('deleteRequests', () => {
  it('names every id it was given, as a kind-5 request', () => {
    const [request] = deleteRequests(
      { author: AUTHOR, ids: ['1'.repeat(64), '2'.repeat(64)], kinds: [4], reason: 'why' },
      NOW,
    );
    expect(request?.kind).toBe(DELETE_KIND);
    expect(request?.created_at).toBe(NOW);
    expect(request?.content).toBe('why');
    expect(tags(request!, 'e')).toEqual(['1'.repeat(64), '2'.repeat(64)]);
    expect(tags(request!, 'k')).toEqual(['4']);
  });

  it('adds an address for a replaceable kind, so copies nobody served go too', () => {
    const [request] = deleteRequests(
      { author: AUTHOR, ids: [], kinds: [0, 10002], reason: '' },
      NOW,
    );
    expect(tags(request!, 'a')).toEqual([`0:${AUTHOR}:`, `10002:${AUTHOR}:`]);
  });

  it('uses the d tag of an addressable kind, not an empty one', () => {
    const [request] = deleteRequests({ author: AUTHOR, ids: [], kinds: [30315], reason: '' }, NOW);
    expect(tags(request!, 'a')).toEqual([`30315:${AUTHOR}:general`]);
  });

  it('never addresses a regular kind — that would delete every event of it', () => {
    // An `a` tag of `4:<pubkey>:` asks a relay to drop every DM the author
    // ever wrote, anywhere, which is not what any screen in this app offers.
    const [request] = deleteRequests(
      { author: AUTHOR, ids: ['1'.repeat(64)], kinds: [4], reason: '' },
      NOW,
    );
    expect(tags(request!, 'a')).toEqual([]);
  });

  it('chunks ids, repeating the shared tags on every chunk', () => {
    const ids = Array.from({ length: PURGE_IDS_PER_EVENT + 5 }, (_, index) =>
      String(index).padStart(64, '0'),
    );
    const requests = deleteRequests({ author: AUTHOR, ids, kinds: [0], reason: '' }, NOW);

    expect(requests).toHaveLength(2);
    expect(tags(requests[0]!, 'e')).toHaveLength(PURGE_IDS_PER_EVENT);
    expect(tags(requests[1]!, 'e')).toHaveLength(5);
    // A purge where only the first chunk arrives must still be a complete,
    // meaningful request.
    for (const request of requests) expect(tags(request, 'a')).toEqual([`0:${AUTHOR}:`]);
    expect(requests.flatMap((request) => tags(request, 'e'))).toHaveLength(ids.length);
  });

  it('builds nothing when there is nothing to name', () => {
    expect(deleteRequests({ author: AUTHOR, ids: [], kinds: [4], reason: '' }, NOW)).toEqual([]);
  });
});

describe('deleteRequestsForIds', () => {
  it('names the ticked events and widens to nothing else', () => {
    const [request] = deleteRequestsForIds(
      { author: AUTHOR, ids: ['1'.repeat(64)], kinds: [0], reason: '' },
      NOW,
    );
    expect(tags(request!, 'e')).toEqual(['1'.repeat(64)]);
    expect(tags(request!, 'k')).toEqual(['0']);
    // Kind 0 is replaceable, and the wholesale purge would address it here.
    // Ticking one event must not become "delete every profile I ever wrote".
    expect(tags(request!, 'a')).toEqual([]);
  });
});
