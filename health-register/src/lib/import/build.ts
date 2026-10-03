// من جدول نظيف + ربط الأعمدة ← عناصر استيراد جاهزة للمراجعة (بلا أي حفظ تلقائي).
import { cleanName, nameKey, normalizeArabic, normalizeHeader } from '../text';
import { normalizeSaudiMobile } from '../phone';
import { maskIdsInText } from '../protect';
import { matchHeader, type Field, type ImportKind, type MatchStatus } from './dictionary';
import type { ParsedTable } from './parse';

export type ColumnMapping = Record<number, Field | 'ignore'>;
export interface ColumnInfo { index: number; header: string; status: MatchStatus; field: Field | 'ignore' }

/** الربط التلقائي لكل عمود حسب القاموس، أو حسب قالب محفوظ (أسماء أعمدة فقط) */
export function autoMap(table: ParsedTable, kind: ImportKind, saved?: Record<string, string>): ColumnInfo[] {
  const header = table.rows[table.headerRow] ?? [];
  const savedNorm = saved ? Object.fromEntries(Object.entries(saved).map(([k, v]) => [normalizeHeader(k), v])) : null;
  const used = new Set<string>();
  return header.map((h, index) => {
    const fromSaved = savedNorm?.[normalizeHeader(h)];
    if (fromSaved) {
      if (fromSaved !== 'ignore') used.add(fromSaved);
      return { index, header: h, status: 'exact' as MatchStatus, field: fromSaved as Field | 'ignore' };
    }
    const m = matchHeader(h, kind);
    if (m.field && !used.has(m.field)) {
      used.add(m.field);
      return { index, header: h, status: m.status, field: m.field };
    }
    return { index, header: h, status: m.field ? 'unmapped' : m.status, field: 'ignore' as const };
  });
}

export function toMapping(cols: ColumnInfo[]): ColumnMapping {
  return Object.fromEntries(cols.map((c) => [c.index, c.field]));
}

export type Gender = 'boys' | 'girls';
export function parseGender(v: string): Gender | null {
  const s = normalizeArabic(v);
  if (!s) return null;
  if (/(بنين|ذكر|طالب$|^m$|male|ولد)/.test(s)) return 'boys';
  if (/(بنات|انثي|طالبه|^f$|female|بنت)/.test(s)) return 'girls';
  return null;
}

/** المرحلة من نص صريح أو من نص الصف */
export function inferStage(v: string): string | null {
  const s = normalizeArabic(v);
  if (/ابتدا/.test(s)) return 'ابتدائي';
  if (/متوسط/.test(s)) return 'متوسط';
  if (/ثانو/.test(s)) return 'ثانوي';
  if (/روضه|رياض|طفوله/.test(s)) return 'رياض أطفال';
  return null;
}

export interface StudentRow {
  rowNumber: number; // رقم الصف في الملف (1 = أول صف)
  full_name: string;
  name_key: string;
  stage: string;
  grade: string;
  section: string;
  gender: Gender | null;
  guardian_phone: string | null;
  phone_needs_review: boolean;
  notes: string | null;
}

export interface Rejected { rowNumber: number; reason: string }

export interface ExistingStudent { id: string; name_key: string; grade: string; section: string }

export type ItemAction = 'add' | 'update' | 'skip';
export interface ImportItem {
  row: StudentRow;
  key: string;
  duplicate: null | 'file' | 'existing';
  existingId?: string;
  /** للمكرر داخل الملف: رقم الصف الأول المطابق */
  duplicateOfRow?: number;
  action: ItemAction;
}

export const placementKey = (grade: string, section: string) => `${normalizeArabic(grade)}|${normalizeArabic(section)}`;
export const studentKey = (nk: string, grade: string, section: string) => `${nk}|${placementKey(grade, section)}`;

