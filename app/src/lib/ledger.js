// الحسابات كلها مشتقة من دفتر القيود — نفس قواعد قاعدة البيانات.
import { addMonths, addMonthsToDate, monthOf, monthRange } from './dates.js';
import { round2 } from './format.js';

export const INFLOW = new Set(['contribution', 'repayment']);
export const signed = (e) => (INFLOW.has(e.kind) ? Number(e.amount) : -Number(e.amount));

/** يفصل القيود الفعّالة عن المعكوسة */
export function indexEntries(entries) {
  const reversedBy = new Map();
  for (const e of entries) if (e.kind === 'reversal') reversedBy.set(e.reverses, e);
  const live = entries.filter((e) => e.kind !== 'reversal' && !reversedBy.has(e.id));
  return { reversedBy, live };
}

export function summarize(live) {
  const s = { collected: 0, withdrawals: 0, expenses: 0, loans_issued: 0, repaid: 0, balance: 0 };
  for (const e of live) {
    const a = Number(e.amount);
    if (e.kind === 'contribution') s.collected += a;
    else if (e.kind === 'withdrawal') s.withdrawals += a;
    else if (e.kind === 'expense') s.expenses += a;
    else if (e.kind === 'loan') s.loans_issued += a;
    else if (e.kind === 'repayment') s.repaid += a;
    s.balance += signed(e);
  }
  for (const k of Object.keys(s)) s[k] = round2(s[k]);
  s.loans_outstanding = round2(s.loans_issued - s.repaid);
  return s;
}

export function rateFor(rates, period) {
  let best = null;
  for (const r of rates) {
    if (r.effective_from <= period && (!best || r.effective_from > best.effective_from)) best = r;
  }
  return best ? Number(best.amount) : null;
}

/** خريطة المدفوع: memberId → period → amount */
export function paidMap(live) {
  const map = new Map();
  for (const e of live) {
    if (e.kind !== 'contribution') continue;
    if (!map.has(e.member_id)) map.set(e.member_id, new Map());
    const m = map.get(e.member_id);
    m.set(e.period, round2((m.get(e.period) || 0) + Number(e.amount)));
  }
  return map;
}

/** الأشهر المستحقة على العضو حتى شهر معيّن */
export function duePeriods(member, settings, upTo) {
  const from = member.joined_on > settings.start_month ? member.joined_on : settings.start_month;
  let to = upTo;
  if (member.archived && member.archived_at) {
    const am = monthOf(member.archived_at.slice(0, 10));
    if (am < to) to = am;
  }
  return monthRange(from, to);
}

export function periodStatus(paid, due, isDue) {
  if (due == null) return 'norate';
  if (paid >= due) return 'paid';
  if (paid > 0) return 'partial';
  return isDue ? 'unpaid' : 'future';
}

export function memberStats({ member, live, settings, rates, curMonth, paid = paidMap(live) }) {
  const mine = paid.get(member.id) || new Map();
  const periods = duePeriods(member, settings, curMonth);
  let dueAmount = 0;
  let paidOnDue = 0;
  let fullMonths = 0;
  const arrearsMonths = [];
  for (const p of periods) {
    const due = rateFor(rates, p) || 0;
    const got = Math.min(mine.get(p) || 0, due);
    dueAmount += due;
    paidOnDue += got;
    if (due > 0 && got >= due) fullMonths += 1;
    else if (due > 0) arrearsMonths.push(p);
  }
  let paidTotal = 0;
  for (const v of mine.values()) paidTotal += v;
  let withdrawals = 0;
  let loansOut = 0;
  const loans = new Map();
  for (const e of live) {
    if (e.member_id !== member.id) continue;
    if (e.kind === 'withdrawal') withdrawals += Number(e.amount);
    if (e.kind === 'loan') loans.set(e.id, Number(e.amount));
  }
  for (const e of live) if (e.kind === 'repayment' && loans.has(e.loan_id)) loans.set(e.loan_id, loans.get(e.loan_id) - Number(e.amount));
  for (const v of loans.values()) loansOut += v;
  return {
    dueMonths: periods.length,
    fullMonths,
    arrearsMonths,
    dueAmount: round2(dueAmount),
    paidTotal: round2(paidTotal),
    arrears: round2(dueAmount - paidOnDue),
    prepaid: round2(paidTotal - paidOnDue),
    commitment: periods.length ? Math.round((fullMonths / periods.length) * 100) : 100,
    withdrawals: round2(withdrawals),
    loansOut: round2(loansOut),
    // صافي حصة العضو في الصندوق = ما دفعه − ما سحبه − ما عليه من قروض
    net: round2(paidTotal - withdrawals - loansOut),
  };
}

