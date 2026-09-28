import { useState } from 'react';
import { useFund } from '../fund.jsx';
import { BACKUP_REMINDER_DAYS } from '../config.js';
import { money, monthName } from '../lib/format.js';
import { rateFor, unpaidFor } from '../lib/ledger.js';
import { Money, MonthLabel, Stat } from '../components/ui.jsx';
import { ContributionDialog } from '../components/forms.jsx';

export default function Dashboard({ go }) {
  const { data, derived, can, hijri, profile } = useFund();
  const [pay, setPay] = useState(null);
  const { summary, curMonth, activeMembers } = derived;
  const rate = rateFor(data.rates, curMonth);
  const unpaid = unpaidFor({ members: data.members, live: derived.live, rates: data.rates, settings: data.settings, period: curMonth, paid: derived.paid });
  const dueCount = activeMembers.filter((m) => m.joined_on <= curMonth).length;
  const paidCount = dueCount - unpaid.length;
  const pct = dueCount ? Math.round((paidCount / dueCount) * 100) : 0;
  const overdue = derived.loans.filter((l) => l.status === 'overdue');
  const lastBackup = data.settings.last_backup_at;
  const backupDue = can.staff && (!lastBackup || Date.now() - Date.parse(lastBackup) > BACKUP_REMINDER_DAYS * 864e5);
  const needsSetup = can.staff && (data.rates.length === 0 || data.members.length === 0);
  const myMember = profile.member_id && derived.memberById.get(profile.member_id);

  return (
    <>
      {needsSetup && (
        <div className="card" style={{ borderColor: 'var(--gold)' }}>
          <div className="card-t">🚀 خطوات البداية</div>
          <ol style={{ paddingInlineStart: 20, lineHeight: 2 }}>
            <li className={data.rates.length ? 'muted' : ''}>
              اضبط شهر التأسيس ومبلغ الاشتراك من <button className="linkish" onClick={() => go('settings')}>الإعدادات</button>
            </li>
            <li className={data.members.length ? 'muted' : ''}>
              انقل بياناتك من النسخة القديمة من <button className="linkish" onClick={() => go('backup')}>النسخ الاحتياطي</button>، أو أضف الأعضاء من <button className="linkish" onClick={() => go('members')}>الأعضاء</button>
            </li>
            <li>اعتمد حسابات الإخوة من الإعدادات ← المستخدمون</li>
          </ol>
        </div>
      )}
      {backupDue && !needsSetup && (
        <div className="alert gold">
          💾 {lastBackup ? `مرّ أكثر من ${BACKUP_REMINDER_DAYS} أيام على آخر نسخة احتياطية.` : 'لم تُؤخذ أي نسخة احتياطية بعد.'}{' '}
          <button className="linkish" onClick={() => go('backup')}>خذ نسخة الآن</button>
        </div>
      )}
      {can.seeAll && overdue.length > 0 && (
        <div className="alert red">
          ⚠️ أقساط متأخرة: {overdue.map((l) => `${derived.memberById.get(l.loan.member_id)?.name} (${money(l.overdueAmount)})`).join('، ')}{' '}
          <button className="linkish" onClick={() => go('loans')}>عرض القروض</button>
        </div>
      )}

      <div className="stats">
        <Stat label="🏦 رصيد الصندوق" value={summary.balance} tone="grn" />
        <Stat label="💰 إجمالي المحصّل" value={summary.collected} tone="gold" />
        <Stat label="💸 السحوبات والمصروفات" value={summary.withdrawals + summary.expenses} tone="red" />
        <Stat label="🔄 قروض قائمة" value={summary.loans_outstanding} tone="blu" />
      </div>

      <div className="grid2">
        {can.seeAll && <div className="card">
          <div className="card-t">
            <span>📅 <MonthLabel period={curMonth} hijri={hijri} /></span>
            {rate != null && <span className="badge b-gold">الاشتراك <Money v={rate} /></span>}
          </div>
          <div className="row" style={{ marginBottom: 8 }}>
            <strong className="num">{paidCount}/{dueCount}</strong>
            <span className="muted small">دفعوا كاملاً</span>
            <span className="spacer" />
            <strong>{pct}%</strong>
          </div>
          <div className="prog"><div style={{ width: `${pct}%` }} /></div>
          <div className="chips" style={{ marginTop: 12, marginBottom: 0 }}>
            {activeMembers.filter((m) => m.joined_on <= curMonth).map((m) => {
              const u = unpaid.find((x) => x.member.id === m.id);
              const cls = !u ? 'b-grn' : u.paid > 0 ? 'b-amb' : 'b-red';
              return (
                <button key={m.id} className={`badge ${cls}`} style={{ border: 'none' }} onClick={() => setPay(m)} disabled={!can.write && !can.seeAll}>
                  {!u ? '✓' : u.paid > 0 ? '◐' : '✗'} {m.name}
                </button>
              );
            })}
          </div>
        </div>}

        <div className="card">
          {myMember || !can.seeAll ? (
            <>
              <div className="card-t">👤 حسابي</div>
              <p className="muted small" style={{ marginBottom: 10 }}>{myMember ? <>مرتبط بالعضو: <strong>{myMember.name}</strong></> : 'حسابك غير مرتبط بعضو بعد؛ تواصل مع المدير.'}</p>
              <button className="btn primary block" onClick={() => go('statement')}>عرض كشف حسابي</button>
            </>
          ) : (
            <>
              <div className="card-t">⏳ لم يكملوا اشتراك {monthName(curMonth)}</div>
              {unpaid.length === 0 ? (
                <div className="empty">✅ الجميع دفعوا</div>
              ) : (
                unpaid.map((u) => (
                  <div className="list-row" key={u.member.id}>
                    <span>{u.member.name}</span>
                    <span className="badge b-red">متبقٍ <Money v={u.remaining} /></span>
                  </div>
                ))
              )}
              {can.staff && unpaid.length > 0 && (
                <button className="btn wa block" style={{ marginTop: 10 }} onClick={() => go('reminders')}>📱 تذكيرهم بالواتساب</button>
              )}
            </>
          )}
        </div>
      </div>

      {can.seeAll && derived.loans.some((l) => l.status === 'active' || l.status === 'overdue') && (
        <div className="card">
          <div className="card-t">🔄 القروض القائمة <button className="linkish" onClick={() => go('loans')}>الكل ←</button></div>
          {derived.loans.filter((l) => l.status === 'active' || l.status === 'overdue').map((l) => (
            <div className="list-row" key={l.loan.id}>
              <span>{derived.memberById.get(l.loan.member_id)?.name}</span>
              <span className="row">
                {l.status === 'overdue' && <span className="badge b-red">متأخر</span>}
                <span className="small muted">متبقٍ</span> <Money v={l.outstanding} />
              </span>
            </div>
          ))}
        </div>
      )}
      {pay && <ContributionDialog member={pay} period={curMonth} onClose={() => setPay(null)} />}
    </>
  );
}
