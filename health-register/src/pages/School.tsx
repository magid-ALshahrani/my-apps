// بقية أقسام السجل: الرسالة والرؤية، بيانات الموجه والنمو المهني، بيانات المدرسة وغرف المبنى، بيانات العيادة.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { supabase, friendlyError } from '../lib/supabase';
import { useAsync, must } from '../lib/data';
import { useRole } from '../lib/auth';
import { maskRecord } from '../lib/protect';
import { dual } from '../lib/dates';
import { MISSION, VISION, GENERAL_GOAL, DETAILED_GOALS, CLINIC_ITEMS } from '../lib/register';
import { PageHeader, Spinner, Field, Modal, Alert, useToast, useConfirm } from '../components/ui';
import { Icon } from '../components/Icon';

export function About() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="رسالة ورؤية وأهداف الصحة المدرسية" />
      <div className="space-y-4">
        <section className="card p-5"><h2 className="font-heading font-bold text-primary mb-2">رسالة الصحة المدرسية</h2><p>{MISSION}</p></section>
        <section className="card p-5"><h2 className="font-heading font-bold text-primary mb-2">رؤية الصحة المدرسية</h2><p>{VISION}</p></section>
        <section className="card p-5">
          <h2 className="font-heading font-bold text-primary mb-2">أهداف الصحة المدرسية</h2>
          <p><b>الهدف العام:</b> {GENERAL_GOAL}</p>
          <p className="mt-3 font-bold">الأهداف التفصيلية:</p>
          <ul className="list-disc ps-6 space-y-1 mt-1">{DETAILED_GOALS.map((g) => <li key={g}>{g}</li>)}</ul>
        </section>
      </div>
    </div>
  );
}

type Row = Record<string, string | number | boolean | null>;

