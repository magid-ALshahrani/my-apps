import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { pptxText, suggestProgramFields, suggestConditionFields, findDate } from '../../src/lib/ocr';
import { validateStatus } from '../../src/pages/Programs';
import { compliance } from '../../src/pages/Environment';
import { ENV_SECTIONS, CLINIC_ITEMS } from '../../src/lib/register';
import { validateAttachment } from '../../src/lib/files';

async function makePptx(slides: string[][]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  slides.forEach((paras, i) => zip.file(`ppt/slides/slide${i + 1}.xml`,
    `<p:sld><p:cSld><p:spTree>${paras.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join('')}</p:spTree></p:cSld></p:sld>`));
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('استخراج النص من العروض', () => {
  it('يقرأ نص الشرائح بالترتيب ويخفي أي هوية', async () => {
    const buf = await makePptx([['برنامج التوعية بالحساسية', 'عدد المستفيدين: 85'], ['رقم الطالب 1000000001', 'التاريخ 2026/10/12']]);
    const text = await pptxText(buf);
    expect(text).toContain('برنامج التوعية بالحساسية');
    expect(text).toContain('[محذوف]');
    expect(text).not.toContain('1000000001');
    expect(text.indexOf('85')).toBeLessThan(text.indexOf('[محذوف]'));
  });
  it('ملف pptx مقبول كمرفق', async () => {
    const buf = await makePptx([['شاهد']]);
    const r = await validateAttachment(new File([buf], 'evidence.pptx'));
    expect(r.ok).toBe(true);
  });
});

describe('اقتراح تعبئة الحقول (بلا حفظ)', () => {
  it('حقول توثيق البرنامج', () => {
    const s = suggestProgramFields('منفذ البرنامج: أ. نورة\nالهدف: رفع الوعي بالحساسية\nعدد المستفيدين: ١٢٠\nعدد الفصول: 6\nبتاريخ 12/10/2026');
    const m = Object.fromEntries(s.map((x) => [x.field, x.value]));
    expect(m).toMatchObject({ executor: 'أ. نورة', goal: 'رفع الوعي بالحساسية', beneficiaries: '120', classes_count: '6', doc_start: '2026-10-12' });
  });
  it('حقول الحالة الصحية مع إخفاء الهوية', () => {
    const s = suggestConditionFields('التشخيص: ربو شعبي - سجل 1000000002\nالعلاج: بخاخ فنتولين عند اللزوم');
    expect(s.find((x) => x.field === 'doctor_notes')!.value).toBe('ربو شعبي - سجل [محذوف]');
    expect(s.find((x) => x.field === 'medication')!.value).toBe('بخاخ فنتولين عند اللزوم');
  });
  it('التواريخ', () => {
    expect(findDate('2027-1-5')).toBe('2027-01-05');
    expect(findDate('٣/٤/٢٠٢٧')).toBe('2027-04-03');
    expect(findDate('بلا تاريخ')).toBeNull();
  });
});

describe('حالة التنفيذ في الواجهة', () => {
  it('«لم يُنفذ» و«مؤجل» بلا سبب تُرفض', () => {
    expect(validateStatus({ status: 'not_done' })).toMatch(/إلزامي/);
    expect(validateStatus({ status: 'postponed', skip_reason: 'weather' })).toMatch(/التاريخ الجديد/);
    expect(validateStatus({ status: 'not_done', skip_reason: 'other', skip_note: ' ' })).toMatch(/أخرى/);
    expect(validateStatus({ status: 'done', actual_date: '2026-10-01', beneficiaries: '' })).toMatch(/المستفيدين/);
    expect(validateStatus({ status: 'postponed', skip_reason: 'exams', new_date: '2026-12-01' })).toBeNull();
    expect(validateStatus({ status: 'not_done', skip_reason: 'other', skip_note: 'سبب' })).toBeNull();
  });
});

describe('بنود السجل الرسمي', () => {
  it('تفقد البيئة: 22 بندًا في 5 أقسام، والعيادة 22 عنصرًا', () => {
    expect(ENV_SECTIONS.map((s) => s.items.length)).toEqual([4, 6, 5, 3, 4]);
    expect(CLINIC_ITEMS).toHaveLength(22);
  });
  it('نسبة الالتزام من البنود المجابة فقط', () => {
    expect(compliance({ clean_1: { yes: true, note: '' }, clean_2: { yes: false, note: '' }, clean_3: { yes: null, note: '' } })).toEqual({ answered: 2, yes: 1, pct: 50 });
  });
});
