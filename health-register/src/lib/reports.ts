// نموذج تقرير واحد يُصدَّر بثلاث صيغ: HTML للطباعة/PDF، وWord (docx)، وExcel (SheetJS).
import type { SupabaseClient } from '@supabase/supabase-js';
import { PROGRAM_STATUS, SKIP_REASONS, SEMESTER_LABEL } from './data';
import { dual, isoDate, parseDate, addDays, time } from './dates';
import { RECORD_KINDS, VISIT_OUTCOMES, REFERRAL_STATUS, ENV_SECTIONS } from './register';

export type Section =
  | { heading: string; kind: 'kv'; rows: [string, string][] }
  | { heading: string; kind: 'table'; columns: string[]; rows: string[][]; note?: string };

export interface ReportModel {
  title: string;
  subtitle: string;
  school: { school_name: string; region: string };
  issuedAt: string;
  sections: Section[];
  approval?: string | null;
}

const MONTHS = [8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6]; // أغسطس ← يونيو
const MONTH_NAMES: Record<number, string> = { 8: 'أغسطس', 9: 'سبتمبر', 10: 'أكتوبر', 11: 'نوفمبر', 12: 'ديسمبر', 1: 'يناير', 2: 'فبراير', 3: 'مارس', 4: 'أبريل', 5: 'مايو', 6: 'يونيو' };
const pct = (n: number, d: number) => (d ? `${Math.round((n * 100) / d)}%` : '—');

async function school(sb: SupabaseClient) {
  const { data, error } = await sb.from('school_info').select('*').single();
  if (error) throw error;
  return data as { school_name: string; region: string; year_start: string; sem1_end: string; sem2_start: string; year_end: string };
}

export function semesterRange(s: { year_start: string; sem1_end: string; sem2_start: string; year_end: string }, sem: 'first' | 'second') {
  return sem === 'first' ? { from: s.year_start, to: s.sem1_end } : { from: s.sem2_start, to: s.year_end };
}

