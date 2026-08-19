import type { Config } from 'tailwindcss';
import { COLORS, SPACING, RADIUS, FONT_SIZE } from './src/config/theme';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: COLORS.surface,
        ink: COLORS.ink,
        brand: COLORS.brand,
        cell: COLORS.cell,
        state: COLORS.state,
      },
      spacing: SPACING,
      borderRadius: RADIUS,
      fontSize: FONT_SIZE,
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      height: { screen: '100dvh' },
      minHeight: { screen: '100dvh' },
    },
  },
  plugins: [],
} satisfies Config;
