// قاموس أعمدة قالب «نور» وقالب أعضاء اللجنة، والمطابقة الدقيقة ثم التقريبية.
import { normalizeHeader, similarity } from '../text';
import { isIdHeader } from '../protect';

export type StudentField = 'full_name' | 'stage' | 'grade' | 'section' | 'gender' | 'guardian_phone' | 'notes';
export type CommitteeField = 'full_name' | 'phone' | 'title';
export type Field = StudentField | CommitteeField;
export type ImportKind = 'students' | 'committee';

export const STUDENT_FIELDS: Record<StudentField, string> = {
  full_name: 'اسم الطالب',
  stage: 'المرحلة',
  grade: 'الصف',
  section: 'الفصل/الشعبة',
  gender: 'الجنس',
  guardian_phone: 'جوال ولي الأمر',
  notes: 'ملاحظات',
};

export const COMMITTEE_FIELDS: Record<CommitteeField, string> = {
  full_name: 'الاسم',
  phone: 'الجوال',
  title: 'الصفة',
};

/** القاموس الافتراضي من المواصفات (يُحدَّث من ملف noor-headers.* إن وُجد) */
export const NOOR_DICTIONARY: Record<StudentField, string[]> = {
  full_name: ['اسم الطالب', 'اسم الطالبة', 'الاسم', 'الاسم الكامل', 'الاسم الرباعي'],
  stage: ['المرحلة', 'المرحلة الدراسية'],
  grade: ['الصف', 'الصف الدراسي', 'المستوى'],
  section: ['الفصل', 'الشعبة', 'رقم الفصل'],
  gender: ['الجنس', 'النوع'],
  guardian_phone: ['جوال ولي الأمر', 'جوال', 'رقم الجوال', 'هاتف ولي الأمر', 'رقم ولي الأمر'],
  notes: ['ملاحظات', 'الملاحظات'],
};

export const COMMITTEE_DICTIONARY: Record<CommitteeField, string[]> = {
  full_name: ['الاسم', 'اسم العضو', 'الاسم الكامل', 'الاسم الرباعي'],
  phone: ['الجوال', 'رقم الجوال', 'جوال', 'الهاتف'],
  title: ['الصفة', 'صفته', 'المسمى', 'الدور في اللجنة'],
};

/** عناوين تُرفض مطابقتها مع أي حقل ولو تشابهت (الفصل الدراسي = الأول/الثاني وليس الشعبة) */
export const REJECTED_HEADERS = ['الفصل الدراسي', 'الفصل الدراسي الاول', 'الفصل الدراسي الثاني', 'الترم'].map(normalizeHeader);

export type MatchStatus = 'exact' | 'fuzzy' | 'unmapped' | 'rejected' | 'id';
export interface HeaderMatch { field: Field | null; status: MatchStatus }

function dictionaryFor(kind: ImportKind): Record<string, string[]> {
  return kind === 'students' ? NOOR_DICTIONARY : COMMITTEE_DICTIONARY;
}

const normCache = new Map<string, string>();
function n(s: string) {
  let v = normCache.get(s);
  if (v === undefined) { v = normalizeHeader(s); normCache.set(s, v); }
  return v;
}

export function matchHeader(header: string, kind: ImportKind = 'students'): HeaderMatch {
  const h = normalizeHeader(header);
  if (!h) return { field: null, status: 'unmapped' };
  if (isIdHeader(header)) return { field: null, status: 'id' };
  if (REJECTED_HEADERS.includes(h)) return { field: null, status: 'rejected' };
  const dict = dictionaryFor(kind);
  for (const [field, words] of Object.entries(dict)) {
    if (words.some((w) => n(w) === h)) return { field: field as Field, status: 'exact' };
  }
  // تقريبية: أعلى تشابه ≥ 0.8، مع رفض أي عنوان يحتوي «الدراسي» حين يُقارن بالفصل
  let best: { field: Field; score: number } | null = null;
  for (const [field, words] of Object.entries(dict)) {
    for (const w of words) {
      const score = similarity(n(w), h);
      if (score >= 0.8 && (!best || score > best.score)) best = { field: field as Field, score };
    }
  }
  if (best && best.field === 'section' && /الدراسي/.test(h)) return { field: null, status: 'rejected' };
  return best ? { field: best.field, status: 'fuzzy' } : { field: null, status: 'unmapped' };
}

/** عدد العناوين المعروفة في صف (يشمل عناوين الهوية لأنها معروفة للكشف) */
export function knownHeaderCount(row: unknown[], kind: ImportKind = 'students'): number {
  const seen = new Set<string>();
  let count = 0;
  for (const cell of row) {
    const text = String(cell ?? '').trim();
    if (!text || text.length > 40) continue;
    const m = matchHeader(text, kind);
    if (m.status === 'id') { count++; continue; }
    if (m.field && !seen.has(m.field)) { seen.add(m.field); count++; }
  }
  return count;
}

/** أول صف يطابق 3 عناوين معروفة أو أكثر؛ -1 إن لم يوجد (يختاره المستخدم يدويًا) */
export function detectHeaderRow(rows: unknown[][], kind: ImportKind = 'students', maxScan = 30): number {
  const min = kind === 'students' ? 3 : 2;
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    if (knownHeaderCount(rows[i] ?? [], kind) >= min) return i;
  }
  return -1;
}
