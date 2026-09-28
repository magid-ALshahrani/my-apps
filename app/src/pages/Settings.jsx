import { useEffect, useState } from 'react';
import { useFund, usePref } from '../fund.jsx';
import { addRate, closeMonth, deleteRate, loadAudit, reopenMonth, updateProfile, updateSettings } from '../api.js';
import { fmtDate, KIND_LABEL, money, monthName, ROLE_LABEL } from '../lib/format.js';
import { addMonths } from '../lib/dates.js';
import { Confirm, Field, Money, MonthLabel, MonthSelect, useSubmit, useToast } from '../components/ui.jsx';

export function applyTheme(theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

export function Settings() {
  const { can } = useFund();
  return (
    <>
      <div className="page-h"><h2>⚙️ الإعدادات</h2></div>
      <Preferences />
      {can.staff && <FundSettings />}
      {can.staff && <Rates />}
      {can.staff && <Closures />}
      {can.staff && <Users />}
    </>
  );
}

function Preferences() {
  const { hijri, setHijri } = useFund();
  const [theme, setTheme] = usePref('theme', 'system');
  useEffect(() => applyTheme(theme), [theme]);
  return (
    <div className="card">
      <div className="card-t">🎨 العرض</div>
      <div className="chips">
        {[['system', 'حسب الجهاز'], ['light', '☀️ فاتح'], ['dark', '🌙 داكن']].map(([k, l]) => (
          <button key={k} className={`chip ${theme === k ? 'on' : ''}`} onClick={() => setTheme(k)}>{l}</button>
        ))}
      </div>
      <label className="check"><input type="checkbox" checked={hijri} onChange={(e) => setHijri(e.target.checked)} /> إظهار التاريخ الهجري بجانب الميلادي</label>
    </div>
  );
}

function FundSettings() {
  const { data, derived, can, reload } = useFund();
  const toast = useToast();
  const [name, setName] = useState(data.settings.fund_name);
  const [start, setStart] = useState(data.settings.start_month);
  const hasEntries = data.entries.length > 0;
  const startChoices = [];
  for (let p = addMonths(derived.curMonth, -120); p <= addMonths(derived.curMonth, 1); p = addMonths(p, 1)) startChoices.push(p);
  const [save, busy] = useSubmit(
    () => updateSettings({ fund_name: name.trim(), ...(hasEntries ? {} : { start_month: start }) }),
    { onDone: () => (toast.ok('✅ تم الحفظ'), reload()) },
  );
  const [toggle] = useSubmit(() => updateSettings({ members_see_all: !data.settings.members_see_all }), { onDone: () => reload() });
  return (
    <div className="card">
      <div className="card-t">🏦 الصندوق {!can.admin && <span className="badge b-mut">للمدير فقط</span>}</div>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) save(); }}>
        <div className="frow">
          <Field label="اسم الصندوق">
            <input className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} disabled={!can.admin} />
          </Field>
          <Field label="شهر التأسيس" hint={hasEntries ? 'لا يتغير بعد تسجيل حركات' : 'أول شهر تُستحق فيه الاشتراكات'}>
            <MonthSelect value={start} onChange={setStart} months={startChoices} disabled={!can.admin || hasEntries} />
          </Field>
        </div>
        {can.admin && <button className="btn primary" disabled={busy}>حفظ</button>}
      </form>
      <hr style={{ border: 'none', borderTop: '1px solid var(--bor)', margin: '14px 0' }} />
      <label className="check">
        <input type="checkbox" checked={data.settings.members_see_all} disabled={!can.admin} onChange={toggle} />
        الأعضاء يرون كل الحركات (شفافية كاملة)
      </label>
      <p className="small muted">عند الإلغاء: يرى كل عضو حركاته والمصروفات العامة والرصيد الإجمالي فقط.</p>
    </div>
  );
}

