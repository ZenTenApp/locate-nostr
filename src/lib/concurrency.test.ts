import { describe, expect, it } from 'vitest';

import { runWithConcurrency } from './concurrency';

/** Resolves on the next macrotask, so overlap is observable. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('runWithConcurrency', () => {
  it('never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    await runWithConcurrency(
      Array.from({ length: 50 }, (_, i) => i),
      5,
      async () => {
        running += 1;
        peak = Math.max(peak, running);
        await tick();
        running -= 1;
      },
    );
    expect(peak).toBe(5);
  });

  it('visits every item', async () => {
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      await tick();
      seen.push(item);
    });
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps going when one item throws', async () => {
    // One dead relay must not abandon the other thirteen hundred.
    const done: number[] = [];
    await runWithConcurrency([1, 2, 3], 2, async (item) => {
      if (item === 2) throw new Error('relay exploded');
      done.push(item);
    });
    expect([...done].sort()).toEqual([1, 3]);
  });

  it('stops taking new items once aborted', async () => {
    const controller = new AbortController();
    const done: number[] = [];
    await runWithConcurrency(
      Array.from({ length: 100 }, (_, i) => i),
      2,
      async (item) => {
        done.push(item);
        if (done.length === 4) controller.abort();
        await tick();
      },
      controller.signal,
    );
    // Checked per item rather than per batch, so a cancel lands within one
    // item per worker rather than after the whole list.
    expect(done.length).toBeLessThan(10);
    expect(done.length).toBeGreaterThanOrEqual(4);
  });

  it('does not spawn more workers than there are items', async () => {
    let started = 0;
    await runWithConcurrency([1], 48, async () => {
      started += 1;
    });
    expect(started).toBe(1);
  });

  it('handles an empty list without hanging', async () => {
    await expect(runWithConcurrency([], 4, async () => undefined)).resolves.toBeUndefined();
  });
});
