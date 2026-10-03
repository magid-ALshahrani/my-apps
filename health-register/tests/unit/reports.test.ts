import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { toXlsx, toDocx, planGrid, PLAN_MONTHS, type ReportModel } from '../../src/lib/reports';

const model: ReportModel = {
  title: 'التقرير الفصلي — الفصل الأول', subtitle: 'الفترة: من 23 أغسطس', school: { school_name: 'المدرسة التجريبية', region: 'الرياض' }, issuedAt: 'اليوم',
  sections: [
    { heading: 'المؤشرات العامة', kind: 'kv', rows: [['عدد الطلاب', '144']] },
    { heading: 'متابعة تنفيذ البرامج — التفاصيل', kind: 'table', columns: ['م', 'البرنامج', 'الحالة'], rows: [['1', 'اليوم العالمي للسكري', 'منفذ']] },
  ],
};

describe('تصدير Excel', () => {
  it('ورقة من اليمين لليسار وتحتوي قسم متابعة البرامج بالعربية', async () => {
    const wb = XLSX.read(await toXlsx(model), { type: 'array' });
    expect(wb.Workbook?.Views?.[0]?.RTL).toBe(true);
    const text = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
    expect(text).toContain('متابعة تنفيذ البرامج — التفاصيل');
    expect(text).toContain('اليوم العالمي للسكري');
    expect(wb.Sheets[wb.SheetNames[0]]['B9']?.v ?? JSON.stringify(wb.Sheets[wb.SheetNames[0]])).toBeTruthy();
  });
});

describe('تصدير Word', () => {
  it('فقرات وجداول ثنائية الاتجاه بخط عربي', async () => {
    const buf = (await toDocx(model)) as Uint8Array;
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('<w:bidi');
    expect(xml).toContain('<w:rtl');
    expect(xml).toContain('<w:bidiVisual');
    expect(xml).toContain('متابعة تنفيذ البرامج — التفاصيل');
    expect(xml).toContain('Tajawal');
  });
});

describe('خطة المتابعة السنوية', () => {
  it('توزيع البرامج على الأشهر', () => {
    const g = planGrid([
      { id: '1', name: 'اليوم العالمي للسكري', start_date: '2026-11-14', end_date: '2026-11-14', effective_status: 'planned', semester: 'first' },
      { id: '2', name: 'النوم الصحي', start_date: '2027-01-17', end_date: '2027-06-10', effective_status: 'planned', semester: 'second' },
    ]);
    expect(PLAN_MONTHS[g[0].months.indexOf(true)]).toBe('نوفمبر');
    expect(g[0].months.filter(Boolean)).toHaveLength(1);
    expect(g[1].months.map((x, i) => (x ? PLAN_MONTHS[i] : null)).filter(Boolean)).toEqual(['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو']);
  });
});
