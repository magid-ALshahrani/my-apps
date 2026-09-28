// ترجمة رسائل الأخطاء لرسائل عربية مفهومة
const MESSAGES = [
  [/row-level security|permission denied|غير مصرّح/i, 'ليست لديك صلاحية لهذه العملية'],
  [/members_name_unique/i, 'الاسم موجود مسبقاً'],
  [/duplicate key/i, 'السجل موجود مسبقاً'],
  [/members_phone_check/i, 'رقم الجوال غير صحيح'],
  [/entries_shape/i, 'بيانات الحركة غير مكتملة'],
  [/Failed to fetch|NetworkError|Load failed/i, 'تعذّر الاتصال بالإنترنت، حاول مرة أخرى'],
  [/Invalid login credentials/i, 'البريد أو كلمة المرور غير صحيحة'],
  [/Email not confirmed/i, 'لم يتم تأكيد البريد بعد؛ افتح رسالة التأكيد في بريدك'],
  [/User already registered/i, 'هذا البريد مسجّل مسبقاً؛ سجّل الدخول'],
  [/Password should be at least/i, 'كلمة المرور قصيرة جداً'],
  [/rate limit|too many/i, 'محاولات كثيرة؛ انتظر قليلاً ثم حاول'],
  [/JWT expired|session/i, 'انتهت الجلسة؛ سجّل الدخول من جديد'],
];

export function friendlyError(err) {
  const msg = err?.message || String(err || 'خطأ غير معروف');
  // رسائل قاعدة البيانات مكتوبة بالعربية أصلاً
  if (/[؀-ۿ]/.test(msg) && !/غير مصرّح/.test(msg)) return msg;
  for (const [re, ar] of MESSAGES) if (re.test(msg)) return ar;
  return msg;
}
