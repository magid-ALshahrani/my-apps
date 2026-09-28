// تحويل ملف التصدير من النسخة القديمة (sandooq-desktop.html) إلى الصيغة الموحدة.
import { BACKUP_FORMAT } from './dataset.js';
import { isISODate, monthOf, todayISO } from './dates.js';
import { round2 } from './format.js';

export const OLD_MONTHLY = 100;
const PAY_KEY = /^(.+)-(\d{4})-(\d{2})$/;

export const isLegacyExport = (d) =>
  d && typeof d === 'object' && !d.format && Array.isArray(d.members) && d.payments && typeof d.payments === 'object';

const bad = (msg) => {
  throw new Error(`ملف النسخة القديمة غير صالح: ${msg}`);
};

export function convertLegacy(old, { uuid = () => crypto.randomUUID(), today = todayISO(), fundName = 'صندوق الإخوة' } = {}) {
  if (!isLegacyExport(old)) bad('ليس ملف تصدير من النسخة القديمة');
  const warnings = [];
  const txs = Array.isArray(old.transactions) ? old.transactions : [];
  const exps = Array.isArray(old.expenses) ? old.expenses : [];

  // الدفعات
  const payments = [];
  for (const [key, val] of Object.entries(old.payments)) {
    if (!val) continue;
    const m = PAY_KEY.exec(key);
    if (!m) bad(`مفتاح دفعة: ${key}`);
    const mm = +m[3];
    if (mm < 1 || mm > 12) bad(`شهر غير صحيح: ${key}`);
    payments.push({ name: m[1].trim(), period: `${m[2]}-${m[3]}-01` });
  }

  for (const t of txs) {
    if (typeof t?.member !== 'string' || !t.member.trim()) bad('حركة بدون عضو');
    if (!['سحب', 'قرض'].includes(t.type)) bad(`نوع حركة: ${t.type}`);
    if (!(Number(t.amount) > 0)) bad('مبلغ حركة');
    if (!isISODate(t.date)) bad(`تاريخ حركة: ${t.date}`);
  }
  for (const e of exps) {
    if (!(Number(e?.amount) > 0)) bad('مبلغ مصروف');
    if (!isISODate(e.date)) bad(`تاريخ مصروف: ${e.date}`);
  }

  // الأعضاء: الحاليون + أي اسم له سجلات (أعضاء حُذفوا في النسخة القديمة يُستعادون مؤرشفين)
  const active = [];
  for (const n of old.members) {
    if (typeof n !== 'string' || !n.trim() || n.trim().length > 60) bad('اسم عضو');
    if (!active.includes(n.trim())) active.push(n.trim());
  }
  const allNames = new Set(active);
  for (const p of payments) allNames.add(p.name);
  for (const t of txs) allNames.add(t.member.trim());

  const months = [
    ...payments.map((p) => p.period),
    ...txs.map((t) => monthOf(t.date)),
    ...exps.map((e) => monthOf(e.date)),
  ].sort();
  const start = months[0] || monthOf(today);

  const members = [];
  const idByName = new Map();
  for (const name of allNames) {
    const id = uuid();
    idByName.set(name, id);
    const archived = !active.includes(name);
    let archivedAt = null;
    if (archived) {
      const last = [...payments.filter((p) => p.name === name).map((p) => p.period),
        ...txs.filter((t) => t.member.trim() === name).map((t) => monthOf(t.date))].sort().pop() || start;
      archivedAt = `${last}T00:00:00Z`;
      warnings.push(`العضو «${name}» محذوف في النسخة القديمة وله سجلات؛ استُعيد كعضو مؤرشف.`);
    }
    members.push({ id, name, phone: null, joined_on: start, archived, archived_at: archivedAt, created_at: null });
  }

  const inflows = [];
  const others = [];
  for (const p of payments) {
    inflows.push({
      id: uuid(), kind: 'contribution', member_id: idByName.get(p.name), amount: OLD_MONTHLY,
      entry_date: p.period < today ? p.period : today, period: p.period, note: null,
    });
  }
  for (const t of txs) {
    const amount = round2(Number(t.amount));
    const note = typeof t.note === 'string' && t.note.trim() ? t.note.trim().slice(0, 300) : null;
    const base = { member_id: idByName.get(t.member.trim()), entry_date: t.date, period: null, note };
    if (t.type === 'سحب') {
      others.push({ id: uuid(), kind: 'withdrawal', amount, ...base });
    } else {
      const loanId = uuid();
      others.push({ id: loanId, kind: 'loan', amount, ...base });
      const repaid = t.returned ? amount : Math.min(round2(Number(t.repaid) || 0), amount);
      if (Number(t.repaid) > amount) warnings.push(`سداد قرض «${t.member}» كان أكبر من القرض؛ اعتُمد مبلغ القرض فقط.`);
      if (repaid > 0) {
        others.push({
          id: uuid(), kind: 'repayment', member_id: base.member_id, loan_id: loanId, amount: repaid,
          entry_date: t.date, period: null, note: 'سداد مسجّل في النسخة السابقة (تاريخه غير محفوظ)',
        });
      }
    }
  }
  for (const e of exps) {
    const desc = typeof e.desc === 'string' ? e.desc.trim() : '';
    others.push({
      id: uuid(), kind: 'expense', member_id: null, amount: round2(Number(e.amount)), entry_date: e.date,
      period: null, note: (desc.length >= 2 ? desc : `مصروف ${desc}`.trim()).slice(0, 300),
    });
  }
  // الإيرادات أولاً ثم بقية الحركات زمنياً (القرض قبل سداده)
  const order = { loan: 0, withdrawal: 0, expense: 0, repayment: 1 };
  others.sort((a, b) => a.entry_date.localeCompare(b.entry_date) || order[a.kind] - order[b.kind]);
  inflows.sort((a, b) => a.period.localeCompare(b.period));

  const dataset = {
    format: BACKUP_FORMAT,
    version: 1,
    exported_at: new Date().toISOString(),
    settings: { fund_name: fundName, start_month: start, members_see_all: true },
    rates: [{ effective_from: start, amount: OLD_MONTHLY }],
    members,
    entries: [...inflows, ...others].map((e) => ({ loan_id: null, due_on: null, installments: null, reverses: null, created_at: null, ...e })),
    closures: [],
  };
  return { dataset, warnings };
}
