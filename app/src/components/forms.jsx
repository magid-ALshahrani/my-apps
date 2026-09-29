import { useState } from 'react';
import { addEntry, addMember, reverseEntry, updateMember } from '../api.js';
import { useFund } from '../fund.jsx';
import { isISODate, monthOf } from '../lib/dates.js';
import { fmtDate, KIND_LABEL, money, monthName, round2 } from '../lib/format.js';
import { rateFor } from '../lib/ledger.js';
import { Field, Modal, MonthSelect, Money, useSubmit, useToast } from './ui.jsx';

const UNDO_NOTE = 'تراجع فوري عن تسجيل خاطئ';

function useUndoable() {
  const { reload } = useFund();
  const toast = useToast();
  return (label, created) => {
    reload();
    toast.ok(`✅ ${label}`, {
      undo: async () => {
        try {
          await reverseEntry(created.id, UNDO_NOTE);
          toast.ok('↩️ تم التراجع بقيد عكسي');
        } catch (e) {
          toast.error(e);
        }
        reload();
      },
    });
  };
}

function dateError(d, { closed, today }) {
  if (!isISODate(d)) return 'تاريخ غير صحيح';
  if (d > today) return 'لا يمكن اختيار تاريخ مستقبلي';
  if (closed.has(monthOf(d))) return `شهر ${monthName(monthOf(d))} مقفل`;
  return null;
}

