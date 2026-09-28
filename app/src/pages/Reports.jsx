import { useEffect, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import { useFund } from '../fund.jsx';
import { fmtDate, KIND_LABEL, monthName, monthShort, round2 } from '../lib/format.js';
import { monthRange } from '../lib/dates.js';
import { balanceSeries, memberStats, monthReport, unpaidFor } from '../lib/ledger.js';
import { fundSummaryText, waLink } from '../lib/text.js';
import { download, Modal, Money, MonthLabel, MonthSelect, toCSV, useToast } from '../components/ui.jsx';

Chart.register(...registerables);

function useCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

function ChartBox({ type, labels, datasets, money = true }) {
  const ref = useRef(null);
  const txt = useCssVar('--mut');
  const grid = useCssVar('--bor');
  // إعادة الرسم فقط عند تغيّر البيانات فعلياً
  const sig = JSON.stringify([type, labels, datasets, money, txt, grid]);
  useEffect(() => {
    const chart = new Chart(ref.current, {
      type,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        locale: 'en-US',
        plugins: {
          legend: { rtl: true, labels: { color: txt, font: { family: 'Tajawal' } } },
          tooltip: { rtl: true, textDirection: 'rtl', bodyFont: { family: 'Tajawal' }, titleFont: { family: 'Tajawal' } },
        },
        scales: {
          x: { reverse: true, ticks: { color: txt, font: { family: 'Tajawal' } }, grid: { color: grid } },
          y: { position: 'right', beginAtZero: true, ticks: { color: txt, callback: (v) => (money ? `${Number(v).toLocaleString('en-US')}` : v) }, grid: { color: grid } },
        },
      },
    });
    return () => chart.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return <div className="chart-box"><canvas ref={ref} role="img" aria-label="رسم بياني" /></div>;
}

export function Reports() {
  const { data, derived, hijri } = useFund();
  const [tab, setTab] = useState('month');
  const [period, setPeriod] = useState(derived.curMonth);
  const [year, setYear] = useState(derived.curMonth.slice(0, 4));
  const [sum, setSum] = useState(false);
  const years = [...new Set(derived.pastMonths.map((p) => p.slice(0, 4)))];

  const report = monthReport(data.entries, period);
  const series = balanceSeries(derived.live, data.settings.start_month, derived.curMonth);
  const last24 = series.slice(-24);
  const stats = derived.activeMembers.map((m) => ({ m, s: memberStats({ member: m, live: derived.live, settings: data.settings, rates: data.rates, curMonth: derived.curMonth, paid: derived.paid }) }));
  const yearRows = monthRange(`${year}-01-01`, `${year}-12-01`).filter((p) => p <= derived.curMonth && p >= data.settings.start_month).map((p) => ({ p, r: monthReport(data.entries, p) }));

  const exportMembers = () => {
    const head = ['العضو', 'الأشهر المستحقة', 'الأشهر المكتملة', 'المستحق', 'المدفوع', 'المتأخرات', 'مقدّم', 'السحوبات', 'قروض قائمة', 'الالتزام %', 'الصافي'];
    const rows = stats.map(({ m, s }) => [m.name, s.dueMonths, s.fullMonths, s.dueAmount, s.paidTotal, s.arrears, s.prepaid, s.withdrawals, s.loansOut, s.commitment, s.net]);
    download(`الأعضاء-${derived.today}.csv`, toCSV([head, ...rows]), 'text/csv;charset=utf-8');
  };
  const exportYear = () => {
    const head = ['الشهر', 'رصيد افتتاحي', 'اشتراكات', 'سدادات', 'سحوبات', 'قروض', 'مصروفات', 'رصيد ختامي'];
    const rows = yearRows.map(({ p, r }) => [monthName(p), r.opening, r.byKind.contribution, r.byKind.repayment, r.byKind.withdrawal, r.byKind.loan, r.byKind.expense, r.closing]);
    download(`التقرير-السنوي-${year}.csv`, toCSV([head, ...rows]), 'text/csv;charset=utf-8');
  };

  return (
    <>
      <div className="page-h">
        <h2>📈 التقارير</h2>
        <div className="row no-print">
          <button className="btn wa sm" onClick={() => setSum(true)}>📤 ملخص للمجموعة</button>
          <button className="btn sm" onClick={() => window.print()}>🖨️ طباعة / PDF</button>
        </div>
      </div>
      <div className="chips no-print">
        {[['month', 'حركة شهر'], ['year', 'تقرير سنوي'], ['balance', 'تطور الرصيد'], ['members', 'التزام الأعضاء']].map(([k, l]) => (
          <button key={k} className={`chip ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div className="print-only"><h2>{data.settings.fund_name} — تقرير بتاريخ {fmtDate(derived.today)}</h2></div>

      {tab === 'month' && (
        <div className="card">
          <div className="card-t">
            <span>حركة <MonthLabel period={period} hijri={hijri} /></span>
            <div className="no-print" style={{ minWidth: 190 }}><MonthSelect value={period} onChange={setPeriod} months={derived.pastMonths} closed={derived.closed} hijri={hijri} /></div>
          </div>
          <div className="list-row"><span>الرصيد الافتتاحي</span><Money v={report.opening} /></div>
          {['contribution', 'repayment'].map((k) => <div className="list-row" key={k} style={{ color: 'var(--grn)' }}><span>+ {KIND_LABEL[k]}</span><Money v={report.byKind[k]} /></div>)}
          {['withdrawal', 'loan', 'expense'].map((k) => <div className="list-row" key={k} style={{ color: 'var(--red)' }}><span>− {KIND_LABEL[k]}</span><Money v={report.byKind[k]} /></div>)}
          <div className="list-row" style={{ fontWeight: 800 }}><span>الرصيد الختامي</span><Money v={report.closing} /></div>
          {report.rows.length > 0 && (
            <div className="tbl-wrap" style={{ marginTop: 12 }}>
              <table className="tbl">
                <thead><tr><th>التاريخ</th><th>النوع</th><th>العضو / البيان</th><th>المبلغ</th></tr></thead>
                <tbody>
                  {report.rows.map((e) => (
                    <tr key={e.id}>
                      <td className="small">{fmtDate(e.entry_date, hijri)}</td>
                      <td>{KIND_LABEL[e.kind]}</td>
                      <td>{derived.memberById.get(e.member_id)?.name || e.note}</td>
                      <td><Money v={e.amount} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'year' && (
        <div className="card">
          <div className="card-t">
            <span>التقرير السنوي {year}</span>
            <div className="row no-print">
              {years.map((y) => <button key={y} className={`chip ${y === year ? 'on' : ''}`} onClick={() => setYear(y)}>{y}</button>)}
              <button className="btn sm" onClick={exportYear}>📊 Excel</button>
            </div>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>الشهر</th><th>اشتراكات</th><th>سدادات</th><th>سحوبات</th><th>قروض</th><th>مصروفات</th><th>الرصيد</th></tr></thead>
              <tbody>
                {yearRows.map(({ p, r }) => (
                  <tr key={p}>
                    <td>{monthShort(p)}{derived.closed.has(p) ? ' 🔒' : ''}</td>
                    <td><Money v={r.byKind.contribution} /></td><td><Money v={r.byKind.repayment} /></td>
                    <td><Money v={r.byKind.withdrawal} /></td><td><Money v={r.byKind.loan} /></td><td><Money v={r.byKind.expense} /></td>
                    <td style={{ fontWeight: 800 }}><Money v={r.closing} /></td>
                  </tr>
                ))}
                {yearRows.length > 0 && (
                  <tr style={{ fontWeight: 800 }}>
                    <td>المجموع</td>
                    {['contribution', 'repayment', 'withdrawal', 'loan', 'expense'].map((k) => <td key={k}><Money v={round2(yearRows.reduce((s, x) => s + x.r.byKind[k], 0))} /></td>)}
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'balance' && (
        <div className="card">
          <div className="card-t">تطور رصيد الصندوق</div>
          <ChartBox
            type="line"
            labels={last24.map((x) => monthName(x.period))}
            datasets={[
              { label: 'الرصيد', data: last24.map((x) => x.balance), borderColor: '#148a52', backgroundColor: 'rgba(20,138,82,.12)', fill: true, tension: 0.25 },
            ]}
          />
          <ChartBox
            type="bar"
            labels={last24.map((x) => monthShort(x.period))}
            datasets={[
              { label: 'وارد', data: last24.map((x) => x.inflow), backgroundColor: 'rgba(20,138,82,.7)', borderRadius: 6 },
              { label: 'صادر', data: last24.map((x) => x.outflow), backgroundColor: 'rgba(194,59,59,.7)', borderRadius: 6 },
            ]}
          />
        </div>
      )}

      {tab === 'members' && (
        <div className="card">
          <div className="card-t">
            <span>التزام الأعضاء (على الأشهر المستحقة فقط)</span>
            <button className="btn sm no-print" onClick={exportMembers}>📊 Excel</button>
          </div>
          <ChartBox
            type="bar"
            money={false}
            labels={stats.map((x) => x.m.name)}
            datasets={[{ label: 'نسبة الالتزام %', data: stats.map((x) => x.s.commitment), backgroundColor: stats.map((x) => (x.s.commitment >= 80 ? 'rgba(20,138,82,.7)' : x.s.commitment >= 50 ? 'rgba(184,106,0,.7)' : 'rgba(194,59,59,.7)')), borderRadius: 6 }]}
          />
          <div className="tbl-wrap" style={{ marginTop: 12 }}>
            <table className="tbl">
              <thead><tr><th>العضو</th><th>الأشهر</th><th>المدفوع</th><th>المتأخرات</th><th>الالتزام</th></tr></thead>
              <tbody>
                {stats.map(({ m, s }) => (
                  <tr key={m.id}>
                    <td style={{ fontWeight: 700 }}>{m.name}</td>
                    <td className="num">{s.fullMonths}/{s.dueMonths}</td>
                    <td><Money v={s.paidTotal} /></td>
                    <td style={{ color: s.arrears ? 'var(--red)' : undefined }}><Money v={s.arrears} /></td>
                    <td><span className={`badge ${s.commitment >= 80 ? 'b-grn' : s.commitment >= 50 ? 'b-amb' : 'b-red'}`}>{s.commitment}%</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {sum && <SummaryDialog onClose={() => setSum(false)} />}
    </>
  );
}

function SummaryDialog({ onClose }) {
  const { data, derived } = useFund();
  const toast = useToast();
  const [opts, setOpts] = useState({ balance: true, month: true, loans: true });
  const unpaid = unpaidFor({ members: data.members, live: derived.live, rates: data.rates, settings: data.settings, period: derived.curMonth, paid: derived.paid });
  const dueCount = derived.activeMembers.filter((m) => m.joined_on <= derived.curMonth).length;
  const loans = derived.loans
    .filter((l) => l.status === 'active' || l.status === 'overdue')
    .map((l) => ({ name: derived.memberById.get(l.loan.member_id)?.name, outstanding: l.outstanding, status: l.status }));
  const text = fundSummaryText({
    fundName: data.settings.fund_name, today: derived.today, summary: derived.summary, period: derived.curMonth,
    unpaid, paidCount: dueCount - unpaid.length, activeCount: dueCount, loans, opts,
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.ok('✅ تم النسخ');
    } catch {
      toast.error('تعذّر النسخ؛ حدّد النص وانسخه يدوياً');
    }
  };
  return (
    <Modal title="📤 ملخص الصندوق" onClose={onClose}>
      <div className="chips">
        {[['balance', '💰 الرصيد'], ['month', '📅 الشهر'], ['loans', '🔄 القروض']].map(([k, l]) => (
          <button key={k} className={`chip ${opts[k] ? 'on' : ''}`} onClick={() => setOpts((o) => ({ ...o, [k]: !o[k] }))}>{l}</button>
        ))}
      </div>
      <div className="preview">{text}</div>
      <div className="row">
        <a className="btn wa" style={{ flex: 1 }} href={waLink(text)} target="_blank" rel="noopener noreferrer">📱 واتساب</a>
        <button className="btn info" style={{ flex: 1 }} onClick={copy}>📋 نسخ</button>
      </div>
    </Modal>
  );
}
