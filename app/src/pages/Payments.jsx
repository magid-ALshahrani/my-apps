import { useState } from 'react';
import { useFund } from '../fund.jsx';
import { monthShort, round2 } from '../lib/format.js';
import { duePeriods, periodStatus, rateFor } from '../lib/ledger.js';
import { Money, MonthLabel, MonthSelect } from '../components/ui.jsx';
import { ContributionDialog } from '../components/forms.jsx';

const STATUS = {
  paid: ['✓', 'مدفوع'],
  partial: ['◐', 'جزئي'],
  unpaid: ['✗', 'لم يدفع'],
  future: ['·', 'لم يستحق'],
  norate: ['—', 'بدون سعر'],
};

export function Payments() {
  const { data, derived, can, hijri } = useFund();
  const [period, setPeriod] = useState(derived.curMonth);
  const [pay, setPay] = useState(null);
  const due = rateFor(data.rates, period);
  const list = data.members.filter((m) => !m.archived || (derived.paid.get(m.id)?.get(period) || 0) > 0);
  let paidSum = 0;
  let dueSum = 0;
  const cards = list.map((m) => {
    const got = derived.paid.get(m.id)?.get(period) || 0;
    const isDue = duePeriods(m, data.settings, derived.curMonth).includes(period);
    const owes = m.joined_on <= period;
    paidSum += got;
    if (owes && !m.archived && due) dueSum += due;
    return { m, got, st: owes ? periodStatus(got, due, isDue) : 'future' };
  });
  return (
    <>
      <div className="page-h">
        <h2>💳 الدفعات الشهرية</h2>
        <div style={{ minWidth: 200 }}>
          <MonthSelect value={period} onChange={setPeriod} months={derived.months} closed={derived.closed} hijri={hijri} aria-label="الشهر" />
        </div>
      </div>
      <div className="card">
        <div className="row small" style={{ marginBottom: 12 }}>
          <span className="badge b-gold">المستحق للعضو: {due == null ? '—' : <Money v={due} />}</span>
          <span className="badge b-grn">المحصّل: <Money v={paidSum} /></span>
          <span className="badge b-red">المتبقي: <Money v={Math.max(0, round2(dueSum - paidSum))} /></span>
          {derived.closed.has(period) && <span className="badge b-mut">🔒 شهر مقفل</span>}
        </div>
        <p className="muted small" style={{ marginBottom: 12 }}>
          {can.write ? 'اضغط على العضو لتسجيل دفعته أو عرض تفاصيلها.' : 'اضغط على العضو لعرض التفاصيل.'}
        </p>
        <div className="mgrid">
          {cards.map(({ m, got, st }) => (
            <button key={m.id} className={`mcard ${st}`} onClick={() => setPay(m)}>
              <span className="nm">{STATUS[st][0]} {m.name}</span>
              <span className="small muted">{STATUS[st][1]}{got > 0 && <> · <Money v={got} /></>}</span>
              {m.archived && <span className="badge b-mut">مؤرشف</span>}
            </button>
          ))}
        </div>
      </div>
      {pay && <ContributionDialog member={pay} period={period} onClose={() => setPay(null)} />}
    </>
  );
}

export function YearView() {
  const { data, derived, hijri } = useFund();
  const years = [...new Set(derived.months.map((p) => p.slice(0, 4)))];
  const [year, setYear] = useState(derived.curMonth.slice(0, 4));
  const [pay, setPay] = useState(null);
  const months = derived.months.filter((p) => p.startsWith(year));
  return (
    <>
      <div className="page-h">
        <h2>📅 عرض السنة</h2>
        <div className="chips" style={{ marginBottom: 0 }}>
          {years.map((y) => (
            <button key={y} className={`chip ${y === year ? 'on' : ''}`} onClick={() => setYear(y)}>{y}</button>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="row small muted" style={{ marginBottom: 10 }}>
          <span className="badge b-grn">✓ مدفوع</span>
          <span className="badge b-amb">◐ جزئي</span>
          <span className="badge b-red">✗ متأخر</span>
          <span className="badge b-mut">· لم يستحق</span>
          <span>🔒 مقفل (إطار منقّط)</span>
        </div>
        <div className="tbl-wrap">
          <table className="ymat">
            <thead>
              <tr>
                <th className="nm">العضو</th>
                {months.map((p) => <th key={p} title={hijri ? undefined : p}>{monthShort(p)}</th>)}
                <th>المدفوع</th>
              </tr>
            </thead>
            <tbody>
              {data.members.filter((m) => !m.archived || months.some((p) => derived.paid.get(m.id)?.get(p))).map((m) => {
                const mine = derived.paid.get(m.id) || new Map();
                const dues = new Set(duePeriods(m, data.settings, derived.curMonth));
                let tot = 0;
                return (
                  <tr key={m.id}>
                    <th className="nm">{m.name}</th>
                    {months.map((p) => {
                      const got = mine.get(p) || 0;
                      tot += got;
                      const st = m.joined_on > p ? 'future' : periodStatus(got, rateFor(data.rates, p), dues.has(p));
                      return (
                        <td key={p}>
                          <button
                            className={`ycell ${st} ${derived.closed.has(p) ? 'closed' : ''}`}
                            onClick={() => setPay({ m, p })}
                            aria-label={`${m.name} ${p} ${STATUS[st][1]}`}
                          >
                            {STATUS[st][0]}
                          </button>
                        </td>
                      );
                    })}
                    <td className="small"><Money v={tot} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {hijri && months.length > 0 && (
          <p className="small muted" style={{ marginTop: 8 }}>
            من <MonthLabel period={months[0]} hijri /> إلى <MonthLabel period={months.at(-1)} hijri />
          </p>
        )}
      </div>
      {pay && <ContributionDialog member={pay.m} period={pay.p} onClose={() => setPay(null)} />}
    </>
  );
}
