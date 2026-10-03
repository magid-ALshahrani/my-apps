// استخراج النص من الصور (Tesseract بالعربية داخل المتصفح) ومن العروض (pptx عبر JSZip).
// يُطبَّق قناع الهوية على النص قبل عرضه، ولا يُحفظ أي شيء دون مراجعة المستخدم.
import { maskIdsInText } from './protect';
import { toWesternDigits } from './text';

const base = () => import.meta.env.BASE_URL.replace(/\/$/, '');

export async function ocrImage(image: Blob, onProgress?: (p: number) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  // كل الملفات تُخدم من نفس النطاق (public/ocr) بلا CDN خارجي
  const worker = await createWorker('ara', 1, {
    workerPath: `${base()}/ocr/worker.min.js`,
    corePath: `${base()}/ocr/`,
    langPath: `${base()}/ocr`,
    gzip: true,
    cacheMethod: 'none',
    logger: (m: { status: string; progress: number }) => { if (m.status === 'recognizing text') onProgress?.(m.progress); },
  });
  try {
    const { data } = await worker.recognize(image);
    return maskIdsInText(data.text);
  } finally {
    await worker.terminate();
  }
}

/** نص الشرائح من ملف pptx (وسوم a:t داخل ppt/slides/slideN.xml) */
export async function pptxText(buf: ArrayBuffer): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const out: string[] = [];
  for (const name of slides) {
    const xml = await zip.file(name)!.async('string');
    const paras = xml.split(/<\/a:p>/).map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('')).filter(Boolean);
    out.push(paras.map(decodeXml).join('\n'));
  }
  return maskIdsInText(out.join('\n\n'));
}

function decodeXml(s: string) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

export interface Suggestion { field: string; label: string; value: string }

const after = (text: string, labels: string[]) => {
  for (const l of labels) {
    const m = text.match(new RegExp(`${l}\\s*[:：\\-]?\\s*([^\\n]{2,120})`));
    if (m) return m[1].trim();
  }
  return null;
};

/** تاريخ ميلادي من النص بصيغ شائعة */
export function findDate(text: string): string | null {
  const t = toWesternDigits(text);
  let m = t.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/** اقتراحات لتوثيق تنفيذ برنامج */
export function suggestProgramFields(raw: string): Suggestion[] {
  const text = toWesternDigits(raw);
  const s: Suggestion[] = [];
  const ben = text.match(/(?:عدد\s*(?:الطلاب|الطالبات|الطلبة)?\s*المستفيدين|المستفيدين|المستفيدات)\s*[:：\-]?\s*(\d{1,5})/) ?? text.match(/(\d{1,5})\s*(?:طالب|طالبة|مستفيد)/);
  if (ben) s.push({ field: 'beneficiaries', label: 'عدد المستفيدين', value: ben[1] });
  const cls = text.match(/(?:عدد\s*الفصول)\s*[:：\-]?\s*(\d{1,3})/);
  if (cls) s.push({ field: 'classes_count', label: 'عدد الفصول', value: cls[1] });
  const date = findDate(text);
  if (date) s.push({ field: 'doc_start', label: 'تاريخ البداية', value: date });
  const exec = after(text, ['منفذ البرنامج', 'المنفذ', 'نفذه', 'تنفيذ']);
  if (exec) s.push({ field: 'executor', label: 'المنفذ', value: exec });
  const goal = after(text, ['الهدف العام', 'الهدف']);
  if (goal) s.push({ field: 'goal', label: 'الهدف', value: goal });
  const partners = after(text, ['الجهات المشاركة', 'بمشاركة']);
  if (partners) s.push({ field: 'partners', label: 'الجهات المشاركة', value: partners });
  return s;
}

/** اقتراحات لحالة صحية (تقرير طبي مصوّر) */
export function suggestConditionFields(raw: string): Suggestion[] {
  const text = toWesternDigits(raw);
  const s: Suggestion[] = [];
  const med = after(text, ['الدواء', 'العلاج', 'الأدوية']);
  if (med) s.push({ field: 'medication', label: 'الدواء', value: med });
  const dr = after(text, ['التشخيص', 'ملاحظات الطبيب', 'توصيات الطبيب', 'التوصيات']);
  if (dr) s.push({ field: 'doctor_notes', label: 'ملاحظات الطبيب', value: dr });
  const em = after(text, ['إجراء الطوارئ', 'في حالة الطوارئ', 'عند الطوارئ']);
  if (em) s.push({ field: 'emergency_action', label: 'إجراء الطوارئ', value: em });
  return s.map((x) => ({ ...x, value: maskIdsInText(x.value) }));
}
