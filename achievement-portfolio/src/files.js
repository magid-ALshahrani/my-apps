'use strict';
const path = require('path');
const fs = require('fs');

// نوع المحتوى يُستنتج من الامتداد (لا نثق بما يرسله المتصفح).
const EXT_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
};

// الأنواع الوحيدة التي تُعرض داخل المتصفح؛ كل ما عداها يُنزَّل كمرفق.
// (لا HTML ولا SVG ولا XML لأنها قد تحتوي سكربتات)
const INLINE_SAFE = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain; charset=utf-8',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
]);

function mimeFromName(name) {
  return EXT_MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';
}

// تنقية اسم الملف الأصلي قبل حفظه في القاعدة
function sanitizeFileName(name) {
  let n = String(name || '').normalize('NFC');
  n = n.split(/[\\/]/).pop();
  // محارف التحكم ومحارف تجاوز الاتجاه (تُستخدم لتزوير الامتدادات)
  n = n.replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
  n = n.replace(/[<>:"|?*]/g, '_').replace(/^[.\s]+/, '').trim();
  if (n.length > 150) {
    const ext = path.extname(n).slice(0, 15);
    n = n.slice(0, 150 - ext.length) + ext;
  }
  return n || 'ملف';
}

const STORED_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// يمنع path traversal: الاسم المخزّن UUID فقط، والمسار الناتج داخل مجلد الرفع
function storedPath(uploadsDir, storedName) {
  if (!STORED_RE.test(storedName)) return null;
  const root = path.resolve(uploadsDir);
  const full = path.resolve(root, storedName);
  if (path.dirname(full) !== root) return null;
  return full;
}

function contentDisposition(type, name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'file';
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function safeUnlink(file) {
  if (!file) return;
  fs.unlink(file, () => {});
}

module.exports = { mimeFromName, sanitizeFileName, storedPath, contentDisposition, safeUnlink, INLINE_SAFE };
