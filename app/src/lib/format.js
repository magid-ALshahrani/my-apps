const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const numFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
let hijriFmt, hijriDayFmt;
try {
  hijriFmt = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  hijriDayFmt = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
} catch {
  hijriFmt = hijriDayFmt = null;
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const num = (n) => numFmt.format(round2(n || 0));
export const money = (n) => `${num(n)} ﷼`;

export const monthName = (period) => `${MONTHS[+period.slice(5, 7) - 1]} ${period.slice(0, 4)}`;
export const monthShort = (period) => MONTHS[+period.slice(5, 7) - 1];

const utc = (iso) => new Date(`${iso}T12:00:00Z`);

export function hijriMonth(period) {
  if (!hijriFmt) return '';
  return hijriFmt.format(utc(`${period.slice(0, 8)}15`));
}

export function fmtDate(iso, hijri = false) {
  if (!iso) return '';
  const g = `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
  if (!hijri || !hijriDayFmt) return g;
  return `${g} · ${hijriDayFmt.format(utc(iso))}`;
}

export const KIND_LABEL = {
  contribution: 'اشتراك',
  withdrawal: 'سحب',
  loan: 'قرض',
  repayment: 'سداد قرض',
  expense: 'مصروف',
  reversal: 'قيد عكسي',
};

export const ROLE_LABEL = {
  admin: 'مدير',
  treasurer: 'أمين الصندوق',
  member: 'عضو (مشاهدة)',
  pending: 'بانتظار الموافقة',
  disabled: 'موقوف',
};
