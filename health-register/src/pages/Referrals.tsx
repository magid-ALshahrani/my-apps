import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { supabase, friendlyError } from '../lib/supabase';
import { useAsync, must } from '../lib/data';
import { useAuth, useRole } from '../lib/auth';
import { maskRecord } from '../lib/protect';
import { displayPhone, whatsappLink } from '../lib/phone';
import { dual, isoDate, addDays } from '../lib/dates';
import { REFERRAL_STATUS } from '../lib/register';
import { PageHeader, Spinner, Empty, Modal, Field, Alert, useConfirm, useToast } from '../components/ui';
import { StudentPicker, useStudents } from '../components/StudentPicker';
import { Icon } from '../components/Icon';

interface Referral { id: string; student_id: string; reason: string; notes: string | null; status: keyof typeof REFERRAL_STATUS; sent_on: string; follow_up_on: string | null; outcome: string | null }
interface Center { name: string | null; location: string | null; shifts: string | null; hours: string | null; director_name: string | null; director_phone: string | null; medical_director_name: string | null; medical_director_phone: string | null; coordinator_name: string | null; coordinator_phone: string | null }

export default function Referrals() {
  const role = useRole();
  const canEdit = role === 'health_guide' || role === 'nurse';
  const toast = useToast();
  const { ask, ui } = useConfirm();
  const [filter, setFilter] = useState<string>('open');
  const [editing, setEditing] = useState<Partial<Referral> | null>(null);
  const students = useStudents();
  const q = useAsync(async () => must(await supabase.from('referrals').select('*').order('sent_on', { ascending: false })) as Referral[]);
  const byId = new Map((students.data ?? []).map((s) => [s.id, s]));
  const today = isoDate();
  const rows = (q.data ?? []).filter((r) => filter === 'all' || (filter === 'open' ? r.status !== 'closed' : r.status === filter));

  const setStatus = async (r: Referral, status: Referral['status']) => {
    const { error } = await supabase.from('referrals').update({ status }).eq('id', r.id);
    if (error) toast(friendlyError(error), 'danger'); else void q.reload();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="التحويل للمراكز الصحية" subtitle="تحويل الطالب لمركز الرعاية الصحية الأولية ومتابعته"
        actions={canEdit && <button className="btn-primary" onClick={() => setEditing({})}><Icon name="plus" />تحويل جديد</button>} />
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="تصفية">
        {[['open', 'المفتوحة'], ['sent', 'مرسل'], ['reviewed', 'تمت المراجعة'], ['closed', 'مغلق'], ['all', 'الكل']].map(([k, l]) => (
          <button key={k} className={`chip shrink-0 ${filter === k ? 'chip-on' : ''}`} style={{ minHeight: 44 }} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      {q.loading || students.loading ? <Spinner /> : rows.length === 0 ? <Empty title="لا توجد تحويلات" /> : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const s = byId.get(r.student_id);
            const due = r.status !== 'closed' && r.follow_up_on && r.follow_up_on <= today;
            return (
              <li key={r.id} className="card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s?.full_name}</span>
                  <span className="text-sm text-muted">{s?.classLabel}</span>
                  <span className={`badge ${r.status === 'closed' ? 'bg-surface-2 text-muted' : 'bg-primary-soft text-text'}`}>{REFERRAL_STATUS[r.status]}</span>
                  {due && <span className="badge bg-warning-soft text-text"><Icon name="clock" size={12} className="text-warning" />متابعة مستحقة</span>}
                </div>
                <div className="mt-1">{r.reason}</div>
                <div className="text-sm text-muted">أُرسل: {dual(r.sent_on, true)}{r.follow_up_on && ` · المتابعة: ${dual(r.follow_up_on, true)}`}</div>
                <div className="flex flex-wrap gap-2 mt-2 no-print">
                  <Link className="btn-ghost" to={`/referrals/${r.id}/print`}><Icon name="print" />طباعة / PDF</Link>
                  {s?.guardian_phone && <a className="btn-ghost" target="_blank" rel="noreferrer"
                    href={whatsappLink(s.guardian_phone, `ولي أمر الطالب ${s.full_name}، نفيدكم بتحويل ابنكم إلى مركز الرعاية الصحية الأولية بتاريخ ${dual(r.sent_on, true)}. نأمل مراجعة المركز وإفادتنا. الموجه الصحي.`)}><Icon name="whatsapp" />واتساب</a>}
                  {canEdit && r.status === 'sent' && <button className="btn-ghost" onClick={() => setStatus(r, 'reviewed')}>تمت المراجعة</button>}
                  {canEdit && r.status !== 'closed' && <button className="btn-ghost" onClick={() => setStatus(r, 'closed')}>إغلاق</button>}
                  {canEdit && <button className="icon-btn" aria-label="تعديل" onClick={() => setEditing(r)}><Icon name="edit" /></button>}
                  {role === 'health_guide' && <button className="icon-btn text-danger" aria-label="حذف" onClick={async () => {
                    if (!(await ask('حذف هذا التحويل؟'))) return;
                    const { error } = await supabase.from('referrals').delete().eq('id', r.id);
                    if (error) toast(friendlyError(error), 'danger'); else void q.reload();
                  }}><Icon name="trash" /></button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <HealthCenter />
      {editing && <ReferralDialog row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void q.reload(); }} />}
      {ui}
    </div>
  );
}

export function ReferralDialog({ row, onClose, onSaved }: { row: Partial<Referral>; onClose(): void; onSaved(): void }) {
  const students = useStudents();
  const [f, setF] = useState({
    student_id: row.student_id ?? null as string | null, reason: row.reason ?? '', notes: row.notes ?? '', sent_on: row.sent_on ?? isoDate(),
    follow_up_on: row.follow_up_on ?? isoDate(addDays(new Date(), 7)), outcome: row.outcome ?? '', status: row.status ?? 'sent',
  });
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!f.student_id) return setError('اختر الطالب');
    if (!f.reason.trim()) return setError('سبب التحويل مطلوب');
    const rec = maskRecord({ ...f, follow_up_on: f.follow_up_on || null, notes: f.notes || null, outcome: f.outcome || null });
    const r = row.id ? await supabase.from('referrals').update(rec).eq('id', row.id) : await supabase.from('referrals').insert(rec);
    if (r.error) setError(friendlyError(r.error)); else onSaved();
  };
  return (
    <Modal open onClose={onClose} title={row.id ? 'تعديل التحويل' : 'تحويل طالب لمركز الرعاية الصحية الأولية'}
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" onClick={save}>حفظ</button></>}>
      <div className="space-y-4">
        <Field label="الطالب" required><StudentPicker students={students.data ?? []} value={f.student_id} onChange={(s) => setF({ ...f, student_id: s.id })} /></Field>
        <Field label="سبب التحويل" required><textarea className="field py-2" rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        <Field label="ملاحظات"><textarea className="field py-2" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="تاريخ الإرسال" hint={dual(f.sent_on, true)}><input className="field" type="date" value={f.sent_on} onChange={(e) => setF({ ...f, sent_on: e.target.value })} /></Field>
          <Field label="تذكير المتابعة" hint={f.follow_up_on ? dual(f.follow_up_on, true) : undefined}><input className="field" type="date" value={f.follow_up_on} onChange={(e) => setF({ ...f, follow_up_on: e.target.value })} /></Field>
        </div>
        <Field label="الحالة">
          <select className="field" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Referral['status'] })}>
            {Object.entries(REFERRAL_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="نتيجة المراجعة"><input className="field" value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} /></Field>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}

function HealthCenter() {
  const isGuide = useRole() === 'health_guide';
  const toast = useToast();
  const q = useAsync(async () => must(await supabase.from('health_center').select('*').single()) as Center);
  const [f, setF] = useState<Center | null>(null);
  useEffect(() => { if (q.data) setF(q.data); }, [q.data]);
  if (!f) return null;
  const fields: [keyof Center, string, boolean?][] = [
    ['name', 'اسم مركز الرعاية الصحية'], ['location', 'موقعه'], ['shifts', 'فترات العمل (صباحي/مسائي)'], ['hours', 'ساعات العمل'],
    ['director_name', 'اسم مدير المركز'], ['director_phone', 'جواله', true], ['medical_director_name', 'اسم المدير الطبي'], ['medical_director_phone', 'جواله', true],
    ['coordinator_name', 'اسم منسق الصحة المدرسية بالمركز'], ['coordinator_phone', 'جواله', true],
  ];
  return (
    <section className="card p-4">
      <h2 className="font-heading font-bold mb-3">بيانات مركز الرعاية الصحية الأولية المشرف على المدرسة</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        {fields.map(([k, l, ltr]) => (
          <Field key={k} label={l}><input className="field" dir={ltr ? 'ltr' : undefined} value={f[k] ?? ''} readOnly={!isGuide} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
        ))}
      </div>
      {isGuide && <button className="btn-primary mt-3" onClick={async () => {
        const { error } = await supabase.from('health_center').update(maskRecord({ ...f })).eq('id', 1);
        if (error) toast(friendlyError(error), 'danger'); else toast('تم الحفظ');
      }}>حفظ</button>}
    </section>
  );
}

/** نموذج التحويل المطبوع: خلفية بيضاء دائمًا، وخط عربي مضمّن (Tajawal/Cairo من حزمة التطبيق) */
export function ReferralPrint() {
  const { id } = useParams();
  const { profile } = useAuth();
  const q = useAsync(async () => {
    const r = must(await supabase.from('referrals').select('*, students(full_name, guardian_phone, sections(name, grades(name, stages(name))))').eq('id', id!).single()) as unknown as Referral & {
      students: { full_name: string; guardian_phone: string | null; sections: { name: string; grades: { name: string; stages: { name: string } } } | null } };
    const school = must(await supabase.from('school_info').select('school_name,region').single()) as { school_name: string; region: string };
    const center = must(await supabase.from('health_center').select('name').single()) as { name: string | null };
    return { r, school, center };
  }, [id]);
  if (q.loading) return <Spinner />;
  if (q.error || !q.data) return <Alert tone="danger">{q.error}</Alert>;
  const { r, school, center } = q.data;
  const sec = r.students.sections;
  return (
    <div>
      <div className="no-print flex gap-2 mb-4">
        <button className="btn-primary" onClick={() => window.print()}><Icon name="print" />طباعة / حفظ PDF</button>
        <Link className="btn-ghost" to="/referrals">رجوع</Link>
      </div>
      <PrintSheet school={school}>
        <h1 className="text-center text-xl font-bold my-4" style={{ fontFamily: 'Cairo' }}>نموذج تحويل الطالب لمركز الرعاية الصحية الأولية</h1>
        <table className="w-full border-collapse text-[15px]" style={{ borderColor: '#555' }}>
          <tbody>
            {[
              ['المكرم مدير مركز الرعاية الصحية الأولية', center.name ?? '…………………'],
              ['اسم الطالب/ة', r.students.full_name],
              ['الصف / الفصل', sec ? `${sec.grades.stages.name} - ${sec.grades.name} / ${sec.name}` : '—'],
              ['تاريخ التحويل', dual(r.sent_on)],
              ['سبب التحويل', r.reason],
              ['ملاحظات', r.notes ?? '—'],
              ['جوال ولي الأمر', displayPhone(r.students.guardian_phone) || '—'],
            ].map(([k, v]) => (
              <tr key={k}><th className="border p-2 text-start w-1/3 bg-[#f3f3f3]" style={{ borderColor: '#555' }}>{k}</th><td className="border p-2" style={{ borderColor: '#555' }}>{v}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4">نأمل التكرم بالكشف على الطالب/ة المذكور/ة أعلاه وإفادتنا بالنتيجة والتوصيات.</p>
        <div className="grid grid-cols-2 gap-8 mt-10">
          <div><div>الموجه/ة الصحي/ة: {profile?.full_name}</div><div className="mt-6">التوقيع: ……………………</div></div>
          <div><div>مدير/ة المدرسة: ……………………</div><div className="mt-6">الختم والتوقيع: ……………………</div></div>
        </div>
        <hr className="my-6" style={{ borderColor: '#999' }} />
        <h2 className="font-bold">إفادة المركز الصحي</h2>
        <div className="mt-2" style={{ minHeight: 120, border: '1px dashed #999' }} />
      </PrintSheet>
    </div>
  );
}

/** ورقة طباعة A4 بترويسة الوزارة */
export function PrintSheet({ school, children }: { school: { school_name: string; region: string }; children: React.ReactNode }) {
  return (
    <article className="print-sheet mx-auto bg-white text-black p-8 shadow" style={{ maxWidth: '210mm', fontFamily: 'Tajawal' }} dir="rtl">
      <header className="flex justify-between text-sm leading-6 border-b pb-3" style={{ borderColor: '#999' }}>
        <div>المملكة العربية السعودية<br />وزارة التعليم<br />الإدارة العامة للتعليم بمنطقة {school.region || '……'}<br />الشؤون الصحية المدرسية</div>
        <div className="text-start">اسم المدرسة: {school.school_name || '……'}<br />العام الدراسي 1448هـ</div>
      </header>
      {children}
    </article>
  );
}
