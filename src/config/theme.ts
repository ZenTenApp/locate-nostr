/**
 * Design tokens — the single source of truth for colour, spacing, radius and
 * type scale. `tailwind.config.ts` imports these, so a Tailwind class and any
 * inline value (an avatar fallback fill, a canvas draw) can never drift apart.
 *
 * The app is forced-dark: its whole surface is one dense result table, and a
 * single palette keeps the count cells legible against each other.
 */

export const COLORS = {
  /** Page and panel surfaces, darkest to lightest. */
  surface: {
    base: '#141416',
    panel: '#1c1c20',
    card: '#26262c',
    raised: '#2f2f37',
    border: '#35353d',
  },
  /** Text, brightest to dimmest. */
  ink: {
    primary: '#f4f4f5',
    secondary: '#a1a1ab',
    muted: '#71717a',
    inverse: '#141416',
  },
  brand: {
    /** Nostr purple — primary actions and the active-nav marker. */
    primary: '#8b5cf6',
    primaryDim: '#6d43d6',
  },
  /** Result-cell fills, keyed by how much of a kind a relay holds. Density is
   *  read at a glance across a thousand rows, so it is carried by fill rather
   *  than by a number the eye has to parse. */
  cell: {
    none: '#1c1c20',
    trace: '#25203a',
    some: '#33265c',
    many: '#452f8a',
    lots: '#5b3bb8',
  },
  state: {
    error: '#ef4444',
    warning: '#f59e0b',
    success: '#10b981',
    info: '#3b82f6',
  },
} as const;

/** 4px base spacing scale. */
export const SPACING = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  xxl: '32px',
} as const;

/** The one layout breakpoint: above it the page is a fixed-height table view,
 *  below it a scrolling phone view. Tailwind's `md:` and the script-side media
 *  query both read this, so the two can never disagree about which is which. */
export const WIDE_MIN_WIDTH = '768px';
export const WIDE_MEDIA_QUERY = `(min-width: ${WIDE_MIN_WIDTH})`;

/** Corner radius scale. */
export const RADIUS = {
  sm: '8px',
  md: '10px',
  lg: '12px',
  xl: '16px',
  full: '9999px',
} as const;

/** Font-size scale. */
export const FONT_SIZE = {
  micro: '10px',
  xs: '11px',
  sm: '12px',
  md: '13px',
  base: '14px',
  lg: '16px',
  xl: '18px',
  xxl: '20px',
  heading: '24px',
  title: '28px',
} as const;
