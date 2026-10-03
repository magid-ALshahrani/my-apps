// ملفات عينة تُنشأ داخل الاختبار. كل أرقام الهوية هنا وهمية بوضوح (1000000001 وما شابه).
import * as XLSX from 'xlsx';
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun } from 'docx';

export const FAKE_IDS = ['1000000001', '1000000002', '2000000003', '1000000004', '2000000005'];

/** يحاكي تصدير نور: سطور عنوان وشعار وخلايا مدمجة فوق الجدول */
export function noorLikeRows(): unknown[][] {
  return [
    ['المملكة العربية السعودية', '', '', '', '', '', ''],
    ['وزارة التعليم - نظام نور', '', '', '', '', '', ''],
    ['كشف أسماء الطلاب للعام 1448هـ', '', '', '', '', '', ''],
    // عناوين بتشكيل وتطويل وهمزات مختلفة ولواحق
    ['رقم الهويـــة', 'اسْمُ الطَّالِب/ـة', 'المرحلة الدراسية', 'الصّف', 'الفصل', 'الفصل الدراسي', 'جوال ولي الامر'],
    [FAKE_IDS[0], 'محمد  أحمد  علي', 'ابتدائي', 'الأول', '1', 'الأول', '٠٥٥١٢٣٤٥٦٧'],
    [FAKE_IDS[1], 'خالد سعد', 'ابتدائي', 'الأول', '1', 'الأول', '+966551234568'],
    [FAKE_IDS[2], 'محمد احمد علي', 'ابتدائي', 'الأول', '1', 'الأول', '0551234569'],
    [FAKE_IDS[3], 'سلمان فهد', 'ابتدائي', 'الثاني', '2', 'الأول', '12345'],
    [FAKE_IDS[4], 'عبدالله ناصر', 'ابتدائي', 'الثاني', '2', 'الأول', '966551234570'],
  ];
}

export function makeXlsx(rows: unknown[][], merges = true): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (merges) ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }, { s: { r: 2, c: 0 }, e: { r: 2, c: 6 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'الطلاب');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return out;
}

export function makeXls(rows: unknown[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'array', bookType: 'biff8' }) as ArrayBuffer;
}

export function makeCsv(rows: unknown[][]): ArrayBuffer {
  const text = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

export async function makeDocx(rows: unknown[][]): Promise<ArrayBuffer> {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun('قائمة الطلاب')] }),
        new Table({
          rows: rows.map((r) => new TableRow({
            children: r.map((c) => new TableCell({ children: [new Paragraph(String(c))] })),
          })),
        }),
      ],
    }],
  });
  const buf = await Packer.toBuffer(doc);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export function asFile(buf: ArrayBuffer, name: string): File {
  return new File([buf], name);
}
