// التاريخ الهجري (أم القرى) والميلادي معًا في كل مكان.

const hijriFmt = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
const hijriShort = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'numeric', year: 'numeric' });
const gregFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
const gregShort = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'numeric', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' });
const monthFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric' });
const hijriMonthFmt = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { month: 'long', year: 'numeric' });

/** يحوّل 'YYYY-MM-DD' إلى تاريخ محلي بلا انزياح منطقة زمنية */
export function parseDate(d: string | Date): Date {
  if (d instanceof Date) return d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day, 12);
  }
  return new Date(d);
}

const clean = (s: string) => s.replace(/\s?هـ$/, '');

export function hijri(d: string | Date, short = false) {
  return `${clean((short ? hijriShort : hijriFmt).format(parseDate(d)))}هـ`;
}
export function gregorian(d: string | Date, short = false) {
  return `${(short ? gregShort : gregFmt).format(parseDate(d))}م`;
}
/** «20 ربيع الآخر 1448هـ — 3 أكتوبر 2026م» */
export function dual(d: string | Date | null | undefined, short = false): string {
  if (!d) return '—';
  return `${hijri(d, short)} — ${gregorian(d, short)}`;
}
export function time(d: string | Date) {
  return timeFmt.format(new Date(d));
}
export function monthLabel(d: Date) {
  return `${monthFmt.format(d)}م · ${clean(hijriMonthFmt.format(d))}هـ`;
}

export function isoDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
