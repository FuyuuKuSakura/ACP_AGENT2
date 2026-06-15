/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: ['class', '[data-theme-mode="dark"]'],
  theme: {
    extend: {
      colors: {
        dionysus: {
          primary: 'var(--dionysus-primary)',
          'primary-hover': 'var(--dionysus-primary-hover)',
          accent: 'var(--dionysus-accent)',
          background: 'var(--dionysus-background)',
          'chat-bg': 'var(--dionysus-chat-bg)',
          'user-bubble': 'var(--dionysus-user-bubble)',
          'agent-bubble': 'var(--dionysus-agent-bubble)',
          'text-primary': 'var(--dionysus-text-primary)',
          'text-secondary': 'var(--dionysus-text-secondary)',
          system: 'var(--dionysus-system)',
          danger: 'var(--dionysus-danger)',
          success: 'var(--dionysus-success)',
          'code-bg': 'var(--dionysus-code-bg)',
          border: 'var(--dionysus-border)',
          'glass-bg': 'var(--dionysus-glass-bg)',
          'glass-border': 'var(--dionysus-glass-border)',
          'glass-highlight': 'var(--dionysus-glass-highlight)',
          'panel-bg': 'var(--dionysus-panel-bg)',
          'subtle-border': 'var(--dionysus-subtle-border)',
          'status-online': 'var(--dionysus-status-online)',
          'status-busy': 'var(--dionysus-status-busy)',
          'status-offline': 'var(--dionysus-status-offline)',
        },
      },
      fontFamily: {
        sans: ['var(--dionysus-font-body)', 'sans-serif'],
        mono: ['var(--dionysus-font-code)', 'monospace'],
      },
    },
  },
  plugins: [],
}
