import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { supabase, friendlyError } from '../lib/supabase';
import { useAsync, must } from '../lib/data';
import { useRole } from '../lib/auth';
import { maskIdsInText, maskRecord } from '../lib/protect';
import { normalizeSaudiMobile, displayPhone } from '../lib/phone';
import { nameKey, cleanName } from '../lib/text';
import { dual, isoDate } from '../lib/dates';
import { PageHeader, Spinner, Empty, Modal, Field, Alert, useConfirm, useToast } from '../components/ui';
import { ConditionDot, CriticalBanner, type ConditionType } from '../components/ConditionDot';
import { Icon } from '../components/Icon';
import { Attachments } from '../components/Attachments';
import { suggestConditionFields } from '../lib/ocr';

interface Student { id: string; full_name: string; guardian_phone: string | null; phone_needs_review: boolean; notes: string | null; section_id: string }
export interface Condition {
  id: string; student_id: string; type_id: string; status: 'active' | 'recovered';
  medication: string | null; guardian_phone: string | null; doctor_notes: string | null; emergency_action: string | null; notes: string | null; started_on: string | null;
}

export default function SectionView() {
  const { sectionId } = useParams();
  const role = useRole();
  const isGuide = role === 'health_guide';
  const canCare = role === 'health_guide' || role === 'nurse';
  const [filter, setFilter] = useState<string | null>(null);
  const [showRecovered, setShowRecovered] = useState(false);
  const [openCond, setOpenCond] = useState<{ student: Student; cond?: Condition; typeId?: string } | null>(null);
  const [editStudent, setEditStudent] = useState<Student | 'new' | null>(null);

  const q = useAsync(async () => {
    const [sec, stu, types] = await Promise.all([
      supabase.from('sections').select('id,name,grades(name,stages(name,gender))').eq('id', sectionId!).single(),
      supabase.from('students').select('id,full_name,guardian_phone,phone_needs_review,notes,section_id').eq('section_id', sectionId!).order('full_name'),
      supabase.from('condition_types').select('*').order('sort'),
    ]);
    const students = must(stu) as Student[];
    const conds = students.length
      ? must(await supabase.from('student_conditions').select('*').in('student_id', students.map((s) => s.id))) as Condition[]
      : [];
    const s = must(sec) as unknown as { name: string; grades: { name: string; stages: { name: string; gender: string } } };
    return { section: s, students, types: must(types) as ConditionType[], conds };
  }, [sectionId]);

  const byStudent = useMemo(() => {
    const m = new Map<string, Condition[]>();
    for (const c of q.data?.conds ?? []) m.set(c.student_id, [...(m.get(c.student_id) ?? []), c]);
    return m;
  }, [q.data]);

  if (q.loading && !q.data) return <Spinner />;
  if (q.error) return <Alert tone="danger">{q.error}</Alert>;
  const { section, students, types } = q.data!;
  const typeById = new Map(types.map((t) => [t.id, t]));
  const visible = students.filter((s) => !filter || (byStudent.get(s.id) ?? []).some((c) => c.type_id === filter && c.status === 'active'));
  const title = `${section.grades.stages.name} · ${section.grades.name} · فصل ${section.name}`;

  return (
    <div>
      <PageHeader title={title} subtitle={<Link to="/classes" className="underline">كل الصفوف</Link>}
        actions={isGuide && <button className="btn-primary" onClick={() => setEditStudent('new')}><Icon name="plus" />طالب</button>} />

      {/* فلترة سريعة لكل حالة */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-3" role="group" aria-label="فلترة حسب الحالة">
        <button className={`chip shrink-0 ${!filter ? 'chip-on' : ''}`} style={{ minHeight: 44 }} aria-pressed={!filter} onClick={() => setFilter(null)}>الكل ({students.length})</button>
        {types.map((t) => {
          const n = students.filter((s) => (byStudent.get(s.id) ?? []).some((c) => c.type_id === t.id && c.status === 'active')).length;
          return (
            <button key={t.id} className={`chip shrink-0 ${filter === t.id ? 'chip-on' : ''}`} style={{ minHeight: 44 }} aria-pressed={filter === t.id} onClick={() => setFilter(filter === t.id ? null : t.id)}>
              <ConditionDot type={t} size={18} label={t.name} />{t.name} ({n})
            </button>
          );
        })}
      </div>
      <label className="inline-flex items-center gap-2 mb-3 text-sm text-muted" style={{ minHeight: 44 }}>
        <input type="checkbox" className="h-5 w-5" checked={showRecovered} onChange={(e) => setShowRecovered(e.target.checked)} />
        إظهار الحالات المتعافية
      </label>

      {students.length === 0 ? <Empty title="لا يوجد طلاب في هذا الفصل" hint={isGuide ? 'أضف طالبًا أو استورد القائمة.' : undefined} /> : (
        <ul className="card divide-y divide-border">
          {visible.map((s, i) => {
            const cs = (byStudent.get(s.id) ?? []).filter((c) => showRecovered || c.status === 'active');
            const critical = cs.filter((c) => typeById.get(c.type_id)?.is_critical && c.status === 'active');
            const dots = cs.filter((c) => !typeById.get(c.type_id)?.is_critical);
            return (
              <li key={s.id} className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-muted tabular-nums w-6 text-center shrink-0">{i + 1}</span>
                  <button className="font-medium text-start hover:underline flex-1 min-w-0" style={{ minHeight: 44 }} onClick={() => isGuide && setEditStudent(s)} disabled={!isGuide}>{s.full_name}</button>
                  {s.phone_needs_review && <span className="badge bg-warning-soft text-text shrink-0" title="رقم الجوال يحتاج مراجعة"><Icon name="phone" size={12} />مراجعة</span>}
                  <div className="flex items-center flex-wrap justify-end shrink-0 max-w-[50%]">
                    {dots.map((c) => (
                      <ConditionDot key={c.id} type={typeById.get(c.type_id)!} inactive={c.status === 'recovered'} onClick={() => setOpenCond({ student: s, cond: c })} />
                    ))}
                    {canCare && (
                      <button className="icon-btn text-primary" aria-label={`إضافة حالة لـ ${s.full_name}`} onClick={() => setOpenCond({ student: s })}><Icon name="plus" /></button>
                    )}
                  </div>
                </div>
                {critical.length > 0 && (
                  <div className="mt-1 ms-8">
                    <CriticalBanner names={critical.map((c) => typeById.get(c.type_id)!.name)} onClick={() => setOpenCond({ student: s, cond: critical[0] })} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {openCond && <ConditionDialog student={openCond.student} cond={openCond.cond} types={types} canEdit={canCare} canDelete={isGuide}
        onClose={() => setOpenCond(null)} onSaved={() => { setOpenCond(null); void q.reload(); }} />}
      {editStudent && <StudentDialog student={editStudent === 'new' ? null : editStudent} sectionId={sectionId!}
        onClose={() => setEditStudent(null)} onSaved={() => { setEditStudent(null); void q.reload(); }} />}
    </div>
  );
}

export function ConditionDialog({ student, cond, types, canEdit, canDelete, onClose, onSaved }: {
  student: { id: string; full_name: string; guardian_phone: string | null }; cond?: Condition; types: ConditionType[];
  canEdit: boolean; canDelete: boolean; onClose(): void; onSaved(): void;
}) {
  const toast = useToast();
  const { ask, ui } = useConfirm();
  const [f, setF] = useState({
    type_id: cond?.type_id ?? types.find((t) => !t.is_critical)?.id ?? '',
    status: cond?.status ?? 'active',
    medication: cond?.medication ?? '',
    guardian_phone: displayPhone(cond?.guardian_phone ?? student.guardian_phone),
    doctor_notes: cond?.doctor_notes ?? '',
    emergency_action: cond?.emergency_action ?? '',
    notes: cond?.notes ?? '',
    started_on: cond?.started_on ?? isoDate(),
  });
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(!cond);
  const type = types.find((t) => t.id === f.type_id);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    const phone = f.guardian_phone.trim() ? normalizeSaudiMobile(f.guardian_phone) : null;
    if (f.guardian_phone.trim() && !phone) return setError('رقم الجوال غير صالح (05xxxxxxxx).');
    const rec = maskRecord({ ...f, guardian_phone: phone, student_id: student.id, started_on: f.started_on || null });
    const r = cond ? await supabase.from('student_conditions').update(rec).eq('id', cond.id) : await supabase.from('student_conditions').insert(rec);
    if (r.error) setError(friendlyError(r.error)); else { toast('تم الحفظ'); onSaved(); }
  };
  const del = async () => {
    if (!cond || !(await ask('حذف هذه الحالة نهائيًا؟'))) return;
    const { error } = await supabase.from('student_conditions').delete().eq('id', cond.id);
    if (error) setError(friendlyError(error)); else onSaved();
  };

  const view = (label: string, v: string | null | undefined) => (
    <div><dt className="text-sm text-muted">{label}</dt><dd className="whitespace-pre-wrap">{v || '—'}</dd></div>
  );

  return (
    <Modal open onClose={onClose} title={`${cond ? 'تفاصيل الحالة' : 'إضافة حالة'} — ${student.full_name}`}
      footer={editing ? <>
        <button className="btn-ghost" onClick={onClose}>إلغاء</button>
        <button className="btn-primary" onClick={save} disabled={!canEdit}>حفظ</button>
      </> : <>
        {canDelete && <button className="btn-ghost text-danger me-auto" onClick={del}><Icon name="trash" />حذف</button>}
        {canEdit && <button className="btn-primary" onClick={() => setEditing(true)}><Icon name="edit" />تعديل</button>}
      </>}>
      {!editing && cond && type ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ConditionDot type={type} />
            <span className="font-heading font-bold">{type.name}</span>
            <span className={`badge ${cond.status === 'active' ? 'bg-primary-soft' : 'bg-surface-2'} text-text`}>{cond.status === 'active' ? 'نشطة' : 'متعافية'}</span>
          </div>
          {type.is_critical && <Alert tone="danger">حالة حرجة: اتبع إجراء الطوارئ فورًا.</Alert>}
          <dl className="grid gap-3">
            {view('إجراء الطوارئ', cond.emergency_action)}
            {view('الدواء', cond.medication)}
            <div><dt className="text-sm text-muted">جوال ولي الأمر</dt><dd>{cond.guardian_phone ? <a className="underline" dir="ltr" href={`tel:${cond.guardian_phone}`}>{displayPhone(cond.guardian_phone)}</a> : '—'}</dd></div>
            {view('ملاحظات الطبيب', cond.doctor_notes)}
            {view('ملاحظات', cond.notes)}
            {view('تاريخ البداية', cond.started_on ? dual(cond.started_on) : null)}
          </dl>
          <div>
            <div className="label">المرفقات</div>
            <Attachments ownerType="condition" ownerId={cond.id} canUpload={canEdit} canDelete={canDelete} suggest={suggestConditionFields}
              onApply={(s) => { const next = { ...f }; for (const x of s) if (x.field in next) (next as Record<string, string>)[x.field] = x.value; setF(next); setEditing(true); }} />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="نوع الحالة" required>
            <select className="field" value={f.type_id} onChange={set('type_id')}>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_critical ? ' (حرجة)' : ''}</option>)}
            </select>
          </Field>
          <fieldset>
            <legend className="label">الحالة</legend>
            <div className="flex gap-2">
              {(['active', 'recovered'] as const).map((s) => (
                <button key={s} type="button" className={`chip ${f.status === s ? 'chip-on' : ''}`} style={{ minHeight: 44 }} aria-pressed={f.status === s} onClick={() => setF({ ...f, status: s })}>{s === 'active' ? 'نشطة' : 'متعافية'}</button>
              ))}
            </div>
          </fieldset>
          <Field label="الدواء"><input className="field" value={f.medication} onChange={set('medication')} /></Field>
          <Field label="جوال ولي الأمر"><input className="field" dir="ltr" inputMode="tel" value={f.guardian_phone} onChange={set('guardian_phone')} placeholder="05xxxxxxxx" /></Field>
          <Field label="إجراء الطوارئ"><textarea className="field py-2" rows={2} value={f.emergency_action} onChange={set('emergency_action')} /></Field>
          <Field label="ملاحظات الطبيب"><textarea className="field py-2" rows={2} value={f.doctor_notes} onChange={set('doctor_notes')} /></Field>
          <Field label="ملاحظات" hint="لا تكتب أي رقم هوية؛ أي رقم بنمطها يُستبدل تلقائيًا."><textarea className="field py-2" rows={2} value={f.notes} onChange={set('notes')} /></Field>
          <Field label="تاريخ البداية"><input className="field" type="date" value={f.started_on} onChange={set('started_on')} /></Field>
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      )}
      {ui}
    </Modal>
  );
}

function StudentDialog({ student, sectionId, onClose, onSaved }: { student: Student | null; sectionId: string; onClose(): void; onSaved(): void }) {
  const { ask, ui } = useConfirm();
  const [name, setName] = useState(student?.full_name ?? '');
  const [phone, setPhone] = useState(displayPhone(student?.guardian_phone));
  const [notes, setNotes] = useState(student?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const full = cleanName(maskIdsInText(name));
    if (full.length < 2) return setError('الاسم مطلوب');
    const p = phone.trim() ? normalizeSaudiMobile(phone) : null;
    if (phone.trim() && !p) return setError('رقم الجوال غير صالح (05xxxxxxxx).');
    const rec = { full_name: full, name_key: nameKey(full), guardian_phone: p, phone_needs_review: false, notes: maskIdsInText(notes) || null, section_id: student?.section_id ?? sectionId };
    const r = student ? await supabase.from('students').update(rec).eq('id', student.id) : await supabase.from('students').insert(rec);
    if (r.error) setError(friendlyError(r.error)); else onSaved();
  };
  const del = async () => {
    if (!student || !(await ask(`حذف الطالب «${student.full_name}» وكل حالاته وسجلاته؟`))) return;
    const { error } = await supabase.from('students').delete().eq('id', student.id);
    if (error) setError(friendlyError(error)); else onSaved();
  };

  return (
    <Modal open onClose={onClose} title={student ? 'تعديل بيانات الطالب' : 'إضافة طالب'}
      footer={<>
        {student && <button className="btn-ghost text-danger me-auto" onClick={del}><Icon name="trash" />حذف</button>}
        <button className="btn-ghost" onClick={onClose}>إلغاء</button>
        <button className="btn-primary" onClick={save}>حفظ</button>
      </>}>
      <div className="space-y-4">
        <Field label="اسم الطالب" required><input className="field" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="جوال ولي الأمر"><input className="field" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05xxxxxxxx" /></Field>
        <Field label="ملاحظات"><textarea className="field py-2" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <p className="text-xs text-muted">معرّف الطالب داخلي فقط، ولا يُطلب أي رقم هوية.</p>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
      {ui}
    </Modal>
  );
}
