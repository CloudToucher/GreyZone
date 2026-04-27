import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{vue,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paper / surface
        paper: {
          50: '#ffffff',
          100: '#fafaf9',
          200: '#f5f5f4',
          300: '#e7e5e4',
          400: '#d6d3d1',
          500: '#a8a29e',
          600: '#78716c',
          700: '#44403c',
          800: '#292524',
          900: '#1c1917',
          950: '#0c0a09',
        },
        // Crimson — primary clash color (HP, alerts, active tab)
        crimson: {
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
        },
        // Navy — secondary (DM, headings, structure)
        navy: {
          50: '#f1f5f9',
          100: '#e2e8f0',
          200: '#cbd5e1',
          400: '#64748b',
          600: '#334155',
          700: '#1e293b',
          800: '#0f172a',
        },
        // Ochre — tertiary (warnings, character)
        ochre: {
          50: '#fefce8',
          100: '#fef9c3',
          200: '#fef08a',
          400: '#facc15',
          500: '#eab308',
          600: '#ca8a04',
          700: '#a16207',
        },
        // Forest — success / SP
        forest: {
          50: '#f0fdf4',
          400: '#4ade80',
          600: '#16a34a',
          700: '#15803d',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Cascadia Code', 'Consolas', 'ui-monospace', 'monospace'],
        sans: ['"Noto Sans SC"', 'Inter', 'system-ui', 'sans-serif'],
        serif: ['"Noto Serif SC"', 'Georgia', 'serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(12, 10, 9, 0.04), 0 1px 3px 0 rgba(12, 10, 9, 0.06)',
        pop: '0 4px 16px -4px rgba(15, 23, 42, 0.12), 0 2px 4px -2px rgba(15, 23, 42, 0.08)',
        ring: '0 0 0 3px rgba(220, 38, 38, 0.18)',
      },
    },
  },
  plugins: [],
} satisfies Config
