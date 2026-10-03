import { useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase';
import { useAsync, PROGRAM_STATUS } from '../lib/data';
import { useRole } from '../lib/auth';
import { isoDate, dual } from '../lib/dates';
import { buildSemesterReport, buildDailyReport, buildPlanReport, exportReport, planGrid, PLAN_MONTHS, type ReportModel } from '../lib/reports';
import { PageHeader, Spinner, Alert, Field, useToast } from '../components/ui';
import { PrintSheet } from './Referrals';
import { StatusBadge } from './Programs';
import { Icon } from '../components/Icon';

/** عرض التقرير للطباعة/PDF: خلفية بيضاء دائمًا وخط عربي مضمّن */
export function ReportView({ m }: { m: ReportModel }) {
  return (
    <PrintSheet school={m.school}>
      <h1 className="text-center text-xl font-bold mt-4" style={{ fontFamily: 'Cairo' }}>{m.title}</h1>
      <p className="text-center text-sm mb-4">{m.subtitle} · تاريخ الإصدار: {m.issuedAt}</p>
      {m.sections.map((s) => (
        <section key={s.heading} className="mb-5" style={{ breakInside: s.rows.length < 15 ? 'avoid' : 'auto' }}>
          <h2 className="font-bold mb-1" style={{ fontFamily: 'Cairo', color: '#0f5f58' }}>{s.heading}</h2>
          <table className="w-full border-collapse text-[13px]">
            {s.kind === 'table' && <thead><tr>{s.columns.map((c) => <th key={c} className="border p-1.5 text-start" style={{ borderColor: '#777', background: '#e8f3f1' }}>{c}</th>)}</tr></thead>}
            <tbody>
              {s.kind === 'kv'
                ? s.rows.map(([k, v]) => <tr key={k}><th className="border p-1.5 text-start w-1/2" style={{ borderColor: '#777', background: '#f5f5f5' }}>{k}</th><td className="border p-1.5" style={{ borderColor: '#777' }}>{v}</td></tr>)
                : s.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border p-1.5" style={{ borderColor: '#777' }}>{c}</td>)}</tr>)}
            </tbody>
          </table>
          {s.kind === 'table' && s.note && <p className="text-xs mt-1">{s.note}</p>}
        </section>
      ))}
      <div className="grid grid-cols-2 gap-8 mt-8 text-sm">
        <div>الموجه/ة الصحي/ة: ……………………<br /><br />التوقيع: ……………………</div>
        <div>{m.approval ?? <>يعتمد،،، مدير/ة المدرسة: ……………………<br /><br />التوقيع: ……………………</>}</div>
      </div>
    </PrintSheet>
  );
}

function ExportBar({ m, onApprove }: { m: ReportModel; onApprove?: () => void }) {
  const toast = useToast();
  return (
    <div className="flex flex-wrap gap-2 no-print">
      <button className="btn-primary" onClick={() => window.print()}><Icon name="print" />طباعة / PDF</button>
      <button className="btn-ghost" onClick={() => exportReport(m, 'docx').catch((e) => toast(friendlyError(e), 'danger'))}><Icon name="file" />Word</button>
      <button className="btn-ghost" onClick={() => exportReport(m, 'xlsx').catch((e) => toast(friendlyError(e), 'danger'))}><Icon name="download" />Excel</button>
      {onApprove && !m.approval && <button className="btn-accent" onClick={onApprove}><Icon name="check" />اعتماد التقرير</button>}
    </div>
  );
}

export default function Reports() {
  const role = useRole();
  const toast = useToast();
  const [kind, setKind] = useState<'semester' | 'daily'>('semester');
  const [sem, setSem] = useState<'first' | 'second'>('first');
  const [day, setDay] = useState(isoDate());
  const [includeViolence, setIncludeViolence] = useState(false);
  const q = useAsync(async () => kind === 'semester' ? buildSemesterReport(supabase, sem, { includeViolence }) : buildDailyReport(supabase, day), [kind, sem, day, includeViolence]);

  const approve = async () => {
    const { error } = await supabase.from('report_approvals').insert({ report_kind: 'semester', period: `1448-${sem}` });
    if (error) toast(friendlyError(error), 'danger'); else { toast('اعتُمد التقرير'); void q.reload(); }
  };

  return (
    <div className="space-y-4">
      <div className="no-print"><PageHeader title="التقارير" subtitle="تُطبع وتُصدَّر بخلفية بيضاء دائمًا" /></div>
      <div className="card p-4 flex flex-wrap gap-3 items-end no-print">
        <div className="flex gap-2" role="tablist">
          {([['semester', 'التقرير الفصلي'], ['daily', 'التقرير اليومي']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={kind === k} className={`chip ${kind === k ? 'chip-on' : ''}`} style={{ minHeight: 44 }} onClick={() => setKind(k)}>{l}</button>
          ))}
        </div>
        {kind === 'semester' ? (
          <Field label="الفصل"><select className="field" value={sem} onChange={(e) => setSem(e.target.value as 'first' | 'second')}><option value="first">الفصل الأول</option><option value="second">الفصل الثاني</option></select></Field>
        ) : (
          <Field label="اليوم" hint={dual(day, true)}><input className="field" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        )}
        {kind === 'semester' && role === 'health_guide' && (
          <label className="flex items-center gap-2" style={{ minHeight: 44 }}>
            <input type="checkbox" className="h-5 w-5" checked={includeViolence} onChange={(e) => setIncludeViolence(e.target.checked)} />
            تضمين عدد حالات العنف الأسري (يتطلب فتح السجل خلال آخر 10 دقائق)
          </label>
        )}
      </div>
      {q.loading ? <Spinner label="جارٍ إعداد التقرير…" /> : q.error ? <Alert tone="danger">{q.error}</Alert> : (
        <>
          <ExportBar m={q.data!} onApprove={kind === 'semester' && role === 'principal' ? approve : undefined} />
          <ReportView m={q.data!} />
        </>
      )}
    </div>
  );
}

/** خطة المتابعة السنوية: شبكة البرامج × الأشهر مع حالة التنفيذ */
export function Plan() {
  const q = useAsync(async () => {
    const [m, p] = await Promise.all([
      buildPlanReport(supabase),
      supabase.from('programs_view').select('id,name,start_date,end_date,effective_status,semester').eq('is_unofficial_day', false).order('start_date').order('sort'),
    ]);
    if (p.error) throw p.error;
    return { m, grid: planGrid(p.data as never) };
  });
  if (q.loading) return <Spinner />;
  if (q.error) return <Alert tone="danger">{q.error}</Alert>;
  const { m, grid } = q.data!;
  return (
    <div className="space-y-4">
      <div className="no-print"><PageHeader title="خطة المتابعة السنوية" subtitle="الخطة الزمنية للبرامج الصحية المدرسية 1448هـ وحالة تنفيذ كل برنامج" /></div>
      <ExportBar m={m} />
      <div className="flex flex-wrap gap-2 text-sm no-print">{Object.keys(PROGRAM_STATUS).map((s) => <StatusBadge key={s} s={s} />)}</div>
      <div className="card overflow-x-auto no-print">
        <table className="text-sm border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th className="sticky start-0 bg-surface text-start px-2 py-1 min-w-48">البرنامج والفعالية</th>
              <th colSpan={5} className="text-center text-muted font-medium">الفصل الدراسي الأول</th>
              <th colSpan={6} className="text-center text-muted font-medium">الفصل الدراسي الثاني</th>
              <th className="px-2">الحالة</th>
            </tr>
            <tr><th className="sticky start-0 bg-surface"></th>{PLAN_MONTHS.map((x) => <th key={x} className="px-1 text-xs font-medium text-muted">{x}</th>)}<th></th></tr>
          </thead>
          <tbody>
            {grid.map((g) => (
              <tr key={g.id}>
                <th className="sticky start-0 bg-surface text-start font-medium px-2 py-1">{g.name}</th>
                {g.months.map((on, i) => (
                  <td key={i} className="rounded" style={{ minWidth: 36, height: 30, background: on ? `rgb(var(--${PROGRAM_STATUS[g.status]?.token ?? 'chart-3'}) / 0.35)` : 'rgb(var(--surface-2))' }}
                    title={on ? `${PLAN_MONTHS[i]}: ${PROGRAM_STATUS[g.status]?.label}` : undefined}>
                    {on && <span className="flex justify-center text-text"><span aria-hidden>●</span><span className="sr-only">{PLAN_MONTHS[i]}</span></span>}
                  </td>
                ))}
                <td className="px-2 whitespace-nowrap"><StatusBadge s={g.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* الخطة عريضة: صفحة أفقية عند الطباعة */}
      <style>{'@media print { @page { size: A4 landscape; margin: 10mm; } }'}</style>
      <div className="hidden print:block"><ReportView m={m} /></div>
    </div>
  );
}
