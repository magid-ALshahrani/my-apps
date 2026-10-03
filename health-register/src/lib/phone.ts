import { toWesternDigits } from './text';

/**
 * يوحّد جوال سعودي إلى +9665XXXXXXXX.
 * يقبل: 05XXXXXXXX، 5XXXXXXXX، +9665XXXXXXXX، 009665XXXXXXXX، 9665XXXXXXXX، وبأرقام هندية.
 * يُرجع null إن كان غير صالح (فيُعلَّم للمراجعة ولا يُحفظ نصه الخام).
 */
export function normalizeSaudiMobile(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  let s = toWesternDigits(typeof input === 'number' ? input.toFixed(0) : String(input));
  s = s.replace(/[\s\-().‎‏‪-‮]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('00')) s = s.slice(2);
  let local: string | null = null;
  if (/^9665\d{8}$/.test(s)) local = s.slice(3);
  else if (/^05\d{8}$/.test(s)) local = s.slice(1);
  else if (/^5\d{8}$/.test(s)) local = s;
  return local ? `+966${local}` : null;
}

/** للعرض: 05XXXXXXXX */
export function displayPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  return e164.startsWith('+966') ? `0${e164.slice(4)}` : e164;
}

/** رابط واتساب */
export function whatsappLink(e164: string | null | undefined, text: string): string {
  const n = e164 ? e164.replace('+', '') : '';
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}
