import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { supabase, friendlyError } from '../lib/supabase';
import { useAsync, must, PROGRAM_STATUS, SKIP_REASONS, SEMESTER_LABEL } from '../lib/data';
import { useRole } from '../lib/auth';
import { maskIdsInText, maskRecord } from '../lib/protect';
import { dual, isoDate, monthLabel, parseDate } from '../lib/dates';
import { MECHANISMS } from '../lib/register';
import { suggestProgramFields, type Suggestion } from '../lib/ocr';
import { PageHeader, Spinner, Empty, Modal, Field, Alert, useConfirm, useToast } from '../components/ui';
import { Attachments } from '../components/Attachments';
import { Icon } from '../components/Icon';

export interface Program {
  id: string; name: string; category: string; description: string | null; executing_body: string | null; supporting_body: string | null;
  target_group: string | null; stages: string[]; semester: string; start_date: string; end_date: string | null;
  is_official: boolean; is_unofficial_day: boolean; sort: number;
  status: 'planned' | 'done' | 'not_done' | 'postponed'; effective_status: string;
  actual_date: string | null; beneficiaries: number | null; skip_reason: string | null; skip_note: string | null; new_date: string | null;
  executor: string | null; goal: string | null; doc_start: string | null; doc_end: string | null; classes_count: number | null;
  partners: string | null; mechanisms: string[]; mechanism_other: string | null; doc_notes: string | null;
}

export function StatusBadge({ s }: { s: string }) {
  const m = PROGRAM_STATUS[s] ?? PROGRAM_STATUS.planned;
  return (
    <span className="badge border text-text" style={{ borderColor: `rgb(var(--${m.token}))`, background: `rgb(var(--${m.token}) / 0.12)` }}>
      <Icon name={m.icon} size={12} />{m.label}
    </span>
  );
}

/** التحقق من الحالة في الواجهة (ونفس القواعد مفروضة بقيود CHECK في قاعدة البيانات) */
export function validateStatus(f: { status: string; actual_date?: string; beneficiaries?: string; skip_reason?: string; skip_note?: string; new_date?: string }): string | null {
  if (f.status === 'done' && (!f.actual_date || f.beneficiaries === '' || f.beneficiaries === undefined)) return 'أدخل تاريخ التنفيذ الفعلي وعدد المستفيدين.';
  if ((f.status === 'not_done' || f.status === 'postponed') && !f.skip_reason) return 'سبب عدم التنفيذ إلزامي.';
  if ((f.status === 'not_done' || f.status === 'postponed') && f.skip_reason === 'other' && !f.skip_note?.trim()) return 'اكتب السبب عند اختيار «أخرى».';
  if (f.status === 'postponed' && !f.new_date) return 'التاريخ الجديد إلزامي للبرنامج المؤجل.';
  return null;
}

