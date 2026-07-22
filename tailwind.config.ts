import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f4f7f5',
          100: '#e3ebe6',
          500: '#2f6b4f',
          600: '#25553f',
          700: '#1c4130',
        },
      },
    },
  },
  plugins: [],
}

export default config