/** التقرير الفصلي، ويتضمن قسم متابعة تنفيذ البرامج */
export async function buildSemesterReport(sb: SupabaseClient, sem: 'first' | 'second', opts: { includeViolence?: boolean } = {}): Promise<ReportModel> {
  const sc = await school(sb);
  const { from, to } = semesterRange(sc, sem);
  const toEnd = isoDate(addDays(parseDate(to), 1));
  const [stats, programs, records, visits, referrals, env, approval] = await Promise.all([
    sb.rpc('dashboard_stats'),
    sb.from('programs_view').select('*').in('semester', sem === 'first' ? ['pre', 'first', 'both'] : ['second', 'both']).eq('is_unofficial_day', false).order('start_date'),
    sb.from('official_records').select('kind').gte('case_date', from).lte('case_date', to),
    sb.from('clinic_visits').select('outcome').gte('visited_at', parseDate(from).toISOString()).lt('visited_at', parseDate(toEnd).toISOString()),
    sb.from('referrals').select('status').gte('sent_on', from).lte('sent_on', to),
    sb.from('env_inspections').select('inspected_on,answers').gte('inspected_on', from).lte('inspected_on', to).order('inspected_on', { ascending: false }).limit(1),
    sb.from('report_approvals').select('approved_at').eq('report_kind', 'semester').eq('period', `1448-${sem}`).maybeSingle(),
  ]);
  for (const r of [stats, programs, records, visits, referrals, env]) if (r.error) throw r.error;
  const st = stats.data as { students_total: number; conditions_by_type: { name: string; count: number }[]; open_referrals: number; beneficiaries_pct: number | null };
  const progs = programs.data as { name: string; start_date: string; end_date: string | null; effective_status: string; actual_date: string | null; beneficiaries: number | null; skip_reason: string | null; skip_note: string | null; new_date: string | null; semester: string }[];

  const sections: Section[] = [];
  sections.push({ heading: 'المؤشرات العامة', kind: 'kv', rows: [
    ['عدد الطلاب', String(st.students_total)],
    ...st.conditions_by_type.filter((c) => c.count > 0).map((c) => [`حالات نشطة: ${c.name}`, String(c.count)] as [string, string]),
    ['التحويلات المفتوحة', String(st.open_referrals)],
    ['نسبة الطلبة المستفيدين من البرامج', st.beneficiaries_pct === null ? '—' : `${st.beneficiaries_pct}%`],
  ] });

  // متابعة تنفيذ البرامج
  const statusCount = (s: string) => progs.filter((p) => p.effective_status === s).length;
  sections.push({ heading: 'متابعة تنفيذ البرامج — ملخص', kind: 'table', columns: ['الحالة', 'العدد', 'النسبة'],
    rows: ['done', 'not_done', 'postponed', 'planned', 'late'].map((s) => [PROGRAM_STATUS[s].label, String(statusCount(s)), pct(statusCount(s), progs.length)]) });
  sections.push({ heading: 'متابعة تنفيذ البرامج — التفاصيل', kind: 'table',
    columns: ['م', 'البرنامج', 'الفصل', 'الموعد', 'الحالة', 'تاريخ التنفيذ', 'المستفيدون', 'السبب / ملاحظات'],
    rows: progs.map((p, i) => [String(i + 1), p.name, SEMESTER_LABEL[p.semester], dual(p.start_date, true), PROGRAM_STATUS[p.effective_status]?.label ?? p.effective_status,
      p.actual_date ? dual(p.actual_date, true) : '—', p.beneficiaries?.toString() ?? '—',
      p.skip_reason ? `${SKIP_REASONS[p.skip_reason]}${p.skip_note ? ` — ${p.skip_note}` : ''}${p.new_date ? ` (الموعد الجديد ${dual(p.new_date, true)})` : ''}` : '—']) });
  const reasons = Object.entries(SKIP_REASONS).map(([k, l]) => [l, String(progs.filter((p) => p.skip_reason === k).length)]).filter((r) => r[1] !== '0');
  if (reasons.length) sections.push({ heading: 'أسباب عدم التنفيذ والتأجيل', kind: 'table', columns: ['السبب', 'العدد'], rows: reasons });

  const rec = records.data as { kind: keyof typeof RECORD_KINDS }[];
  sections.push({ heading: 'سجلات المتابعة الرسمية خلال الفصل', kind: 'table', columns: ['السجل', 'عدد الحالات'],
    rows: (Object.keys(RECORD_KINDS) as (keyof typeof RECORD_KINDS)[]).map((k) => [RECORD_KINDS[k].short, String(rec.filter((r) => r.kind === k).length)]) });
  if (opts.includeViolence) {
    const v = await sb.from('violence_cases').select('id', { count: 'exact', head: true }).gte('case_date', from).lte('case_date', to);
    if (v.error) throw new Error('تعذّر تضمين سجل العنف: أعد إدخال كلمة المرور.');
    sections.push({ heading: 'سجل العنف الأسري (عدد فقط، بقرار من الموجه الصحي)', kind: 'kv', rows: [['عدد الحالات خلال الفصل', String(v.count ?? 0)]] });
  }
  const vis = visits.data as { outcome: keyof typeof VISIT_OUTCOMES }[];
  sections.push({ heading: 'زيارات العيادة', kind: 'table', columns: ['النتيجة', 'العدد'],
    rows: [...(Object.keys(VISIT_OUTCOMES) as (keyof typeof VISIT_OUTCOMES)[]).map((k) => [VISIT_OUTCOMES[k], String(vis.filter((v) => v.outcome === k).length)]), ['الإجمالي', String(vis.length)]] });
  const ref = referrals.data as { status: keyof typeof REFERRAL_STATUS }[];
  sections.push({ heading: 'التحويل للمراكز الصحية', kind: 'table', columns: ['الحالة', 'العدد'],
    rows: [...(Object.keys(REFERRAL_STATUS) as (keyof typeof REFERRAL_STATUS)[]).map((k) => [REFERRAL_STATUS[k], String(ref.filter((r) => r.status === k).length)]), ['الإجمالي', String(ref.length)]] });
  const lastEnv = (env.data as { inspected_on: string; answers: Record<string, { yes: boolean | null }> }[])[0];
  if (lastEnv) {
    const rows = ENV_SECTIONS.map((s) => {
      const ans = s.items.map((i) => lastEnv.answers[i.key]?.yes).filter((x) => x !== null && x !== undefined);
      return [s.title, `${ans.filter(Boolean).length}/${ans.length}`, pct(ans.filter(Boolean).length, ans.length)];
    });
    sections.push({ heading: `تفقد البيئة المدرسية (${dual(lastEnv.inspected_on, true)})`, kind: 'table', columns: ['القسم', 'نعم/المجاب', 'الالتزام'], rows });
  }
  return {
    title: `التقرير الفصلي — ${SEMESTER_LABEL[sem]}`,
    subtitle: `الفترة: ${dual(from, true)} إلى ${dual(to, true)}`,
    school: sc, issuedAt: dual(new Date()), sections,
    approval: approval.data ? `اعتمده مدير/ة المدرسة في ${dual(approval.data.approved_at as string, true)}` : null,
  };
}

