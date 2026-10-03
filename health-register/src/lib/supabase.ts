import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && anon);

// المفتاح العام فقط. الحماية الفعلية في RLS.
export const supabase = createClient(url ?? 'http://invalid.local', anon ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'hr-auth' },
});

/** رسالة خطأ عربية عامة لا تكشف أي بيانات */
export function friendlyError(e: unknown): string {
  const msg = String((e as { message?: string })?.message ?? '');
  if (/row-level security|permission denied|42501|غير مصرح/i.test(msg)) return 'لا تملك صلاحية لهذه العملية.';
  if (/program_reason_required/.test(msg)) return 'سبب عدم التنفيذ إلزامي.';
  if (/program_postponed_needs_date/.test(msg)) return 'التاريخ الجديد إلزامي للبرنامج المؤجل.';
  if (/program_other_needs_text/.test(msg)) return 'اكتب السبب عند اختيار «أخرى».';
  if (/program_done_fields/.test(msg)) return 'أدخل تاريخ التنفيذ وعدد المستفيدين.';
  if (/duplicate key|unique/i.test(msg)) return 'هذا السجل موجود مسبقًا.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'تعذّر الاتصال. تحقق من الإنترنت.';
  if (/Invalid login credentials/i.test(msg)) return 'البريد أو كلمة المرور غير صحيحة.';
  if (/Password should be|weak_password/i.test(msg)) return 'كلمة المرور ضعيفة: 10 أحرف على الأقل.';
  if (/^[؀-ۿ]/.test(msg) && msg.length < 120) return msg; // رسائلنا العربية
  return 'حدث خطأ غير متوقع. حاول مرة أخرى.';
}
