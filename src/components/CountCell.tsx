/**
 * One kind, on one relay.
 *
 * The cell has to say four things at once in about seventy pixels: how much,
 * how sure, whether the relay refused, and whether it changed since last time.
 * Magnitude is carried by the fill so a thousand rows can be read as a shape;
 * the number is the exact answer for whoever stops on it; and everything that
 * does not fit — which is most of it, for the glyph cells — is in the tooltip.
 *
 * The tooltip is this app's own, not the browser's `title`: these cells are
 * single characters whose whole meaning is in that text, and a hover that
 * arrives a second late and unstyled is not good enough for it. See
 * `ui/Tooltip.tsx`.
 */
import type { KindSpec } from '@/config/kinds';
import { compactCount } from '@/lib/format';
import type { KindDelta } from '@/services/sweep/diff';
import type { KindResult } from '@/services/sweep/types';
import { tooltipText } from '@/stores/tooltip-store';
import { cellTooltip, pendingTooltip, unreachableTooltip } from '@/components/cell-tooltip';
import { tooltipHandlers } from '@/components/ui/tooltip-handlers';

/** Fill by order of magnitude. Boundaries are decades because relay holdings
 *  span seven of them — a linear scale would be one colour for everything. */
function fillFor(count: number): string {
  if (count === 0) return 'bg-cell-none';
  if (count < 10) return 'bg-cell-trace';
  if (count < 100) return 'bg-cell-some';
  if (count < 1000) return 'bg-cell-many';
  return 'bg-cell-lots';
}

/** Refusals and failures render as a glyph rather than a number: a lock is not
 *  a zero, and showing one as the other is the mistake this whole app exists
 *  to avoid. What each glyph means is in the tooltip. */
const STATUS_GLYPH: Record<string, { glyph: string; tone: string }> = {
  auth: { glyph: '🔒', tone: 'text-state-warning' },
  payment: { glyph: '💸', tone: 'text-state-warning' },
  restricted: { glyph: '⊘', tone: 'text-state-warning' },
  timeout: { glyph: '⏱', tone: 'text-ink-muted' },
  error: { glyph: '!', tone: 'text-state-error' },
};

export function CountCell({
  spec,
  result,
  delta,
  pending,
}: {
  spec: KindSpec;
  result: KindResult | undefined;
  delta: KindDelta | undefined;
  /** The relay has not been reached yet in this run. */
  pending: boolean;
}) {
  if (pending) {
    const content = pendingTooltip(spec);
    return (
      <div
        {...tooltipHandlers(content)}
        aria-label={tooltipText(content)}
        className="text-center text-sm text-ink-muted/40"
      >
        ·
      </div>
    );
  }

  if (!result) {
    const content = unreachableTooltip(spec);
    return (
      <div
        {...tooltipHandlers(content)}
        aria-label={tooltipText(content)}
        className="text-center text-sm text-ink-muted"
      >
        —
      </div>
    );
  }

  const content = cellTooltip(spec, result, delta);
  const handlers = tooltipHandlers(content);
  const label = tooltipText(content);
  const status = STATUS_GLYPH[result.status];

  if (status && (result.count ?? 0) === 0) {
    return (
      <div {...handlers} aria-label={label} className={`text-center text-sm ${status.tone}`}>
        {status.glyph}
      </div>
    );
  }

  const count = result.count ?? 0;
  const change = delta?.delta ?? 0;
  /**
   * A change *from nothing* is not growth, and `+10` beside a total of 10
   * reads as "ten new ones" when it means "all ten of these are new here".
   * Shown as a mark rather than a number, with the sentence in the tooltip.
   */
  const appeared = change > 0 && delta?.before === 0;
  const changed = change !== 0 && !appeared;

  return (
    <div
      {...handlers}
      aria-label={label}
      className={`relative rounded-sm py-0.5 text-center font-mono text-sm ${fillFor(count)} ${
        count === 0 ? 'text-ink-muted' : 'text-ink-primary'
      }`}
    >
      {result.approx && <span className="text-ink-secondary">≥</span>}
      {compactCount(count)}
      {result.mismatched > 0 && (
        <span className="absolute right-0.5 top-0 text-xs leading-none text-state-error">•</span>
      )}
      {changed && (
        <span
          className={`absolute bottom-0 left-1 text-micro leading-none ${
            change > 0 ? 'text-state-success' : 'text-state-error'
          }`}
        >
          {change > 0 ? '+' : ''}
          {change}
        </span>
      )}
      {appeared && (
        <span className="absolute bottom-0 left-1 text-micro leading-none text-state-success">
          new
        </span>
      )}
    </div>
  );
}
