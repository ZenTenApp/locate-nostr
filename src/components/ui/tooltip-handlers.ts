/**
 * Handlers that make any element show a tooltip.
 *
 * Spread onto the element rather than wrapping it in a provider component: a
 * wrapper per cell would double the node count of a grid that already renders
 * around eight thousand of them, and these are four properties that cost
 * nothing to attach.
 *
 * Lives apart from `Tooltip.tsx` because a module that exports both a
 * component and a plain function cannot be fast-refreshed.
 */
import type { FocusEvent, MouseEvent } from 'react';

import { useTooltipStore } from '@/stores/tooltip-store';
import type { TooltipContent } from '@/stores/tooltip-store';

export function tooltipHandlers(content: TooltipContent) {
  const open = (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    useTooltipStore.getState().show(event.currentTarget.getBoundingClientRect(), content);
  };
  const close = () => useTooltipStore.getState().hide();
  return { onMouseEnter: open, onMouseLeave: close, onFocus: open, onBlur: close };
}
