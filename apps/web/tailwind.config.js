/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          50: 'rgb(var(--ink-50) / <alpha-value>)',
          100: 'rgb(var(--ink-100) / <alpha-value>)',
          200: 'rgb(var(--ink-200) / <alpha-value>)',
          300: 'rgb(var(--ink-300) / <alpha-value>)',
          400: 'rgb(var(--ink-400) / <alpha-value>)',
          500: 'rgb(var(--ink-500) / <alpha-value>)',
          600: 'rgb(var(--ink-600) / <alpha-value>)',
          700: 'rgb(var(--ink-700) / <alpha-value>)',
          800: 'rgb(var(--ink-800) / <alpha-value>)',
          900: 'rgb(var(--ink-900) / <alpha-value>)',
          950: 'rgb(var(--ink-950) / <alpha-value>)'
        },
        brand: {
          50: 'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)'
        },
        danger: {
          50: 'rgb(var(--danger-50) / <alpha-value>)',
          100: 'rgb(var(--danger-100) / <alpha-value>)',
          200: 'rgb(var(--danger-200) / <alpha-value>)',
          700: 'rgb(var(--danger-700) / <alpha-value>)',
          800: 'rgb(var(--danger-800) / <alpha-value>)'
        },
        warn: {
          50: 'rgb(var(--warn-50) / <alpha-value>)',
          100: 'rgb(var(--warn-100) / <alpha-value>)',
          200: 'rgb(var(--warn-200) / <alpha-value>)',
          700: 'rgb(var(--warn-700) / <alpha-value>)',
          800: 'rgb(var(--warn-800) / <alpha-value>)'
        },
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          muted: 'rgb(var(--surface-muted) / <alpha-value>)',
          sidebar: 'rgb(var(--surface-sidebar) / <alpha-value>)',
          canvas: 'rgb(var(--surface-canvas) / <alpha-value>)'
        }
      },
      fontFamily: {
        display: ['"Outfit"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"Source Sans 3"', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        toolbar: 'var(--shadow-toolbar)',
        card: 'var(--shadow-card)',
        lift: 'var(--shadow-lift)'
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        'soft-pulse': {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' }
        }
      },
      animation: {
        'fade-up': 'fade-up 0.55s ease-out both',
        'fade-up-delay': 'fade-up 0.7s ease-out 0.12s both',
        'soft-pulse': 'soft-pulse 2s ease-in-out infinite'
      }
    }
  },
  plugins: []
};