/** التقرير اليومي: مصدره زيارات العيادة */
export async function buildDailyReport(sb: SupabaseClient, day: string): Promise<ReportModel> {
  const sc = await school(sb);
  const start = parseDate(day); start.setHours(0, 0, 0, 0);
  const { data, error } = await sb.from('clinic_visits').select('visited_at,complaint,action,outcome,students(full_name,sections(name,grades(name)))')
    .gte('visited_at', start.toISOString()).lt('visited_at', addDays(start, 1).toISOString()).order('visited_at');
  if (error) throw error;
  const rows = data as unknown as { visited_at: string; complaint: string; action: string | null; outcome: keyof typeof VISIT_OUTCOMES; students: { full_name: string; sections: { name: string; grades: { name: string } } | null } }[];
  return {
    title: 'التقرير اليومي لزيارات العيادة', subtitle: dual(day), school: sc, issuedAt: dual(new Date()),
    sections: [
      { heading: 'الملخص', kind: 'kv', rows: [['عدد الزيارات', String(rows.length)], ...(Object.keys(VISIT_OUTCOMES) as (keyof typeof VISIT_OUTCOMES)[]).map((k) => [VISIT_OUTCOMES[k], String(rows.filter((r) => r.outcome === k).length)] as [string, string])] },
      { heading: 'الزيارات', kind: 'table', columns: ['م', 'الوقت', 'الطالب', 'الصف', 'الشكوى', 'الإجراء', 'النتيجة'],
        rows: rows.map((r, i) => [String(i + 1), time(r.visited_at), r.students.full_name, r.students.sections ? `${r.students.sections.grades.name}/${r.students.sections.name}` : '—', r.complaint, r.action ?? '—', VISIT_OUTCOMES[r.outcome]]) },
    ],
  };
}

/** خطة المتابعة السنوية: البرامج × الأشهر (أغسطس ← يونيو) مع حالة التنفيذ */
export interface PlanRow { id: string; name: string; months: boolean[]; status: string; semester: string }
export function planGrid(programs: { id: string; name: string; start_date: string; end_date: string | null; effective_status: string; semester: string }[]): PlanRow[] {
  return programs.map((p) => {
    const s = parseDate(p.start_date); const e = parseDate(p.end_date ?? p.start_date);
    const months = MONTHS.map((m) => {
      const y = m >= 8 ? 2026 : 2027;
      const ms = new Date(y, m - 1, 1); const me = new Date(y, m, 0);
      return s <= me && e >= ms;
    });
    return { id: p.id, name: p.name, months, status: p.effective_status, semester: p.semester };
  });
}
export const PLAN_MONTHS = MONTHS.map((m) => MONTH_NAMES[m]);

export async function buildPlanReport(sb: SupabaseClient): Promise<ReportModel> {
  const sc = await school(sb);
  const { data, error } = await sb.from('programs_view').select('id,name,start_date,end_date,effective_status,semester').eq('is_unofficial_day', false).order('start_date').order('sort');
  if (error) throw error;
  const grid = planGrid(data as never);
  return {
    title: 'الخطة الزمنية لبرامج الصحة المدرسية ومتابعتها 1448هـ', subtitle: 'البرنامج والفعالية حسب الأشهر مع حالة التنفيذ', school: sc, issuedAt: dual(new Date()),
    sections: [{ heading: 'خطة المتابعة السنوية', kind: 'table', columns: ['البرنامج والفعالية', ...PLAN_MONTHS, 'الحالة'],
      rows: grid.map((g) => [g.name, ...g.months.map((x) => (x ? '●' : '')), PROGRAM_STATUS[g.status]?.label ?? g.status]),
      note: '● = شهر التنفيذ المخطط' }],
  };
}