function parseAmount(s) {
  const v = Number(String(s).replace(/,/g, '').replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
  return Number.isFinite(v) ? round2(v) : NaN;
}

/* ---------- تسجيل اشتراك ---------- */
export function ContributionDialog({ member, period: initial, onClose }) {
  const { data, derived, can, hijri } = useFund();
  const [period, setPeriod] = useState(initial);
  const due = rateFor(data.rates, period);
  const paid = derived.paid.get(member.id)?.get(period) || 0;
  const remaining = due == null ? 0 : round2(due - paid);
  const [amount, setAmount] = useState(remaining > 0 ? String(remaining) : '');
  const [date, setDate] = useState(derived.today);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const done = useUndoable();
  const rows = derived.live.filter((e) => e.kind === 'contribution' && e.member_id === member.id && e.period === period);

  const a = parseAmount(amount);
  const errs = {
    amount: !(a > 0) ? 'أدخل مبلغاً صحيحاً' : a > remaining ? `الحد الأقصى ${money(remaining)}` : null,
    date: dateError(date, derived),
  };
  const [submit, busy] = useSubmit(
    () => addEntry({ kind: 'contribution', member_id: member.id, period, amount: a, entry_date: date, note: note.trim() || null }),
    { onDone: (r) => (done(`سُجّل اشتراك ${member.name} لشهر ${monthName(period)}`, r), onClose()) },
  );

  return (
    <Modal title={`💳 اشتراك ${member.name}`} onClose={onClose}>
      <Field label="الشهر">
        <MonthSelect value={period} onChange={(p) => { setPeriod(p); const d = rateFor(data.rates, p); const pd = derived.paid.get(member.id)?.get(p) || 0; setAmount(d != null && d > pd ? String(round2(d - pd)) : ''); }} months={derived.months} hijri={hijri} />
      </Field>
      {due == null ? (
        <div className="alert red">لا يوجد مبلغ اشتراك محدد لهذا الشهر. أضفه من الإعدادات.</div>
      ) : (
        <div className="alert gold">
          المستحق: <Money v={due} /> · المدفوع: <Money v={paid} /> · المتبقي: <Money v={remaining} />
        </div>
      )}
      {rows.length > 0 && (
        <div className="card" style={{ padding: 10 }}>
          {rows.map((e) => (
            <div key={e.id} className="list-row small">
              <span>{fmtDate(e.entry_date, hijri)}{e.note ? ` — ${e.note}` : ''}</span>
              <Money v={e.amount} />
            </div>
          ))}
          <div className="muted small">لإلغاء دفعة مسجلة استخدم «عكس» من صفحة الحركات.</div>
        </div>
      )}
      {can.write && remaining > 0 && (
        <form onSubmit={(e) => { e.preventDefault(); setTried(true); if (!errs.amount && !errs.date) submit(); }}>
          <div className="frow">
            <Field label="المبلغ ﷼" error={tried && errs.amount}>
              <input className={`input ${tried && errs.amount ? 'bad' : ''}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="تاريخ الاستلام" error={tried && errs.date}>
              <input className="input" type="date" value={date} max={derived.today} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label="ملاحظة (اختياري)">
            <input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: تحويل بنكي" />
          </Field>
          <button className="btn primary block" disabled={busy}>{busy ? 'جارٍ الحفظ...' : 'تسجيل الدفعة ✅'}</button>
        </form>
      )}
      {remaining <= 0 && due != null && <div className="alert grn">✅ هذا الشهر مدفوع بالكامل.</div>}
    </Modal>
  );
}

/* ---------- سحب / قرض / مصروف ---------- */
export function EntryDialog({ kind, memberId, onClose }) {
  const { derived } = useFund();
  // لا يُختار عضو تلقائياً حتى لا تُسجَّل الحركة على الشخص الخطأ
  const [member, setMember] = useState(memberId || '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(derived.today);
  const [note, setNote] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [inst, setInst] = useState('1');
  const [tried, setTried] = useState(false);
  const done = useUndoable();
  const a = parseAmount(amount);
  const balance = derived.summary.balance;
  const n = Number(inst);
  const errs = {
    member: kind !== 'expense' && !member ? 'اختر العضو' : null,
    amount: !(a > 0) ? 'أدخل مبلغاً صحيحاً' : a > balance ? `الرصيد لا يكفي (${money(balance)})` : null,
    date: dateError(date, derived),
    note: kind === 'expense' && note.trim().length < 2 ? 'اكتب بيان المصروف' : null,
    dueOn: kind === 'loan' && dueOn && dueOn < date ? 'الاستحقاق قبل تاريخ القرض' : null,
    inst: kind === 'loan' && dueOn && !(Number.isInteger(n) && n >= 1 && n <= 120) ? 'من 1 إلى 120' : null,
  };
  const ok = Object.values(errs).every((x) => !x);
  const [submit, busy] = useSubmit(
    () =>
      addEntry({
        kind,
        member_id: kind === 'expense' ? null : member,
        amount: a,
        entry_date: date,
        note: note.trim() || null,
        ...(kind === 'loan' && dueOn ? { due_on: dueOn, installments: n } : {}),
      }),
    { onDone: (r) => (done(`سُجّل ${KIND_LABEL[kind]} بمبلغ ${money(a)}`, r), onClose()) },
  );
  const title = { withdrawal: '💸 سحب نهائي', loan: '🔄 قرض جديد', expense: '🧾 مصروف' }[kind];
  return (
    <Modal title={title} onClose={onClose}>
      <div className="alert blu">الرصيد المتاح: <Money v={balance} /></div>
      <form onSubmit={(e) => { e.preventDefault(); setTried(true); if (ok) submit(); }}>
        {kind !== 'expense' && (
          <Field label="العضو" error={tried && errs.member}>
            <select className={`input ${tried && errs.member ? 'bad' : ''}`} value={member} onChange={(e) => setMember(e.target.value)}>
              <option value="" disabled>— اختر العضو —</option>
              {derived.activeMembers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
        )}
        {kind === 'expense' && (
          <Field label="البيان" error={tried && errs.note}>
            <input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="وصف المصروف" />
          </Field>
        )}
        <div className="frow">
          <Field label="المبلغ ﷼" error={tried && errs.amount}>
            <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          </Field>
          <Field label="التاريخ" error={tried && errs.date}>
            <input className="input" type="date" value={date} max={derived.today} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {kind === 'loan' && (
          <div className="frow">
            <Field label="تاريخ الاستحقاق (اختياري)" error={tried && errs.dueOn} hint="آخر موعد لسداد القرض كاملاً">
              <input className="input" type="date" value={dueOn} min={date} onChange={(e) => setDueOn(e.target.value)} />
            </Field>
            <Field label="عدد الأقساط الشهرية" error={tried && errs.inst}>
              <input className="input" inputMode="numeric" value={inst} disabled={!dueOn} onChange={(e) => setInst(e.target.value)} />
            </Field>
          </div>
        )}
        {kind !== 'expense' && (
          <Field label="ملاحظة (اختياري)">
            <input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="السبب" />
          </Field>
        )}
        <button className="btn primary block" disabled={busy}>{busy ? 'جارٍ الحفظ...' : 'تسجيل'}</button>
      </form>
    </Modal>
  );
}

/* ---------- سداد قرض ---------- */
export function RepayDialog({ view, onClose }) {
  const { derived, hijri } = useFund();
  const suggested = view.next ? Math.min(round2(view.next.cumulative - view.repaid), view.outstanding) : view.outstanding;
  const [amount, setAmount] = useState(String(suggested));
  const [date, setDate] = useState(derived.today);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const done = useUndoable();
  const a = parseAmount(amount);
  const member = derived.memberById.get(view.loan.member_id);
  const errs = {
    amount: !(a > 0) ? 'أدخل مبلغاً صحيحاً' : a > view.outstanding ? `الحد الأقصى ${money(view.outstanding)}` : null,
    date: dateError(date, derived),
  };
  const [submit, busy] = useSubmit(
    () => addEntry({ kind: 'repayment', loan_id: view.loan.id, member_id: view.loan.member_id, amount: a, entry_date: date, note: note.trim() || null }),
    { onDone: (r) => (done(`سُجّل سداد ${money(a)} من ${member?.name}`, r), onClose()) },
  );
  return (
    <Modal title="✅ تسجيل سداد" onClose={onClose}>
      <div className="alert gold">
        {member?.name} — القرض: <Money v={view.loan.amount} /> · المسدّد: <Money v={view.repaid} /> · المتبقي: <Money v={view.outstanding} />
        {view.next && <div>القسط القادم: {fmtDate(view.next.date, hijri)}</div>}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); setTried(true); if (!errs.amount && !errs.date) submit(); }}>
        <div className="frow">
          <Field label="المبلغ ﷼" error={tried && errs.amount}>
            <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="التاريخ" error={tried && errs.date}>
            <input className="input" type="date" value={date} max={derived.today} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="ملاحظة (اختياري)">
          <input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <button className="btn primary block" disabled={busy}>{busy ? 'جارٍ الحفظ...' : 'تأكيد السداد'}</button>
      </form>
    </Modal>
  );
}

/* ---------- قيد عكسي ---------- */
export function ReverseDialog({ entry, onClose }) {
  const { derived, reload, hijri } = useFund();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const err = note.trim().length < 3 ? 'اكتب سبب العكس (3 أحرف على الأقل)' : null;
  const [submit, busy] = useSubmit(() => reverseEntry(entry.id, note.trim()), {
    onDone: () => {
      toast.ok('↩️ تم تسجيل القيد العكسي');
      reload();
      onClose();
    },
  });
  const m = derived.memberById.get(entry.member_id);
  return (
    <Modal title="↩️ عكس قيد" onClose={onClose}>
      <div className="alert gold">
        {KIND_LABEL[entry.kind]} {m ? `— ${m.name}` : ''} — <Money v={entry.amount} /> — {fmtDate(entry.entry_date, hijri)}
        {entry.period ? ` — عن ${monthName(entry.period)}` : ''}
      </div>
      <p className="small muted" style={{ marginBottom: 12 }}>
        لا يُحذف القيد الأصلي؛ يُسجَّل قيد عكسي يلغي أثره ويبقى الاثنان في السجل للمراجعة.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); setTried(true); if (!err) submit(); }}>
        <Field label="سبب العكس" error={tried && err}>
          <input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: سُجّل بالخطأ على عضو آخر" autoFocus />
        </Field>
        <button className="btn danger block" disabled={busy}>{busy ? '...' : 'تسجيل القيد العكسي'}</button>
      </form>
    </Modal>
  );
}

/* ---------- عضو ---------- */
export function MemberDialog({ member, onClose }) {
  const { data, derived, reload, hijri } = useFund();
  const toast = useToast();
  const [name, setName] = useState(member?.name || '');
  const [phone, setPhone] = useState(member?.phone || '');
  const [joined, setJoined] = useState(member?.joined_on || (derived.curMonth > data.settings.start_month ? derived.curMonth : data.settings.start_month));
  const [tried, setTried] = useState(false);
  const clean = phone.replace(/[^0-9+ ]/g, '').trim();
  const errs = {
    name: !name.trim() ? 'أدخل الاسم' : name.trim().length > 60 ? 'الاسم طويل' : data.members.some((m) => m.id !== member?.id && m.name.trim() === name.trim()) ? 'الاسم موجود مسبقاً' : null,
    phone: clean && !/^[0-9+ ]{6,20}$/.test(clean) ? 'رقم غير صحيح' : null,
  };
  const [submit, busy] = useSubmit(
    () => {
      const row = { name: name.trim(), phone: clean || null, joined_on: joined };
      return member ? updateMember(member.id, row) : addMember(row);
    },
    { onDone: () => (toast.ok(member ? '✅ تم التحديث' : '✅ تمت إضافة العضو'), reload(), onClose()) },
  );
  return (
    <Modal title={member ? `✏️ تعديل ${member.name}` : '➕ عضو جديد'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); setTried(true); if (!errs.name && !errs.phone) submit(); }}>
        <Field label="الاسم" error={tried && errs.name}>
          <input className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="رقم الجوال (لإرسال الكشف والتذكير بالواتساب)" error={tried && errs.phone}>
          <input className="input num" style={{ textAlign: 'right' }} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05xxxxxxxx" />
        </Field>
        <Field label="بداية الاشتراك" hint="تُحسب عليه الأشهر المستحقة من هذا الشهر">
          <MonthSelect value={joined} onChange={setJoined} months={derived.months} hijri={hijri} />
        </Field>
        <button className="btn primary block" disabled={busy}>{busy ? '...' : 'حفظ'}</button>
      </form>
    </Modal>
  );
}
