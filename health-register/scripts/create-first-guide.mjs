// إنشاء حساب الموجه الصحي الأول (مرة واحدة).
// يقرأ من متغيرات البيئة ولا يحتوي أي كلمة مرور:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GUIDE_EMAIL, GUIDE_NAME
// يطبع كلمة مرور مؤقتة مرة واحدة، ويُلزم صاحبها بتغييرها عند أول دخول.
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GUIDE_EMAIL, GUIDE_NAME = 'الموجه الصحي' } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GUIDE_EMAIL) {
  console.error('يلزم ضبط SUPABASE_URL وSUPABASE_SERVICE_ROLE_KEY وGUIDE_EMAIL');
  process.exit(1);
}
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'health_guide');
if (count && count > 0) {
  console.error('يوجد موجه صحي مسبقًا. أضف بقية المستخدمين من داخل التطبيق.');
  process.exit(1);
}
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const password = Array.from(crypto.randomBytes(14), (b) => alphabet[b % alphabet.length]).join('');
const { data, error } = await admin.auth.admin.createUser({ email: GUIDE_EMAIL, password, email_confirm: true });
if (error) { console.error('تعذّر إنشاء الحساب:', error.message); process.exit(1); }
const { error: e2 } = await admin.from('profiles').insert({
  id: data.user.id, full_name: GUIDE_NAME, email: GUIDE_EMAIL, role: 'health_guide', active: true, must_change_password: true,
});
if (e2) { console.error('تعذّر إنشاء الملف الشخصي:', e2.message); process.exit(1); }
console.log(`✅ أُنشئ حساب الموجه الصحي: ${GUIDE_EMAIL}`);
console.log(`كلمة المرور المؤقتة (تظهر مرة واحدة): ${password}`);
console.log('سيُطلب تغييرها عند أول دخول (10 أحرف على الأقل).');
