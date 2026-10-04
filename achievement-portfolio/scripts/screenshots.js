'use strict';
/*
 * لقطات شاشة + فحوص واجهة شاملة بـ Playwright.
 * يشغّل التطبيق في الذاكرة ببيانات تجريبية وهمية في مجلد مؤقت (لا يمس بياناتك).
 * التشغيل:  node scripts/screenshots.js
 * اختياري:  OCR_LANG_DIR=<مجلد فيه ara.traineddata.gz> لاختبار OCR دون الوصول إلى CDN.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createApp } = require('../src/app');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require(path.join(process.execPath, '..', '..', 'lib', 'node_modules', 'playwright')));
}

const OUT = path.join(__dirname, '..', 'screenshots');
const TEACHER = crypto.randomBytes(4).toString('hex');
const MANAGER = crypto.randomBytes(4).toString('hex');
const results = [];
const consoleErrors = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-shots-'));
  const { app, db } = createApp({
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
    dbPath: path.join(dataDir, 'app.db'),
    maxFileMb: 20,
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    adminPin: TEACHER,
    managerPin: MANAGER,
    seedDemo: true,
  });
  const server = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  // ---------- تعبئة أعمال تجريبية عبر الـ API ----------
  const students = db.prepare('SELECT id, name FROM students ORDER BY id').all();
  const counts = [6, 10, 3, 0, 5, 8];
  for (let i = 0; i < students.length; i++) {
    const login = await fetch(`${base}/api/auth/student`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ studentId: students[i].id }),
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    for (let k = 1; k <= counts[i]; k++) {
      const fd = new FormData();
      const kinds = [
        ['تقرير الوحدة', 'تقرير.pdf'],
        ['صورة النشاط', 'نشاط.jpg'],
        ['عرض تقديمي', 'عرض.pptx'],
        ['ملخص الدرس', 'ملخص.docx'],
      ];
      const [t, n] = kinds[k % kinds.length];
      fd.append('title', `${t} ${k}`);
      fd.append('source', k === 2 ? 'camera' : 'upload');
      fd.append('file', new Blob([`demo ${k}`]), n);
      await fetch(`${base}/api/student/submissions`, { method: 'POST', headers: { cookie }, body: fd });
    }
  }
  const tLogin = await fetch(`${base}/api/auth/pin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'teacher', pin: TEACHER }),
  });
  const tCookie = tLogin.headers.get('set-cookie').split(';')[0];
  const firstSub = db.prepare('SELECT id FROM submissions WHERE student_id = ? ORDER BY slot LIMIT 1').get(students[0].id).id;
  await fetch(`${base}/api/admin/submissions/${firstSub}`, {
    method: 'PATCH',
    headers: { cookie: tCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'rejected', reason: 'الملف لا يطابق المطلوب' }),
  });
  const dl = new Date(Date.now() + (3 * 864e5 + 5 * 36e5) + 3 * 36e5).toISOString().slice(0, 16);
  await fetch(`${base}/api/admin/settings`, {
    method: 'PUT',
    headers: { cookie: tCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ deadline: dl }),
  });

  // ---------- المتصفح ----------
  // في بيئة فيها وكيل HTTPS (لتحميل خطوط Google) نُبقي الخادم المحلي خارج الوكيل
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
  if (proxy) process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK = '1';
  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    proxy,
  });

  async function newPage({ width, height, theme }) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: width < 500 ? 2 : 1,
      ignoreHTTPSErrors: true, // لوكيل بيئة الاختبار فقط (خطوط Google)
      permissions: ['camera'],
      locale: 'ar-SA',
      timezoneId: 'Asia/Riyadh',
    });
    await ctx.addInitScript((t) => {
      try {
        localStorage.setItem('ep-theme', t);
      } catch {}
    }, theme);
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(`[${page.url()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => consoleErrors.push(`[${page.url()}] ${e.message}`));
    return { ctx, page };
  }

  async function layoutChecks(page, label) {
    const r = await page.evaluate(() => ({
      dir: document.documentElement.dir,
      bodyDir: getComputedStyle(document.body).direction,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
    }));
    if (!r.fonts.length) await page.waitForTimeout(3000);
    r.fonts = r.fonts.length ? r.fonts : await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
    check(`${label}: اتجاه RTL`, r.dir === 'rtl' && r.bodyDir === 'rtl');
    check(`${label}: لا تمرير أفقي`, r.overflow <= 0, `فرق ${r.overflow}px`);
    return r;
  }

  async function shot(page, name) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  }

  const sizes = [
    { width: 375, height: 812, tag: '375' },
    { width: 1440, height: 900, tag: '1440' },
  ];
  let fontsLogged = false;

  for (const size of sizes) {
    for (const theme of ['dark', 'light']) {
      const tag = `${size.tag}-${theme}`;
      const { ctx, page } = await newPage({ ...size, theme });

      // اختيار الاسم
      await page.goto(`${base}/`);
      await page.waitForSelector('.name-btn');
      await page.evaluate(() =>
        Promise.race([
          Promise.allSettled([document.fonts.load('800 20px Cairo'), document.fonts.load('400 16px Tajawal')]),
          new Promise((r) => setTimeout(r, 8000)),
        ])
      );
      const lc = await layoutChecks(page, `اختيار الاسم ${tag}`);
      if (!fontsLogged) {
        check('خطوط Cairo وTajawal محمّلة', lc.fonts.includes('Cairo') && lc.fonts.includes('Tajawal'), [...new Set(lc.fonts)].join(', '));
        fontsLogged = true;
      }
      check(`النمط ${tag}`, (await page.getAttribute('html', 'data-theme')) === theme);
      await shot(page, `01-picker-${tag}`);

      // لوحة الطالب (طالب تجريبي ١: 6 أعمال وواحد مرفوض)
      await page.request.post(`${base}/api/auth/student`, { data: { studentId: students[0].id } });
      await page.goto(`${base}/student`);
      await page.waitForSelector('.slot');
      await page.waitForTimeout(1300); // حركة المؤشر الدائري
      await layoutChecks(page, `لوحة الطالب ${tag}`);
      check(`لوحة الطالب ${tag}: المؤشر 6/10`, (await page.textContent('#ringNum')) === '6' && (await page.textContent('#ringMax')) === '10');
      check(`لوحة الطالب ${tag}: 10 خانات`, (await page.locator('.slot').count()) === 10);
      check(`لوحة الطالب ${tag}: عدّاد تنازلي ظاهر`, await page.locator('.countdown .unit').first().isVisible());
      check(`لوحة الطالب ${tag}: سبب الرفض ظاهر`, await page.locator('.slot .reason').first().isVisible());
      await shot(page, `02-student-${tag}`);
      // نافذة الإضافة
      await page.click('.slot.empty');
      await page.waitForSelector('#addDlg[open]');
      await shot(page, `03-student-add-${tag}`);
      await page.keyboard.press('Escape');

      // لوحة المعلم
      await page.request.post(`${base}/api/auth/pin`, { data: { role: 'teacher', pin: TEACHER } });
      await page.goto(`${base}/admin`);
      await page.waitForSelector('#tbody tr');
      await page.waitForTimeout(1000);
      await layoutChecks(page, `لوحة المعلم ${tag}`);
      if (size.width > 700) {
        const order = await page.evaluate(() => {
          const ths = [...document.querySelectorAll('#table thead th')].map((t) => t.getBoundingClientRect().left);
          return ths.every((x, i) => i === 0 || x < ths[i - 1]);
        });
        check(`لوحة المعلم ${tag}: الأعمدة مرتبة من اليمين`, order);
      }
      await shot(page, `04-admin-${tag}`);
      await page.locator('#tbody tr').first().click();
      await page.waitForSelector('.sub-item');
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `05-admin-drawer-${tag}.png`) });
      await page.click('#drawerClose');

      // كشف الطباعة
      await page.goto(`${base}/print?classId=all`);
      await page.waitForSelector('.sheet');
      await layoutChecks(page, `كشف الطباعة ${tag}`);
      check(`كشف الطباعة ${tag}: صفحة لكل فصل`, (await page.locator('.sheet').count()) === 2);
      await shot(page, `06-print-${tag}`);
      await ctx.close();
    }
  }

  // ---------- اختبارات تفاعلية ----------
  {
    const { ctx, page } = await newPage({ width: 375, height: 812, theme: 'dark' });
    // طالب بلا أعمال: تصوير بالكاميرا (جهاز وهمي) ثم رفع ملف ثم حذف
    await page.request.post(`${base}/api/auth/student`, { data: { studentId: students[3].id } });
    await page.goto(`${base}/student`);
    await page.waitForSelector('.slot.empty');
    await page.click('.slot.empty');
    await page.fill('#title', 'صورة السبورة');
    await page.click('[data-tab="camera"]');
    await page.waitForFunction(() => document.getElementById('video').videoWidth > 0, null, { timeout: 15000 });
    await shot(page, '07-camera-live-375-dark');
    await page.click('#snap');
    await page.waitForSelector('#camPreview:not([hidden])');
    await page.click('#retake');
    await page.waitForSelector('#camLive:not([hidden])');
    await page.waitForFunction(() => document.getElementById('video').videoWidth > 0);
    await page.click('#snap');
    await page.waitForSelector('#camPreview:not([hidden])');
    await shot(page, '08-camera-preview-375-dark');
    await page.click('#approve');
    await page.click('#saveBtn');
    await page.waitForFunction(() => document.getElementById('ringNum').textContent === '1', null, { timeout: 10000 });
    const me1 = await (await page.request.get(`${base}/api/student/me`)).json();
    check('الكاميرا: التقاط وإعادة واعتماد وحفظ (source=camera)', me1.count === 1 && me1.submissions[0].source === 'camera', me1.submissions[0]?.original_name);

    await page.click('.slot.empty');
    await page.fill('#title', 'ملف من الجهاز');
    await page.setInputFiles('#fileInput', { name: 'بحث.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await page.click('#saveBtn');
    await page.waitForFunction(() => document.getElementById('ringNum').textContent === '2', null, { timeout: 10000 });
    check('رفع ملف من الواجهة يحدّث المؤشر لحظيًا إلى 2', true);

    // عنوان فارغ
    await page.click('.slot.empty');
    await page.setInputFiles('#fileInput', { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('a') });
    await page.click('#saveBtn');
    check('عنوان العمل إلزامي في الواجهة', await page.locator('#formError').isVisible());
    await page.keyboard.press('Escape');

    // حذف مع تأكيد
    await page.locator('[data-del]').first().click();
    await page.waitForSelector('dialog.modal[open] [data-ok]');
    await shot(page, '09-delete-confirm-375-dark');
    await page.click('dialog.modal[open] [data-ok]');
    await page.waitForFunction(() => document.getElementById('ringNum').textContent === '1', null, { timeout: 10000 });
    check('الحذف مع تأكيد ينقص الدرجة', true);
    await ctx.close();
  }

  // بعد الموعد: رسالة واضحة وإخفاء الحذف
  {
    await fetch(`${base}/api/admin/settings`, {
      method: 'PUT',
      headers: { cookie: tCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ deadline: new Date(Date.now() - 6e4 + 3 * 36e5).toISOString().slice(0, 16) }),
    });
    const { ctx, page } = await newPage({ width: 375, height: 812, theme: 'light' });
    await page.request.post(`${base}/api/auth/student`, { data: { studentId: students[0].id } });
    await page.goto(`${base}/student`);
    await page.waitForSelector('.slot');
    check('بعد الموعد: رسالة انتهاء ظاهرة', (await page.textContent('#deadline')).includes('انتهى الموعد'));
    check('بعد الموعد: لا أزرار حذف، والتحميل متاح', (await page.locator('[data-del]').count()) === 0 && (await page.locator('a[download]').count()) > 0);
    await shot(page, '10-student-closed-375-light');
    await ctx.close();
    await fetch(`${base}/api/admin/settings`, {
      method: 'PUT',
      headers: { cookie: tCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ deadline: dl }),
    });
  }

  // المدير: اطلاع فقط
  {
    const { ctx, page } = await newPage({ width: 1440, height: 900, theme: 'dark' });
    await page.goto(`${base}/admin`);
    await page.click('[data-role="manager"]');
    await page.fill('#pin', MANAGER);
    await page.click('#loginBtn');
    await page.waitForSelector('#tbody tr');
    check('المدير: أزرار التعديل مخفية', !(await page.isVisible('#openManage')) && !(await page.isVisible('#openSettings')));
    check('المدير: زر الكشوف ظاهر', await page.isVisible('#openReports'));
    await page.locator('#tbody tr').first().click();
    await page.waitForSelector('.sub-item');
    check('المدير: لا أزرار رفض/حذف في الدرج', (await page.locator('[data-reject]:visible, #dDelete:visible').count()) === 0);
    check('المدير: روابط فتح/تحميل الملفات ظاهرة', (await page.locator('.sub-item a[download]:visible').count()) > 0);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '11-manager-1440-dark.png') });
    await ctx.close();
  }

  // المعلم: استيراد CSV بعمود الفصل، لصق قائمة مع تكرار، PIN خاطئ
  {
    const { ctx, page } = await newPage({ width: 1440, height: 900, theme: 'light' });
    await page.goto(`${base}/admin`);
    await page.fill('#pin', 'wrong-pin');
    await page.click('#loginBtn');
    await page.waitForSelector('#loginError:not([hidden])');
    check('PIN خاطئ: رسالة عربية', (await page.textContent('#loginError')).includes('غير صحيح'));
    await shot(page, '12-login-error-1440-light');
    await page.fill('#pin', TEACHER);
    await page.click('#loginBtn');
    await page.waitForSelector('#tbody tr');

    await page.click('#openManage');
    await page.click('[data-mtab="students"]');
    await page.click('[data-method="file"]');
    const csv = '﻿الاسم,الفصل\nمستورد أول,فصل تجريبي (أ)\nمستورد ثان,فصل جديد مستورد\n';
    await page.setInputFiles('#importFile', { name: 'names.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.waitForSelector('#previewBox:not([hidden])');
    check('استيراد CSV: قراءة الاسم والفصل', (await page.locator('#previewList [data-f="className"]').count()) === 2);
    await shot(page, '13-import-preview-1440-light');
    await page.click('#previewSave');
    await page.waitForFunction(() => document.getElementById('previewBox').hidden);
    const ov = await (await page.request.get(`${base}/api/admin/overview`)).json();
    check('استيراد CSV: حُفظ وأُنشئ الفصل الجديد', ov.classes.some((c) => c.name === 'فصل جديد مستورد') && ov.students.some((s) => s.name === 'مستورد أول'));

    await page.click('[data-method="paste"]');
    await page.fill('#pasteBox', 'طالب تجريبي ١\nاسم جديد');
    await page.click('#pastePreview');
    check('لصق قائمة: تمييز الاسم المكرر', (await page.locator('#previewList .edit-row.dup').count()) === 1);
    await page.click('#previewSave');
    await page.waitForSelector('dialog.modal[open] [data-ok]');
    check('لصق قائمة: تنبيه التكرار قبل الحفظ', (await page.locator('dialog.modal[open]').last().textContent()).includes('طالب تجريبي ١'));
    await shot(page, '14-duplicate-warning-1440-light');
    await page.click('dialog.modal[open] [data-cancel]');

    // OCR
    const langDir = process.env.OCR_LANG_DIR;
    if (langDir) {
      await page.route('https://cdn.jsdelivr.net/npm/@tesseract.js-data/ara/**', (route) =>
        route.fulfill({ path: path.join(langDir, 'ara.traineddata.gz'), contentType: 'application/gzip' })
      );
      const imgPage = await ctx.newPage();
      await imgPage.setViewportSize({ width: 900, height: 420 });
      await imgPage.setContent(
        `<html dir="rtl"><body style="margin:0;background:#fff;font:40px 'Noto Naskh Arabic','Arial';color:#000;padding:30px 50px;line-height:1.7">
         <div>محمد أحمد</div><div>سارة خالد</div><div>عبدالله ناصر</div><div>نورة سعد</div></body></html>`
      );
      const img = await imgPage.screenshot();
      await imgPage.close();
      await page.click('[data-method="ocr"]');
      await page.setInputFiles('#ocrFile', { name: 'kashf.png', mimeType: 'image/png', buffer: img });
      try {
        await page.waitForSelector('#previewBox:not([hidden])', { timeout: 180000 });
        const names = await page.$$eval('#previewList [data-f="name"]', (els) => els.map((e) => e.value));
        check('OCR عربي: استخراج أسماء قابلة للتعديل', names.length > 0, names.join(' | '));
        await shot(page, '15-ocr-preview-1440-light');
        const before = (await (await page.request.get(`${base}/api/admin/overview`)).json()).students.length;
        check('OCR: لم يُحفظ شيء قبل الاعتماد', before === ov.students.length);
      } catch (e) {
        check('OCR عربي: استخراج أسماء', false, (await page.textContent('#ocrMsg')) || e.message);
      }
    } else {
      console.log('… تخطّي OCR (لم يُحدَّد OCR_LANG_DIR)');
    }
    await ctx.close();
  }

  // PDF عبر محرك الطباعة: A4، صفحة لكل فصل
  {
    const { ctx, page } = await newPage({ width: 1440, height: 900, theme: 'dark' });
    await page.request.post(`${base}/api/auth/pin`, { data: { role: 'teacher', pin: TEACHER } });
    await page.goto(`${base}/print?classId=all`);
    await page.waitForSelector('.sheet');
    await page.evaluate(() => document.fonts.ready);
    const nSheets = await page.locator('.sheet').count();
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    fs.writeFileSync(path.join(OUT, 'kashf-all.pdf'), pdf);
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    check('PDF الطباعة: صفحة A4 لكل فصل', pages === nSheets, `${pages} صفحات لـ ${nSheets} فصول`);
    await page.emulateMedia({ media: 'print' });
    await page.screenshot({ path: path.join(OUT, '16-print-media-1440.png'), fullPage: true });
    await ctx.close();
  }

  await browser.close();
  server.close();
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });

  // ردود 4xx المتوقعة من الاختبارات نفسها (PIN خاطئ، تكرار) يسجّلها المتصفح كأخطاء شبكة؛ نستثنيها.
  // أخطاء الوكيل في بيئة الاختبار عند جلب خطوط Google ليست من التطبيق.
  const relevant = consoleErrors.filter(
    (e) => !/responded with a status of (401|409)/.test(e) && !/ERR_TOO_MANY_RETRIES|ERR_TUNNEL_CONNECTION_FAILED/.test(e)
  );
  check('لا أخطاء في وحدة التحكم (ومنها مخالفات CSP)', relevant.length === 0, relevant.slice(0, 5).join(' || '));
  const failed = results.filter((r) => !r.ok);
  console.log(`\nالنتيجة: ${results.length - failed.length}/${results.length} فحصًا ناجحًا`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
