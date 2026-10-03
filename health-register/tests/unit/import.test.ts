import { describe, it, expect } from 'vitest';
import { parseSpreadsheet, parseDocx, parseTableFile, applyManualHeaderRow } from '../../src/lib/import/parse';
import { matchHeader, detectHeaderRow } from '../../src/lib/import/dictionary';
import { autoMap, toMapping, buildStudentRows, classifyDuplicates, missingPlacements, buildCommitteeRows, idRemovalLine } from '../../src/lib/import/build';
import { normalizeSaudiMobile } from '../../src/lib/phone';
import { isIdHeader, isIdColumnByContent, maskIdsInText, maskRecord } from '../../src/lib/protect';
import { validateAttachment, ID_FILE_MESSAGE } from '../../src/lib/files';
import { normalizeHeader } from '../../src/lib/text';
import { FAKE_IDS, noorLikeRows, makeXlsx, makeXls, makeCsv, makeDocx, asFile } from './fixtures';

const noIds = (v: unknown) => {
  const s = JSON.stringify(v);
  for (const id of FAKE_IDS) expect(s).not.toContain(id);
};

describe('محللات الملفات', () => {
  it('xlsx: يكتشف صف العناوين تحت سطور العنوان والخلايا المدمجة', () => {
    const t = parseSpreadsheet(makeXlsx(noorLikeRows()), 'xlsx');
    expect(t.headerRow).toBe(3);
    expect(t.rows[3]).toContain('اسْمُ الطَّالِب/ـة');
    expect(t.removed.map((r) => r.reason)).toEqual(['header']);
    noIds(t);
  });

  it('xls (BIFF8): يُقرأ ويُحذف عمود الهوية', () => {
    const t = parseSpreadsheet(makeXls(noorLikeRows()), 'xls');
    expect(t.headerRow).toBe(3);
    expect(t.removed).toHaveLength(1);
    noIds(t);
  });

  it('csv: UTF-8 مع BOM', async () => {
    const t = await parseTableFile(asFile(makeCsv(noorLikeRows()), 'list.csv'));
    expect(t.headerRow).toBe(3);
    expect(t.rows[4]).toContain('محمد  أحمد  علي');
    noIds(t);
  });

  it('docx: يقرأ الجدول من مستند Word', async () => {
    const t = await parseDocx(await makeDocx(noorLikeRows().slice(3)));
    expect(t.headerRow).toBe(0);
    expect(t.rows.length).toBe(6);
    expect(t.removed).toHaveLength(1);
    noIds(t);
  });

  it('نوع غير مدعوم يُرفض برسالة واضحة', async () => {
    await expect(parseTableFile(asFile(new ArrayBuffer(4), 'x.txt'))).rejects.toThrow(/غير مدعوم/);
  });
});

