// يفحص ملفات التصدير: Excel (اتجاه RTL وقسم متابعة البرامج)، Word (bidi/rtl ومعاينة مرسومة)، PDF (خطوط مضمّنة ونص عربي).
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { chromium } from 'playwright';

const D = 'screenshots/exports';
const res = [];
const check = (n, p, d = '') => { res.push({ n, p }); console.log(`${p ? '✅' : '❌'} ${n} ${d}`); };

const wb = XLSX.read(fs.readFileSync(`${D}/semester.xlsx`));
const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
check('Excel: الورقة من اليمين لليسار', wb.Workbook?.Views?.[0]?.RTL === true);
check('Excel: يحتوي قسم متابعة تنفيذ البرامج', csv.includes('متابعة تنفيذ البرامج — التفاصيل') && csv.includes('اليوم العالمي للسكري'));

const xml = await (await JSZip.loadAsync(fs.readFileSync(`${D}/semester.docx`))).file('word/document.xml').async('string');
check('Word: فقرات bidi ونصوص rtl وجداول bidiVisual', xml.includes('<w:bidi') && xml.includes('<w:rtl') && xml.includes('<w:bidiVisual'));
check('Word: يحتوي قسم متابعة تنفيذ البرامج', xml.includes('متابعة تنفيذ البرامج — التفاصيل'));
const { value: html } = await mammoth.convertToHtml({ buffer: fs.readFileSync(`${D}/semester.docx`) });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 800, height: 1000 } });
const font = fs.readFileSync('node_modules/@fontsource/tajawal/files/tajawal-arabic-400-normal.woff2').toString('base64');
await p.setContent(`<html dir="rtl"><style>@font-face{font-family:Tajawal;src:url(data:font/woff2;base64,${font})}body{font-family:Tajawal;background:#fff;padding:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #888;padding:4px}</style><body>${html}</body></html>`);
await p.screenshot({ path: `${D}/semester-docx-preview.png`, fullPage: true });
await b.close();
check('Word: معاينة مرسومة', fs.existsSync(`${D}/semester-docx-preview.png`));

const fonts = execSync(`pdffonts ${D}/semester.pdf`).toString();
check('PDF: الخط العربي مضمّن', /Tajawal/.test(fonts) && /Cairo/.test(fonts) && !/\bno\s+no\b/.test(fonts.split('\n').slice(2).join('\n')));
const text = execSync(`pdftotext ${D}/semester.pdf -`).toString();
check('PDF: نص عربي قابل للاستخراج وفيه قسم متابعة البرامج', text.includes('متابعة تنفيذ البرامج') || text.includes('التفاصيل'));
process.exit(res.every((r) => r.p) ? 0 : 1);
