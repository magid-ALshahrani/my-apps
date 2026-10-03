import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '../lib/supabase';
import { useAsync, must, PROGRAM_STATUS, SKIP_REASONS, SEMESTER_LABEL } from '../lib/data';
import { useAuth } from '../lib/auth';
import { dual, isoDate, addDays } from '../lib/dates';
import { useTokens, colorOf, type TokenMap } from '../lib/useTokens';
import { PageHeader, Spinner, Stat, Alert } from '../components/ui';
import { ConditionDot, type ConditionType } from '../components/ConditionDot';
import { Icon } from '../components/Icon';

interface Stats {
  students_total: number;
  conditions_by_type: (ConditionType & { type_id: string; count: number })[];
  open_referrals: number;
  beneficiaries_pct: number | null;
  env_compliance_pct: number | null;
  programs_by_status: { semester: string; status: string; count: number }[];
  skip_reasons: { reason: string; count: number }[];
  conditions_by_grade: { grade: string; stage: string; type_id: string; count: number }[];
  monthly: { month: string; conditions: number; visits: number }[];
}

const STATUS_ORDER = ['done', 'not_done', 'postponed', 'planned', 'late'];
const pct = (n: number, d: number) => (d ? Math.round((n * 100) / d) : 0);

export default function Dashboard() {
  const { profile } = useAuth();
  const t = useTokens();
  const staff = profile?.role !== 'committee_member';
  const today = isoDate();

  const stats = useAsync(async () => must(await supabase.rpc('dashboard_stats')) as Stats);
  const upcoming = useAsync(async () => must(await supabase.from('programs_view')
    .select('id,name,start_date,end_date,effective_status,is_unofficial_day,stages')
    .lte('start_date', isoDate(addDays(new Date(), 30))).gte('end_date', today).order('start_date')) ?? []);
  const settings = useAsync(async () => must(await supabase.from('school_info').select('show_unofficial_days').single()) as { show_unofficial_days: boolean });
  const followUps = useAsync(async () => staff
    ? must(await supabase.from('referrals').select('id,reason,follow_up_on,status,students(full_name)').neq('status', 'closed').lte('follow_up_on', today).order('follow_up_on')) ?? []
    : [], [staff]);

  if (stats.loading) return <Spinner />;
  if (stats.error || !stats.data) return <Alert tone="danger">{stats.error ?? 'تعذّر التحميل'}</Alert>;
  const s = stats.data;
  const activeTotal = s.conditions_by_type.reduce((a, c) => a + c.count, 0);
  const showUnofficial = settings.data?.show_unofficial_days ?? false;
  // القادمة والجارية القصيرة (أيام وأسابيع وأشهر صحية)، دون برامج الفصل الممتدة
  const days = (p: { start_date: string; end_date: string | null }) => (Date.parse(p.end_date ?? p.start_date) - Date.parse(p.start_date)) / 864e5;
  const upcomingList = (upcoming.data ?? []).filter((p) => (showUnofficial || !p.is_unofficial_day) && days(p) <= 31);

  return (
    <div className="space-y-6">
      <PageHeader title={`مرحبًا ${profile?.full_name ?? ''}`} subtitle={dual(new Date())} />

      <section aria-label="المؤشرات" className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="عدد الطلاب" value={s.students_total} />
        <Stat label="الحالات النشطة" value={activeTotal} hint={
          <span className="flex flex-wrap gap-1 mt-1">
            {s.conditions_by_type.filter((c) => c.count > 0).map((c) => (
              <span key={c.type_id} className="inline-flex items-center gap-1"><ConditionDot type={c} size={16} />{c.count}</span>
            ))}
          </span>} />
        <Stat label="التحويلات المفتوحة" value={s.open_referrals} tone={s.open_referrals ? 'accent' : 'primary'} />
        <Stat label="نسبة الطلبة المستفيدين" value={s.beneficiaries_pct === null ? '—' : `${s.beneficiaries_pct}%`} hint="متوسط المستفيدين من البرامج المنفذة" />
        <Stat label="التزام تفقد البيئة" value={s.env_compliance_pct === null ? '—' : `${s.env_compliance_pct}%`} hint="آخر نموذج تفقد" />
      </section>

      <ProgramsWidget s={s} t={t} />

      <div className="grid lg:grid-cols-2 gap-4">
        <ConditionsByGrade s={s} t={t} />
        <Monthly s={s} t={t} />
      </div>
      <Heatmap s={s} />

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="card p-4">
          <h2 className="font-heading font-bold mb-3">البرامج والأيام الصحية خلال 30 يومًا</h2>
          {upcomingList.length === 0 ? <p className="text-muted">لا توجد برامج قادمة خلال 30 يومًا.</p> : (
            <ul className="divide-y divide-border">
              {upcomingList.map((p) => (
                <li key={p.id} className="py-2 flex items-start gap-2">
                  <Icon name="calendar" className="text-primary mt-1" />
                  <div className="min-w-0">
                    <div className="font-medium">{p.name} {p.is_unofficial_day && <span className="badge bg-surface-2 text-muted">غير رسمي</span>}</div>
                    <div className="text-sm text-muted">{dual(p.start_date, true)}{p.end_date && p.end_date !== p.start_date ? ` ← ${dual(p.end_date, true)}` : ''}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        {staff && (
          <section className="card p-4">
            <h2 className="font-heading font-bold mb-3">متابعات مستحقة اليوم</h2>
            {(followUps.data ?? []).length === 0 ? <p className="text-muted">لا توجد متابعات مستحقة.</p> : (
              <ul className="divide-y divide-border">
                {(followUps.data ?? []).map((r) => (
                  <li key={r.id} className="py-2">
                    <div className="font-medium">{(r.students as unknown as { full_name: string } | null)?.full_name}</div>
                    <div className="text-sm text-muted">{r.reason} · {dual(r.follow_up_on, true)}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function ProgramsWidget({ s, t }: { s: Stats; t: TokenMap }) {
  const semesters = ['pre', 'first', 'second'];
  const colors: Record<string, string> = { done: t.success, not_done: t.danger, postponed: t.warning, planned: t['chart-3'], late: t['chart-5'] };
  const reasons = s.skip_reasons.map((r) => ({ name: SKIP_REASONS[r.reason] ?? r.reason, count: r.count }));
  const late = s.programs_by_status.filter((x) => x.status === 'late').reduce((a, x) => a + x.count, 0);
  return (
    <section className="card p-4" aria-labelledby="pw">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 id="pw" className="font-heading font-bold">متابعة تنفيذ البرامج</h2>
        {late > 0 && <span className="badge bg-warning-soft text-text"><Icon name="warning" size={14} className="text-warning" /> {late} برنامجًا متأخر التحديث</span>}
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        {semesters.map((sem) => {
          const rows = s.programs_by_status.filter((x) => x.semester === sem);
          const total = rows.reduce((a, x) => a + x.count, 0);
          if (!total) return null;
          return (
            <div key={sem}>
              <div className="font-medium mb-2">{SEMESTER_LABEL[sem]} <span className="text-muted text-sm">({total})</span></div>
              <div className="flex h-3 rounded-full overflow-hidden gap-0.5 bg-surface-2" role="img" aria-label={`توزيع حالات ${SEMESTER_LABEL[sem]}`}>
                {STATUS_ORDER.map((st) => {
                  const n = rows.find((r) => r.status === st)?.count ?? 0;
                  return n ? <span key={st} style={{ width: `${pct(n, total)}%`, background: colors[st] }} title={`${PROGRAM_STATUS[st].label}: ${n}`} /> : null;
                })}
              </div>
              <ul className="mt-2 text-sm space-y-0.5">
                {STATUS_ORDER.map((st) => {
                  const n = rows.find((r) => r.status === st)?.count ?? 0;
                  return (
                    <li key={st} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors[st] }} />
                      <span>{PROGRAM_STATUS[st].label}</span>
                      <span className="ms-auto tabular-nums">{n} <span className="text-muted">({pct(n, total)}%)</span></span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="mt-5">
        <h3 className="font-medium mb-2">أسباب عدم التنفيذ والتأجيل</h3>
        {reasons.length === 0 ? <p className="text-muted text-sm">لم يُسجَّل أي سبب بعد.</p> : (
          <div style={{ height: Math.max(120, reasons.length * 40) }}>
            <ResponsiveContainer>
              <BarChart data={reasons} layout="vertical" margin={{ left: 8, right: 8 }}>
                <CartesianGrid horizontal={false} stroke={t.border} />
                <XAxis type="number" allowDecimals={false} reversed tick={{ fill: t.muted, fontSize: 12 }} stroke={t.border} />
                <YAxis type="category" dataKey="name" orientation="right" width={150} tick={{ fill: t.text, fontSize: 12 }} stroke={t.border} />
                <Tooltip cursor={{ fill: t['surface-2'] }} contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, color: t.text }} formatter={(v) => [v, 'العدد']} />
                <Bar isAnimationActive={false} dataKey="count" fill={t['chart-2']} radius={[4, 0, 0, 4]} barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  );
}

function ConditionsByGrade({ s, t }: { s: Stats; t: TokenMap }) {
  const types = s.conditions_by_type.filter((c) => !c.is_critical);
  const grades = [...new Map(s.conditions_by_grade.map((g) => [`${g.stage} ${g.grade}`, g])).keys()];
  const data = grades.map((g) => {
    const row: Record<string, string | number> = { grade: g };
    for (const ty of types) row[ty.name] = s.conditions_by_grade.filter((x) => `${x.stage} ${x.grade}` === g && x.type_id === ty.type_id).reduce((a, x) => a + x.count, 0);
    return row;
  });
  return (
    <section className="card p-4">
      <h2 className="font-heading font-bold mb-3">توزيع الحالات حسب الصف</h2>
      {data.length === 0 ? <p className="text-muted">لا توجد حالات نشطة بعد.</p> : (
        <div style={{ height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={data}>
              <CartesianGrid vertical={false} stroke={t.border} />
              <XAxis dataKey="grade" reversed tick={{ fill: t.text, fontSize: 12 }} stroke={t.border} />
              <YAxis orientation="right" allowDecimals={false} tick={{ fill: t.muted, fontSize: 12 }} stroke={t.border} />
              <Tooltip cursor={{ fill: t['surface-2'] }} contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, color: t.text }} />
              <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: t.text }}>{v}</span>} />
              {types.map((ty) => <Bar isAnimationActive={false} key={ty.type_id} dataKey={ty.name} stackId="a" fill={colorOf(t, ty.color)} stroke={t.surface} strokeWidth={2} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

function Monthly({ s, t }: { s: Stats; t: TokenMap }) {
  const data = s.monthly.map((m) => ({ ...m, label: m.month }));
  return (
    <section className="card p-4">
      <h2 className="font-heading font-bold mb-3">الاتجاه الشهري</h2>
      {data.length === 0 ? <p className="text-muted">لا توجد بيانات بعد.</p> : (
        <div style={{ height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={data}>
              <CartesianGrid vertical={false} stroke={t.border} />
              <XAxis dataKey="label" reversed tick={{ fill: t.text, fontSize: 12 }} stroke={t.border} />
              <YAxis orientation="right" allowDecimals={false} tick={{ fill: t.muted, fontSize: 12 }} stroke={t.border} />
              <Tooltip contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, color: t.text }} />
              <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: t.text }}>{v}</span>} />
              <Line isAnimationActive={false} type="monotone" dataKey="conditions" name="حالات جديدة" stroke={t['chart-1']} strokeWidth={2} dot={{ r: 4 }} />
              <Line isAnimationActive={false} type="monotone" dataKey="visits" name="زيارات العيادة" stroke={t['chart-2']} strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

/** خريطة حرارية: الصفوف × أنواع الحالات (تيل بدرجات، والرقم مكتوب داخل كل خلية) */
function Heatmap({ s }: { s: Stats }) {
  const types = s.conditions_by_type.filter((c) => !c.is_critical);
  const grades = [...new Map(s.conditions_by_grade.map((g) => [`${g.stage} ${g.grade}`, g])).keys()];
  const max = Math.max(1, ...s.conditions_by_grade.map((g) => g.count));
  return (
    <section className="card p-4 overflow-x-auto">
      <h2 className="font-heading font-bold mb-3">الخريطة الحرارية للصفوف</h2>
      {grades.length === 0 ? <p className="text-muted">لا توجد بيانات بعد.</p> : (
        <table className="text-sm border-separate" style={{ borderSpacing: 3 }}>
          <thead>
            <tr><th className="text-start font-medium text-muted px-2">الصف</th>
              {types.map((ty) => <th key={ty.type_id} className="px-1 font-medium text-muted"><span className="inline-flex flex-col items-center gap-1"><ConditionDot type={ty} size={18} /><span className="text-xs">{ty.name}</span></span></th>)}
            </tr>
          </thead>
          <tbody>
            {grades.map((g) => (
              <tr key={g}>
                <th className="text-start font-medium px-2 whitespace-nowrap">{g}</th>
                {types.map((ty) => {
                  const n = s.conditions_by_grade.filter((x) => `${x.stage} ${x.grade}` === g && x.type_id === ty.type_id).reduce((a, x) => a + x.count, 0);
                  const a = n ? 0.12 + 0.58 * (n / max) : 0; // سقف 0.7 يحفظ تباين النص ≥ 4.5 في الثيمين
                  return (
                    <td key={ty.type_id} className="text-center rounded-md tabular-nums" title={`${g} · ${ty.name}: ${n}`}
                      style={{ minWidth: 56, height: 36, background: n ? `rgb(var(--chart-1) / ${a})` : 'rgb(var(--surface-2))', color: 'rgb(var(--text))' }}>
                      {n}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-muted mt-2">كلما كانت الخلية أغمق زاد عدد الحالات.</p>
    </section>
  );
}
