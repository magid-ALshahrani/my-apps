/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'), surface: v('surface'), 'surface-2': v('surface-2'), border: v('border'),
        text: v('text'), muted: v('muted'), primary: v('primary'), 'on-primary': v('on-primary'),
        'primary-soft': v('primary-soft'), accent: v('accent'), 'on-accent': v('on-accent'),
        danger: v('danger'), 'danger-soft': v('danger-soft'), success: v('success'), warning: v('warning'),
        'warning-soft': v('warning-soft'),
      },
      fontFamily: { heading: ['Cairo', 'sans-serif'], body: ['Tajawal', 'sans-serif'] },
    },
  },
  plugins: [],
};
