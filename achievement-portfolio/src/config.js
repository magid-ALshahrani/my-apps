'use strict';
const path = require('path');

// كل الإعدادات من متغيرات البيئة فقط. لا قيم سرية افتراضية هنا.
function loadConfig(env = process.env) {
  const dataDir = path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data'));
  const maxFileMb = Number(env.MAX_FILE_MB);
  return {
    port: Number(env.PORT) || 3000,
    production: env.NODE_ENV === 'production',
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
    dbPath: path.join(dataDir, 'app.db'),
    maxFileMb: Number.isFinite(maxFileMb) && maxFileMb > 0 ? maxFileMb : 20,
    sessionSecret: env.SESSION_SECRET || '',
    adminPin: env.ADMIN_PIN || '',
    managerPin: env.MANAGER_PIN || '',
    seedDemo: env.SEED_DEMO === '1',
  };
}

module.exports = { loadConfig };
