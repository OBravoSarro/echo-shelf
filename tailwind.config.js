/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          950: '#060910',
          900: '#0b1020',
        },
        surface: {
          800: '#141b32',
          700: '#1a2340',
        },
        accent: {
          violet: '#7b63ff',
          magenta: '#f03daf',
          cyan: '#3cb8ff',
        },
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(255,255,255,0.08), 0 14px 48px rgba(23, 40, 108, 0.42)',
      },
      borderRadius: {
        xxl: '1.35rem',
      },
    },
  },
  plugins: [],
}