describe('قالب نور', () => {
  it('عناوين بتشكيل أو تطويل أو همزات مختلفة تُطابق القاموس', () => {
    expect(matchHeader('اسْمُ الطَّالِب/ـة').field).toBe('full_name');
    expect(matchHeader('اسم الطالبـــة').field).toBe('full_name');
    expect(matchHeader('الصّف').field).toBe('grade');
    expect(matchHeader('جوال ولي الامر').field).toBe('guardian_phone');
    expect(matchHeader('جوال ولي الأمر (الأب)').field).toBe('guardian_phone');
    expect(matchHeader('المرحلة الدراسيه').field).toBe('stage');
    expect(matchHeader('الشعبة').field).toBe('section');
    expect(normalizeHeader('إسم  الطالب/ـة')).toBe('اسم الطالب');
  });

  it('مطابقة تقريبية لخطأ إملائي بسيط', () => {
    const m = matchHeader('اسم الطالبب');
    expect(m.field).toBe('full_name');
    expect(m.status).toBe('fuzzy');
  });

  it('«الفصل الدراسي» لا يُربط بحقل الفصل', () => {
    expect(matchHeader('الفصل الدراسي').field).toBeNull();
    expect(matchHeader('الفصل الدراسي').status).toBe('rejected');
    const t = parseSpreadsheet(makeXlsx(noorLikeRows()), 'xlsx');
    const cols = autoMap(t, 'students');
    const semester = cols.find((c) => c.header === 'الفصل الدراسي')!;
    expect(semester.field).toBe('ignore');
    expect(cols.find((c) => c.header === 'الفصل')!.field).toBe('section');
  });

  it('الأرقام الهندية في الجوال تُحوَّل لصيغة موحدة، وغير الصالح يُعلَّم للمراجعة', () => {
    expect(normalizeSaudiMobile('٠٥٥١٢٣٤٥٦٧')).toBe('+966551234567');
    expect(normalizeSaudiMobile('+966551234568')).toBe('+966551234568');
    expect(normalizeSaudiMobile('00966 55 123 4569')).toBe('+966551234569');
    expect(normalizeSaudiMobile('551234570')).toBe('+966551234570');
    expect(normalizeSaudiMobile('12345')).toBeNull();
    const t = parseSpreadsheet(makeXlsx(noorLikeRows()), 'xlsx');
    const { rows } = buildStudentRows(t, toMapping(autoMap(t, 'students')));
    expect(rows[0].guardian_phone).toBe('+966551234567');
    const bad = rows.find((r) => r.full_name === 'سلمان فهد')!;
    expect(bad.guardian_phone).toBeNull();
    expect(bad.phone_needs_review).toBe(true);
  });

  it('الاسم يُحفظ كما كُتب بعد إزالة المسافات المكررة', () => {
    const t = parseSpreadsheet(makeXlsx(noorLikeRows()), 'xlsx');
    const { rows } = buildStudentRows(t, toMapping(autoMap(t, 'students')));
    expect(rows[0].full_name).toBe('محمد أحمد علي');
  });

  it('تكرار اسم في نفس الصف والفصل يظهر للمراجعة ولا يُدمج صامتًا', () => {
    const t = parseSpreadsheet(makeXlsx(noorLikeRows()), 'xlsx');
    const { rows } = buildStudentRows(t, toMapping(autoMap(t, 'students')));
    const items = classifyDuplicates(rows, []);
    expect(items).toHaveLength(5); // لا شيء اختفى
    const dup = items.find((i) => i.row.full_name === 'محمد احمد علي')!;
    expect(dup.duplicate).toBe('file');
    expect(dup.duplicateOfRow).toBe(5);
    expect(dup.action).toBe('skip');
    // مع طالب موجود
    const withExisting = classifyDuplicates(rows, [{ id: 'x', name_key: rows[1].name_key, grade: 'الاول', section: '1' }]);
    expect(withExisting[1].duplicate).toBe('existing');
    expect(withExisting[1].existingId).toBe('x');
  });

  it('المراحل والصفوف والفصول الناقصة تُعرض للموافقة', () => {
    const t = parseSpreadsheet(makeXlsx(noorLikeRows()), 'xlsx');
    const { rows } = buildStudentRows(t, toMapping(autoMap(t, 'students')));
    const need = missingPlacements(rows, [{ stage: 'ابتدائي', grade: 'الأول', section: '1' }]);
    expect(need).toEqual([{ stage: 'ابتدائي', grade: 'الثاني', section: '2', gender: null }]);
  });

  it('صف عناوين يدوي عند عدم الاكتشاف', () => {
    const rows = [['عنوان'], ['س', 'ص', 'ع'], ['أحمد', 'الأول', '1']];
    const t = parseSpreadsheet(makeXlsx(rows, false), 'xlsx');
    expect(t.headerRow).toBe(-1);
    const m = applyManualHeaderRow(t, 1);
    expect(m.headerRow).toBe(1);
  });

  it('قالب أعضاء اللجنة', () => {
    const t = parseSpreadsheet(makeXlsx([['الاسم', 'الجوال', 'الصفة'], ['سارة علي', '0551112223', 'رئيس اللجنة']], false), 'xlsx', 'committee');
    expect(t.headerRow).toBe(0);
    const { rows } = buildCommitteeRows(t, toMapping(autoMap(t, 'committee')));
    expect(rows[0]).toMatchObject({ full_name: 'سارة علي', phone: '+966551112223', title: 'رئيس اللجنة' });
  });

  it('سطر التقرير الصريح', () => {
    expect(idRemovalLine(1)).toBe('تم حذف عمود الهوية ولم يُحفظ');
  });
});

