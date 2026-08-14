/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        tpl: {
          'dark':    '#152b0e',
          'forest':  '#1e4011',
          'mid':     '#2d6a1e',
          'lime':    '#74c043',
          'light':   '#9fd45a',
          'pale':    '#d4edbc',
          'cream':   '#faf8f2',
          'warm':    '#f5f0e8',
          'amber':   '#e8a020',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Playfair Display', 'Georgia', 'serif'],
      },
      boxShadow: {
        'card': '0 2px 8px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
        'card-hover': '0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)',
      },
    },
  },
  plugins: [],
};
