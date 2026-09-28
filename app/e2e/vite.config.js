// تشغيل الواجهة على قاعدة بيانات محلية داخل المتصفح لأغراض الاختبار: npx vite -c e2e/vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const mock = fileURLToPath(new URL('./mock-api.js', import.meta.url));
const real = fileURLToPath(new URL('../src/api.js', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [
    react(),
    {
      name: 'mock-api',
      enforce: 'pre',
      async resolveId(source, importer, opts) {
        if (!importer || importer === mock) return null;
        const r = await this.resolve(source, importer, { ...opts, skipSelf: true });
        return r && r.id === real ? mock : null;
      },
    },
  ],
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  server: { port: 5199, strictPort: true, fs: { allow: ['..'] } },
});
