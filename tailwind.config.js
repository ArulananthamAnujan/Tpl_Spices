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
      // Hairline borders carry the structure; shadows stay almost invisible
      // until something is lifted. Heavy drop shadows on every surface are what
      // make a page read as a template.
      boxShadow: {
        'card': '0 1px 2px rgba(21,43,14,0.04)',
        'card-hover': '0 6px 20px -6px rgba(21,43,14,0.14)',
        'lift': '0 12px 32px -8px rgba(21,43,14,0.18)',
      },
      borderRadius: {
        'card': '0.625rem',
      },
      letterSpacing: {
        'tightest': '-0.03em',
      },
    },
  },
  plugins: [],
};
