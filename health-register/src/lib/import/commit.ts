// حفظ الاستيراد بعد تأكيد المستخدم: الحقول المربوطة فقط، ولا حذف لأي طالب غير وارد في الملف.
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeArabic } from '../text';
import { maskIdsInText } from '../protect';
import type { ImportItem, PlacementNeed, Rejected, ImportReport, Gender, CommitteeRow } from './build';
import { placementKey } from './build';

interface StageRow { id: string; name: string; gender: Gender }
interface GradeRow { id: string; stage_id: string; name: string }
interface SectionRow { id: string; grade_id: string; name: string }

export async function loadPlacements(sb: SupabaseClient) {
  const [st, gr, se] = await Promise.all([
    sb.from('stages').select('id,name,gender'),
    sb.from('grades').select('id,stage_id,name'),
    sb.from('sections').select('id,grade_id,name'),
  ]);
  if (st.error || gr.error || se.error) throw new Error('تعذّر تحميل الصفوف');
  return { stages: st.data as StageRow[], grades: gr.data as GradeRow[], sections: se.data as SectionRow[] };
}

/** قائمة (مرحلة، صف، فصل) الموجودة بأسمائها، للمقارنة في المعاينة */
export function flattenPlacements(p: Awaited<ReturnType<typeof loadPlacements>>) {
  return p.sections.map((s) => {
    const g = p.grades.find((x) => x.id === s.grade_id)!;
    const st = p.stages.find((x) => x.id === g?.stage_id)!;
    return { section_id: s.id, stage: st?.name ?? '', grade: g?.name ?? '', section: s.name };
  });
}

export async function loadExistingStudents(sb: SupabaseClient) {
  const p = await loadPlacements(sb);
  const flat = flattenPlacements(p);
  const { data, error } = await sb.from('students').select('id,name_key,section_id');
  if (error) throw new Error('تعذّر تحميل الطلاب');
  return (data ?? []).map((s) => {
    const f = flat.find((x) => x.section_id === s.section_id);
    return { id: s.id as string, name_key: s.name_key as string, grade: f?.grade ?? '', section: f?.section ?? '' };
  });
}

const eq = (a: string, b: string) => normalizeArabic(a) === normalizeArabic(b);

/** ينشئ المراحل والصفوف والفصول الموافق عليها، ويُرجع خريطة (مرحلة|صف|فصل) ← section_id */
export async function ensurePlacements(sb: SupabaseClient, needs: PlacementNeed[], defaultGender: Gender) {
  const p = await loadPlacements(sb);
  for (const n of needs) {
    let stage = p.stages.find((s) => eq(s.name, n.stage));
    if (!stage) {
      const { data, error } = await sb.from('stages').insert({ name: n.stage, gender: n.gender ?? defaultGender, sort: p.stages.length }).select('id,name,gender').single();
      if (error) throw new Error('تعذّر إنشاء المرحلة');
      stage = data as StageRow; p.stages.push(stage);
    }
    let grade = p.grades.find((g) => g.stage_id === stage!.id && eq(g.name, n.grade));
    if (!grade) {
      const { data, error } = await sb.from('grades').insert({ stage_id: stage.id, name: n.grade, sort: p.grades.length }).select('id,stage_id,name').single();
      if (error) throw new Error('تعذّر إنشاء الصف');
      grade = data as GradeRow; p.grades.push(grade);
    }
    if (!p.sections.find((s) => s.grade_id === grade!.id && eq(s.name, n.section))) {
      const { data, error } = await sb.from('sections').insert({ grade_id: grade.id, name: n.section, sort: p.sections.length }).select('id,grade_id,name').single();
      if (error) throw new Error('تعذّر إنشاء الفصل');
      p.sections.push(data as SectionRow);
    }
  }
  const map = new Map<string, string>();
  for (const f of flattenPlacements(p)) map.set(`${normalizeArabic(f.stage)}|${placementKey(f.grade, f.section)}`, f.section_id);
  return map;
}

export async function commitStudentImport(
  sb: SupabaseClient,
  items: ImportItem[],
  approvedNeeds: PlacementNeed[],
  rejectedEarlier: Rejected[],
  idColumnsRemoved: number,
  defaultGender: Gender = 'boys',
): Promise<ImportReport> {
  const map = await ensurePlacements(sb, approvedNeeds, defaultGender);
  const report: ImportReport = { added: 0, updated: 0, skipped: 0, rejected: [...rejectedEarlier], idColumnsRemoved, phonesFlagged: 0 };
  const toInsert: Record<string, unknown>[] = [];
  for (const it of items) {
    const r = it.row;
    if (it.action === 'skip') { report.skipped++; continue; }
    const section_id = map.get(`${normalizeArabic(r.stage)}|${placementKey(r.grade, r.section)}`);
    if (!section_id) { report.rejected.push({ rowNumber: r.rowNumber, reason: 'الفصل غير موجود ولم تتم الموافقة على إنشائه' }); continue; }
    const rec = {
      full_name: maskIdsInText(r.full_name), name_key: r.name_key, section_id,
      guardian_phone: r.guardian_phone, phone_needs_review: r.phone_needs_review,
      notes: r.notes ? maskIdsInText(r.notes) : null,
    };
    if (r.phone_needs_review) report.phonesFlagged++;
    if (it.action === 'update' && it.existingId) {
      const upd: Record<string, unknown> = { section_id, phone_needs_review: r.phone_needs_review };
      if (r.guardian_phone) upd.guardian_phone = r.guardian_phone;
      if (rec.notes) upd.notes = rec.notes;
      const { error } = await sb.from('students').update(upd).eq('id', it.existingId);
      if (error) report.rejected.push({ rowNumber: r.rowNumber, reason: 'تعذّر التحديث' });
      else report.updated++;
    } else {
      toInsert.push(rec);
    }
  }
  for (let i = 0; i < toInsert.length; i += 200) {
    const chunk = toInsert.slice(i, i + 200);
    const { error } = await sb.from('students').insert(chunk);
    if (error) report.rejected.push({ rowNumber: 0, reason: `تعذّر حفظ ${chunk.length} صفًا` });
    else report.added += chunk.length;
  }
  return report;
}

export async function commitCommitteeImport(sb: SupabaseClient, rows: CommitteeRow[], rejected: Rejected[], idColumnsRemoved: number): Promise<ImportReport> {
  const { data: existing } = await sb.from('committee_members').select('full_name');
  const have = new Set((existing ?? []).map((e) => normalizeArabic(e.full_name as string)));
  const report: ImportReport = { added: 0, updated: 0, skipped: 0, rejected: [...rejected], idColumnsRemoved, phonesFlagged: 0 };
  const fresh = rows.filter((r) => {
    if (have.has(normalizeArabic(r.full_name))) { report.skipped++; return false; }
    return true;
  });
  if (fresh.length) {
    const { error } = await sb.from('committee_members').insert(fresh.map((r, i) => ({
      full_name: maskIdsInText(r.full_name), phone: r.phone, title: maskIdsInText(r.title), sort: 100 + i })));
    if (error) report.rejected.push({ rowNumber: 0, reason: 'تعذّر الحفظ' });
    else report.added = fresh.length;
  }
  return report;
}
