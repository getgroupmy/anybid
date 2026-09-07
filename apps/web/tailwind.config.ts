import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d5dae3',
          300: '#b0bacb',
          400: '#8494ae',
          500: '#647694',
          600: '#4f5e7a',
          700: '#414d63',
          800: '#384253',
          900: '#323a47',
          950: '#21262f',
        },
        bid: {
          50: '#fff4ed',
          100: '#ffe6d4',
          200: '#ffc9a8',
          300: '#ffa370',
          400: '#ff7137',
          500: '#fe4d11',
          600: '#ef3307',
          700: '#c62208',
          800: '#9d1d0f',
          900: '#7e1b10',
        },
        deal: {
          50: '#eefbf3',
          100: '#d6f5e1',
          200: '#b0e9c8',
          300: '#7dd7a8',
          400: '#48bd84',
          500: '#25a268',
          600: '#178253',
          700: '#136844',
          800: '#125338',
          900: '#0f4430',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      keyframes: {
        'price-pop': {
          '0%': { transform: 'scale(1)', color: 'inherit' },
          '35%': { transform: 'scale(1.08)', color: '#ef3307' },
          '100%': { transform: 'scale(1)', color: 'inherit' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'price-pop': 'price-pop 600ms ease-out',
        'fade-up': 'fade-up 220ms ease-out',
      },
    },
  },
  plugins: [],
} satisfies Config;