describe('حماية الهوية', () => {
  it('عمود هوية بعنوان معروف: يُكتشف ويُحذف', () => {
    for (const h of ['رقم الهوية', 'السجل المدني', 'رقم الإقامة', 'National ID', 'ID', 'Iqama', 'هوية الطالب']) expect(isIdHeader(h)).toBe(true);
    expect(isIdHeader('اسم الطالب')).toBe(false);
    const t = parseSpreadsheet(makeXlsx(noorLikeRows()), 'xlsx');
    expect(t.rows[3]).not.toContain('رقم الهويـــة');
    noIds(t);
  });

  it('عمود هوية بعنوان غير معروف («رقم 1»): يُكتشف بالمحتوى ويُحذف', () => {
    const rows = [
      ['اسم الطالب', 'الصف', 'الفصل', 'رقم 1'],
      ['أحمد', 'الأول', '1', FAKE_IDS[0]],
      ['سعد', 'الأول', '1', '١٠٠٠٠٠٠٠٠٢'], // أرقام هندية
      ['فهد', 'الأول', '1', FAKE_IDS[2]],
      ['علي', 'الأول', '1', ''],
    ];
    const t = parseSpreadsheet(makeXlsx(rows, false), 'xlsx');
    expect(t.removed).toEqual([{ header: 'رقم 1', index: 3, reason: 'content' }]);
    expect(t.rows[0]).toEqual(['اسم الطالب', 'الصف', 'الفصل']);
    noIds(t);
    expect(JSON.stringify(t)).not.toContain('١٠٠٠٠٠٠٠٠٢');
  });

  it('كشف المحتوى بعتبة 60%', () => {
    expect(isIdColumnByContent([FAKE_IDS[0], FAKE_IDS[1], FAKE_IDS[2], 'x', 'y'])).toBe(true);
    expect(isIdColumnByContent([FAKE_IDS[0], 'a', 'b', 'c'])).toBe(false);
  });

  it('هوية وهمية داخل حقل ملاحظات تُستبدل بـ [محذوف]', () => {
    expect(maskIdsInText(`راجع المستشفى، رقمه ${FAKE_IDS[0]} اليوم`)).toBe('راجع المستشفى، رقمه [محذوف] اليوم');
    expect(maskIdsInText('١٠٠٠٠٠٠٠٠١')).toBe('[محذوف]');
    expect(maskIdsInText('جوال 0551234567')).toBe('جوال 0551234567');
    expect(maskRecord({ notes: `x ${FAKE_IDS[1]}`, n: 3 })).toEqual({ notes: 'x [محذوف]', n: 3 });
    // داخل جدول مستورد: عمود ملاحظات فيه هوية واحدة لا تكفي لحذف العمود، فتُستبدل القيمة
    const rows = [['اسم الطالب', 'الصف', 'الفصل', 'ملاحظات'], ['أحمد', 'الأول', '1', `سجل ${FAKE_IDS[3]}`], ['سعد', 'الأول', '1', 'سليم'], ['فهد', 'الأول', '1', 'لا شيء']];
    const t = parseSpreadsheet(makeXlsx(rows, false), 'xlsx');
    const { rows: out } = buildStudentRows(t, toMapping(autoMap(t, 'students')), { stage: 'ابتدائي' });
    expect(out[0].notes).toBe('سجل [محذوف]');
    noIds(t);
  });

  it('رفع ملف فيه هويات كمرفق يُرفض برسالة التوجيه', async () => {
    for (const [buf, name] of [[makeXlsx(noorLikeRows()), 'a.xlsx'], [makeCsv(noorLikeRows()), 'a.csv'], [await makeDocx(noorLikeRows().slice(3)), 'a.docx']] as const) {
      const r = await validateAttachment(asFile(buf, name));
      expect(r).toEqual({ ok: false, error: ID_FILE_MESSAGE });
    }
    const clean = await validateAttachment(asFile(makeXlsx([['البرنامج', 'العدد'], ['توعية', '30']], false), 'ok.xlsx'));
    expect(clean.ok).toBe(true);
  });

  it('الأنواع والأحجام غير المسموحة تُرفض', async () => {
    expect((await validateAttachment(asFile(new TextEncoder().encode('x').buffer as ArrayBuffer, 'a.exe'))).error).toMatch(/غير مدعوم/);
    expect((await validateAttachment(asFile(new TextEncoder().encode('not a pdf').buffer as ArrayBuffer, 'a.pdf'))).error).toMatch(/لا يطابق/);
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png');
    expect((await validateAttachment(big)).error).toMatch(/10 ميجابايت/);
  });

  it('detectHeaderRow يتجاهل سطور العنوان', () => {
    expect(detectHeaderRow(noorLikeRows())).toBe(3);
  });
});
