/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0a0c10',
          900: '#0f1218',
          850: '#141821',
          800: '#1a1f2b',
          700: '#242b3a',
          600: '#333c4f',
          500: '#4b566d',
          400: '#6b7689',
          300: '#98a2b3',
          200: '#c9d1de',
          100: '#e8ecf3'
        },
        brand: {
          50: '#eef6ff',
          200: '#b9dcff',
          400: '#4da3ff',
          500: '#2b8bff',
          600: '#1a6fe0',
          700: '#1557ad'
        }
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace']
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,.3), 0 8px 24px -12px rgba(0,0,0,.55)'
      }
    }
  },
  plugins: []
}
