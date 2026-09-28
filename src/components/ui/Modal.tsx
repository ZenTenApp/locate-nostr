import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/Button';

/**
 * How a dialog sits on screen. `side` is a panel against the edge, used as the
 * phone menu. It focuses itself rather than its first field, so opening a menu
 * does not throw up the on-screen keyboard over it.
 */
type Placement = 'center' | 'side';

const PLACEMENT: Record<Placement, { scrim: string; panel: string; focusField: boolean }> = {
  center: {
    scrim: 'items-center justify-center p-sm md:p-lg',
    panel: 'max-h-full w-full max-w-xl rounded-xl border p-lg md:p-xl',
    focusField: true,
  },
  side: {
    scrim: 'justify-end',
    panel: 'h-full w-[85%] max-w-sm border-l p-lg',
    focusField: false,
  },
};

/**
 * A dialog over a scrim.
 *
 * Escape closes and the scrim closes, but only through the same `onClose` the
 * buttons use — a key derivation in flight needs to terminate its worker on
 * the way out, and a dismissal path that skipped that would leave the
 * passphrase alive in a heap nobody owns any more.
 */
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  placement = 'center',
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  placement?: Placement;
}) {
  const layout = PLACEMENT[placement];
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Move focus into the dialog on open. Without this a keyboard user is still
  // on the page behind it — tabbing walks the grid rather than the fields, and
  // a screen reader never announces that a dialog appeared.
  // Focus goes back where it came from on close, or a keyboard user is dropped
  // at the top of the document and has to walk back to the control they used.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = layout.focusField
      ? dialog?.querySelector<HTMLElement>('textarea, input, button, [href]')
      : dialog;
    focusable?.focus();
    return () => opener?.focus();
  }, [layout.focusField]);

  return (
    <div
      className={`fixed inset-0 z-50 flex bg-black/70 ${layout.scrim}`}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={`overflow-y-auto overscroll-contain border-surface-border bg-surface-panel shadow-2xl outline-none ${layout.panel}`}
      >
        <header className="mb-lg flex items-start justify-between gap-md">
          <div>
            <h2 className="text-xl font-semibold text-ink-primary">{title}</h2>
            {subtitle !== undefined && (
              <p className="mt-xs text-sm text-ink-secondary">{subtitle}</p>
            )}
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </header>
        {children}
      </div>
    </div>
  );
}
