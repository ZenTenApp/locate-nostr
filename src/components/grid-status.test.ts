import { describe, expect, it } from 'vitest';

import { gridStatusFor } from './grid-status';

describe('gridStatusFor', () => {
  it('says it is finding relays while the list is still being fetched', () => {
    // The case that used to read "No relay matches these filters" — before any
    // relay existed to match, and before the user had set a filter.
    expect(
      gridStatusFor({ relayCount: 0, resultCount: 0, directoryLoading: true, running: false }),
    ).toBe('finding-relays');
  });

  it('blames the trackers, not the filters, when no list came back', () => {
    expect(
      gridStatusFor({ relayCount: 0, resultCount: 0, directoryLoading: false, running: false }),
    ).toBe('no-relays');
  });

  it('says a check is in progress when nothing matches yet', () => {
    expect(
      gridStatusFor({ relayCount: 1339, resultCount: 12, directoryLoading: false, running: true }),
    ).toBe('checking');
  });

  it('only blames the filters once a check has actually answered', () => {
    expect(
      gridStatusFor({
        relayCount: 1339,
        resultCount: 1339,
        directoryLoading: false,
        running: false,
      }),
    ).toBe('idle');
  });

  it('says nothing has been checked yet rather than blaming the filters', () => {
    // First load: relays known, nothing asked of them. The grid is empty
    // because `holds something` is on by default, not because the answer
    // came back empty.
    expect(
      gridStatusFor({ relayCount: 1339, resultCount: 0, directoryLoading: false, running: false }),
    ).toBe('not-checked');
  });

  it('reports work in flight over a stale list rather than a filter miss', () => {
    // A refresh with relays already on screen from cache: still working.
    expect(
      gridStatusFor({
        relayCount: 1339,
        resultCount: 1339,
        directoryLoading: true,
        running: false,
      }),
    ).toBe('idle');
    expect(
      gridStatusFor({ relayCount: 1339, resultCount: 1339, directoryLoading: true, running: true }),
    ).toBe('checking');
  });
});
