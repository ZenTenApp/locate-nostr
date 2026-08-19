/**
 * The one tooltip on screen, and where it points.
 *
 * A store rather than per-cell state because the grid renders around eight
 * thousand count cells: giving each one its own hover state and its own hidden
 * popup would be eight thousand extra nodes and a re-render per mouse move.
 * Here a cell only reports "I am hovered, here is my content and my rectangle"
 * and exactly one component — the layer — re-renders.
 */
import { create } from 'zustand';

/**
 * Tooltip content as data, not as markup.
 *
 * Being a plain structure means it can be rendered, flattened into an
 * `aria-label` for a screen reader, and asserted in a test — three consumers
 * that would otherwise each need their own copy of the wording.
 */
export type TooltipTone = 'default' | 'warning' | 'error';

export interface TooltipContent {
  title: string;
  lines: string[];
  tone?: TooltipTone | undefined;
}

/**
 * The tooltip as one spoken sentence, for assistive technology.
 *
 * Punctuation is added only where a part does not already end in some — most
 * lines are full sentences, and joining them with a bare `'. '` produced
 * "…what the relay sent.." for those that were.
 */
export function tooltipText(content: TooltipContent): string {
  return [content.title, ...content.lines]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => (/[.!?:"”]$/.test(part) ? part : `${part}.`))
    .join(' ');
}

interface TooltipState {
  content: TooltipContent | null;
  /** Viewport rectangle of whatever is being hovered. */
  anchor: DOMRect | null;
  show: (anchor: DOMRect, content: TooltipContent) => void;
  hide: () => void;
}

export const useTooltipStore = create<TooltipState>((set) => ({
  content: null,
  anchor: null,
  show: (anchor, content) => set({ anchor, content }),
  hide: () => set({ anchor: null, content: null }),
}));
