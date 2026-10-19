/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Stack de sistema: SF Pro en Apple, Segoe/Roboto en el resto
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          '"SF Pro Text"',
          '"Inter"',
          '"Segoe UI"',
          'Roboto',
          'system-ui',
          'sans-serif',
        ],
        rounded: ['"SF Pro Rounded"', 'ui-rounded', '-apple-system', 'system-ui', 'sans-serif'],
      },
      colors: {
        bg: {
          950: '#000000',
          900: '#0a0a0f',
        },
        surface: {
          800: '#1c1c1e',
          700: '#2c2c2e',
        },
        label: {
          primary: '#f5f5f7',
          secondary: 'rgba(235,235,245,0.6)',
          tertiary: 'rgba(235,235,245,0.3)',
        },
        accent: {
          violet: '#7b63ff',
          magenta: '#f03daf',
          cyan: '#3cb8ff',
        },
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(255,255,255,0.06), 0 20px 60px -20px rgba(0,0,0,0.8)',
        glass: 'inset 0 1px 0 0 rgba(255,255,255,0.12), 0 0 0 1px rgba(255,255,255,0.06), 0 24px 48px -12px rgba(0,0,0,0.6)',
        float: '0 40px 80px -20px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.08)',
      },
      borderRadius: {
        xxl: '1.35rem',
        squircle: '1.75rem',
      },
      transitionTimingFunction: {
        apple: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
        'apple-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        aurora: {
          '0%, 100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '33%': { transform: 'translate3d(6%,-4%,0) scale(1.12)' },
          '66%': { transform: 'translate3d(-5%,5%,0) scale(0.94)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'eq-bar': {
          '0%, 100%': { transform: 'scaleY(0.3)' },
          '50%': { transform: 'scaleY(1)' },
        },
      },
      animation: {
        aurora: 'aurora 22s ease-in-out infinite',
        'aurora-slow': 'aurora 34s ease-in-out infinite reverse',
        shimmer: 'shimmer 2.2s linear infinite',
        'eq-bar': 'eq-bar 0.9s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
