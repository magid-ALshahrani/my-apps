import { defineConfig } from 'vitest/config';
// اختبارات قاعدة البيانات وRLS: تتطلب تشغيل البيئة المحلية (npm run stack)
export default defineConfig({
  test: { environment: 'node', include: ['tests/db/**/*.test.ts'], fileParallelism: false, testTimeout: 30000 },
});
