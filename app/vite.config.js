import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { SUPABASE_URL } from './src/config.js';

const host = new URL(SUPABASE_URL).host;

// سياسة أمان المحتوى: لا سكربتات خارجية، والاتصال بـ Supabase فقط
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  `connect-src 'self' https://${host} wss://${host}`,
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'inject-csp',
      apply: 'build',
      transformIndexHtml: (html) =>
        html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
    },
  ],
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
  test: { environment: 'node', testTimeout: 60000 },
});
