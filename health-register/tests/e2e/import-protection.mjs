// اختبار شامل لحماية الهوية عبر الواجهة الحقيقية:
// 1) استيراد ملف عينة يحاكي نور فيه هويات وهمية، مع تسجيل كل طلبات الشبكة.
// 2) البحث عن الأرقام الوهمية في الطلبات، وفي كل جداول قاعدة البيانات، وsupabase audit_log، ومخزن الملفات.
// 3) رفع الملف نفسه كمرفق يُرفض برسالة التوجيه (عبر دالة التحقق في المتصفح).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const BASE = process.env.APP_URL ?? 'http://localhost:5173';
const FAKE = ['1000000001', '1000000002', '2000000003', '1000000004'];
const SAMPLE = process.env.NOOR_SAMPLE ?? '/var/tmp/hr-stack/noor-sample.xlsx';
const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? '✅' : '❌'} ${name} ${detail}`); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const traffic = [];
page.on('request', (r) => traffic.push(`${r.method()} ${r.url()}\n${r.postData() ?? ''}`));
const consoleLines = [];
page.on('console', (m) => consoleLines.push(m.text()));

await page.goto(BASE);
await page.getByLabel('البريد الإلكتروني').fill('guide@demo.invalid');
await page.getByLabel('كلمة المرور').fill(process.env.DEMO_PASSWORD);
await page.getByRole('button', { name: 'دخول' }).click();
await page.getByRole('heading', { name: /مرحبًا/ }).waitFor();
await page.goto(`${BASE}/import`);
await page.locator('input[type=file]').setInputFiles(SAMPLE);
await page.getByRole('button', { name: 'معاينة' }).click();
await page.getByRole('button', { name: /تأكيد الاستيراد/ }).click();
await page.getByRole('heading', { name: 'تقرير الاستيراد' }).waitFor();
const reportText = await page.locator('main').innerText();
check('تقرير الاستيراد يحتوي السطر الصريح', reportText.includes('تم حذف عمود الهوية ولم يُحفظ'));
check('الأرقام لا تظهر في الصفحة', !FAKE.some((f) => reportText.includes(f)));
const dom = await page.content();
check('الأرقام لا تظهر في DOM', !FAKE.some((f) => dom.includes(f)));

// رفع الملف نفسه كمرفق: يُرفض داخل المتصفح قبل أي طلب
const verdict = await page.evaluate(async (bytes) => {
  const { validateAttachment } = await import('/src/lib/files.ts');
  return validateAttachment(new File([new Uint8Array(bytes)], 'list.xlsx'));
}, [...fs.readFileSync(SAMPLE)]);
check('رفع الملف كمرفق يُرفض برسالة التوجيه', verdict.ok === false && verdict.error === 'هذا الملف يحتوي أرقام هوية. استخدم الاستيراد بدل المرفقات.', JSON.stringify(verdict));

const net = traffic.join('\n');
check(`طلبات الشبكة (${traffic.length}) لا تحتوي أي هوية وهمية`, !FAKE.some((f) => net.includes(f)));
check('console لا يحتوي أي هوية', !FAKE.some((f) => consoleLines.join('\n').includes(f)));
check('الملف الأصلي لم يُرفع للتخزين', !traffic.some((t) => t.includes('/storage/v1/object')));
await browser.close();

// البحث في كل جداول قاعدة البيانات (public وauth وstorage)
const db = new pg.Client({ connectionString: 'postgres://postgres@127.0.0.1:54322/postgres' });
await db.connect();
const { rows: tables } = await db.query(`select table_schema, table_name from information_schema.tables where table_schema in ('public','auth','storage') and table_type='BASE TABLE'`);
let hits = 0;
for (const t of tables) {
  const { rows } = await db.query(`select count(*)::int n from "${t.table_schema}"."${t.table_name}" x where ${FAKE.map((_, i) => `x::text like $${i + 1}`).join(' or ')}`, FAKE.map((f) => `%${f}%`));
  if (rows[0].n) { hits += rows[0].n; console.log('  hit in', t.table_schema, t.table_name); }
}
check(`البحث في ${tables.length} جدولًا (منها audit_log) يُرجع صفرًا`, hits === 0, `hits=${hits}`);
const { rows: imported } = await db.query(`select count(*)::int n from students where full_name like '%العينة%'`);
check('الطلاب استوردوا فعلًا', imported[0].n >= 3, `n=${imported[0].n}`);
const { rows: aud } = await db.query(`select count(*)::int n from audit_log where table_name='students' and action='INSERT'`);
check('الاستيراد مسجّل في audit_log', aud[0].n >= 3);
await db.end();

// مخزن الملفات على القرص
const store = '/var/tmp/hr-stack/storage';
const files = fs.existsSync(store) ? fs.readdirSync(store, { recursive: true }).map((f) => path.join(store, String(f))).filter((f) => fs.statSync(f).isFile()) : [];
const storeHit = files.some((f) => FAKE.some((x) => fs.readFileSync(f).includes(x) || f.includes(x)));
check(`مخزن الملفات (${files.length} ملف) لا يحتوي أي هوية`, !storeHit);

fs.writeFileSync('screenshots/import-protection.json', JSON.stringify(results, null, 2));
process.exit(results.every((r) => r.pass) ? 0 : 1);