export default function Programs() {
  const role = useRole();
  const canExec = role === 'health_guide' || role === 'committee_member';
  const isGuide = role === 'health_guide';
  const [params, setParams] = useSearchParams();
  const view = params.get('view') ?? 'list';
  const [sem, setSem] = useState('all');
  const [st, setSt] = useState('all');
  const [statusFor, setStatusFor] = useState<Program | null>(null);
  const [docFor, setDocFor] = useState<Program | null>(null);
  const [detail, setDetail] = useState<Program | null>(null);
  const [editing, setEditing] = useState<Partial<Program> | null>(null);
  const toast = useToast();
  const { ask, ui } = useConfirm();

  const q = useAsync(async () => {
    const [p, s] = await Promise.all([
      supabase.from('programs_view').select('*').order('start_date').order('sort'),
      supabase.from('school_info').select('show_unofficial_days').single(),
    ]);
    const show = (must(s) as { show_unofficial_days: boolean }).show_unofficial_days;
    return (must(p) as Program[]).filter((x) => show || !x.is_unofficial_day);
  });
  const programs = useMemo(() => (q.data ?? []).filter((p) => (sem === 'all' || p.semester === sem) && (st === 'all' || p.effective_status === st)), [q.data, sem, st]);

  const tabs = [['list', 'القائمة'], ['calendar', 'التقويم الشهري'], ['timeline', 'القائمة الزمنية'], ['trainings', 'تدريب الطلبة']];
  return (
    <div>
      <PageHeader title="البرامج والتقويم" subtitle="الخطة المشتركة للبرامج الصحية المدرسية 1448هـ ومتابعة التنفيذ"
        actions={isGuide && view !== 'trainings' && <button className="btn-primary" onClick={() => setEditing({ semester: 'first', start_date: isoDate(), stages: ['ابتدائي', 'متوسط', 'ثانوي'], category: 'فعالية مخصصة' })}><Icon name="plus" />برنامج أو فعالية</button>} />
      <div className="flex gap-2 overflow-x-auto pb-2 mb-3" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} className={`chip shrink-0 ${view === k ? 'chip-on' : ''}`} style={{ minHeight: 44 }} onClick={() => setParams({ view: k })}>{l}</button>)}
      </div>
      {view === 'trainings' ? <Trainings /> : <>
        {view !== 'calendar' && (
          <div className="grid grid-cols-2 sm:flex gap-2 mb-4">
            <select className="field sm:w-48" value={sem} onChange={(e) => setSem(e.target.value)} aria-label="الفصل">
              <option value="all">كل الفصول</option>{Object.entries(SEMESTER_LABEL).filter(([k]) => k !== 'both').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select className="field sm:w-48" value={st} onChange={(e) => setSt(e.target.value)} aria-label="حالة التنفيذ">
              <option value="all">كل الحالات</option>{Object.entries(PROGRAM_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        )}
        {q.loading ? <Spinner /> : q.error ? <Alert tone="danger">{q.error}</Alert> : view === 'calendar' ? <Calendar programs={q.data!} onOpen={setDetail} /> : programs.length === 0 ? <Empty title="لا توجد برامج مطابقة" /> : view === 'timeline' ? (
          <Timeline programs={programs} onOpen={setDetail} />
        ) : (
          <ul className="grid lg:grid-cols-2 gap-3">
            {programs.map((p) => (
              <li key={p.id} className="card p-4 flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <button className="font-heading font-bold text-start flex-1 hover:underline" onClick={() => setDetail(p)}>{p.name}</button>
                  <StatusBadge s={p.effective_status} />
                </div>
                <div className="flex flex-wrap gap-1">
                  <span className="badge bg-surface-2 text-text">{SEMESTER_LABEL[p.semester]}</span>
                  <span className="badge bg-surface-2 text-text">{p.category}</span>
                  {!p.is_official && <span className="badge bg-warning-soft text-text">{p.is_unofficial_day ? 'غير رسمي' : 'مخصص'}</span>}
                  {p.stages.map((s) => <span key={s} className="badge bg-primary-soft text-text">{s}</span>)}
                </div>
                <div className="text-sm text-muted">{dual(p.start_date, true)}{p.end_date && p.end_date !== p.start_date && <> ← {dual(p.end_date, true)}</>}</div>
                {p.effective_status === 'late' && <Alert tone="warning">تجاوز موعده وحالته «مخطط». حدّث حالة التنفيذ.</Alert>}
                {p.status === 'done' && <div className="text-sm">نُفّذ {dual(p.actual_date, true)} · المستفيدون: {p.beneficiaries}</div>}
                {p.skip_reason && <div className="text-sm">السبب: {SKIP_REASONS[p.skip_reason]}{p.skip_note && ` — ${p.skip_note}`}{p.new_date && ` · الموعد الجديد: ${dual(p.new_date, true)}`}</div>}
                <div className="flex flex-wrap gap-2 mt-auto pt-1">
                  {canExec && <button className="btn-ghost" onClick={() => setStatusFor(p)}><Icon name="check" />تحديث الحالة</button>}
                  {canExec && <button className="btn-ghost" onClick={() => setDocFor(p)}><Icon name="clipboard" />التوثيق والشواهد</button>}
                  {isGuide && <button className="icon-btn" aria-label={`تعديل ${p.name}`} onClick={() => setEditing(p)}><Icon name="edit" /></button>}
                  {isGuide && !p.is_official && <button className="icon-btn text-danger" aria-label={`حذف ${p.name}`} onClick={async () => {
                    if (!(await ask(`حذف «${p.name}»؟`))) return;
                    const { error } = await supabase.from('programs').delete().eq('id', p.id);
                    if (error) toast(friendlyError(error), 'danger'); else void q.reload();
                  }}><Icon name="trash" /></button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </>}
      {statusFor && <StatusDialog p={statusFor} onClose={() => setStatusFor(null)} onSaved={() => { setStatusFor(null); toast('حُدّثت الحالة'); void q.reload(); }} />}
      {docFor && <DocDialog p={docFor} onClose={() => setDocFor(null)} onSaved={() => { setDocFor(null); toast('حُفظ التوثيق'); void q.reload(); }} />}
      {detail && <Detail p={detail} onClose={() => setDetail(null)} />}
      {editing && <ProgramForm p={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void q.reload(); }} />}
      {ui}
    </div>
  );
}

function StatusDialog({ p, onClose, onSaved }: { p: Program; onClose(): void; onSaved(): void }) {
  const [f, setF] = useState({
    status: p.status as string, actual_date: p.actual_date ?? isoDate(), beneficiaries: p.beneficiaries?.toString() ?? '',
    skip_reason: p.skip_reason ?? '', skip_note: p.skip_note ?? '', new_date: p.new_date ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const v = validateStatus(f);
    if (v) return setError(v);
    const { error } = await supabase.rpc('update_program_execution', { p_id: p.id, p: {
      status: f.status, actual_date: f.actual_date || null, beneficiaries: f.beneficiaries === '' ? null : Number(f.beneficiaries),
      skip_reason: f.skip_reason || null, skip_note: maskIdsInText(f.skip_note) || null, new_date: f.new_date || null,
    } });
    if (error) setError(friendlyError(error)); else onSaved();
  };
  const needsReason = f.status === 'not_done' || f.status === 'postponed';
  return (
    <Modal open onClose={onClose} title={`حالة التنفيذ — ${p.name}`} footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" onClick={save}>حفظ</button></>}>
      <div className="space-y-4">
        <fieldset>
          <legend className="label">الحالة</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['planned', 'done', 'not_done', 'postponed'] as const).map((s) => (
              <button key={s} type="button" className={`chip justify-center ${f.status === s ? 'chip-on' : ''}`} style={{ minHeight: 44 }} aria-pressed={f.status === s} onClick={() => setF({ ...f, status: s })}>
                <Icon name={PROGRAM_STATUS[s].icon} size={16} />{PROGRAM_STATUS[s].label}
              </button>
            ))}
          </div>
        </fieldset>
        {f.status === 'done' && <div className="grid sm:grid-cols-2 gap-3">
          <Field label="تاريخ التنفيذ الفعلي" required hint={f.actual_date ? dual(f.actual_date, true) : undefined}><input className="field" type="date" value={f.actual_date} onChange={(e) => setF({ ...f, actual_date: e.target.value })} /></Field>
          <Field label="عدد المستفيدين" required><input className="field" type="number" min={0} inputMode="numeric" value={f.beneficiaries} onChange={(e) => setF({ ...f, beneficiaries: e.target.value })} /></Field>
        </div>}
        {needsReason && <>
          <Field label={f.status === 'postponed' ? 'سبب التأجيل' : 'سبب عدم التنفيذ'} required>
            <select className="field" value={f.skip_reason} onChange={(e) => setF({ ...f, skip_reason: e.target.value })}>
              <option value="">— اختر —</option>{Object.entries(SKIP_REASONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="ملاحظة" required={f.skip_reason === 'other'}><textarea className="field py-2" rows={2} value={f.skip_note} onChange={(e) => setF({ ...f, skip_note: e.target.value })} /></Field>
        </>}
        {f.status === 'postponed' && <Field label="التاريخ الجديد" required hint={f.new_date ? dual(f.new_date, true) : undefined}><input className="field" type="date" value={f.new_date} onChange={(e) => setF({ ...f, new_date: e.target.value })} /></Field>}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}

function DocDialog({ p, onClose, onSaved }: { p: Program; onClose(): void; onSaved(): void }) {
  const role = useRole();
  const [f, setF] = useState({
    executor: p.executor ?? '', goal: p.goal ?? '', doc_start: p.doc_start ?? '', doc_end: p.doc_end ?? '',
    classes_count: p.classes_count?.toString() ?? '', partners: p.partners ?? '', mechanisms: p.mechanisms ?? [],
    mechanism_other: p.mechanism_other ?? '', doc_notes: p.doc_notes ?? '',
  });
  const [benefit, setBenefit] = useState(p.beneficiaries?.toString() ?? '');
  const [error, setError] = useState<string | null>(null);
  const apply = (s: Suggestion[]) => {
    const next = { ...f };
    for (const x of s) {
      if (x.field === 'beneficiaries') setBenefit(x.value);
      else if (x.field in next) (next as Record<string, unknown>)[x.field] = x.value;
    }
    setF(next);
  };
  const save = async () => {
    const payload: Record<string, unknown> = maskRecord({
      ...f, doc_start: f.doc_start || null, doc_end: f.doc_end || null,
      classes_count: f.classes_count === '' ? null : Number(f.classes_count),
    });
    payload.mechanisms = f.mechanisms;
    if (p.status === 'done' && benefit !== '') Object.assign(payload, { status: 'done', actual_date: p.actual_date, beneficiaries: Number(benefit) });
    const { error } = await supabase.rpc('update_program_execution', { p_id: p.id, p: payload });
    if (error) setError(friendlyError(error)); else onSaved();
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open wide onClose={onClose} title={`سجل توثيق تنفيذ البرنامج — ${p.name}`} footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" onClick={save}>حفظ</button></>}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="منفذ البرنامج"><input className="field" value={f.executor} onChange={set('executor')} /></Field>
          <Field label="الجهة المنفذة"><input className="field" value={p.executing_body ?? ''} readOnly /></Field>
          <Field label="تاريخ بداية البرنامج" hint={f.doc_start ? dual(f.doc_start, true) : undefined}><input className="field" type="date" value={f.doc_start} onChange={set('doc_start')} /></Field>
          <Field label="تاريخ نهاية البرنامج" hint={f.doc_end ? dual(f.doc_end, true) : undefined}><input className="field" type="date" value={f.doc_end} onChange={set('doc_end')} /></Field>
          <Field label="عدد الفصول التي طُبّق بها البرنامج"><input className="field" type="number" min={0} value={f.classes_count} onChange={set('classes_count')} /></Field>
          <Field label="عدد الطلاب المستفيدين" hint={p.status !== 'done' ? 'يُسجَّل عند تحديث الحالة إلى «منفذ».' : undefined}>
            <input className="field" type="number" min={0} value={benefit} disabled={p.status !== 'done'} onChange={(e) => setBenefit(e.target.value)} />
          </Field>
        </div>
        <Field label="الهدف العام من البرنامج"><textarea className="field py-2" rows={2} value={f.goal} onChange={set('goal')} /></Field>
        <Field label="الجهات المشاركة بالبرنامج"><input className="field" value={f.partners} onChange={set('partners')} /></Field>
        <fieldset>
          <legend className="label">آلية تنفيذ البرنامج</legend>
          <div className="flex flex-wrap gap-2">
            {MECHANISMS.map((m) => {
              const on = f.mechanisms.includes(m);
              return <button key={m} type="button" className={`chip ${on ? 'chip-on' : ''}`} style={{ minHeight: 44 }} aria-pressed={on} onClick={() => setF({ ...f, mechanisms: on ? f.mechanisms.filter((x) => x !== m) : [...f.mechanisms, m] })}>{m}</button>;
            })}
          </div>
          <input className="field mt-2" placeholder="أخرى (اذكرها)" value={f.mechanism_other} onChange={set('mechanism_other')} />
        </fieldset>
        <Field label="ملاحظات عامة"><textarea className="field py-2" rows={2} value={f.doc_notes} onChange={set('doc_notes')} /></Field>
        <div>
          <div className="label">شواهد التنفيذ</div>
          <Attachments ownerType="program" ownerId={p.id} canUpload={role === 'health_guide' || role === 'committee_member'} canDelete={role === 'health_guide'} suggest={suggestProgramFields} onApply={apply} />
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}

function Detail({ p, onClose }: { p: Program; onClose(): void }) {
  const row = (l: string, v: React.ReactNode) => <div><dt className="text-sm text-muted">{l}</dt><dd>{v || '—'}</dd></div>;
  return (
    <Modal open onClose={onClose} title={p.name}>
      <dl className="space-y-3">
        <div className="flex gap-2 flex-wrap"><StatusBadge s={p.effective_status} />{!p.is_official && <span className="badge bg-warning-soft text-text">{p.is_unofficial_day ? 'غير رسمي' : 'مخصص'}</span>}</div>
        {row('الوصف', p.description)}
        {row('الجهة المنفذة', p.executing_body)}
        {row('الجهة الداعمة', p.supporting_body)}
        {row('الفئة المستهدفة', p.target_group)}
        {row('المراحل', p.stages.join('، '))}
        {row('الفصل', SEMESTER_LABEL[p.semester])}
        {row('التاريخ', <>{dual(p.start_date)}{p.end_date && p.end_date !== p.start_date && <><br />إلى {dual(p.end_date)}</>}</>)}
      </dl>
    </Modal>
  );
}

function ProgramForm({ p, onClose, onSaved }: { p: Partial<Program>; onClose(): void; onSaved(): void }) {
  const [f, setF] = useState({
    name: p.name ?? '', category: p.category ?? '', description: p.description ?? '', executing_body: p.executing_body ?? '',
    target_group: p.target_group ?? '', stages: p.stages ?? [], semester: p.semester ?? 'first', start_date: p.start_date ?? isoDate(), end_date: p.end_date ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!f.name.trim()) return setError('اسم البرنامج مطلوب');
    if (f.end_date && f.end_date < f.start_date) return setError('تاريخ النهاية قبل البداية');
    const rec = { ...maskRecord({ ...f, end_date: f.end_date || null }), stages: f.stages };
    const r = p.id ? await supabase.from('programs').update(rec).eq('id', p.id) : await supabase.from('programs').insert({ ...rec, is_official: false });
    if (r.error) setError(friendlyError(r.error)); else onSaved();
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} title={p.id ? 'تعديل البرنامج' : 'برنامج أو فعالية مخصصة'} footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" onClick={save}>حفظ</button></>}>
      <div className="space-y-4">
        <Field label="اسم البرنامج" required><input className="field" value={f.name} onChange={set('name')} /></Field>
        <Field label="التصنيف"><input className="field" value={f.category} onChange={set('category')} /></Field>
        <Field label="الجهة المنفذة"><input className="field" value={f.executing_body} onChange={set('executing_body')} /></Field>
        <Field label="الفئة المستهدفة"><input className="field" value={f.target_group} onChange={set('target_group')} /></Field>
        <fieldset><legend className="label">المراحل</legend>
          <div className="flex flex-wrap gap-2">{['رياض أطفال', 'ابتدائي', 'متوسط', 'ثانوي'].map((s) => {
            const on = f.stages.includes(s);
            return <button key={s} type="button" className={`chip ${on ? 'chip-on' : ''}`} style={{ minHeight: 44 }} aria-pressed={on} onClick={() => setF({ ...f, stages: on ? f.stages.filter((x) => x !== s) : [...f.stages, s] })}>{s}</button>;
          })}</div>
        </fieldset>
        <Field label="الفصل"><select className="field" value={f.semester} onChange={set('semester')}>{Object.entries(SEMESTER_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="تاريخ البداية" required hint={dual(f.start_date, true)}><input className="field" type="date" value={f.start_date} onChange={set('start_date')} /></Field>
          <Field label="تاريخ النهاية"><input className="field" type="date" value={f.end_date} onChange={set('end_date')} /></Field>
        </div>
        <Field label="الوصف"><textarea className="field py-2" rows={2} value={f.description} onChange={set('description')} /></Field>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}

const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
// في خلايا التقويم: الأيام والأسابيع فقط؛ ما زاد عن أسبوعين يظهر في «برامج ممتدة»
const short = (p: Program) => (Date.parse(p.end_date ?? p.start_date) - Date.parse(p.start_date)) / 864e5 <= 14;

/** تقويم شهري (الأسبوع يبدأ الأحد، والأيام من اليمين) */
function Calendar({ programs, onOpen }: { programs: Program[]; onOpen(p: Program): void }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [...Array(first.getDay()).fill(null), ...Array.from({ length: days }, (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1))];
  const today = isoDate();
  const on = (d: Date) => { const k = isoDate(d); return programs.filter((p) => short(p) && p.start_date <= k && (p.end_date ?? p.start_date) >= k); };
  const monthStart = isoDate(first); const monthEnd = isoDate(new Date(cursor.getFullYear(), cursor.getMonth(), days));
  const long = programs.filter((p) => !short(p) && p.start_date <= monthEnd && (p.end_date ?? p.start_date) >= monthStart);
  const hijriDay = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric' });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button className="icon-btn" aria-label="الشهر السابق" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><Icon name="chevron" className="rotate-180" /></button>
        <h2 className="font-heading font-bold text-center">{monthLabel(cursor)}</h2>
        <button className="icon-btn" aria-label="الشهر التالي" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><Icon name="chevron" /></button>
      </div>
      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 bg-surface-2 text-xs text-muted text-center">{WEEKDAYS.map((w) => <div key={w} className="py-2">{w}</div>)}</div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const list = d ? on(d) : [];
            const isToday = d && isoDate(d) === today;
            return (
              <div key={i} className={`border-t border-s border-border min-h-20 sm:min-h-28 p-1 ${d ? '' : 'bg-surface-2/50'}`}>
                {d && <div className={`flex justify-between text-xs ${isToday ? 'text-primary font-bold' : 'text-muted'}`}><span>{d.getDate()}</span><span>{hijriDay.format(d)}</span></div>}
                <div className="space-y-0.5 mt-1">
                  {list.slice(0, 3).map((p) => (
                    <button key={p.id} onClick={() => onOpen(p)} className="block w-full text-start truncate rounded px-1 text-[11px] sm:text-xs bg-primary-soft text-text" title={p.name}>{p.name}</button>
                  ))}
                  {list.length > 3 && <span className="text-[11px] text-muted">+{list.length - 3}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {long.length > 0 && <div className="card p-3">
        <h3 className="font-medium mb-2">برامج ممتدة خلال الشهر</h3>
        <ul className="flex flex-wrap gap-2">{long.map((p) => <li key={p.id}><button className="chip" onClick={() => onOpen(p)}>{p.name}</button></li>)}</ul>
      </div>}
    </div>
  );
}

function Timeline({ programs, onOpen }: { programs: Program[]; onOpen(p: Program): void }) {
  const groups = new Map<string, Program[]>();
  for (const p of programs) {
    const d = parseDate(p.start_date); const k = `${d.getFullYear()}-${d.getMonth()}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  return (
    <ol className="relative border-s-2 border-border ms-3 space-y-6">
      {[...groups.entries()].map(([k, list]) => {
        const [y, m] = k.split('-').map(Number);
        return (
          <li key={k} className="ps-5">
            <span className="absolute -start-[9px] mt-1.5 h-4 w-4 rounded-full bg-primary" aria-hidden />
            <h3 className="font-heading font-bold">{monthLabel(new Date(y, m, 1))}</h3>
            <ul className="mt-2 space-y-2">
              {list.map((p) => (
                <li key={p.id} className="card p-3 flex flex-wrap items-center gap-2">
                  <button className="font-medium text-start hover:underline" onClick={() => onOpen(p)}>{p.name}</button>
                  <StatusBadge s={p.effective_status} />
                  <span className="text-sm text-muted w-full">{dual(p.start_date, true)}{p.end_date && p.end_date !== p.start_date && <> ← {dual(p.end_date, true)}</>}</span>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}

interface Training { id: string; program_name: string; held_on: string | null; beneficiaries: number | null; goal: string | null; executing_body: string | null }

/** سجل تدريب الطلبة على البرامج الصحية */
function Trainings() {
  const isGuide = useRole() === 'health_guide';
  const toast = useToast();
  const { ask, ui } = useConfirm();
  const q = useAsync(async () => must(await supabase.from('student_trainings').select('*').order('held_on')) as Training[]);
  const [edit, setEdit] = useState<Partial<Training> | null>(null);
  const save = async () => {
    if (!edit?.program_name?.trim()) return;
    const rec = maskRecord({ program_name: edit.program_name, held_on: edit.held_on || null, beneficiaries: edit.beneficiaries ?? null, goal: edit.goal || null, executing_body: edit.executing_body || null });
    const r = edit.id ? await supabase.from('student_trainings').update(rec).eq('id', edit.id) : await supabase.from('student_trainings').insert(rec);
    if (r.error) toast(friendlyError(r.error), 'danger'); else { setEdit(null); void q.reload(); }
  };
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h2 className="font-heading font-bold">سجل تدريب الطلبة على البرامج الصحية</h2>
        {isGuide && <button className="btn-primary" onClick={() => setEdit({})}><Icon name="plus" />إضافة</button>}
      </div>
      {q.loading ? <Spinner /> : (q.data ?? []).length === 0 ? <Empty title="لا توجد سجلات تدريب" /> : (
        <div className="card overflow-x-auto"><table className="table">
          <thead><tr><th>م</th><th>اسم البرنامج</th><th>تاريخ البرنامج</th><th>عدد المستفيدين</th><th>الهدف من البرنامج</th><th>الجهة المنفذة</th>{isGuide && <th></th>}</tr></thead>
          <tbody>{q.data!.map((t, i) => (
            <tr key={t.id}><td>{i + 1}</td><td>{t.program_name}</td><td className="whitespace-nowrap">{dual(t.held_on, true)}</td><td>{t.beneficiaries ?? '—'}</td><td>{t.goal ?? '—'}</td><td>{t.executing_body ?? '—'}</td>
              {isGuide && <td className="whitespace-nowrap"><button className="icon-btn" aria-label="تعديل" onClick={() => setEdit(t)}><Icon name="edit" /></button>
                <button className="icon-btn text-danger" aria-label="حذف" onClick={async () => { if (await ask('حذف السجل؟')) { await supabase.from('student_trainings').delete().eq('id', t.id); void q.reload(); } }}><Icon name="trash" /></button></td>}
            </tr>))}</tbody>
        </table></div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title="تدريب الطلبة" footer={<><button className="btn-ghost" onClick={() => setEdit(null)}>إلغاء</button><button className="btn-primary" onClick={save}>حفظ</button></>}>
        {edit && <div className="space-y-4">
          <Field label="اسم البرنامج" required><input className="field" value={edit.program_name ?? ''} onChange={(e) => setEdit({ ...edit, program_name: e.target.value })} /></Field>
          <Field label="تاريخ البرنامج"><input className="field" type="date" value={edit.held_on ?? ''} onChange={(e) => setEdit({ ...edit, held_on: e.target.value })} /></Field>
          <Field label="عدد المستفيدين"><input className="field" type="number" min={0} value={edit.beneficiaries ?? ''} onChange={(e) => setEdit({ ...edit, beneficiaries: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
          <Field label="الهدف من البرنامج"><input className="field" value={edit.goal ?? ''} onChange={(e) => setEdit({ ...edit, goal: e.target.value })} /></Field>
          <Field label="الجهة المنفذة للبرنامج"><input className="field" value={edit.executing_body ?? ''} onChange={(e) => setEdit({ ...edit, executing_body: e.target.value })} /></Field>
        </div>}
      </Modal>
      {ui}
    </div>
  );
}
