// زيارات العيادة اليومية: سجل سريع، وهو مصدر التقرير اليومي.
import { useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase';
import { useAsync, must } from '../lib/data';
import { useRole } from '../lib/auth';
import { maskRecord } from '../lib/protect';
import { dual, isoDate, time, addDays, parseDate } from '../lib/dates';
import { VISIT_OUTCOMES } from '../lib/register';
import { PageHeader, Spinner, Empty, Field, Alert, useConfirm, useToast } from '../components/ui';
import { StudentPicker, useStudents } from '../components/StudentPicker';
import { ReferralDialog } from './Referrals';
import { Icon } from '../components/Icon';

interface Visit { id: string; student_id: string; visited_at: string; complaint: string; action: string | null; outcome: keyof typeof VISIT_OUTCOMES }

function nowLocal() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function Visits() {
  const role = useRole();
  const canEdit = role === 'health_guide' || role === 'nurse';
  const toast = useToast();
  const { ask, ui } = useConfirm();
  const [day, setDay] = useState(isoDate());
  const students = useStudents();
  const [f, setF] = useState({ student_id: null as string | null, at: nowLocal(), complaint: '', action: '', outcome: 'returned' as Visit['outcome'] });
  const [error, setError] = useState<string | null>(null);
  const [referFor, setReferFor] = useState<string | null>(null);
  const q = useAsync(async () => {
    const start = parseDate(day); start.setHours(0, 0, 0, 0);
    const end = addDays(start, 1);
    return must(await supabase.from('clinic_visits').select('*').gte('visited_at', start.toISOString()).lt('visited_at', end.toISOString()).order('visited_at', { ascending: false })) as Visit[];
  }, [day]);
  const byId = new Map((students.data ?? []).map((s) => [s.id, s]));

  const save = async () => {
    if (!f.student_id) return setError('اختر الطالب');
    if (!f.complaint.trim()) return setError('الشكوى مطلوبة');
    const [h, m] = f.at.split(':').map(Number);
    const at = parseDate(day); at.setHours(h, m, 0, 0);
    const { error } = await supabase.from('clinic_visits').insert(maskRecord({ student_id: f.student_id, visited_at: at.toISOString(), complaint: f.complaint.trim(), action: f.action.trim() || null, outcome: f.outcome }));
    if (error) return setError(friendlyError(error));
    setError(null);
    toast('سُجّلت الزيارة');
    if (f.outcome === 'referred') setReferFor(f.student_id);
    setF({ student_id: null, at: nowLocal(), complaint: '', action: '', outcome: 'returned' });
    void q.reload();
  };

  const counts = Object.fromEntries(Object.keys(VISIT_OUTCOMES).map((k) => [k, (q.data ?? []).filter((v) => v.outcome === k).length]));

  return (
    <div className="space-y-5">
      <PageHeader title="زيارات العيادة اليومية" subtitle={dual(day)} />
      {canEdit && (
        <section className="card p-4 space-y-3">
          <h2 className="font-heading font-bold">تسجيل سريع</h2>
          <Field label="الطالب" required><StudentPicker students={students.data ?? []} value={f.student_id} onChange={(s) => setF({ ...f, student_id: s.id })} /></Field>
          <div className="grid sm:grid-cols-[140px_1fr] gap-3">
            <Field label="الوقت"><input className="field" type="time" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></Field>
            <Field label="الشكوى" required><input className="field" value={f.complaint} onChange={(e) => setF({ ...f, complaint: e.target.value })} placeholder="صداع، ألم بطن…" /></Field>
          </div>
          <Field label="الإجراء"><input className="field" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} /></Field>
          <fieldset>
            <legend className="label">النتيجة</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(VISIT_OUTCOMES) as Visit['outcome'][]).map((k) => (
                <button key={k} type="button" className={`chip ${f.outcome === k ? 'chip-on' : ''}`} style={{ minHeight: 44 }} aria-pressed={f.outcome === k} onClick={() => setF({ ...f, outcome: k })}>{VISIT_OUTCOMES[k]}</button>
              ))}
            </div>
          </fieldset>
          {error && <Alert tone="danger">{error}</Alert>}
          <button className="btn-primary" onClick={save}><Icon name="check" />تسجيل الزيارة</button>
        </section>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="اليوم"><input className="field" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        <div className="flex gap-2 flex-wrap text-sm">
          <span className="badge bg-surface-2 text-text">الإجمالي {(q.data ?? []).length}</span>
          {Object.entries(VISIT_OUTCOMES).map(([k, l]) => <span key={k} className="badge bg-surface-2 text-text">{l} {counts[k]}</span>)}
        </div>
      </div>
      {q.loading ? <Spinner /> : (q.data ?? []).length === 0 ? <Empty title="لا توجد زيارات في هذا اليوم" /> : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>الوقت</th><th>الطالب</th><th>الصف</th><th>الشكوى</th><th>الإجراء</th><th>النتيجة</th>{role === 'health_guide' && <th></th>}</tr></thead>
            <tbody>
              {q.data!.map((v) => (
                <tr key={v.id}>
                  <td className="tabular-nums whitespace-nowrap">{time(v.visited_at)}</td>
                  <td className="whitespace-nowrap">{byId.get(v.student_id)?.full_name}</td>
                  <td className="whitespace-nowrap">{byId.get(v.student_id)?.classLabel}</td>
                  <td>{v.complaint}</td><td>{v.action ?? '—'}</td><td className="whitespace-nowrap">{VISIT_OUTCOMES[v.outcome]}</td>
                  {role === 'health_guide' && <td><button className="icon-btn text-danger" aria-label="حذف" onClick={async () => {
                    if (!(await ask('حذف هذه الزيارة؟'))) return;
                    const { error } = await supabase.from('clinic_visits').delete().eq('id', v.id);
                    if (error) toast(friendlyError(error), 'danger'); else void q.reload();
                  }}><Icon name="trash" /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {referFor && <ReferralDialog row={{ student_id: referFor }} onClose={() => setReferFor(null)} onSaved={() => { setReferFor(null); toast('أُنشئ التحويل'); }} />}
      {ui}
    </div>
  );
}
