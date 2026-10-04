'use strict';
const crypto = require('crypto');
const { loadConfig } = require('./src/config');
const { createApp } = require('./src/app');

const config = loadConfig();

if (!config.sessionSecret) {
  if (config.production) {
    console.error('خطأ: يجب ضبط SESSION_SECRET في بيئة الإنتاج.');
    process.exit(1);
  }
  // للتطوير المحلي فقط: سر مؤقت يتغير مع كل تشغيل (تُفقد الجلسات عند إعادة التشغيل)
  config.sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('تنبيه: SESSION_SECRET غير مضبوط؛ استُخدم سر مؤقت للتطوير.');
}
if (!config.adminPin) console.warn('تنبيه: ADMIN_PIN غير مضبوط؛ دخول المعلم معطّل.');
if (!config.managerPin) console.warn('تنبيه: MANAGER_PIN غير مضبوط؛ دخول المدير معطّل.');

// لا نُبقي القيم السرية في بيئة العملية بعد قراءتها
delete process.env.ADMIN_PIN;
delete process.env.MANAGER_PIN;
delete process.env.SESSION_SECRET;

const { app } = createApp(config);
app.listen(config.port, () => {
  console.log(`ملف الإنجاز يعمل على المنفذ ${config.port}`);
});