export function buildStudentRows(table: ParsedTable, mapping: ColumnMapping, defaults: { stage?: string; gender?: Gender } = {}) {
  const rows: StudentRow[] = [];
  const rejected: Rejected[] = [];
  const colOf = (f: Field) => {
    const e = Object.entries(mapping).find(([, v]) => v === f);
    return e ? Number(e[0]) : -1;
  };
  const c = {
    name: colOf('full_name'), stage: colOf('stage'), grade: colOf('grade'), section: colOf('section'),
    gender: colOf('gender'), phone: colOf('guardian_phone'), notes: colOf('notes'),
  };
  const get = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '');
  for (let i = table.headerRow + 1; i < table.rows.length; i++) {
    const r = table.rows[i];
    if (r.every((x) => !String(x).trim())) continue;
    const rowNumber = i + 1;
    const full_name = cleanName(get(r, c.name));
    if (!full_name || full_name.length < 2) { rejected.push({ rowNumber, reason: 'اسم الطالب فارغ' }); continue; }
    if (full_name.includes('[محذوف]')) { rejected.push({ rowNumber, reason: 'خانة الاسم تحتوي رقمًا محذوفًا' }); continue; }
    const grade = cleanName(get(r, c.grade));
    const section = cleanName(get(r, c.section));
    if (!grade) { rejected.push({ rowNumber, reason: 'الصف غير محدد' }); continue; }
    if (!section) { rejected.push({ rowNumber, reason: 'الفصل/الشعبة غير محدد' }); continue; }
    const stage = inferStage(get(r, c.stage)) ?? (get(r, c.stage) || inferStage(grade) || defaults.stage || '');
    if (!stage) { rejected.push({ rowNumber, reason: 'المرحلة غير محددة' }); continue; }
    const phoneRaw = get(r, c.phone);
    const guardian_phone = phoneRaw ? normalizeSaudiMobile(phoneRaw) : null;
    const notes = get(r, c.notes);
    rows.push({
      rowNumber, full_name, name_key: nameKey(full_name), stage, grade, section,
      gender: parseGender(get(r, c.gender)) ?? defaults.gender ?? null,
      guardian_phone,
      phone_needs_review: !!phoneRaw && !guardian_phone,
      notes: notes ? maskIdsInText(notes) : null,
    });
  }
  return { rows, rejected };
}

/** التكرار: داخل الملف، ومع الطلاب الموجودين. لا دمج صامت: كل مكرر يُعرض بخيار صريح */
export function classifyDuplicates(rows: StudentRow[], existing: ExistingStudent[]): ImportItem[] {
  const existingByKey = new Map<string, ExistingStudent>();
  for (const e of existing) existingByKey.set(studentKey(e.name_key, e.grade, e.section), e);
  const firstInFile = new Map<string, number>();
  return rows.map((row) => {
    const key = studentKey(row.name_key, row.grade, row.section);
    const ex = existingByKey.get(key);
    const prior = firstInFile.get(key);
    if (prior === undefined) firstInFile.set(key, row.rowNumber);
    if (ex) return { row, key, duplicate: 'existing', existingId: ex.id, action: 'skip' };
    if (prior !== undefined) return { row, key, duplicate: 'file', duplicateOfRow: prior, action: 'skip' };
    return { row, key, duplicate: null, action: 'add' };
  });
}

export interface PlacementNeed { stage: string; grade: string; section: string; gender: Gender | null }

/** المراحل والصفوف والفصول غير الموجودة، لتُعرض في المعاينة وتُنشأ بعد الموافقة */
export function missingPlacements(rows: StudentRow[], existing: { stage: string; grade: string; section: string }[]): PlacementNeed[] {
  const have = new Set(existing.map((p) => `${normalizeArabic(p.stage)}|${placementKey(p.grade, p.section)}`));
  const out = new Map<string, PlacementNeed>();
  for (const r of rows) {
    const k = `${normalizeArabic(r.stage)}|${placementKey(r.grade, r.section)}`;
    if (!have.has(k) && !out.has(k)) out.set(k, { stage: r.stage, grade: r.grade, section: r.section, gender: r.gender });
  }
  return [...out.values()];
}

export interface ImportReport {
  added: number; updated: number; skipped: number;
  rejected: Rejected[];
  idColumnsRemoved: number;
  phonesFlagged: number;
}

export function idRemovalLine(n: number): string {
  return n > 0 ? 'تم حذف عمود الهوية ولم يُحفظ' : 'لم يُعثر على عمود هوية في الملف، ولم يُحفظ أي رقم هوية';
}

export interface CommitteeRow { rowNumber: number; full_name: string; phone: string | null; title: string }

export function buildCommitteeRows(table: ParsedTable, mapping: ColumnMapping) {
  const rows: CommitteeRow[] = [];
  const rejected: Rejected[] = [];
  const colOf = (f: Field) => Number(Object.entries(mapping).find(([, v]) => v === f)?.[0] ?? -1);
  const [cn, cp, ct] = [colOf('full_name'), colOf('phone'), colOf('title')];
  for (let i = table.headerRow + 1; i < table.rows.length; i++) {
    const r = table.rows[i];
    if (r.every((x) => !String(x).trim())) continue;
    const full_name = cleanName(cn >= 0 ? r[cn] : '');
    if (full_name.length < 2) { rejected.push({ rowNumber: i + 1, reason: 'الاسم فارغ' }); continue; }
    rows.push({
      rowNumber: i + 1, full_name,
      phone: cp >= 0 ? normalizeSaudiMobile(r[cp]) : null,
      title: cleanName(ct >= 0 ? r[ct] : '') || 'عضو',
    });
  }
  return { rows, rejected };
}

export type { ImportKind };
export { normalizeHeader };
