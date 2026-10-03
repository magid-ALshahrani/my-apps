// تحليل الملفات داخل المتصفح. الملف الأصلي لا يُرفع ولا يُحفظ.
// أعمدة الهوية تُحذف داخل هذه الدوال نفسها، قبل أن يصل أي شيء إلى الحالة أو المعاينة أو الشبكة.
import * as XLSX from 'xlsx';
import { detectHeaderRow, type ImportKind } from './dictionary';
import { stripIdColumns, type RemovedColumn } from '../protect';

export interface ParsedTable {
  /** صفوف نظيفة: بلا أعمدة هوية، وأي رقم بنمط الهوية داخل الخلايا مستبدل */
  rows: string[][];
  /** صف العناوين المكتشف، أو -1 ليختاره المستخدم */
  headerRow: number;
  /** عناوين الأعمدة المحذوفة فقط (بلا قيم) */
  removed: RemovedColumn[];
  sheetName?: string;
}

export type TableFileKind = 'xlsx' | 'xls' | 'csv' | 'docx';

export function tableKindOf(fileName: string): TableFileKind | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  return (['xlsx', 'xls', 'csv', 'docx'] as const).find((k) => k === ext) ?? null;
}

/** يزيل الصفوف الفارغة تمامًا من النهاية ويحوّل الخلايا إلى نص */
function tidy(rows: unknown[][]): unknown[][] {
  const out = rows.map((r) => (Array.isArray(r) ? r : []));
  while (out.length && out[out.length - 1].every((c) => String(c ?? '').trim() === '')) out.pop();
  return out;
}

function finish(raw: unknown[][], kind: ImportKind, sheetName?: string): ParsedTable {
  const rows = tidy(raw);
  const headerRow = detectHeaderRow(rows, kind);
  const { rows: clean, removed } = stripIdColumns(rows, headerRow);
  // من هذه النقطة لا يبقى مرجع للصفوف الخام
  rows.length = 0;
  return { rows: clean, headerRow, removed, sheetName };
}

/** يقرأ نص CSV بترميز UTF-8، وإن فشل فبترميز Windows-1256 (Excel العربي) */
export function decodeCsv(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1256').decode(buf);
  }
}

/** يختار الورقة التي يُكتشف فيها صف العناوين، وإلا الأولى */
function sheetRows(wb: XLSX.WorkBook, kind: ImportKind): { raw: unknown[][]; name: string } {
  let first: { raw: unknown[][]; name: string } | null = null;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: true });
    if (!first) first = { raw, name };
    if (detectHeaderRow(raw, kind) >= 0) return { raw, name };
  }
  return first ?? { raw: [], name: '' };
}

export function parseSpreadsheet(buf: ArrayBuffer, fileKind: 'xlsx' | 'xls' | 'csv', kind: ImportKind = 'students'): ParsedTable {
  const wb = fileKind === 'csv'
    ? XLSX.read(decodeCsv(buf), { type: 'string', raw: true })
    : XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: false });
  const { raw, name } = sheetRows(wb, kind);
  return finish(raw, kind, name);
}

/** جداول Word: يُحوَّل إلى HTML ثم تُقرأ الجداول مع فك الدمج (colspan) */
export async function parseDocx(buf: ArrayBuffer, kind: ImportKind = 'students'): Promise<ParsedTable> {
  const mammoth = (await import('mammoth')).default;
  // نسخة المتصفح تقبل arrayBuffer، ونسخة Node (في الاختبارات) تقبل buffer
  const NodeBuffer = (globalThis as { Buffer?: { from(b: ArrayBuffer): unknown } }).Buffer;
  const input = (NodeBuffer ? { buffer: NodeBuffer.from(buf) } : { arrayBuffer: buf }) as { arrayBuffer: ArrayBuffer };
  const { value: html } = await mammoth.convertToHtml(input);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const tables = Array.from(doc.querySelectorAll('table'));
  let raw: unknown[][] = [];
  if (tables.length) {
    // الجدول الذي يُكتشف فيه صف عناوين، وإلا الأكبر
    const asRows = tables.map((t) =>
      Array.from(t.querySelectorAll('tr')).map((tr) => {
        const cells: string[] = [];
        tr.querySelectorAll('td,th').forEach((td) => {
          const span = Math.max(1, Number(td.getAttribute('colspan') ?? 1));
          const text = (td.textContent ?? '').trim();
          cells.push(text);
          for (let i = 1; i < span; i++) cells.push('');
        });
        return cells;
      }));
    raw = asRows.find((r) => detectHeaderRow(r, kind) >= 0) ?? asRows.sort((a, b) => b.length - a.length)[0];
  } else {
    // بلا جدول: كل سطر صف، والفصل بعلامة جدولة أو فاصلة
    raw = (doc.body.textContent ?? '').split(/\n+/).map((l) => l.split(/\t|,|،/).map((c) => c.trim()));
  }
  return finish(raw, kind);
}

export async function parseTableFile(file: File | { name: string; arrayBuffer(): Promise<ArrayBuffer> }, kind: ImportKind = 'students'): Promise<ParsedTable> {
  const fk = tableKindOf(file.name);
  if (!fk) throw new Error('نوع الملف غير مدعوم للاستيراد. الأنواع المقبولة: xlsx وxls وcsv وdocx.');
  const buf = await file.arrayBuffer();
  return fk === 'docx' ? parseDocx(buf, kind) : parseSpreadsheet(buf, fk, kind);
}

/** عند اختيار صف العناوين يدويًا: يُعاد فحص العناوين لحذف أي عمود هوية بالعنوان */
export function applyManualHeaderRow(table: ParsedTable, headerRow: number): ParsedTable {
  const { rows, removed } = stripIdColumns(table.rows, headerRow);
  return { ...table, rows, headerRow, removed: [...table.removed, ...removed] };
}
