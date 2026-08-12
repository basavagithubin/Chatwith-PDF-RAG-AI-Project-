/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f4f7f8',
          100: '#e4ecef',
          200: '#cbd8de',
          300: '#a7bcc6',
          400: '#7a98a6',
          500: '#5e7c8b',
          600: '#516675',
          700: '#455560',
          800: '#3c4851',
          900: '#353e45',
          950: '#1a2228'
        },
        brand: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a'
        },
        surface: {
          DEFAULT: '#ffffff',
          muted: '#f4f7f8',
          sidebar: '#f7fafb',
          canvas: '#e8eef1'
        }
      },
      fontFamily: {
        display: ['"Outfit"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"Source Sans 3"', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        toolbar: '0 8px 30px rgba(26, 34, 40, 0.10)',
        card: '0 1px 2px rgba(26, 34, 40, 0.05), 0 4px 16px rgba(26, 34, 40, 0.04)',
        lift: '0 12px 40px rgba(26, 34, 40, 0.12)'
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
