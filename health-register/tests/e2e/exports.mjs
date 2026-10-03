// تصدير التقرير الفصلي بصيغ PDF وWord وExcel من الواجهة الحقيقية (بالثيم الداكن للتحقق أن الطباعة بيضاء).
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.APP_URL ?? 'http://localhost:5173';
const OUT = 'screenshots/exports';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ar-SA', acceptDownloads: true, colorScheme: 'dark' });
await ctx.addInitScript(() => localStorage.setItem('theme', 'dark'));
const page = await ctx.newPage();
await page.goto(BASE);
await page.getByLabel('البريد الإلكتروني').fill('guide@demo.invalid');
await page.getByLabel('كلمة المرور').fill(process.env.DEMO_PASSWORD);
await page.getByRole('button', { name: 'دخول' }).click();
await page.getByRole('heading', { name: /مرحبًا/ }).waitFor();

for (const [path, name, heading] of [['/reports', 'semester', 'متابعة تنفيذ البرامج — التفاصيل'], ['/plan', 'plan', 'خطة المتابعة السنوية']]) {
  await page.goto(`${BASE}${path}`);
  await page.getByRole('button', { name: 'Word' }).waitFor();
  await page.waitForTimeout(500);
  for (const [btn, ext] of [['Word', 'docx'], ['Excel', 'xlsx']]) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: btn }).click()]);
    await dl.saveAs(`${OUT}/${name}.${ext}`);
  }
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: `${OUT}/${name}.pdf`, format: 'A4', printBackground: true, landscape: name === 'plan' });
  await page.emulateMedia({ media: 'screen' });
  console.log('exported', name, heading);
}
await browser.close();
