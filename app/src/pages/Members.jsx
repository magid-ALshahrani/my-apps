import { useState } from 'react';
import { useFund } from '../fund.jsx';
import { updateMember } from '../api.js';
import { fmtDate, monthName } from '../lib/format.js';
import { duePeriods, memberStats, periodStatus, rateFor, unpaidFor } from '../lib/ledger.js';
import { reminderText, statementText, waLink } from '../lib/text.js';
import { Confirm, Money, MonthLabel, MonthSelect, useToast } from '../components/ui.jsx';
import { MemberDialog } from '../components/forms.jsx';

export function Members({ go }) {
  const { data, derived, can, reload } = useFund();
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  const [archive, setArchive] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const list = data.members.filter((m) => showArchived || !m.archived);
  return (
    <>
      <div className="page-h">
        <h2>👥 الأعضاء</h2>
        {can.write && <button className="btn primary sm" onClick={() => setEdit('new')}>➕ عضو جديد</button>}
      </div>
      <label className="check"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> إظهار المؤرشفين</label>
      <div className="card">
        {list.length === 0 && <div className="empty">لا يوجد أعضاء</div>}
        {list.map((m) => {
          const s = memberStats({ member: m, live: derived.live, settings: data.settings, rates: data.rates, curMonth: derived.curMonth, paid: derived.paid });
          return (
            <div className="list-row" key={m.id} style={{ alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800 }}>
                  {m.name} {m.archived && <span className="badge b-mut">مؤرشف</span>}
                </div>
                <div className="small muted">
                  المدفوع <Money v={s.paidTotal} /> · الالتزام {s.commitment}%
                  {s.arrears > 0 && <> · <span style={{ color: 'var(--red)' }}>متأخرات <Money v={s.arrears} /></span></>}
                  {s.loansOut > 0 && <> · قرض <Money v={s.loansOut} /></>}
                </div>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                {can.seeAll && <button className="btn sm" onClick={() => go('statement', m.id)}>📄 كشف</button>}
                {can.write && <button className="btn sm" onClick={() => setEdit(m)}>✏️</button>}
                {can.write && (
                  <button className={`btn sm ${m.archived ? 'ok' : 'danger'}`} onClick={() => setArchive(m)}>{m.archived ? 'تفعيل' : 'أرشفة'}</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="small muted">الأرشفة لا تحذف أي بيانات: يبقى سجل العضو وأرصدته محفوظة، وتتوقف الأشهر المستحقة عليه من تاريخ الأرشفة.</p>
      {edit && <MemberDialog member={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {archive && (
        <Confirm
          title={archive.archived ? `تفعيل ${archive.name}` : `أرشفة ${archive.name}`}
          message={archive.archived ? 'سيعود العضو نشطاً وتُحسب عليه الأشهر القادمة.' : 'لن تُسجَّل له حركات جديدة، وتبقى كل سجلاته محفوظة. يمكن إعادة تفعيله لاحقاً.'}
          danger={!archive.archived}
          onConfirm={async () => {
            await updateMember(archive.id, { archived: !archive.archived });
            toast.ok('✅ تم');
            reload();
          }}
          onClose={() => setArchive(null)}
        />
      )}
    </>
  );
}

export function Statement({ memberId }) {
  const { data, derived, profile, can, hijri } = useFund();
  const choices = can.seeAll ? data.members : data.members.filter((m) => m.id === profile.member_id);
  const [id, setId] = useState(memberId || profile.member_id || choices[0]?.id || '');
  const member = derived.memberById.get(id);
  if (!member) return <div className="card empty">{can.staff ? 'لا يوجد أعضاء بعد' : 'حسابك غير مرتبط بعضو بعد؛ تواصل مع المدير.'}</div>;
  const s = memberStats({ member, live: derived.live, settings: data.settings, rates: data.rates, curMonth: derived.curMonth, paid: derived.paid });
  const mine = derived.paid.get(member.id) || new Map();
  const dues = duePeriods(member, data.settings, derived.curMonth);
  const extra = [...mine.keys()].filter((p) => !dues.includes(p)).sort();
  const periods = [...dues, ...extra].reverse();
  const moves = derived.live.filter((e) => e.member_id === member.id && e.kind !== 'contribution').sort((a, b) => b.entry_date.localeCompare(a.entry_date));
  const text = statementText({ fundName: data.settings.fund_name, member, stats: s, today: derived.today });
  return (
    <>
      <div className="page-h">
        <h2>📄 كشف حساب</h2>
        {choices.length > 1 && (
          <select className="input no-print" style={{ maxWidth: 220 }} value={id} onChange={(e) => setId(e.target.value)}>
            {choices.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
      </div>
      <div className="print-only"><h2>{data.settings.fund_name} — كشف حساب {member.name} — {fmtDate(derived.today)}</h2></div>
      <div className="stats">
        <div className="stat gold"><div className="l">إجمالي المدفوع</div><div className="v"><Money v={s.paidTotal} /></div></div>
        <div className="stat red"><div className="l">المتأخرات</div><div className="v"><Money v={s.arrears} /></div></div>
        <div className="stat blu"><div className="l">قروض قائمة</div><div className="v"><Money v={s.loansOut} /></div></div>
        <div className="stat grn"><div className="l">نسبة الالتزام</div><div className="v">{s.commitment}%</div></div>
      </div>
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <a className="btn wa" href={waLink(text, member.phone)} target="_blank" rel="noopener noreferrer">📱 إرسال بالواتساب{member.phone ? '' : ' (بدون رقم)'}</a>
        <button className="btn" onClick={() => window.print()}>🖨️ طباعة / PDF</button>
      </div>
      <div className="grid2">
        <div className="card">
          <div className="card-t">الاشتراكات</div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>الشهر</th><th>المستحق</th><th>المدفوع</th><th>الحالة</th></tr></thead>
              <tbody>
                {periods.map((p) => {
                  const due = rateFor(data.rates, p);
                  const got = mine.get(p) || 0;
                  const st = periodStatus(got, due, dues.includes(p));
                  const b = { paid: ['b-grn', 'مدفوع'], partial: ['b-amb', 'جزئي'], unpaid: ['b-red', 'متأخر'], future: ['b-blu', 'مقدّم'], norate: ['b-mut', '—'] }[st];
                  return (
                    <tr key={p}>
                      <td><MonthLabel period={p} hijri={hijri} /></td>
                      <td>{due == null ? '—' : <Money v={due} />}</td>
                      <td><Money v={got} /></td>
                      <td><span className={`badge ${b[0]}`}>{b[1]}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-t">السحوبات والقروض</div>
          {moves.length === 0 ? <div className="empty">لا يوجد</div> : moves.map((e) => (
            <div className="list-row small" key={e.id}>
              <span>{fmtDate(e.entry_date, hijri)} — {{ withdrawal: 'سحب', loan: 'قرض', repayment: 'سداد' }[e.kind]}{e.note ? ` (${e.note})` : ''}</span>
              <Money v={e.amount} />
            </div>
          ))}
          <div className="list-row" style={{ fontWeight: 800 }}>
            <span>صافي حصته في الصندوق</span><Money v={s.net} />
          </div>
        </div>
      </div>
    </>
  );
}

export function Reminders() {
  const { data, derived, hijri } = useFund();
  const [period, setPeriod] = useState(derived.curMonth);
  const list = unpaidFor({ members: data.members, live: derived.live, rates: data.rates, settings: data.settings, period, paid: derived.paid });
  const pastAndCurrent = derived.pastMonths;
  return (
    <>
      <div className="page-h">
        <h2>🔔 تذكير المتأخرين</h2>
        <div style={{ minWidth: 200 }}>
          <MonthSelect value={period} onChange={setPeriod} months={pastAndCurrent} hijri={hijri} />
        </div>
      </div>
      <div className="card">
        <div className="card-t">لم يكملوا اشتراك <MonthLabel period={period} hijri={hijri} /></div>
        {list.length === 0 && <div className="empty">✅ الجميع دفعوا</div>}
        {list.map((u) => (
          <div className="list-row" key={u.member.id}>
            <span>{u.member.name} — متبقٍ <Money v={u.remaining} /></span>
            <a
              className="btn wa sm"
              href={waLink(reminderText({ fundName: data.settings.fund_name, member: u.member, period, remaining: u.remaining }), u.member.phone)}
              target="_blank"
              rel="noopener noreferrer"
            >
              📱 {u.member.phone ? 'تذكير' : 'تذكير (أضف رقمه)'}
            </a>
          </div>
        ))}
      </div>
      <p className="small muted">يفتح الواتساب برسالة جاهزة لكل عضو. أضف أرقام الجوال من صفحة الأعضاء لتصل الرسالة مباشرة. آخر تحديث: {monthName(derived.curMonth)}.</p>
    </>
  );
}
