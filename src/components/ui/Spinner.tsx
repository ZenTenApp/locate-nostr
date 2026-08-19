/**
 * A working indicator, for the two waits long enough to look like a fault:
 * building the relay list (~20s) and a full check (minutes).
 *
 * A bare CSS ring rather than an icon dependency — it is one border and a
 * rotation. `motion-reduce` honours the OS setting; a spinner is decoration,
 * and the text beside it carries the meaning.
 */
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Working"
      className={`inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-surface-border border-t-brand-primary motion-reduce:animate-none ${className}`}
    />
  );
}
