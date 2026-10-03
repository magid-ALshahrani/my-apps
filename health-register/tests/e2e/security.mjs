// فحوص أمنية عبر الواجهة: إلزام تغيير كلمة المرور عند أول دخول، والقفل بعد 15 دقيقة خمول،
// وعدم وجود مفتاح الخدمة في حزمة الواجهة.
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.APP_URL ?? 'http://localhost:5173';
const keys = JSON.parse(fs.readFileSync('/var/tmp/hr-stack/keys.json', 'utf8'));
const res = [];
const check = (n, p, d = '') => { res.push({ n, p }); console.log(`${p ? '✅' : '❌'} ${n} ${d}`); };

// مستخدم جديد بكلمة مرور مؤقتة
const admin = createClient('http://localhost:54321', keys.service, { auth: { persistSession: false } });
const email = `first-${Date.now()}@demo.invalid`;
const temp = 'Temp-Pass-Only-1';
const { data: u } = await admin.auth.admin.createUser({ email, password: temp, email_confirm: true });
await admin.from('profiles').insert({ id: u.user.id, email, full_name: 'مستخدم أول دخول', role: 'nurse', must_change_password: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
let page = await ctx.newPage();
await page.goto(BASE);
await page.getByLabel('البريد الإلكتروني').fill(email);
await page.getByLabel('كلمة المرور').fill(temp);
await page.getByRole('button', { name: 'دخول' }).click();
await page.getByRole('heading', { name: 'تغيير كلمة المرور' }).waitFor();
check('أول دخول: شاشة تغيير كلمة المرور إلزامية', true);
await page.goto(`${BASE}/classes`);
check('لا وصول لأي صفحة قبل التغيير', await page.getByRole('heading', { name: 'تغيير كلمة المرور' }).waitFor().then(() => true, () => false));
await page.getByLabel('كلمة المرور الجديدة').fill('short');
await page.getByLabel('تأكيد كلمة المرور').fill('short');
await page.getByRole('button', { name: 'حفظ ومتابعة' }).click();
// المتصفح يمنع الإرسال (minLength=10)، وإن تجاوزه أحد فالواجهة ثم Auth يرفضان
const tooShort = await page.getByLabel('كلمة المرور الجديدة').evaluate((el) => !el.checkValidity());
check('أقل من 10 أحرف يُرفض', tooShort && await page.getByRole('heading', { name: 'تغيير كلمة المرور' }).isVisible());
await page.getByLabel('كلمة المرور الجديدة').fill('New-Strong-Pass-9');
await page.getByLabel('تأكيد كلمة المرور').fill('New-Strong-Pass-9');
await page.getByRole('button', { name: 'حفظ ومتابعة' }).click();
await page.getByRole('heading', { name: 'الصفوف والطلاب' }).waitFor({ timeout: 10000 });
check('بعد التغيير يدخل الصفحة المطلوبة (بصلاحيات دوره)', true);
await ctx.close();

// القفل التلقائي بعد 15 دقيقة خمول (ساعة وهمية)
ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
page = await ctx.newPage();
await page.clock.install();
await page.goto(BASE);
await page.getByLabel('البريد الإلكتروني').fill('guide@demo.invalid');
await page.getByLabel('كلمة المرور').fill(process.env.DEMO_PASSWORD);
await page.getByRole('button', { name: 'دخول' }).click();
await page.getByRole('heading', { name: /مرحبًا/ }).waitFor();
await page.clock.runFor(14 * 60 * 1000);
check('قبل 15 دقيقة: الجلسة باقية', await page.getByRole('heading', { name: /مرحبًا/ }).isVisible());
await page.clock.runFor(2 * 60 * 1000);
await page.getByText('قُفلت الجلسة بعد 15 دقيقة من عدم النشاط').waitFor({ timeout: 15000 });
check('بعد 15 دقيقة خمول: قفل تلقائي وطلب الدخول', true);
const stored = await page.evaluate(() => localStorage.getItem('hr-auth'));
check('الجلسة حُذفت من المتصفح بعد القفل', !stored);
await browser.close();

// مفتاح الخدمة لا يظهر في حزمة الواجهة
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const bundle = walk('dist').filter((f) => /\.(js|html|css|json)$/.test(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
check('حزمة الواجهة لا تحتوي مفتاح الخدمة ولا كلمة service_role', !bundle.includes(keys.service) && !/service_role/i.test(bundle));
const src = walk('src').map((f) => fs.readFileSync(f, 'utf8')).join('\n');
check('كود الواجهة لا يشير لمفتاح الخدمة', !/SERVICE_ROLE|service_role/i.test(src));
const ignored = fs.readFileSync('.gitignore', 'utf8');
check('.env في .gitignore', /^\.env$/m.test(ignored) && /^\.env\.\*$/m.test(ignored));

await admin.auth.admin.deleteUser(u.user.id);
process.exit(res.every((r) => r.p) ? 0 : 1);
