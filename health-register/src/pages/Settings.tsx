import { useEffect, useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase';
import { useAsync, must, GENDER_LABEL } from '../lib/data';
import { PageHeader, Spinner, Alert, Field, Modal, useToast, useConfirm } from '../components/ui';
import { ConditionDot, type ConditionType } from '../components/ConditionDot';
import { Icon, CONDITION_ICONS } from '../components/Icon';

interface School {
  school_name: string; region: string; stage_label: string; gender: 'boys' | 'girls' | null;
  year_start: string; sem1_end: string; sem2_start: string; year_end: string; show_unofficial_days: boolean;
}

export default function Settings() {
  const toast = useToast();
  const school = useAsync(async () => must(await supabase.from('school_info').select('school_name,region,stage_label,gender,year_start,sem1_end,sem2_start,year_end,show_unofficial_days').single()) as School);
  const [f, setF] = useState<School | null>(null);
  useEffect(() => { if (school.data) setF(school.data); }, [school.data]);

  const save = async () => {
    if (!f) return;
    const { error } = await supabase.from('school_info').update(f).eq('id', 1);
    if (error) toast(friendlyError(error), 'danger'); else toast('تم حفظ الإعدادات');
  };

  if (!f) return school.error ? <Alert tone="danger">{school.error}</Alert> : <Spinner />;
  const set = (k: keyof School) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="space-y-6">
      <PageHeader title="الإعدادات" />
      <section className="card p-4 space-y-4">
        <h2 className="font-heading font-bold">المدرسة والعام الدراسي</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="اسم المدرسة"><input className="field" value={f.school_name} onChange={set('school_name')} /></Field>
          <Field label="إدارة التعليم بمنطقة"><input className="field" value={f.region} onChange={set('region')} /></Field>
          <Field label="المرحلة"><input className="field" value={f.stage_label} onChange={set('stage_label')} /></Field>
          <Field label="بنين/بنات">
            <select className="field" value={f.gender ?? ''} onChange={(e) => setF({ ...f, gender: (e.target.value || null) as School['gender'] })}>
              <option value="">—</option>{(['boys', 'girls'] as const).map((g) => <option key={g} value={g}>{GENDER_LABEL[g]}</option>)}
            </select>
          </Field>
          <Field label="بداية العام الدراسي"><input className="field" type="date" value={f.year_start} onChange={set('year_start')} /></Field>
          <Field label="نهاية الفصل الأول"><input className="field" type="date" value={f.sem1_end} onChange={set('sem1_end')} /></Field>
          <Field label="بداية الفصل الثاني"><input className="field" type="date" value={f.sem2_start} onChange={set('sem2_start')} /></Field>
          <Field label="نهاية العام الدراسي"><input className="field" type="date" value={f.year_end} onChange={set('year_end')} /></Field>
        </div>
        <label className="flex items-center gap-3" style={{ minHeight: 44 }}>
          <input type="checkbox" className="h-5 w-5" checked={f.show_unofficial_days} onChange={(e) => setF({ ...f, show_unofficial_days: e.target.checked })} />
          <span>إظهار أيام صحية عالمية إضافية في التقويم (تُوسَم «غير رسمي»)</span>
        </label>
        <button className="btn-primary" onClick={save}>حفظ</button>
      </section>
      <ConditionTypes />
    </div>
  );
}

function ConditionTypes() {
  const toast = useToast();
  const { ask, ui } = useConfirm();
  const q = useAsync(async () => must(await supabase.from('condition_types').select('*').order('sort')) as ConditionType[]);
  const [edit, setEdit] = useState<Partial<ConditionType> | null>(null);

  const save = async () => {
    if (!edit?.name?.trim()) return;
    const rec = { name: edit.name.trim(), color: edit.color ?? '#0e7490', icon: edit.icon ?? 'star', is_critical: !!edit.is_critical };
    const r = edit.id ? await supabase.from('condition_types').update(rec).eq('id', edit.id) : await supabase.from('condition_types').insert(rec);
    if (r.error) toast(friendlyError(r.error), 'danger'); else { setEdit(null); void q.reload(); }
  };

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-heading font-bold">أنواع الحالات الصحية</h2>
        <button className="btn-ghost" onClick={() => setEdit({ color: '#0e7490', icon: 'star' })}><Icon name="plus" />نوع جديد</button>
      </div>
      {!q.data ? <Spinner /> : (
        <ul className="divide-y divide-border">
          {q.data.map((t) => (
            <li key={t.id} className="py-2 flex items-center gap-3">
              <ConditionDot type={t} />
              <span className="font-medium">{t.name}</span>
              {t.is_critical && <span className="badge bg-danger-soft text-text">حرجة · تظهر كشريط تنبيه</span>}
              {t.is_builtin && <span className="badge bg-surface-2 text-muted">افتراضي</span>}
              {!t.is_builtin && <div className="ms-auto flex">
                <button className="icon-btn" aria-label={`تعديل ${t.name}`} onClick={() => setEdit(t)}><Icon name="edit" /></button>
                <button className="icon-btn text-danger" aria-label={`حذف ${t.name}`} onClick={async () => {
                  if (!(await ask(`حذف النوع «${t.name}»؟`))) return;
                  const { error } = await supabase.from('condition_types').delete().eq('id', t.id);
                  if (error) toast('لا يمكن حذف نوع مستخدم في حالات قائمة.', 'danger'); else void q.reload();
                }}><Icon name="trash" /></button>
              </div>}
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'تعديل نوع' : 'نوع حالة جديد'}
        footer={<><button className="btn-ghost" onClick={() => setEdit(null)}>إلغاء</button><button className="btn-primary" onClick={save}>حفظ</button></>}>
        {edit && (
          <div className="space-y-4">
            <Field label="الاسم" required><input className="field" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="اللون"><input className="field" type="color" value={edit.color?.startsWith('#') ? edit.color : '#0e7490'} onChange={(e) => setEdit({ ...edit, color: e.target.value })} /></Field>
            <fieldset>
              <legend className="label">الرمز</legend>
              <div className="flex flex-wrap gap-1">
                {CONDITION_ICONS.map((ic) => (
                  <button key={ic} type="button" className={`icon-btn border ${edit.icon === ic ? 'border-primary bg-primary-soft' : 'border-border'}`} aria-pressed={edit.icon === ic} aria-label={ic} onClick={() => setEdit({ ...edit, icon: ic })}><Icon name={ic} /></button>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center gap-2" style={{ minHeight: 44 }}>
              <input type="checkbox" className="h-5 w-5" checked={!!edit.is_critical} onChange={(e) => setEdit({ ...edit, is_critical: e.target.checked })} />حالة حرجة (تظهر كشريط تنبيه)
            </label>
            <div className="flex items-center gap-2 text-sm text-muted">معاينة: <ConditionDot type={{ id: 'x', name: edit.name ?? '', color: edit.color ?? '#0e7490', icon: edit.icon ?? 'star', is_critical: !!edit.is_critical, is_builtin: false, sort: 0 }} /></div>
          </div>
        )}
      </Modal>
      {ui}
    </section>
  );
}
