/**
 * A tooltip this app controls, replacing the browser's `title` attribute.
 *
 * `title` was wrong for this grid in four ways: it waits about a second before
 * appearing, it cannot be styled, it collapses newlines in some browsers so a
 * multi-line explanation arrives as one run-on sentence, and it is truncated
 * by the OS. The cells it was attached to are single glyphs — `🔒`, `⏱`, `!` —
 * whose entire meaning lives in that text, so a hover that arrives late and
 * half-legible is the difference between a readable grid and a wall of
 * symbols.
 *
 * One layer serves the whole page; see `stores/tooltip-store.ts` for why.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useTooltipStore } from '@/stores/tooltip-store';

/** Distance from the anchor, and from the viewport edge. */
const GAP = 8;
const MARGIN = 8;

const TONE_CLASS = {
  default: 'border-surface-border',
  warning: 'border-state-warning/60',
  error: 'border-state-error/60',
} as const;

export function TooltipLayer() {
  const content = useTooltipStore((state) => state.content);
  const anchor = useTooltipStore((state) => state.anchor);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  // Measured after render because placement depends on the tooltip's own size:
  // it flips above the anchor when it would fall off the bottom, and is
  // clamped horizontally so a cell in the last column stays on screen.
  useLayoutEffect(() => {
    if (!anchor || !ref.current) {
      setPosition(null);
      return;
    }
    const box = ref.current.getBoundingClientRect();
    const below = anchor.bottom + GAP;
    const fitsBelow = below + box.height <= window.innerHeight - MARGIN;

    setPosition({
      left: Math.min(
        Math.max(MARGIN, anchor.left + anchor.width / 2 - box.width / 2),
        window.innerWidth - box.width - MARGIN,
      ),
      top: fitsBelow ? below : Math.max(MARGIN, anchor.top - box.height - GAP),
    });
  }, [anchor, content]);

  // The anchor is a rectangle captured at hover time, so any scroll leaves the
  // tooltip pointing at nothing. On touch this is also how a tapped tooltip
  // goes away: no mouse ever leaves the cell to close it.
  useEffect(() => {
    if (anchor === null) return;
    const hide = () => useTooltipStore.getState().hide();
    document.addEventListener('scroll', hide, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', hide, { capture: true });
  }, [anchor]);

  if (!content || !anchor) return null;

  return (
    <div
      ref={ref}
      role="tooltip"
      className={`pointer-events-none fixed z-[60] max-w-[320px] rounded-md border bg-surface-raised px-md py-sm shadow-2xl ${
        TONE_CLASS[content.tone ?? 'default']
      }`}
      style={{
        left: position?.left ?? -9999,
        top: position?.top ?? -9999,
        // Hidden until measured, so it never flashes at the wrong place.
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      <p className="text-sm font-medium text-ink-primary">{content.title}</p>
      {content.lines.map((line) => (
        <p key={line} className="mt-xs text-xs leading-snug text-ink-secondary">
          {line}
        </p>
      ))}
    </div>
  );
}
