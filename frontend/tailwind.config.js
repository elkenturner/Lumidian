/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'bg-primary': '#0a0a0f',
        'bg-card': '#111118',
        'bg-elevated': '#1a1a24',
        'border-default': '#1e1e2e',
        'text-primary': '#e2e8f0',
        'text-secondary': '#94a3b8',
        'text-muted': '#64748b',
        'accent': '#6366f1',
        'accent-hover': '#4f46e5',
        'success': '#22c55e',
        'warning': '#f59e0b',
        'danger': '#ef4444',
      },
      keyframes: {
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
      },
      animation: {
        pulse: 'pulse 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
