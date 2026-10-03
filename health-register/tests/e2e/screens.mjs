// لقطات الشاشة: 375px و1280px في الثيمين، مع فحوص RTL والتباين ولون نقاط الحالات.
// يتطلب: البيئة المحلية + البيانات التجريبية + خادم التطوير على 5173. DEMO_PASSWORD من البيئة.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.APP_URL ?? 'http://localhost:5173';
const OUT = process.env.OUT ?? 'screenshots';
const PASS = process.env.DEMO_PASSWORD;
const SAMPLE = process.env.NOOR_SAMPLE ?? '/var/tmp/hr-stack/noor-sample.xlsx';
const only = (process.env.PAGES ?? 'dashboard,section,import').split(',');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const report = [];

// تباين النص الفعلي لكل عنصر نصي ظاهر (WCAG)
const contrastCheck = () => {
  const parse = (c) => { const m = c.match(/[\d.]+/g); return m ? m.map(Number) : null; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => {
    let layers = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && (c[3] ?? 1) > 0) { layers.push(c); if ((c[3] ?? 1) >= 1) break; }
    }
    let base = [255, 255, 255];
    for (const l of layers.reverse()) { const a = l[3] ?? 1; base = base.map((v, i) => v * (1 - a) + l[i] * a); }
    return base;
  };
  const bad = [];
  let checked = 0;
  for (const el of document.querySelectorAll('body *')) {
    if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.opacity === '0' || el.closest('[aria-hidden="true"],button:disabled,[disabled]')) continue;
    const fg = parse(cs.color); if (!fg) continue;
    const bg = bgOf(el);
    const a = fg[3] ?? 1; const f2 = fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
    const [L1, L2] = [lum(f2), lum(bg)].sort((x, y) => y - x);
    const ratio = (L1 + 0.05) / (L2 + 0.05);
    checked++;
    if (ratio < 4.5) bad.push(`${ratio.toFixed(2)} «${el.textContent.trim().slice(0, 30)}»`);
  }
  return { checked, bad };
};

async function shoot(page, name) {
  await page.waitForTimeout(600);
  const dir = await page.evaluate(() => document.documentElement.dir);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const c = await page.evaluate(contrastCheck);
  // تكبير النافذة لطول الصفحة بدل fullPage حتى تظهر العناصر الثابتة في مواضعها
  const vp = page.viewportSize();
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 6000) });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await page.setViewportSize(vp);
  report.push({ name, dir, horizontalOverflow: overflow, textChecked: c.checked, lowContrast: c.bad.slice(0, 8), lowCount: c.bad.length });
}

for (const theme of ['light', 'dark']) {
  for (const width of [375, 1280]) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 812 : 900 }, locale: 'ar-SA', colorScheme: theme });
    await ctx.addInitScript((t) => localStorage.setItem('theme', t), theme);
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.getByLabel('البريد الإلكتروني').fill('guide@demo.invalid');
    await page.getByLabel('كلمة المرور').fill(PASS);
    await page.getByRole('button', { name: 'دخول' }).click();
    await page.getByRole('heading', { name: /مرحبًا/ }).waitFor();
    const tag = `${width}-${theme}`;
    if (only.includes('dashboard')) { await page.waitForTimeout(800); await shoot(page, `dashboard-${tag}`); }
    if (only.includes('section')) {
      await page.goto(`${BASE}/classes`);
      await page.getByRole('link', { name: /فصل 1/ }).first().click();
      await page.getByRole('group', { name: 'فلترة حسب الحالة' }).waitFor();
      // نقطة السكري زرقاء ونقطة الضغط حمراء، ولكل منهما رمز
      const dots = await page.evaluate(() => Object.fromEntries(['diabetes', 'bp'].map((k) => {
        const el = document.querySelector(`[data-condition="${k}"]`);
        return [k, el ? { bg: getComputedStyle(el).backgroundColor, glyph: el.querySelector('path')?.getAttribute('d')?.slice(0, 12) } : null];
      })));
      report.push({ name: `dots-${tag}`, dots });
      await shoot(page, `section-${tag}`);
    }
    if (only.includes('import')) {
      await page.goto(`${BASE}/import`);
      await page.locator('input[type=file]').setInputFiles(SAMPLE);
      await page.getByRole('button', { name: 'معاينة' }).waitFor();
      await shoot(page, `import-map-${tag}`);
      await page.getByRole('button', { name: 'معاينة' }).click();
      await page.getByRole('button', { name: /تأكيد الاستيراد/ }).waitFor();
      await shoot(page, `import-preview-${tag}`);
    }
    for (const extra of (process.env.EXTRA ?? '').split(',').filter(Boolean)) {
      const i = extra.lastIndexOf('='); const [path, name] = [extra.slice(0, i), extra.slice(i + 1)];
      await page.goto(`${BASE}${path}`);
      await page.waitForLoadState('networkidle');
      await shoot(page, `${name}-${tag}`);
    }
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
const problems = report.filter((r) => !r.dots && (r.lowCount || r.horizontalOverflow || r.dir !== 'rtl'));
const dotsBad = report.filter((r) => r.dots && (!r.dots.diabetes || !r.dots.bp || r.dots.diabetes.glyph === r.dots.bp.glyph));
console.log(problems.length || dotsBad.length ? `❌ مشكلات: ${problems.length + dotsBad.length}` : `✅ ${report.length} فحصًا: RTL سليم، بلا تمرير أفقي، وكل النصوص ≥ 4.5:1، ونقاط السكري والضغط برمزين مختلفين`);
process.exit(problems.length || dotsBad.length ? 1 : 0);
