// فحوص الواجهة للمرحلة 3 (متصفح حقيقي + البيئة المحلية + البيانات التجريبية).
import { chromium } from 'playwright';
import fs from 'node:fs';
import pg from 'pg';

const BASE = process.env.APP_URL ?? 'http://localhost:5173';
const PASS = process.env.DEMO_PASSWORD;
const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? '✅' : '❌'} ${name} ${detail}`); };
const db = new pg.Client({ connectionString: 'postgres://postgres@127.0.0.1:54322/postgres' });
await db.connect();
// حالة ابتدائية معروفة لبرنامج الاختبار
await db.query(`update programs set status='planned', skip_reason=null, skip_note=null, executor=null where name='اليوم الدولي لنقاوة الهواء'`);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

async function login(email) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ar-SA' });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASS);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.getByRole('heading', { name: /مرحبًا/ }).waitFor();
  return page;
}

// صورة فيها نص عربي ورقم هوية وهمي لاختبار OCR
const imgPage = await browser.newPage({ viewport: { width: 900, height: 380 } });
await imgPage.setContent(`<html dir="rtl"><body style="margin:0;background:#fff;font-family:'Noto Naskh Arabic','DejaVu Sans',sans-serif;font-size:44px;padding:30px;line-height:1.6">
  منفذ البرنامج: فريق التوعية<br>عدد المستفيدين: 85<br>رقم الهوية 1000000001</body></html>`);
await imgPage.screenshot({ path: '/var/tmp/hr-stack/evidence.png' });
await imgPage.close();

// ===== الموجه الصحي =====
let page = await login('guide@demo.invalid');
await page.goto(`${BASE}/programs`);
await page.getByText('تجاوز موعده وحالته «مخطط»').first().waitFor();
check('البرنامج المتجاوز تاريخه يظهر «متأخر التحديث» في الواجهة', await page.getByText('تجاوز موعده وحالته «مخطط»').first().isVisible());

const card = page.locator('li', { has: page.getByRole('button', { name: 'اليوم الدولي لنقاوة الهواء' }) });
await card.getByRole('button', { name: 'تحديث الحالة' }).click();
await page.getByRole('button', { name: 'لم يُنفذ' }).click();
await page.getByRole('button', { name: 'حفظ' }).click();
const err = await page.getByRole('alert').filter({ hasText: 'سبب عدم التنفيذ إلزامي' }).isVisible();
const dbRow = (await db.query(`select status from programs where name='اليوم الدولي لنقاوة الهواء'`)).rows[0];
check('«لم يُنفذ» بلا سبب يُرفض من الواجهة ولا يُحفظ', err && dbRow.status === 'planned');
await page.getByRole('dialog').locator('select').selectOption('weather');
await page.getByRole('button', { name: 'حفظ' }).click();
await page.getByRole('dialog').waitFor({ state: 'detached' });
const after = (await db.query(`select status, skip_reason from programs where name='اليوم الدولي لنقاوة الهواء'`)).rows[0];
check('مع السبب يُحفظ', after.status === 'not_done' && after.skip_reason === 'weather');

// التوثيق والشواهد
await card.getByRole('button', { name: 'التوثيق والشواهد' }).click();
const dialog = page.getByRole('dialog');
// رفع ملف فيه هويات كمرفق: يُرفض
await dialog.locator('label:has-text("إضافة مرفق") input[type=file]').setInputFiles('/var/tmp/hr-stack/noor-sample.xlsx');
await dialog.getByText('هذا الملف يحتوي أرقام هوية. استخدم الاستيراد بدل المرفقات.').waitFor();
check('رفع جدول فيه هويات كشاهد يُرفض برسالة التوجيه', true);
await dialog.locator('label:has-text("إضافة مرفق") input[type=file]').setInputFiles('/var/tmp/hr-stack/evidence.png');
await dialog.getByRole('button', { name: 'evidence.png', exact: true }).waitFor().catch(async (e) => { await page.screenshot({ path: '/var/tmp/hr-stack/fail.png' }); console.log(await dialog.innerText()); throw e; });
check('رفع صورة شاهد صالحة', true);
await dialog.getByRole('button', { name: 'evidence.png', exact: true }).click();
const img = page.locator('img[alt$=".png"]');
await img.waitFor();
const loaded = await img.evaluate((el) => el.complete && el.naturalWidth > 0);
check('معاينة المرفق داخل التطبيق برابط موقّع', loaded && (await img.getAttribute('src')).includes('token='));
await page.getByRole('dialog', { name: 'evidence.png' }).getByRole('button', { name: 'إغلاق' }).click();

// OCR على الصورة نفسها (داخل المتصفح بلغة ara)
const t0 = Date.now();
await dialog.getByRole('button', { name: /استخراج النص من/ }).click();
await page.getByRole('dialog', { name: /النص المستخرج/ }).waitFor({ timeout: 120000 });
const ocrText = await page.locator('pre').innerText();
check('OCR استخرج نصًا عربيًا', /المستفيدين|البرنامج/.test(ocrText), `(${Math.round((Date.now() - t0) / 1000)}ث) «${ocrText.replace(/\n/g, ' / ').slice(0, 90)}»`);
check('قناع الهوية على نص OCR قبل العرض', !ocrText.includes('1000000001'), ocrText.includes('[محذوف]') ? '(ظهر [محذوف])' : '');
const ocrDialog = page.getByRole('dialog', { name: /النص المستخرج/ });
const sugg = await ocrDialog.locator('input.field').evaluateAll((els) => els.map((e) => e.value));
check('اقتراحات تعبئة من النص', sugg.length > 0, JSON.stringify(sugg));
const before = (await db.query(`select executor from programs where name='اليوم الدولي لنقاوة الهواء'`)).rows[0].executor;
if (sugg.length) {
  await ocrDialog.locator('input[type=checkbox]').first().check();
  await ocrDialog.getByRole('button', { name: 'تعبئة الحقول المختارة' }).click();
}
const afterOcr = (await db.query(`select executor from programs where name='اليوم الدولي لنقاوة الهواء'`)).rows[0].executor;
check('لا حفظ تلقائي للنص المستخرج قبل ضغط «حفظ»', before === afterOcr, `executor=${afterOcr}`);
await page.keyboard.press('Escape');

// سجل العنف: كلمة المرور مطلوبة
await page.goto(`${BASE}/violence`);
await page.getByRole('button', { name: 'فتح السجل' }).waitFor();
await page.getByLabel('كلمة المرور').fill('wrong-password-123');
await page.getByRole('button', { name: 'فتح السجل' }).click();
await page.getByText('كلمة المرور غير صحيحة.').waitFor();
await page.getByLabel('كلمة المرور').fill(PASS);
await page.getByRole('button', { name: 'فتح السجل' }).click();
await page.getByRole('button', { name: 'إضافة حالة' }).waitFor();
check('سجل العنف يُفتح للموجه بعد إعادة إدخال كلمة المرور فقط', true);
await page.context().close();

// ===== الممرض =====
page = await login('nurse@demo.invalid');
for (const path of ['/violence', '/users', '/import', '/committee']) {
  await page.goto(`${BASE}${path}`);
  check(`الممرض: ${path} ← «غير مصرح»`, await page.getByRole('heading', { name: 'غير مصرح' }).waitFor({ timeout: 10000 }).then(() => true, () => false));
}
const navText = await page.locator('aside nav').innerText();
check('قائمة الممرض لا تعرض العنف ولا المستخدمين', !navText.includes('العنف') && !navText.includes('المستخدمون'));
await page.goto(`${BASE}/visits`);
await page.getByPlaceholder('ابحث باسم الطالب…').fill('محمد');
await page.getByRole('option').first().click();
await page.getByPlaceholder('صداع، ألم بطن…').fill('صداع');
await page.getByRole('button', { name: 'تسجيل الزيارة' }).click();
await page.getByText('سُجّلت الزيارة').waitFor();
check('الممرض يسجّل زيارة عيادة', true);
await page.context().close();

// ===== عضو اللجنة =====
page = await login('member@demo.invalid');
for (const path of ['/classes', '/records', '/visits', '/referrals']) {
  await page.goto(`${BASE}${path}`);
  check(`عضو اللجنة: ${path} ← «غير مصرح»`, await page.getByRole('heading', { name: 'غير مصرح' }).waitFor({ timeout: 10000 }).then(() => true, () => false));
}
await page.goto(`${BASE}/`);
await page.getByText('متابعة تنفيذ البرامج').waitFor();
const dash = await page.locator('main').innerText();
check('لوحة عضو اللجنة: أعداد فقط بلا أسماء طلاب', !dash.includes('متابعات مستحقة') && !/التجريبي|المثالي|النموذجي/.test(dash));
await page.goto(`${BASE}/programs`);
check('عضو اللجنة يرى زر تحديث الحالة', await page.getByRole('button', { name: 'تحديث الحالة' }).first().waitFor().then(() => true, () => false));
await page.context().close();

// ===== المدير =====
page = await login('principal@demo.invalid');
await page.goto(`${BASE}/environment`);
await page.getByRole('button', { name: 'اعتماد' }).first().click();
await page.getByText('معتمد').first().waitFor();
check('المدير يعتمد نموذج التفقد', true);
await page.goto(`${BASE}/violence`);
check('المدير: سجل العنف ← «غير مصرح»', await page.getByRole('heading', { name: 'غير مصرح' }).waitFor({ timeout: 10000 }).then(() => true, () => false));
await page.context().close();

await browser.close();
await db.end();
fs.writeFileSync('screenshots/phase3-checks.json', JSON.stringify(results, null, 2));
process.exit(results.every((r) => r.pass) ? 0 : 1);
