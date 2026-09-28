// إعدادات الاتصال بـ Supabase.
// المفتاح هنا هو المفتاح العام (publishable) المصمم ليكون داخل التطبيق؛ الحماية الفعلية في قواعد RLS.
// لا تضع هنا أبداً مفتاح secret أو service_role.
export const SUPABASE_URL = 'https://negrrneumbulrgudhtaq.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_fCeVt3ChrTWk7g3vXTzhVA_YTTSMMlL';

// تسجيل الخروج تلقائياً بعد فترة خمول (بالدقائق)
export const IDLE_MINUTES = 20;
// التذكير بالنسخ الاحتياطي بعد (أيام)
export const BACKUP_REMINDER_DAYS = 7;
