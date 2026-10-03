// ينسخ ملفات Tesseract (العامل، النواة، وبيانات العربية) إلى public/ocr لتُخدَم من نفس النطاق.
// لا اعتماد على CDN خارجي: الصور لا تغادر المتصفح، ولا تُحمَّل سكربتات من طرف ثالث.
import fs from 'node:fs';
const out = new URL('../public/ocr/', import.meta.url);
fs.mkdirSync(out, { recursive: true });
const nm = new URL('../node_modules/', import.meta.url);
const copy = (from, to) => fs.copyFileSync(new URL(from, nm), new URL(to, out));
copy('tesseract.js/dist/worker.min.js', 'worker.min.js');
for (const v of ['tesseract-core-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-relaxedsimd-lstm']) copy(`tesseract.js-core/${v}.wasm.js`, `${v}.wasm.js`);
copy('@tesseract.js-data/ara/4.0.0_best_int/ara.traineddata.gz', 'ara.traineddata.gz');
console.log('✅ ملفات OCR جاهزة في public/ocr');
