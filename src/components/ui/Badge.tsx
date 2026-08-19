import type { ReactNode } from 'react';

import { tooltipHandlers } from '@/components/ui/tooltip-handlers';

export type BadgeTone = 'neutral' | 'brand' | 'warning' | 'error' | 'success' | 'info';
type Tone = BadgeTone;

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-surface-raised text-ink-secondary',
  brand: 'bg-brand-primaryDim text-ink-primary',
  warning: 'bg-state-warning/20 text-state-warning',
  error: 'bg-state-error/20 text-state-error',
  success: 'bg-state-success/20 text-state-success',
  info: 'bg-state-info/20 text-state-info',
};

export function Badge({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: Tone;
  /** Explanation, shown in this app's own tooltip rather than the browser's —
   *  a badge is two or three characters and the sentence is the point. */
  title?: string;
  children: ReactNode;
}) {
  const label = typeof children === 'string' ? children : 'detail';
  return (
    <span
      {...(title === undefined ? {} : tooltipHandlers({ title: label, lines: [title] }))}
      className={`inline-flex items-center rounded-sm px-xs py-0 text-xs font-medium leading-5 ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}
