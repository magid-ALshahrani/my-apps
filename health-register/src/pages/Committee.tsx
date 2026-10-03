import { useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase';
import { useAsync, must } from '../lib/data';
import { useRole } from '../lib/auth';
import { maskRecord, maskIdsInText } from '../lib/protect';
import { normalizeSaudiMobile, displayPhone } from '../lib/phone';
import { dual, isoDate } from '../lib/dates';
import { COMMITTEE_TITLES } from '../lib/register';
import { PageHeader, Spinner, Empty, Modal, Field, Alert, useConfirm, useToast } from '../components/ui';
import { Icon } from '../components/Icon';

interface Member { id: string; full_name: string; phone: string | null; title: string; profile_id: string | null; sort: number }
interface Item { item: string; recommendation: string }
interface Meeting { id: string; number: number | null; held_on: string; held_time: string | null; place: string | null; attendees: number | null; absentees: number | null; items: Item[]; notes: string | null; approved_at: string | null }

export default function Committee() {
  const role = useRole();
  const isGuide = role === 'health_guide';
  const isPrincipal = role === 'principal';
  const toast = useToast();
  const { ask, ui } = useConfirm();
  const members = useAsync(async () => must(await supabase.from('committee_members').select('*').order('sort').order('created_at')) as Member[]);
  const meetings = useAsync(async () => must(await supabase.from('committee_meetings').select('*').order('held_on', { ascending: false })) as Meeting[]);
  const [editM, setEditM] = useState<Partial<Member> | null>(null);
  const [editMeet, setEditMeet] = useState<Partial<Meeting> | null>(null);

  const saveMember = async () => {
    if (!editM?.full_name?.trim()) return;
    const phone = editM.phone ? normalizeSaudiMobile(editM.phone) : null;
    const rec = maskRecord({ full_name: editM.full_name.trim(), phone, title: editM.title ?? 'عضو' });
    const r = editM.id ? await supabase.from('committee_members').update(rec).eq('id', editM.id) : await supabase.from('committee_members').insert(rec);
    if (r.error) toast(friendlyError(r.error), 'danger'); else { setEditM(null); void members.reload(); }
  };

  const approve = async (m: Meeting) => {
    const { error } = await supabase.rpc('approve_record', { p_table: 'committee_meetings', p_id: m.id });
    if (error) toast(friendlyError(error), 'danger'); else { toast('تم الاعتماد'); void meetings.reload(); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="لجنة الصحة المدرسية" subtitle="يُفضَّل وجود عضو من مركز الرعاية الصحية الأولية المشرف على المدرسة."
        actions={<button className="btn-ghost" onClick={() => window.print()}><Icon name="print" />طباعة</button>} />
      <section className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-heading font-bold">سجل تشكيل لجنة الصحة المدرسية</h2>
          {isGuide && <button className="btn-ghost no-print" onClick={() => setEditM({ title: 'عضو' })}><Icon name="plus" />عضو</button>}
        </div>
        {members.loading ? <Spinner /> : (members.data ?? []).length === 0 ? <p className="text-muted">لم يُضف أعضاء بعد. يمكن أيضًا استيرادهم من ملف.</p> : (
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>م</th><th>الاسم</th><th>الجوال</th><th>صفته</th><th>حساب في التطبيق</th>{isGuide && <th className="no-print"></th>}</tr></thead>
            <tbody>{members.data!.map((m, i) => (
              <tr key={m.id}><td>{i + 1}</td><td className="whitespace-nowrap">{m.full_name}</td><td dir="ltr" className="text-end">{displayPhone(m.phone) || '—'}</td><td>{m.title}</td><td>{m.profile_id ? 'نعم' : '—'}</td>
                {isGuide && <td className="no-print whitespace-nowrap"><button className="icon-btn" aria-label="تعديل" onClick={() => setEditM({ ...m, phone: displayPhone(m.phone) })}><Icon name="edit" /></button>
                  <button className="icon-btn text-danger" aria-label="حذف" onClick={async () => { if (await ask(`حذف ${m.full_name} من سجل اللجنة؟`)) { await supabase.from('committee_members').delete().eq('id', m.id); void members.reload(); } }}><Icon name="trash" /></button></td>}
              </tr>))}</tbody>
          </table></div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-heading font-bold">محاضر اجتماعات اللجنة والتوصيات</h2>
          {isGuide && <button className="btn-primary no-print" onClick={() => setEditMeet({ held_on: isoDate(), items: [{ item: '', recommendation: '' }], number: (meetings.data?.length ?? 0) + 1 })}><Icon name="plus" />محضر</button>}
        </div>
        {meetings.loading ? <Spinner /> : (meetings.data ?? []).length === 0 ? <Empty title="لا توجد محاضر" /> : (
          <ul className="space-y-3">{meetings.data!.map((m) => (
            <li key={m.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-heading font-bold">اجتماع رقم {m.number ?? '—'}</h3>
                <span className="text-sm text-muted">{dual(m.held_on, true)}{m.held_time && ` · ${m.held_time}`}{m.place && ` · ${m.place}`}</span>
                {m.approved_at ? <span className="badge bg-primary-soft text-text"><Icon name="check" size={12} />معتمد</span> : <span className="badge bg-warning-soft text-text">بانتظار الاعتماد</span>}
              </div>
              <div className="text-sm text-muted mt-1">الحضور: {m.attendees ?? '—'} · الغياب: {m.absentees ?? '—'}</div>
              <table className="table mt-2"><thead><tr><th>م</th><th>البند</th><th>التوصيات</th></tr></thead>
                <tbody>{m.items.map((it, i) => <tr key={i}><td>{i + 1}</td><td>{it.item}</td><td>{it.recommendation}</td></tr>)}</tbody></table>
              {m.notes && <p className="mt-2 text-sm">ملاحظات: {m.notes}</p>}
              <div className="flex gap-2 mt-2 no-print">
                {isPrincipal && !m.approved_at && <button className="btn-primary" onClick={() => approve(m)}><Icon name="check" />اعتماد</button>}
                {isGuide && <button className="btn-ghost" onClick={() => setEditMeet(m)}><Icon name="edit" />تعديل</button>}
                {isGuide && <button className="btn-ghost text-danger" onClick={async () => { if (await ask('حذف المحضر؟')) { await supabase.from('committee_meetings').delete().eq('id', m.id); void meetings.reload(); } }}><Icon name="trash" />حذف</button>}
              </div>
            </li>))}</ul>
        )}
      </section>

      <Modal open={!!editM} onClose={() => setEditM(null)} title="عضو اللجنة" footer={<><button className="btn-ghost" onClick={() => setEditM(null)}>إلغاء</button><button className="btn-primary" onClick={saveMember}>حفظ</button></>}>
        {editM && <div className="space-y-4">
          <Field label="الاسم" required><input className="field" value={editM.full_name ?? ''} onChange={(e) => setEditM({ ...editM, full_name: e.target.value })} /></Field>
          <Field label="الجوال"><input className="field" dir="ltr" value={editM.phone ?? ''} onChange={(e) => setEditM({ ...editM, phone: e.target.value })} /></Field>
          <Field label="صفته"><select className="field" value={editM.title} onChange={(e) => setEditM({ ...editM, title: e.target.value })}>{COMMITTEE_TITLES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        </div>}
      </Modal>
      {editMeet && <MeetingDialog m={editMeet} onClose={() => setEditMeet(null)} onSaved={() => { setEditMeet(null); void meetings.reload(); }} />}
      {ui}
    </div>
  );
}

function MeetingDialog({ m, onClose, onSaved }: { m: Partial<Meeting>; onClose(): void; onSaved(): void }) {
  const [f, setF] = useState({ number: m.number?.toString() ?? '', held_on: m.held_on ?? isoDate(), held_time: m.held_time ?? '', place: m.place ?? '', attendees: m.attendees?.toString() ?? '', absentees: m.absentees?.toString() ?? '', notes: m.notes ?? '' });
  const [items, setItems] = useState<Item[]>(m.items?.length ? m.items : [{ item: '', recommendation: '' }]);
  const [error, setError] = useState<string | null>(null);
  const num = (v: string) => (v === '' ? null : Number(v));
  const save = async () => {
    const clean = items.filter((i) => i.item.trim() || i.recommendation.trim()).map((i) => ({ item: maskIdsInText(i.item), recommendation: maskIdsInText(i.recommendation) }));
    const rec = { number: num(f.number), held_on: f.held_on, held_time: f.held_time || null, place: f.place || null, attendees: num(f.attendees), absentees: num(f.absentees), notes: maskIdsInText(f.notes) || null, items: clean };
    const r = m.id ? await supabase.from('committee_meetings').update(rec).eq('id', m.id) : await supabase.from('committee_meetings').insert(rec);
    if (r.error) setError(friendlyError(r.error)); else onSaved();
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open wide onClose={onClose} title="محضر اجتماع لجنة الصحة المدرسية" footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" onClick={save}>حفظ</button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Field label="رقم الاجتماع"><input className="field" type="number" value={f.number} onChange={set('number')} /></Field>
          <Field label="التاريخ" hint={dual(f.held_on, true)}><input className="field" type="date" value={f.held_on} onChange={set('held_on')} /></Field>
          <Field label="الوقت"><input className="field" type="time" value={f.held_time} onChange={set('held_time')} /></Field>
          <Field label="المكان"><input className="field" value={f.place} onChange={set('place')} /></Field>
          <Field label="عدد الحضور"><input className="field" type="number" min={0} value={f.attendees} onChange={set('attendees')} /></Field>
          <Field label="عدد الغياب"><input className="field" type="number" min={0} value={f.absentees} onChange={set('absentees')} /></Field>
        </div>
        <fieldset>
          <legend className="label">بنود الاجتماع وتوصياته</legend>
          <div className="space-y-2">{items.map((it, i) => (
            <div key={i} className="grid sm:grid-cols-[1fr_1fr_auto] gap-2">
              <input className="field" placeholder={`البند ${i + 1}`} value={it.item} onChange={(e) => setItems(items.map((x, k) => k === i ? { ...x, item: e.target.value } : x))} />
              <input className="field" placeholder="التوصية" value={it.recommendation} onChange={(e) => setItems(items.map((x, k) => k === i ? { ...x, recommendation: e.target.value } : x))} />
              <button className="icon-btn text-danger" aria-label="حذف البند" onClick={() => setItems(items.filter((_, k) => k !== i))}><Icon name="trash" /></button>
            </div>))}</div>
          <button className="btn-ghost mt-2" onClick={() => setItems([...items, { item: '', recommendation: '' }])}><Icon name="plus" />بند</button>
        </fieldset>
        <Field label="ملاحظات"><textarea className="field py-2" rows={2} value={f.notes} onChange={set('notes')} /></Field>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}
