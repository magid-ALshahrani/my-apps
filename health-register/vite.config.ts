import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'سجل الموجه الصحي 1448هـ',
        short_name: 'الموجه الصحي',
        lang: 'ar',
        dir: 'rtl',
        // هوية ونطاق مستقلان حتى لا يُعامل كجزء من «صندوق الإخوة» المنشور على المسار الأب /my-apps/
        id: 'health-register',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#0b1324',
        theme_color: '#0f766e',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // لا تخزين مؤقت لطلبات البيانات: بيانات صحية لا تُحفظ في ذاكرة المتصفح
        navigateFallbackDenylist: [/^\/(rest|auth|storage|functions)\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['ocr/**'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 2000 },
});
