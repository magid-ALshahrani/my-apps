// التحقق من الملفات قبل الرفع كمرفقات (النوع، الحجم، وكاشف الهوية للجداول والمستندات).
import { parseTableFile, tableKindOf } from './import/parse';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const ACCEPTED: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
export const ACCEPT_ATTR = Object.keys(ACCEPTED).map((e) => `.${e}`).join(',');

export const ID_FILE_MESSAGE = 'هذا الملف يحتوي أرقام هوية. استخدم الاستيراد بدل المرفقات.';

export function extOf(name: string) {
  return (name.toLowerCase().split('.').pop() ?? '').trim();
}

/** يتحقق من التوقيع الفعلي لأول بايتات الملف، لا من الامتداد وحده */
export async function sniffMatches(file: Blob & { name: string }): Promise<boolean> {
  const ext = extOf(file.name);
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const starts = (...b: number[]) => b.every((x, i) => head[i] === x);
  switch (ext) {
    case 'pdf': return starts(0x25, 0x50, 0x44, 0x46);
    case 'png': return starts(0x89, 0x50, 0x4e, 0x47);
    case 'jpg': case 'jpeg': return starts(0xff, 0xd8, 0xff);
    case 'gif': return starts(0x47, 0x49, 0x46);
    case 'webp': return starts(0x52, 0x49, 0x46, 0x46);
    case 'xlsx': case 'docx': case 'pptx': return starts(0x50, 0x4b, 0x03, 0x04);
    case 'xls': return starts(0xd0, 0xcf, 0x11, 0xe0);
    case 'csv': return !head.includes(0);
    default: return false;
  }
}

export interface FileCheck { ok: boolean; error?: string; mime?: string }

export async function validateAttachment(file: File): Promise<FileCheck> {
  const ext = extOf(file.name);
  const mime = ACCEPTED[ext];
  if (!mime) return { ok: false, error: `نوع الملف غير مدعوم. الأنواع المقبولة: ${Object.keys(ACCEPTED).join('، ')}` };
  if (file.size === 0) return { ok: false, error: 'الملف فارغ.' };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: 'حجم الملف أكبر من 10 ميجابايت.' };
  if (!(await sniffMatches(file))) return { ok: false, error: 'محتوى الملف لا يطابق امتداده.' };
  // كاشف الهوية: يُشغَّل داخل المتصفح على الجداول ومستندات Word قبل أي رفع
  if (tableKindOf(file.name)) {
    try {
      const t = await parseTableFile(file);
      if (t.removed.length > 0) return { ok: false, error: ID_FILE_MESSAGE };
      if (t.rows.some((r) => r.some((c) => c.includes('[محذوف]')))) return { ok: false, error: ID_FILE_MESSAGE };
    } catch {
      return { ok: false, error: 'تعذّر فحص الملف. تأكد أنه غير تالف.' };
    }
  }
  return { ok: true, mime };
}

/** اسم ملف آمن للتخزين: بلا أرقام طويلة وبلا رموز */
export function safeStorageName(name: string): string {
  const ext = extOf(name);
  const base = name.slice(0, name.length - ext.length - 1)
    .replace(/[0-9٠-٩]{6,}/g, '')
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .trim()
    .slice(0, 60) || 'ملف';
  return `${base}.${ext}`;
}
