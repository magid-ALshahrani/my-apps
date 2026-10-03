// نموذج تفقد البيئة المدرسية بالبنود الرسمية (نعم/لا + ملاحظات) واعتماد المدير.
import { useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase';
import { useAsync, must, SEMESTER_LABEL } from '../lib/data';
import { useRole } from '../lib/auth';
import { maskIdsInText } from '../lib/protect';
import { dual, isoDate } from '../lib/dates';
import { ENV_SECTIONS } from '../lib/register';
import { PageHeader, Spinner, Empty, Field, Alert, useConfirm, useToast } from '../components/ui';
import { Icon } from '../components/Icon';

type Answers = Record<string, { yes: boolean | null; note: string }>;
interface Inspection { id: string; inspected_on: string; semester: string; answers: Answers; notes: string | null; approved_at: string | null }
const ALL_ITEMS = ENV_SECTIONS.flatMap((s) => s.items);

export function compliance(a: Answers) {
  const answered = ALL_ITEMS.filter((i) => a[i.key]?.yes !== null && a[i.key]?.yes !== undefined);
  const yes = answered.filter((i) => a[i.key]?.yes).length;
  return { answered: answered.length, yes, pct: answered.length ? Math.round((yes * 100) / answered.length) : null };
}

export default function Environment() {
  const role = useRole();
  const isGuide = role === 'health_guide';
  const toast = useToast();
  const { ask, ui } = useConfirm();
  const q = useAsync(async () => must(await supabase.from('env_inspections').select('*').order('inspected_on', { ascending: false })) as Inspection[]);
  const [edit, setEdit] = useState<Partial<Inspection> | null>(null);

  if (edit) return <InspectionForm row={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); toast('حُفظ النموذج'); void q.reload(); }} />;
  return (
    <div>
      <PageHeader title="نموذج تفقد البيئة المدرسية" actions={isGuide && <button className="btn-primary" onClick={() => setEdit({ inspected_on: isoDate(), semester: 'first', answers: {} })}><Icon name="plus" />تفقد جديد</button>} />
      {q.loading ? <Spinner /> : (q.data ?? []).length === 0 ? <Empty title="لا توجد نماذج تفقد" /> : (
        <ul className="space-y-3">{q.data!.map((r) => {
          const c = compliance(r.answers);
          return (
            <li key={r.id} className="card p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-heading font-bold">تفقد {dual(r.inspected_on, true)}</div>
                <div className="text-sm text-muted">{SEMESTER_LABEL[r.semester]} · البنود المجابة {c.answered}/{ALL_ITEMS.length} · نعم {c.yes}</div>
              </div>
              <div className="text-2xl font-bold text-primary">{c.pct === null ? '—' : `${c.pct}%`}</div>
              {r.approved_at ? <span className="badge bg-primary-soft text-text"><Icon name="check" size={12} />معتمد</span> : <span className="badge bg-warning-soft text-text">بانتظار الاعتماد</span>}
              <div className="flex gap-2 w-full sm:w-auto">
                <button className="btn-ghost" onClick={() => setEdit(r)}>{isGuide ? 'فتح/تعديل' : 'عرض'}</button>
                {role === 'principal' && !r.approved_at && <button className="btn-primary" onClick={async () => {
                  const { error } = await supabase.rpc('approve_record', { p_table: 'env_inspections', p_id: r.id });
                  if (error) toast(friendlyError(error), 'danger'); else void q.reload();
                }}>اعتماد</button>}
                {isGuide && <button className="icon-btn text-danger" aria-label="حذف" onClick={async () => { if (await ask('حذف النموذج؟')) { await supabase.from('env_inspections').delete().eq('id', r.id); void q.reload(); } }}><Icon name="trash" /></button>}
              </div>
            </li>
          );
        })}</ul>
      )}
      {ui}
    </div>
  );
}

function InspectionForm({ row, onClose, onSaved }: { row: Partial<Inspection>; onClose(): void; onSaved(): void }) {
  const isGuide = useRole() === 'health_guide';
  const [answers, setAnswers] = useState<Answers>(row.answers ?? {});
  const [date, setDate] = useState(row.inspected_on ?? isoDate());
  const [semester, setSemester] = useState(row.semester ?? 'first');
  const [notes, setNotes] = useState(row.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const setA = (k: string, v: Partial<Answers[string]>) => setAnswers({ ...answers, [k]: { ...{ yes: null, note: '' }, ...answers[k], ...v } });
  const save = async () => {
    const clean = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, { yes: v.yes, note: maskIdsInText(v.note ?? '') }]));
    const rec = { inspected_on: date, semester, answers: clean, notes: maskIdsInText(notes) || null };
    const r = row.id ? await supabase.from('env_inspections').update(rec).eq('id', row.id) : await supabase.from('env_inspections').insert(rec);
    if (r.error) setError(friendlyError(r.error)); else onSaved();
  };
  const c = compliance(answers);
  return (
    <div className="space-y-4">
      <PageHeader title="نموذج تفقد البيئة المدرسية" subtitle={`نسبة الالتزام: ${c.pct === null ? '—' : `${c.pct}%`}`}
        actions={<><button className="btn-ghost" onClick={() => window.print()}><Icon name="print" />طباعة</button><button className="btn-ghost" onClick={onClose}>رجوع</button></>} />
      <div className="card p-4 grid sm:grid-cols-2 gap-3">
        <Field label="تاريخ التفقد" hint={dual(date, true)}><input className="field" type="date" value={date} disabled={!isGuide} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="الفصل"><select className="field" value={semester} disabled={!isGuide} onChange={(e) => setSemester(e.target.value)}><option value="first">الفصل الأول</option><option value="second">الفصل الثاني</option></select></Field>
      </div>
      {ENV_SECTIONS.map((sec) => (
        <section key={sec.title} className="card overflow-hidden">
          <h2 className="font-heading font-bold px-4 py-2 bg-surface-2">{sec.title}</h2>
          <ul className="divide-y divide-border">{sec.items.map((it, i) => {
            const a = answers[it.key];
            return (
              <li key={it.key} className="p-3 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                <span><span className="text-muted tabular-nums me-1">{i + 1}.</span>{it.text}</span>
                <div className="flex gap-1" role="radiogroup" aria-label={it.text}>
                  {([[true, 'نعم'], [false, 'لا']] as const).map(([v, l]) => (
                    <button key={l} type="button" role="radio" aria-checked={a?.yes === v} disabled={!isGuide}
                      className={`chip ${a?.yes === v ? (v ? 'chip-on' : 'bg-danger text-surface border-danger') : ''}`} style={{ minHeight: 44, minWidth: 56 }}
                      onClick={() => setA(it.key, { yes: a?.yes === v ? null : v })}>{l}</button>
                  ))}
                </div>
                <input className="field" placeholder="الملاحظات" value={a?.note ?? ''} disabled={!isGuide} onChange={(e) => setA(it.key, { note: e.target.value })} aria-label={`ملاحظات: ${it.text}`} />
              </li>
            );
          })}</ul>
        </section>
      ))}
      <Field label="ملاحظات عامة"><textarea className="field py-2" rows={3} value={notes} disabled={!isGuide} onChange={(e) => setNotes(e.target.value)} /></Field>
      {error && <Alert tone="danger">{error}</Alert>}
      {isGuide && <button className="btn-primary" onClick={save}>حفظ</button>}
    </div>
  );
}
