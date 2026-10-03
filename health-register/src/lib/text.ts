// أدوات نصية عربية: الأرقام الهندية، التطبيع للمطابقة، والمسافة التحريرية.

const HINDI = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

/** يحوّل الأرقام الهندية والفارسية إلى أرقام غربية */
export function toWesternDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => {
    const i = HINDI.indexOf(d);
    return String(i >= 0 ? i : PERSIAN.indexOf(d));
  });
}

/** تطبيع للمطابقة فقط (لا يُحفظ): بلا تشكيل ولا تطويل، وتوحيد الهمزات والياء والتاء المربوطة */
export function normalizeArabic(input: string): string {
  return toWesternDigits(String(input ?? ''))
    .replace(/[ً-ٰٟۖ-ۭ]/g, '') // التشكيل
    .replace(/ـ/g, '') // التطويل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[‌-‏‪-‮ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** تطبيع عنوان عمود: يزيد على normalizeArabic حذف اللواحق مثل «/ـة» و«(…)» والنقطتين */
export function normalizeHeader(input: string): string {
  let s = String(input ?? '');
  s = s.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  s = normalizeArabic(s);
  s = s.replace(/\s*\/\s*[ـ]?\s*(ه|ها|ة|ات|ـة)?\s*$/u, ''); // «اسم الطالب/ـة» ← «اسم الطالب»
  s = s.replace(/\s*\/\s*ه\b/g, ''); // «الطالب/ه» داخل العنوان
  s = s.replace(/[:：*#\-_.،,]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

export function similarity(a: string, b: string): number {
  const len = Math.max(a.length, b.length);
  return len === 0 ? 1 : 1 - levenshtein(a, b) / len;
}

/** مفتاح الاسم للمطابقة: تطبيع + مسافات موحدة. الاسم يُحفظ كما كُتب، وهذا للمقارنة فقط */
export function nameKey(name: string): string {
  return normalizeArabic(name).replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
}

/** يزيل المسافات المكررة من الاسم دون تغيير حروفه */
export function cleanName(name: string): string {
  return String(name ?? '').replace(/[‌-‏‪-‮]/g, '').replace(/\s+/g, ' ').trim();
}