/** جدول أقساط متساوية تنتهي في تاريخ الاستحقاق */
export function installmentSchedule(loan) {
  if (!loan.due_on) return [];
  const n = loan.installments || 1;
  const amount = Number(loan.amount);
  const base = Math.floor((amount / n) * 100) / 100;
  const rows = [];
  let cum = 0;
  for (let i = 0; i < n; i++) {
    const part = i === n - 1 ? round2(amount - base * (n - 1)) : base;
    cum = round2(cum + part);
    rows.push({ date: addMonthsToDate(loan.due_on, i - (n - 1)), amount: part, cumulative: cum });
  }
  return rows;
}

export function loansView(entries, today) {
  const { reversedBy } = indexEntries(entries);
  const loans = entries.filter((e) => e.kind === 'loan');
  return loans.map((loan) => {
    const repayments = entries.filter((e) => e.kind === 'repayment' && e.loan_id === loan.id);
    const repaid = round2(repayments.filter((r) => !reversedBy.has(r.id)).reduce((s, r) => s + Number(r.amount), 0));
    const outstanding = round2(Number(loan.amount) - repaid);
    const schedule = installmentSchedule(loan);
    const expected = schedule.filter((r) => r.date <= today).reduce((m, r) => r.cumulative, 0);
    const reversed = reversedBy.has(loan.id);
    let status = 'active';
    if (reversed) status = 'reversed';
    else if (outstanding <= 0) status = 'paid';
    else if (expected > repaid) status = 'overdue';
    const next = schedule.find((r) => r.cumulative > repaid);
    return { loan, repayments, repaid, outstanding, schedule, expected, overdueAmount: round2(Math.max(0, expected - repaid)), status, next };
  });
}

/** تطور الرصيد شهراً بشهر */
export function balanceSeries(live, from, to) {
  const months = monthRange(from, to);
  const byMonth = new Map(months.map((p) => [p, { inflow: 0, outflow: 0 }]));
  let opening = 0;
  for (const e of live) {
    const p = monthOf(e.entry_date);
    const v = signed(e);
    if (p < from) { opening += v; continue; }
    const b = byMonth.get(p);
    if (!b) continue;
    if (v > 0) b.inflow += v;
    else b.outflow -= v;
  }
  let bal = opening;
  return months.map((p) => {
    const b = byMonth.get(p);
    bal += b.inflow - b.outflow;
    return { period: p, inflow: round2(b.inflow), outflow: round2(b.outflow), balance: round2(bal) };
  });
}

/** تقرير حركة شهر: رصيد افتتاحي، الوارد والصادر حسب النوع، رصيد ختامي */
export function monthReport(entries, period) {
  const { live } = indexEntries(entries);
  const next = addMonths(period, 1);
  let opening = 0;
  const byKind = { contribution: 0, repayment: 0, withdrawal: 0, loan: 0, expense: 0 };
  const rows = [];
  for (const e of live) {
    if (e.entry_date < period) opening += signed(e);
    else if (e.entry_date < next) {
      byKind[e.kind] += Number(e.amount);
      rows.push(e);
    }
  }
  const inflow = byKind.contribution + byKind.repayment;
  const outflow = byKind.withdrawal + byKind.loan + byKind.expense;
  for (const k of Object.keys(byKind)) byKind[k] = round2(byKind[k]);
  rows.sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  return {
    opening: round2(opening),
    inflow: round2(inflow),
    outflow: round2(outflow),
    closing: round2(opening + inflow - outflow),
    byKind,
    rows,
  };
}

export function unpaidFor({ members, live, rates, settings, period, paid = paidMap(live) }) {
  const due = rateFor(rates, period);
  if (due == null) return [];
  return members
    .filter((m) => !m.archived && duePeriods(m, settings, period).includes(period))
    .map((m) => ({ member: m, paid: paid.get(m.id)?.get(period) || 0, due }))
    .filter((x) => x.paid < x.due)
    .map((x) => ({ ...x, remaining: round2(x.due - x.paid) }));
}