/** نموذج صف واحد (جدول بمعرّف 1) بحقول معرّفة */
function SingleRowForm({ table, fields, canEdit, title }: { table: string; title: string; canEdit: boolean;
  fields: { key: string; label: string; type?: 'text' | 'number' | 'bool' | 'select' | 'email' | 'tel'; options?: string[] }[] }) {
  const toast = useToast();
  const q = useAsync(async () => must(await supabase.from(table).select(fields.map((f) => f.key).join(',')).eq('id', 1).single()) as unknown as Row, [table]);
  const [f, setF] = useState<Row | null>(null);
  useEffect(() => { if (q.data) setF(q.data); }, [q.data]);
  if (!f) return q.error ? <Alert tone="danger">{q.error}</Alert> : <Spinner />;
  return (
    <section className="card p-4">
      <h2 className="font-heading font-bold mb-3">{title}</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {fields.map((d) => (
          <Field key={d.key} label={d.label}>
            {d.type === 'bool' ? (
              <div className="flex gap-2">{([[true, 'نعم'], [false, 'لا']] as const).map(([v, l]) => (
                <button key={l} type="button" disabled={!canEdit} className={`chip ${f[d.key] === v ? 'chip-on' : ''}`} style={{ minHeight: 44 }} aria-pressed={f[d.key] === v} onClick={() => setF({ ...f, [d.key]: v })}>{l}</button>
              ))}</div>
            ) : d.type === 'select' ? (
              <select className="field" disabled={!canEdit} value={String(f[d.key] ?? '')} onChange={(e) => setF({ ...f, [d.key]: e.target.value || null })}>
                <option value="">—</option>{d.options!.map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : (
              <input className="field" readOnly={!canEdit} type={d.type === 'number' ? 'number' : d.type ?? 'text'} dir={d.type === 'email' || d.type === 'tel' ? 'ltr' : undefined}
                value={String(f[d.key] ?? '')} onChange={(e) => setF({ ...f, [d.key]: d.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value })} />
            )}
          </Field>
        ))}
      </div>
      {canEdit && <button className="btn-primary mt-3" onClick={async () => {
        const { error } = await supabase.from(table).update(maskRecord({ ...f })).eq('id', 1);
        if (error) toast(friendlyError(error), 'danger'); else toast('تم الحفظ');
      }}>حفظ</button>}
    </section>
  );
}

/** جدول قائمة بسيط (النمو المهني، غرف المبنى) */
function ListTable({ table, title, columns, canEdit }: { table: string; title: string; canEdit: boolean; columns: { key: string; label: string; type?: 'date' | 'number' }[] }) {
  const toast = useToast();
  const { ask, ui } = useConfirm();
  const q = useAsync(async () => must(await supabase.from(table).select('*').order('created_at')) as Row[], [table]);
  const [edit, setEdit] = useState<Row | null>(null);
  const save = async () => {
    if (!edit) return;
    const rec = maskRecord(Object.fromEntries(columns.map((c) => [c.key, edit[c.key] === '' ? null : edit[c.key] ?? null])));
    const r = edit.id ? await supabase.from(table).update(rec as never).eq('id', String(edit.id)) : await supabase.from(table).insert(rec as never);
    if (r.error) toast(friendlyError(r.error), 'danger'); else { setEdit(null); void q.reload(); }
  };
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-heading font-bold">{title}</h2>
        {canEdit && <button className="btn-ghost" onClick={() => setEdit({})}><Icon name="plus" />إضافة</button>}
      </div>
      {q.loading ? <Spinner /> : (q.data ?? []).length === 0 ? <p className="text-muted">لا توجد بيانات.</p> : (
        <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>م</th>{columns.map((c) => <th key={c.key}>{c.label}</th>)}{canEdit && <th></th>}</tr></thead>
          <tbody>{q.data!.map((r, i) => (
            <tr key={String(r.id)}><td>{i + 1}</td>{columns.map((c) => <td key={c.key}>{c.type === 'date' && r[c.key] ? dual(String(r[c.key]), true) : String(r[c.key] ?? '—')}</td>)}
              {canEdit && <td className="whitespace-nowrap"><button className="icon-btn" aria-label="تعديل" onClick={() => setEdit(r)}><Icon name="edit" /></button>
                <button className="icon-btn text-danger" aria-label="حذف" onClick={async () => { if (await ask('حذف السجل؟')) { await supabase.from(table).delete().eq('id', String(r.id)); void q.reload(); } }}><Icon name="trash" /></button></td>}
            </tr>))}</tbody>
        </table></div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={title} footer={<><button className="btn-ghost" onClick={() => setEdit(null)}>إلغاء</button><button className="btn-primary" onClick={save}>حفظ</button></>}>
        {edit && <div className="space-y-4">{columns.map((c) => (
          <Field key={c.key} label={c.label}><input className="field" type={c.type ?? 'text'} value={String(edit[c.key] ?? '')} onChange={(e) => setEdit({ ...edit, [c.key]: c.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value })} /></Field>
        ))}</div>}
      </Modal>
      {ui}
    </section>
  );
}

/** بيانات العيادة المدرسية: الممرض والتواصل و22 عنصرًا تجهيزيًا */
export function Clinic() {
  const role = useRole();
  const canEdit = role === 'health_guide' || role === 'nurse';
  const toast = useToast();
  const q = useAsync(async () => must(await supabase.from('clinic_info').select('*').eq('id', 1).single()) as { nurse_name: string | null; nurse_phone: string | null; nurse_email: string | null; items: Record<string, { ok: boolean | null; note: string }>; notes: string | null });
  const [f, setF] = useState<typeof q.data>(null);
  useEffect(() => { if (q.data) setF(q.data); }, [q.data]);
  if (!f) return <Spinner />;
  const setItem = (i: number, v: Partial<{ ok: boolean | null; note: string }>) => setF({ ...f, items: { ...f.items, [i + 1]: { ...{ ok: null, note: '' }, ...f.items[i + 1], ...v } } });
  const have = CLINIC_ITEMS.filter((_, i) => f.items[i + 1]?.ok).length;
  return (
    <section className="space-y-4">
      <div className="card p-4 grid sm:grid-cols-3 gap-3">
        <Field label="ممرض/ة المدرسة"><input className="field" readOnly={!canEdit} value={f.nurse_name ?? ''} onChange={(e) => setF({ ...f, nurse_name: e.target.value })} /></Field>
        <Field label="رقم التواصل"><input className="field" dir="ltr" readOnly={!canEdit} value={f.nurse_phone ?? ''} onChange={(e) => setF({ ...f, nurse_phone: e.target.value })} /></Field>
        <Field label="البريد الإلكتروني"><input className="field" dir="ltr" readOnly={!canEdit} value={f.nurse_email ?? ''} onChange={(e) => setF({ ...f, nurse_email: e.target.value })} /></Field>
      </div>
      <div className="card overflow-hidden">
        <div className="px-4 py-2 bg-surface-2 flex justify-between"><h2 className="font-heading font-bold">التجهيزات (22 عنصرًا)</h2><span className="text-sm">متوفر: {have}/{CLINIC_ITEMS.length}</span></div>
        <ul className="divide-y divide-border">{CLINIC_ITEMS.map((name, i) => {
          const it = f.items[i + 1];
          return (
            <li key={i} className="p-3 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <span><span className="text-muted tabular-nums me-1">{i + 1}.</span>{name}</span>
              <div className="flex gap-1" role="radiogroup" aria-label={name}>{([[true, 'نعم'], [false, 'لا']] as const).map(([v, l]) => (
                <button key={l} type="button" role="radio" aria-checked={it?.ok === v} disabled={!canEdit} className={`chip ${it?.ok === v ? (v ? 'chip-on' : 'bg-danger text-surface border-danger') : ''}`} style={{ minHeight: 44, minWidth: 56 }} onClick={() => setItem(i, { ok: it?.ok === v ? null : v })}>{l}</button>
              ))}</div>
              <input className="field" placeholder="ملاحظات" readOnly={!canEdit} value={it?.note ?? ''} onChange={(e) => setItem(i, { note: e.target.value })} aria-label={`ملاحظات: ${name}`} />
            </li>
          );
        })}</ul>
      </div>
      <Field label="ملاحظات"><textarea className="field py-2" rows={2} readOnly={!canEdit} value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      {canEdit && <button className="btn-primary" onClick={async () => {
        const { error } = await supabase.from('clinic_info').update(maskRecord({ nurse_name: f.nurse_name, nurse_phone: f.nurse_phone, nurse_email: f.nurse_email, notes: f.notes, items: f.items })).eq('id', 1);
        if (error) toast(friendlyError(error), 'danger'); else toast('تم الحفظ');
      }}>حفظ</button>}
    </section>
  );
}

export default function School() {
  const role = useRole();
  const isGuide = role === 'health_guide';
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'guide';
  const tabs = [['guide', 'بيانات الموجه الصحي'], ['school', 'بيانات المدرسة'], ['clinic', 'العيادة المدرسية']];
  return (
    <div className="space-y-4">
      <PageHeader title="بيانات المدرسة والسجل" actions={<button className="btn-ghost" onClick={() => window.print()}><Icon name="print" />طباعة</button>} />
      <div className="flex gap-2 overflow-x-auto pb-1 no-print" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`chip shrink-0 ${tab === k ? 'chip-on' : ''}`} style={{ minHeight: 44 }} onClick={() => setParams({ tab: k })}>{l}</button>)}
      </div>
      {tab === 'guide' && <>
        <SingleRowForm table="guide_info" title="بيانات الموجه/ة الصحي/ة" canEdit={isGuide} fields={[
          { key: 'full_name', label: 'الاسم الرباعي' }, { key: 'qualification', label: 'المؤهل' }, { key: 'specialty', label: 'التخصص' },
          { key: 'cadre', label: 'الكادر', type: 'select', options: ['تعليمي', 'إداري'] }, { key: 'weekly_classes', label: 'عدد الحصص', type: 'number' },
          { key: 'has_foundation_cert', label: 'الحصول على شهادة البرنامج التأسيسي في التوجيه الصحي', type: 'bool' },
          { key: 'guidance_years', label: 'سنوات الخبرة في التوجيه الصحي', type: 'number' }, { key: 'service_years', label: 'سنوات الخدمة', type: 'number' },
          { key: 'phone', label: 'الجوال', type: 'tel' }, { key: 'email', label: 'البريد الإلكتروني الرسمي', type: 'email' },
          { key: 'has_first_aid', label: 'الحصول على دورة الإسعافات الأولية', type: 'bool' }, { key: 'other_tasks', label: 'المهام الأخرى المسندة' },
        ]} />
        <ListTable table="professional_development" title="النمو المهني في مجال التوجيه الصحي" canEdit={isGuide} columns={[
          { key: 'title', label: 'اسم البرنامج' }, { key: 'kind', label: 'نوعه' }, { key: 'provider', label: 'الجهة المنفذة' },
          { key: 'duration', label: 'مدتها' }, { key: 'held_on', label: 'تاريخها', type: 'date' }, { key: 'notes', label: 'ملاحظات' },
        ]} />
      </>}
      {tab === 'school' && <>
        <SingleRowForm table="school_info" title="البيانات الأولية للمدرسة" canEdit={isGuide} fields={[
          { key: 'school_name', label: 'اسم المدرسة' }, { key: 'founded_year', label: 'عام التأسيس' }, { key: 'stat_number', label: 'الرقم الإحصائي' },
          { key: 'stage_label', label: 'المرحلة الدراسية', type: 'select', options: ['رياض أطفال', 'طفولة مبكرة', 'ابتدائي', 'متوسط', 'ثانوي'] },
          { key: 'education_type', label: 'نوع التعليم', type: 'select', options: ['حكومي', 'أهلي', 'عالمي', 'أخرى'] },
          { key: 'building_type', label: 'نوع المبنى', type: 'select', options: ['حكومي', 'مستأجر'] }, { key: 'district', label: 'موقع المدرسة (الحي)' },
          { key: 'health_center_name', label: 'المركز الصحي التابعة له المدرسة' }, { key: 'phone', label: 'هاتف المدرسة', type: 'tel' },
          { key: 'shift', label: 'الفترة', type: 'select', options: ['صباحي', 'مسائي'] }, { key: 'email', label: 'البريد الإلكتروني للمدرسة', type: 'email' },
          { key: 'student_count', label: 'عدد الطلاب/الطالبات', type: 'number' }, { key: 'guide_count', label: 'عدد الموجهين الصحيين', type: 'number' },
          { key: 'teacher_count', label: 'عدد المعلمين', type: 'number' }, { key: 'admin_count', label: 'عدد الإداريين', type: 'number' },
          { key: 'worker_count', label: 'عدد العاملين', type: 'number' }, { key: 'class_count', label: 'عدد الفصول', type: 'number' },
          { key: 'inclusion_class_count', label: 'عدد فصول الدمج', type: 'number' }, { key: 'clinic_exists', label: 'عيادة طبية', type: 'bool' },
          { key: 'clinic_equipment', label: 'تجهيزات العيادة', type: 'select', options: ['تجهيز مكتبي', 'تجهيز طبي', 'غير مجهز'] },
          { key: 'clinic_location', label: 'مقر العيادة', type: 'select', options: ['ذاتي', 'مشترك'] },
          { key: 'class_crowding', label: 'معدل الازدحام في الفصول', type: 'select', options: ['مناسب', 'غير مناسب'] },
          { key: 'yard_crowding', label: 'معدل الازدحام في الساحات', type: 'select', options: ['مناسب', 'غير مناسب'] },
        ]} />
        <ListTable table="building_rooms" title="غرف المبنى المدرسي" canEdit={isGuide} columns={[{ key: 'name', label: 'الغرفة' }, { key: 'count', label: 'العدد', type: 'number' }, { key: 'notes', label: 'ملاحظات' }]} />
      </>}
      {tab === 'clinic' && <Clinic />}
    </div>
  );
}
