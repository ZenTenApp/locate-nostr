import { describe, expect, it } from 'vitest';

import { absoluteTime, compactCount, duration, since } from './format';

describe('absoluteTime', () => {
  it('names the day and the clock time, which "2h ago" cannot', () => {
    // Locale-dependent by design — it is read against the user's own clock —
    // so this pins the parts rather than one exact string.
    const text = absoluteTime(Date.UTC(2026, 7, 19, 9, 32));
    expect(text).toMatch(/2026/);
    expect(text).toMatch(/Aug/i);
    expect(text).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe('since', () => {
  it('reads as an age', () => {
    const now = Date.UTC(2026, 7, 19, 12, 0, 0);
    expect(since(now / 1000 - 90, now)).toBe('1m ago');
    expect(since(now / 1000 - 7200, now)).toBe('2h ago');
    expect(since(now / 1000 - 3 * 86_400, now)).toBe('3d ago');
  });

  it('never reports the future as a negative age', () => {
    const now = Date.UTC(2026, 7, 19, 12, 0, 0);
    // Clock skew between this machine and a relay is routine, and "-4s ago"
    // reads as a bug in the app rather than as a difference of clocks.
    expect(since(now / 1000 + 60, now)).toBe('0s ago');
  });
});

describe('compactCount', () => {
  it('keeps small numbers exact and abbreviates the wide ones', () => {
    expect(compactCount(0)).toBe('0');
    expect(compactCount(999)).toBe('999');
    expect(compactCount(1500)).toBe('1.5k');
    expect(compactCount(24_057)).toBe('24k');
    expect(compactCount(3_047_606)).toBe('3.0M');
  });
});

describe('duration', () => {
  it('switches units so a three-minute run does not read as 234000', () => {
    expect(duration(450)).toBe('450ms');
    expect(duration(8_400)).toBe('8s');
    expect(duration(234_000)).toBe('3m 54s');
  });
});