function Rates() {
  const { data, derived, can, reload, hijri } = useFund();
  const toast = useToast();
  const [from, setFrom] = useState(data.rates.length ? derived.curMonth : data.settings.start_month);
  const [amount, setAmount] = useState('');
  const [del, setDel] = useState(null);
  const a = Number(amount);
  const [add, busy] = useSubmit(() => addRate(from, a), { onDone: () => (toast.ok('✅ أُضيف السعر'), setAmount(''), reload()) });
  const choices = [...new Set([data.settings.start_month, ...derived.months])].sort();
  return (
    <div className="card">
      <div className="card-t">💵 مبلغ الاشتراك الشهري {!can.admin && <span className="badge b-mut">للمدير فقط</span>}</div>
      {data.rates.length === 0 && <div className="alert red">لم يُحدد مبلغ الاشتراك بعد؛ لا يمكن تسجيل الدفعات قبل تحديده.</div>}
      {[...data.rates].reverse().map((r) => (
        <div className="list-row" key={r.effective_from}>
          <span>من <MonthLabel period={r.effective_from} hijri={hijri} /></span>
          <span className="row"><Money v={r.amount} />{can.admin && <button className="btn danger sm" onClick={() => setDel(r)}>حذف</button>}</span>
        </div>
      ))}
      {can.admin && (
        <form className="frow" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); if (a > 0) add(); }}>
          <Field label="يسري من شهر"><MonthSelect value={from} onChange={setFrom} months={choices} /></Field>
          <Field label="المبلغ ﷼"><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100" /></Field>
          <button className="btn primary" disabled={busy || !(a > 0)}>➕ إضافة سعر</button>
        </form>
      )}
      <p className="small muted" style={{ marginTop: 8 }}>تغيير المبلغ لا يؤثر على الأشهر السابقة؛ كل شهر يُحسب بالسعر الساري فيه.</p>
      {del && (
        <Confirm title="حذف سعر" message={`حذف سعر ${money(del.amount)} الساري من ${monthName(del.effective_from)}؟ (مسموح فقط إن لم تُسجَّل عليه دفعات)`} danger
          onConfirm={async () => { await deleteRate(del.effective_from); toast.ok('تم الحذف'); reload(); }} onClose={() => setDel(null)} />
      )}
    </div>
  );
}

function Closures() {
  const { data, derived, can, reload, hijri } = useFund();
  const toast = useToast();
  const [c, setC] = useState(null);
  const past = derived.pastMonths.filter((p) => p < derived.curMonth).reverse().slice(0, 18);
  return (
    <div className="card">
      <div className="card-t">🔒 إقفال الأشهر</div>
      <p className="small muted" style={{ marginBottom: 10 }}>
        بعد مراجعة الشهر أقفله؛ لا تُسجَّل بعدها حركات بتاريخه، وأي تصحيح يكون بقيد عكسي بتاريخ اليوم.
      </p>
      {past.length === 0 && <div className="empty">لا توجد أشهر منتهية بعد</div>}
      {past.map((p) => {
        const closed = derived.closed.has(p);
        const info = data.closures.find((x) => x.period === p);
        return (
          <div className="list-row" key={p}>
            <span><MonthLabel period={p} hijri={hijri} /> {closed && <span className="badge b-mut">🔒 مقفل {info?.closed_at ? fmtDate(info.closed_at.slice(0, 10)) : ''}</span>}</span>
            {!closed && can.write && <button className="btn sm" onClick={() => setC({ p, closed })}>إقفال</button>}
            {closed && can.admin && <button className="btn danger sm" onClick={() => setC({ p, closed })}>إعادة فتح</button>}
          </div>
        );
      })}
      {c && (
        <Confirm
          title={c.closed ? `إعادة فتح ${monthName(c.p)}` : `إقفال ${monthName(c.p)}`}
          message={c.closed ? 'سيسمح بتسجيل حركات بتاريخ هذا الشهر من جديد. تُسجَّل العملية في سجل التدقيق.' : 'تأكد من مراجعة حركات الشهر قبل الإقفال.'}
          danger={c.closed}
          onConfirm={async () => { await (c.closed ? reopenMonth(c.p) : closeMonth(c.p)); toast.ok('✅ تم'); reload(); }}
          onClose={() => setC(null)}
        />
      )}
    </div>
  );
}

