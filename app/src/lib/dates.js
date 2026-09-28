// كل التواريخ نصوص بصيغة YYYY-MM-DD، والأشهر بصيغة YYYY-MM-01 — بدون تحويل مناطق زمنية.

const pad = (n) => String(n).padStart(2, '0');

export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const monthOf = (date) => `${date.slice(0, 7)}-01`;

export const currentMonth = (now = new Date()) => monthOf(todayISO(now));

export function addMonths(period, n) {
  const y = +period.slice(0, 4);
  const m = +period.slice(5, 7) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${pad(mm + 1)}-01`;
}

export function monthRange(from, to) {
  const out = [];
  if (!from || !to || from > to) return out;
  for (let p = from; p <= to; p = addMonths(p, 1)) out.push(p);
  return out;
}

export function addMonthsToDate(date, n) {
  const target = addMonths(monthOf(date), n);
  const day = +date.slice(8, 10);
  const y = +target.slice(0, 4);
  const m = +target.slice(5, 7);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${target.slice(0, 8)}${pad(Math.min(day, last))}`;
}

export const isISODate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const isPeriod = (s) => isISODate(s) && s.endsWith('-01');
