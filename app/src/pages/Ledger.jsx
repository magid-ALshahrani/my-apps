import { useMemo, useState } from 'react';
import { useFund } from '../fund.jsx';
import { fmtDate, KIND_LABEL, monthName } from '../lib/format.js';
import { signed } from '../lib/ledger.js';
import { download, Money, toCSV } from '../components/ui.jsx';
import { EntryDialog, RepayDialog, ReverseDialog } from '../components/forms.jsx';
import { installmentSchedule } from '../lib/ledger.js';

const KIND_BADGE = { contribution: 'b-grn', repayment: 'b-grn', withdrawal: 'b-red', loan: 'b-blu', expense: 'b-amb', reversal: 'b-mut' };

export function Ledger() {
  const { data, derived, can, hijri } = useFund();
  const [kind, setKind] = useState('');
  const [member, setMember] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState(null);
  const [reverse, setReverse] = useState(null);
  const [limit, setLimit] = useState(100);

  const rows = useMemo(() => {
    const s = q.trim();
    return [...data.entries]
      .filter((e) => (!kind || e.kind === kind) && (!member || e.member_id === member) && (!from || e.entry_date >= from) && (!to || e.entry_date <= to))
      .filter((e) => !s || (e.note || '').includes(s) || (derived.memberById.get(e.member_id)?.name || '').includes(s))
      .sort((a, b) => b.entry_date.localeCompare(a.entry_date) || (b.created_at || '').localeCompare(a.created_at || ''));
  }, [data.entries, kind, member, from, to, q, derived.memberById]);

  const exportCSV = () => {
    const head = ['التاريخ', 'النوع', 'العضو', 'الشهر', 'المبلغ', 'الأثر على الرصيد', 'الحالة', 'ملاحظة', 'وقت التسجيل'];
    const body = rows.map((e) => [
      e.entry_date, KIND_LABEL[e.kind], derived.memberById.get(e.member_id)?.name || '', e.period ? monthName(e.period) : '', e.amount,
      e.kind === 'reversal' ? '' : signed(e), derived.reversedBy.has(e.id) ? 'معكوس' : e.kind === 'reversal' ? 'قيد عكسي' : 'فعّال', e.note || '', e.created_at || '',
    ]);
    download(`حركات-${derived.today}.csv`, toCSV([head, ...body]), 'text/csv;charset=utf-8');
  };

  return (
    <>
      <div className="page-h">
        <h2>📋 سجل الحركات</h2>
        {can.write && (
          <div className="row">
            <button className="btn danger sm" onClick={() => setDialog('withdrawal')}>💸 سحب</button>
            <button className="btn info sm" onClick={() => setDialog('loan')}>🔄 قرض</button>
            <button className="btn sm" onClick={() => setDialog('expense')}>🧾 مصروف</button>
          </div>
        )}
      </div>
      <div className="card no-print">
        <div className="frow">
          <label className="field"><span>النوع</span>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">الكل</option>
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="field"><span>العضو</span>
            <select className="input" value={member} onChange={(e) => setMember(e.target.value)}>
              <option value="">الكل</option>
              {data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="field"><span>من تاريخ</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field"><span>إلى تاريخ</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <div className="row">
          <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="🔍 بحث في الملاحظات والأسماء" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn sm" onClick={exportCSV}>📊 تصدير Excel</button>
        </div>
      </div>
      <div className="card">
        <div className="muted small" style={{ marginBottom: 8 }}>{rows.length} حركة</div>
        {rows.length === 0 ? <div className="empty">لا توجد حركات</div> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>التاريخ</th><th>النوع</th><th>العضو</th><th>المبلغ</th><th>تفاصيل</th>{can.write && <th />}</tr></thead>
              <tbody>
                {rows.slice(0, limit).map((e) => {
                  const rev = derived.reversedBy.get(e.id);
                  const target = e.kind === 'reversal' ? data.entries.find((x) => x.id === e.reverses) : null;
                  return (
                    <tr key={e.id} className={rev ? 'reversed' : ''}>
                      <td className="small" style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.entry_date, hijri)}</td>
                      <td><span className={`badge ${KIND_BADGE[e.kind]}`}>{KIND_LABEL[e.kind]}</span></td>
                      <td>{derived.memberById.get(e.member_id)?.name || '—'}</td>
                      <td style={{ fontWeight: 800, color: e.kind === 'reversal' ? 'var(--mut)' : signed(e) > 0 ? 'var(--grn)' : 'var(--red)' }}><Money v={e.amount} /></td>
                      <td className="small muted">
                        {e.period && <div>عن {monthName(e.period)}</div>}
                        {target && <div>يعكس {KIND_LABEL[target.kind]} بتاريخ {fmtDate(target.entry_date)}</div>}
                        {e.note && <div>{e.note}</div>}
                        {rev && <div style={{ color: 'var(--red)' }}>معكوس: {rev.note}</div>}
                      </td>
                      {can.write && (
                        <td>
                          {e.kind !== 'reversal' && !rev && (
                            <button className="btn danger sm" onClick={() => setReverse(e)} title="عكس القيد">↩️ عكس</button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > limit && <button className="btn block" style={{ marginTop: 10 }} onClick={() => setLimit(limit + 200)}>عرض المزيد</button>}
      </div>
      {dialog && <EntryDialog kind={dialog} onClose={() => setDialog(null)} />}
      {reverse && <ReverseDialog entry={reverse} onClose={() => setReverse(null)} />}
    </>
  );
}

const LOAN_STATUS = { active: ['b-blu', 'قائم'], overdue: ['b-red', 'متأخر'], paid: ['b-grn', 'مسدّد'], reversed: ['b-mut', 'ملغى'] };

export function Loans() {
  const { derived, can, hijri } = useFund();
  const [filter, setFilter] = useState('open');
  const [repay, setRepay] = useState(null);
  const [newLoan, setNewLoan] = useState(false);
  const [open, setOpen] = useState(null);
  const list = derived.loans
    .filter((l) => (filter === 'open' ? l.status === 'active' || l.status === 'overdue' : filter === 'all' ? true : l.status === filter))
    .sort((a, b) => b.loan.entry_date.localeCompare(a.loan.entry_date));
  return (
    <>
      <div className="page-h">
        <h2>🔄 القروض</h2>
        {can.write && <button className="btn primary sm" onClick={() => setNewLoan(true)}>➕ قرض جديد</button>}
      </div>
      <div className="chips">
        {[['open', 'القائمة'], ['overdue', 'المتأخرة'], ['paid', 'المسدّدة'], ['all', 'الكل']].map(([k, l]) => (
          <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      {list.length === 0 && <div className="card empty">لا توجد قروض</div>}
      {list.map((l) => {
        const pct = Math.round((l.repaid / l.loan.amount) * 100);
        const m = derived.memberById.get(l.loan.member_id);
        return (
          <div className="card" key={l.loan.id}>
            <div className="card-t">
              <span>{m?.name}</span>
              <span className={`badge ${LOAN_STATUS[l.status][0]}`}>{LOAN_STATUS[l.status][1]}</span>
            </div>
            <div className="row small" style={{ marginBottom: 8 }}>
              <span>القرض: <Money v={l.loan.amount} /></span>
              <span style={{ color: 'var(--grn)' }}>المسدّد: <Money v={l.repaid} /></span>
              <span style={{ color: 'var(--red)', fontWeight: 800 }}>المتبقي: <Money v={l.outstanding} /></span>
            </div>
            <div className="prog"><div style={{ width: `${pct}%` }} /></div>
            <div className="small muted" style={{ marginTop: 8 }}>
              بتاريخ {fmtDate(l.loan.entry_date, hijri)}
              {l.loan.due_on && <> · الاستحقاق {fmtDate(l.loan.due_on, hijri)} · {l.loan.installments || 1} قسط</>}
              {l.loan.note && <> · {l.loan.note}</>}
            </div>
            {l.status === 'overdue' && <div className="alert red" style={{ marginTop: 8, marginBottom: 0 }}>متأخر بمبلغ <Money v={l.overdueAmount} /></div>}
            <div className="row" style={{ marginTop: 10 }}>
              {can.write && (l.status === 'active' || l.status === 'overdue') && <button className="btn ok sm" onClick={() => setRepay(l)}>✅ تسجيل سداد</button>}
              {(l.schedule.length > 0 || l.repayments.length > 0) && (
                <button className="btn sm" onClick={() => setOpen(open === l.loan.id ? null : l.loan.id)}>{open === l.loan.id ? 'إخفاء التفاصيل' : 'الأقساط والسدادات'}</button>
              )}
            </div>
            {open === l.loan.id && (
              <div className="grid2" style={{ marginTop: 10 }}>
                {l.schedule.length > 0 && (
                  <div>
                    <div className="small muted" style={{ fontWeight: 700 }}>جدول الأقساط</div>
                    {installmentSchedule(l.loan).map((r, i) => (
                      <div className="list-row small" key={r.date}>
                        <span>{i + 1}. {fmtDate(r.date, hijri)}</span>
                        <span className="row"><Money v={r.amount} />{l.repaid >= r.cumulative ? <span className="badge b-grn">✓</span> : r.date < derived.today ? <span className="badge b-red">متأخر</span> : null}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div>
                  <div className="small muted" style={{ fontWeight: 700 }}>السدادات</div>
                  {l.repayments.length === 0 && <div className="small muted">لا يوجد</div>}
                  {l.repayments.map((r) => (
                    <div className="list-row small" key={r.id} style={derived.reversedBy.has(r.id) ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
                      <span>{fmtDate(r.entry_date, hijri)}</span><Money v={r.amount} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {repay && <RepayDialog view={repay} onClose={() => setRepay(null)} />}
      {newLoan && <EntryDialog kind="loan" onClose={() => setNewLoan(false)} />}
    </>
  );
}