function Users() {
  const { data, can, reload, session } = useFund();
  const toast = useToast();
  const [busyId, setBusyId] = useState(null);
  const pending = data.profiles.filter((p) => p.role === 'pending');
  const change = async (p, patch) => {
    setBusyId(p.id);
    try {
      await updateProfile(p.id, patch);
      toast.ok('✅ تم التحديث');
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusyId(null);
    }
  };
  return (
    <div className="card">
      <div className="card-t">👤 المستخدمون والصلاحيات {!can.admin && <span className="badge b-mut">للمدير فقط</span>}</div>
      {pending.length > 0 && <div className="alert gold">{pending.length} حساب بانتظار موافقتك.</div>}
      {data.profiles.map((p) => (
        <div className="list-row" key={p.id} style={{ flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: '1 1 200px' }}>
            <div style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{p.display_name || p.email} {p.id === session.user.id && <span className="badge b-gold">أنت</span>}</div>
            <div className="small muted" style={{ overflowWrap: 'anywhere' }}>{p.email}</div>
          </div>
          <div className="row" style={{ flex: '1 1 260px' }}>
            <select className="input" style={{ flex: 1 }} value={p.role} disabled={!can.admin || busyId === p.id} onChange={(e) => change(p, { role: e.target.value })} aria-label="الصلاحية">
              {Object.entries(ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select className="input" style={{ flex: 1 }} value={p.member_id || ''} disabled={!can.admin || busyId === p.id} onChange={(e) => change(p, { member_id: e.target.value || null })} aria-label="العضو المرتبط">
              <option value="">— غير مرتبط بعضو —</option>
              {data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        </div>
      ))}
      <p className="small muted" style={{ marginTop: 8 }}>
        اربط حساب كل أخ باسمه في الصندوق ليرى كشف حسابه. «أمين الصندوق» يسجّل الحركات، و«عضو» للمشاهدة فقط، و«موقوف» يمنع الدخول.
      </p>
    </div>
  );
}

export function Audit() {
  const { derived, data } = useFund();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [limit, setLimit] = useState(200);
  useEffect(() => {
    loadAudit(limit).then(setRows).catch((e) => toast.error(e));
  }, [limit, toast]);
  const who = (r) => r.actor_email || (r.actor ? r.actor.slice(0, 8) : 'النظام');
  const describe = (r) => {
    const d = r.new_data || r.old_data || {};
    if (r.table_name === 'entries') {
      const m = derived.memberById.get(d.member_id)?.name;
      return `${KIND_LABEL[d.kind] || d.kind} ${money(d.amount)}${m ? ` — ${m}` : ''}${d.period ? ` عن ${monthName(d.period)}` : ''}${d.note ? ` (${d.note})` : ''}`;
    }
    if (r.table_name === 'members') return `عضو: ${d.name}${r.action === 'update' && r.old_data?.archived !== r.new_data?.archived ? (d.archived ? ' — أرشفة' : ' — تفعيل') : ''}`;
    if (r.table_name === 'profiles') return `صلاحية ${d.email}: ${ROLE_LABEL[d.role] || d.role}`;
    if (r.table_name === 'contribution_rates') return `سعر اشتراك ${money(d.amount)} من ${monthName(d.effective_from)}`;
    if (r.table_name === 'month_closures') return `${r.action === 'delete' ? 'إعادة فتح' : 'إقفال'} ${monthName(d.period)}`;
    if (r.table_name === 'settings') return 'تعديل الإعدادات';
    return r.table_name;
  };
  const ACTION = { insert: ['b-grn', 'إضافة'], update: ['b-amb', 'تعديل'], delete: ['b-red', 'حذف'] };
  return (
    <>
      <div className="page-h"><h2>🛡️ سجل التدقيق</h2></div>
      <p className="small muted" style={{ marginBottom: 12 }}>كل عملية على بيانات {data.settings.fund_name} مسجلة هنا بصاحبها ووقتها، ولا يمكن تعديل هذا السجل أو حذفه.</p>
      <div className="card">
        {!rows ? <div className="empty">جارٍ التحميل...</div> : rows.length === 0 ? <div className="empty">لا يوجد</div> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>التفاصيل</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="small num" style={{ whiteSpace: 'nowrap' }}>{new Date(r.at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td className="small" style={{ overflowWrap: 'anywhere' }}>{who(r)}</td>
                    <td><span className={`badge ${ACTION[r.action]?.[0] || 'b-mut'}`}>{ACTION[r.action]?.[1] || r.action}</span></td>
                    <td className="small">{describe(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows && rows.length >= limit && <button className="btn block" style={{ marginTop: 10 }} onClick={() => setLimit(limit + 300)}>عرض المزيد</button>}
      </div>
    </>
  );
}
