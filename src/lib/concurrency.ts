/**
 * Bounded-concurrency runner.
 *
 * `Promise.all` over the directory would open thirteen hundred sockets at
 * once; a sequential loop would take the sum of every relay's timeout. This
 * runs a fixed number of workers over a shared cursor, which bounds the open
 * socket count while still overlapping the slow relays.
 *
 * Ported from `chat/src/lib/concurrency.ts`. The worker count is fixed for the
 * life of a call: the sweep reads the concurrency setting once when it starts,
 * so moving the slider mid-run changes nothing until the next run. That is
 * deliberate — a slider drag must not silently apply to half the list.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let cursor = 0;

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      // Checked per item rather than per batch, so a cancel takes effect at
      // the next relay instead of after the whole sweep.
      if (signal?.aborted) return;

      const item = items[index];
      if (item === undefined) continue;
      try {
        await worker(item);
      } catch {
        // One failed relay must not abandon the rest of the sweep.
      }
    }
  });

  await Promise.all(runners);
}
