import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/Button';

/**
 * A centred dialog over a scrim.
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
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
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
  useEffect(() => {
    const focusable = dialogRef.current?.querySelector<HTMLElement>(
      'textarea, input, button, [href]',
    );
    focusable?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-lg"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="max-h-full w-full max-w-xl overflow-y-auto rounded-xl border border-surface-border bg-surface-panel p-xl shadow-2xl"
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
