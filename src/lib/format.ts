/** Display helpers. Pure, so the grid can call them per cell without care. */

/** `1234` → `1.2k`. Counts run from 0 to seven figures in the same column, so
 *  the wide ones are abbreviated rather than allowed to set the column width. */
export function compactCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

/** `93000` → `1m 33s`. */
export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

/**
 * A timestamp as a date and time a person can check against their own clock.
 *
 * "1h ago" is the right thing to read at a glance and the wrong thing to trust
 * a decision to: a saved result reloaded the next morning still says "16h
 * ago", which is true and tells you nothing about whether it predates the
 * thing you are investigating. Both are shown together for that reason.
 */
export function absoluteTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Seconds-since-epoch → `3h ago`, for an event's `created_at` and for how
 *  old the directory is. */
export function since(unixSeconds: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round(now / 1000 - unixSeconds));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}
