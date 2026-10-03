// حماية الأرقام الوطنية: كشف الأعمدة بالعنوان أو بالمحتوى، وإخفاء الأرقام داخل النصوص الحرة.
// لا تطبع أي قيمة من هنا في console ولا في رسائل الأخطاء.
import { normalizeHeader, toWesternDigits } from './text';

/** قاموس العناوين (بعد التطبيع) */
const HEADER_EXACT = [
  'رقم الهوية', 'الهوية', 'هوية الطالب', 'رقم هوية الطالب', 'الهوية الوطنية', 'رقم الهوية الوطنية',
  'السجل المدني', 'رقم السجل المدني', 'الرقم الوطني', 'رقم الاقامة', 'رقم الإقامة', 'رقم الحدود',
  'national id', 'id', 'iqama',
].map(normalizeHeader);

/** أجزاء إن وردت في العنوان يُعامل كعمود هوية (أحوط من المطابقة الدقيقة وحدها) */
const HEADER_PARTS = ['هويه', 'سجل مدني', 'السجل المدني', 'الرقم الوطني', 'رقم وطني', 'اقامه', 'رقم الحدود', 'national id', 'nationalid', 'iqama', 'iqamah']
  .map(normalizeHeader);

export const ID_VALUE_RE = /^[12]\d{9}$/;
const ID_IN_TEXT_RE = /(?<!\d)[12]\d{9}(?!\d)/g;
export const REMOVED_TEXT = '[محذوف]';
export const MASK = '••••••••••';

export function isIdHeader(header: unknown): boolean {
  const h = normalizeHeader(String(header ?? ''));
  if (!h) return false;
  if (HEADER_EXACT.includes(h)) return true;
  if (/(^|\s)id(\s|$)/.test(h)) return true;
  return HEADER_PARTS.some((p) => h.includes(p));
}

export function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v);
  return String(v);
}

export function looksLikeIdValue(v: unknown): boolean {
  return ID_VALUE_RE.test(toWesternDigits(cellToString(v)).replace(/[\s‏‎-]/g, ''));
}

/** 60% أو أكثر من القيم غير الفارغة تطابق النمط */
export function isIdColumnByContent(values: unknown[]): boolean {
  const nonEmpty = values.filter((v) => cellToString(v).trim() !== '');
  if (nonEmpty.length === 0) return false;
  const hits = nonEmpty.filter(looksLikeIdValue).length;
  return hits / nonEmpty.length >= 0.6;
}

/** يستبدل أي رقم بنمط الهوية داخل نص حر بـ «[محذوف]» */
export function maskIdsInText(text: string): string;
export function maskIdsInText(text: string | null | undefined): string | null | undefined;
export function maskIdsInText(text: string | null | undefined) {
  if (text === null || text === undefined) return text;
  return toWesternDigits(String(text)).replace(ID_IN_TEXT_RE, REMOVED_TEXT);
}

export function containsIdInText(text: string): boolean {
  ID_IN_TEXT_RE.lastIndex = 0;
  const r = ID_IN_TEXT_RE.test(toWesternDigits(text));
  ID_IN_TEXT_RE.lastIndex = 0;
  return r;
}

/** يمرّ على كل الحقول النصية في كائن ويخفي الأرقام قبل الإرسال */
export function maskRecord<T extends Record<string, unknown>>(rec: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) out[k] = typeof v === 'string' ? maskIdsInText(v) : v;
  return out as T;
}

export interface RemovedColumn { header: string; index: number; reason: 'header' | 'content' }

/**
 * يحذف أعمدة الهوية من جدول (صفوف خام) ويُرجع جدولًا نظيفًا ووصف الأعمدة المحذوفة (عناوينها فقط).
 * headerRow = رقم صف العناوين أو -1 إن لم يُعرف بعد (يُفحص المحتوى على كل الصفوف).
 */
export function stripIdColumns(rows: unknown[][], headerRow: number): { rows: string[][]; removed: RemovedColumn[] } {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const removedIdx = new Set<number>();
  const removed: RemovedColumn[] = [];
  const header = headerRow >= 0 ? rows[headerRow] ?? [] : [];
  for (let c = 0; c < width; c++) {
    const title = cellToString(header[c]);
    const body = rows.slice(headerRow + 1).map((r) => r[c]);
    let reason: RemovedColumn['reason'] | null = null;
    if (headerRow >= 0 && isIdHeader(title)) reason = 'header';
    else if (isIdColumnByContent(body)) reason = 'content';
    if (reason) {
      removedIdx.add(c);
      removed.push({ header: title.trim() || `عمود ${c + 1}`, index: c, reason });
    }
  }
  const clean = rows.map((r) => {
    const out: string[] = [];
    for (let c = 0; c < width; c++) {
      if (removedIdx.has(c)) continue;
      // أي رقم بنمط الهوية في خلية أخرى يُستبدل قبل أن يغادر هذه الدالة
      out.push(maskIdsInText(cellToString(r[c])));
    }
    return out;
  });
  return { rows: clean, removed };
}