// ===================== التصدير =====================

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Excel: ورقة واحدة باتجاه من اليمين لليسار */
export async function toXlsx(m: ReportModel): Promise<Uint8Array> {
  const XLSX = await import('xlsx');
  const aoa: (string | number)[][] = [
    ['المملكة العربية السعودية — وزارة التعليم — الشؤون الصحية المدرسية'],
    [`المدرسة: ${m.school.school_name || '—'}`, `المنطقة: ${m.school.region || '—'}`],
    [m.title], [m.subtitle], [`تاريخ الإصدار: ${m.issuedAt}`], [],
  ];
  for (const s of m.sections) {
    aoa.push([s.heading]);
    if (s.kind === 'kv') s.rows.forEach((r) => aoa.push(r));
    else {
      aoa.push(s.columns);
      s.rows.forEach((r) => aoa.push(r.map((c) => (/^\d+$/.test(c) ? Number(c) : c))));
      if (s.note) aoa.push([s.note]);
    }
    aoa.push([]);
  }
  if (m.approval) aoa.push([m.approval]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 40 }, { wch: 16 }, { wch: 18 }, { wch: 22 }, { wch: 16 }, { wch: 18 }, { wch: 12 }, { wch: 40 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'التقرير');
  wb.Workbook = { Views: [{ RTL: true }] };
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
}

/** Word: فقرات وجداول ثنائية الاتجاه بخط عربي، وخلفية بيضاء */
export async function toDocx(m: ReportModel): Promise<Blob | Uint8Array> {
  const d = await import('docx');
  const FONT = 'Tajawal';
  const run = (text: string, bold = false, size = 22) => new d.TextRun({ text, bold, size, rightToLeft: true, font: { name: FONT, hint: 'cs' } as never, boldComplexScript: bold, sizeComplexScript: size } as never);
  const para = (text: string, opts: { bold?: boolean; size?: number; heading?: boolean; center?: boolean } = {}) => new d.Paragraph({
    bidirectional: true, alignment: opts.center ? d.AlignmentType.CENTER : d.AlignmentType.RIGHT,
    spacing: { after: opts.heading ? 120 : 60, before: opts.heading ? 240 : 0 },
    children: [run(text, opts.bold, opts.size)],
  });
  const border = { style: d.BorderStyle.SINGLE, size: 4, color: '888888' };
  const cell = (text: string, header = false) => new d.TableCell({
    children: [para(text, { bold: header, size: 20 })],
    shading: header ? { fill: 'E8F3F1', type: d.ShadingType.CLEAR, color: 'auto' } : undefined,
    borders: { top: border, bottom: border, left: border, right: border },
  });
  const children: (InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>)[] = [
    para('المملكة العربية السعودية — وزارة التعليم', { size: 20 }),
    para(`الإدارة العامة للتعليم بمنطقة ${m.school.region || '……'} — الشؤون الصحية المدرسية`, { size: 20 }),
    para(`اسم المدرسة: ${m.school.school_name || '……'}`, { size: 20 }),
    para(m.title, { bold: true, size: 32, center: true, heading: true }),
    para(m.subtitle, { center: true }),
    para(`تاريخ الإصدار: ${m.issuedAt}`, { size: 18, center: true }),
  ];
  for (const s of m.sections) {
    children.push(para(s.heading, { bold: true, size: 26, heading: true }));
    const rows = s.kind === 'kv'
      ? s.rows.map(([k, v]) => new d.TableRow({ children: [cell(k, true), cell(v)] }))
      : [new d.TableRow({ tableHeader: true, children: s.columns.map((c) => cell(c, true)) }), ...s.rows.map((r) => new d.TableRow({ children: r.map((c) => cell(c)) }))];
    children.push(new d.Table({ rows, visuallyRightToLeft: true, width: { size: 100, type: d.WidthType.PERCENTAGE } }));
    if (s.kind === 'table' && s.note) children.push(para(s.note, { size: 18 }));
  }
  children.push(para(m.approval ?? 'يعتمد،،، مدير/ة المدرسة: ………………   الموجه/ة الصحي/ة: ………………', { heading: true }));
  const doc = new d.Document({
    styles: { default: { document: { run: { font: FONT, size: 22, rightToLeft: true } as never, paragraph: { alignment: d.AlignmentType.RIGHT } } } },
    sections: [{ properties: { page: { size: { orientation: m.sections.some((s) => s.kind === 'table' && s.columns.length > 8) ? d.PageOrientation.LANDSCAPE : d.PageOrientation.PORTRAIT } } }, children }],
  });
  return typeof window === 'undefined' ? new Uint8Array(await d.Packer.toBuffer(doc)) : d.Packer.toBlob(doc);
}

export async function exportReport(m: ReportModel, kind: 'xlsx' | 'docx') {
  const name = safeName(m.title);
  if (kind === 'xlsx') download(new Blob([await toXlsx(m) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${name}.xlsx`);
  else download((await toDocx(m)) as Blob, `${name}.docx`);
}
