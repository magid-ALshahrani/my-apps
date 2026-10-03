// المرفقات والشواهد (للبرامج والحالات فقط): تحقق في المتصفح ← مخزن خاص ← روابط موقّعة مؤقتة.
import { useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase';
import { useAsync, must } from '../lib/data';
import { validateAttachment, safeStorageName, extOf, ACCEPT_ATTR } from '../lib/files';
import { ocrImage, pptxText, type Suggestion } from '../lib/ocr';
import { dual } from '../lib/dates';
import { Modal, Alert, Spinner, useConfirm, useToast } from './ui';
import { Icon } from './Icon';

interface Att { id: string; path: string; file_name: string; mime: string; size_bytes: number; created_at: string }
const IMG = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

export async function signedUrl(path: string, seconds = 60) {
  const { data, error } = await supabase.storage.from('files').createSignedUrl(path, seconds);
  if (error || !data) throw error ?? new Error('تعذّر إنشاء الرابط');
  return data.signedUrl;
}

export function Attachments({ ownerType, ownerId, canUpload, canDelete, suggest, onApply }: {
  ownerType: 'program' | 'condition'; ownerId: string; canUpload: boolean; canDelete: boolean;
  /** دالة اقتراح الحقول من النص المستخرج */
  suggest?: (text: string) => Suggestion[];
  /** تطبيق الاقتراحات المختارة على النموذج (لا حفظ تلقائي) */
  onApply?: (s: Suggestion[]) => void;
}) {
  const toast = useToast();
  const { ask, ui } = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Att | null>(null);
  const [ocr, setOcr] = useState<{ text: string; name: string } | null>(null);
  const q = useAsync(async () => must(await supabase.from('attachments').select('*').eq('owner_type', ownerType).eq('owner_id', ownerId).order('created_at')) as Att[], [ownerType, ownerId]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null); setBusy('جارٍ فحص الملف…');
    try {
      const check = await validateAttachment(file);
      if (!check.ok) throw new Error(check.error);
      setBusy('جارٍ الرفع…');
      const path = `${ownerType}/${ownerId}/${crypto.randomUUID()}.${extOf(file.name)}`;
      const up = await supabase.storage.from('files').upload(path, file, { contentType: check.mime, upsert: false });
      if (up.error) throw up.error;
      const ins = await supabase.from('attachments').insert({ owner_type: ownerType, owner_id: ownerId, path, file_name: safeStorageName(file.name), mime: check.mime, size_bytes: file.size });
      if (ins.error) { await supabase.storage.from('files').remove([path]); throw ins.error; }
      toast('أُضيف المرفق');
      void q.reload();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const extract = async (blob: Blob, name: string) => {
    setBusy('جارٍ استخراج النص…'); setError(null);
    try {
      const text = extOf(name) === 'pptx' ? await pptxText(await blob.arrayBuffer()) : await ocrImage(blob, (p) => setBusy(`جارٍ قراءة الصورة… ${Math.round(p * 100)}%`));
      setOcr({ text, name });
    } catch {
      setError('تعذّر استخراج النص من الملف.');
    } finally { setBusy(null); }
  };

  const remove = async (a: Att) => {
    if (!(await ask(`حذف المرفق «${a.file_name}»؟`))) return;
    await supabase.storage.from('files').remove([a.path]);
    const { error } = await supabase.from('attachments').delete().eq('id', a.id);
    if (error) toast(friendlyError(error), 'danger'); else void q.reload();
  };

  return (
    <div className="space-y-2">
      {q.loading ? <Spinner /> : (q.data ?? []).length === 0 ? <p className="text-sm text-muted">لا توجد مرفقات.</p> : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {q.data!.map((a) => (
            <li key={a.id} className="flex items-center gap-2 px-2">
              <Icon name={IMG.includes(extOf(a.file_name)) ? 'eye' : 'file'} className="text-muted" />
              <button className="flex-1 min-w-0 text-start truncate" style={{ minHeight: 44 }} onClick={() => setPreview(a)}>{a.file_name}</button>
              <span className="text-xs text-muted hidden sm:inline">{Math.ceil(a.size_bytes / 1024)} ك.ب · {dual(a.created_at, true)}</span>
              {suggest && (IMG.includes(extOf(a.file_name)) || extOf(a.file_name) === 'pptx') && (
                <button className="icon-btn" title="استخراج النص" aria-label={`استخراج النص من ${a.file_name}`} onClick={async () => {
                  const res = await fetch(await signedUrl(a.path)); void extract(await res.blob(), a.file_name);
                }}><Icon name="search" /></button>
              )}
              {canDelete && <button className="icon-btn text-danger" aria-label={`حذف ${a.file_name}`} onClick={() => remove(a)}><Icon name="trash" /></button>}
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <div className="flex flex-wrap gap-2">
          <label className="btn-ghost cursor-pointer"><Icon name="upload" />إضافة مرفق
            <input type="file" className="sr-only" accept={ACCEPT_ATTR} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {suggest && (
            <label className="btn-ghost cursor-pointer"><Icon name="search" />استخراج نص من صورة/عرض
              <input type="file" className="sr-only" accept=".jpg,.jpeg,.png,.webp,.pptx" onChange={(e) => { const f = e.target.files?.[0]; if (f) void extract(f, f.name); e.target.value = ''; }} />
            </label>
          )}
        </div>
      )}
      <p className="text-xs text-muted">الحد 10 ميجابايت. المقبول: صور، pdf، pptx، xlsx، xls، csv، docx. الجداول التي تحتوي أرقام هوية تُرفض.</p>
      {busy && <Spinner label={busy} />}
      {error && <Alert tone="danger">{error}</Alert>}
      {preview && <Preview att={preview} onClose={() => setPreview(null)} />}
      {ocr && <OcrReview text={ocr.text} name={ocr.name} suggestions={suggest?.(ocr.text) ?? []} onClose={() => setOcr(null)} onApply={(s) => { onApply?.(s); setOcr(null); }} />}
      {ui}
    </div>
  );
}

/** مراجعة إلزامية: لا يُطبَّق أي اقتراح إلا ما يختاره المستخدم، والحفظ يبقى بيده */
function OcrReview({ text, name, suggestions, onClose, onApply }: { text: string; name: string; suggestions: Suggestion[]; onClose(): void; onApply(s: Suggestion[]): void }) {
  const [items, setItems] = useState(suggestions.map((s) => ({ ...s, on: false })));
  return (
    <Modal open onClose={onClose} title={`النص المستخرج — ${name}`} wide
      footer={<><button className="btn-ghost" onClick={onClose}>إغلاق</button>
        <button className="btn-primary" disabled={!items.some((i) => i.on)} onClick={() => onApply(items.filter((i) => i.on))}>تعبئة الحقول المختارة</button></>}>
      <div className="space-y-4">
        <Alert tone="warning">راجع النص والاقتراحات. لن يُحفظ شيء تلقائيًا؛ الحقول المختارة تُملأ في النموذج فقط، وتحفظها أنت بعد المراجعة. أي رقم بنمط الهوية مستبدل بـ [محذوف].</Alert>
        {items.length > 0 && (
          <fieldset>
            <legend className="label">اقتراحات التعبئة</legend>
            <ul className="space-y-1">
              {items.map((s, i) => (
                <li key={i}>
                  <label className="flex items-start gap-2" style={{ minHeight: 44 }}>
                    <input type="checkbox" className="h-5 w-5 mt-1" checked={s.on} onChange={(e) => setItems(items.map((x, k) => k === i ? { ...x, on: e.target.checked } : x))} />
                    <span className="flex-1"><span className="text-muted text-sm">{s.label}: </span>
                      <input className="field mt-1" value={s.value} onChange={(e) => setItems(items.map((x, k) => k === i ? { ...x, value: e.target.value } : x))} aria-label={s.label} />
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        <div>
          <div className="label">النص الكامل</div>
          <pre className="whitespace-pre-wrap rounded-xl bg-surface-2 p-3 text-sm max-h-72 overflow-y-auto" style={{ fontFamily: 'Tajawal' }}>{text || '(لم يُعثر على نص)'}</pre>
        </div>
      </div>
    </Modal>
  );
}

function Preview({ att, onClose }: { att: Att; onClose(): void }) {
  const ext = extOf(att.file_name);
  const q = useAsync(async () => {
    const url = await signedUrl(att.path, 120);
    if (IMG.includes(ext) || ext === 'pdf') return { url, rows: null as string[][] | null, text: null as string | null };
    const buf = await (await fetch(url)).arrayBuffer();
    if (['xlsx', 'xls', 'csv'].includes(ext)) {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
      return { url, rows: XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' }).slice(0, 200), text: null };
    }
    if (ext === 'docx') {
      const mammoth = (await import('mammoth')).default;
      return { url, rows: null, text: (await mammoth.extractRawText({ arrayBuffer: buf })).value };
    }
    if (ext === 'pptx') return { url, rows: null, text: await pptxText(buf) };
    return { url, rows: null, text: null };
  }, [att.id]);
  return (
    <Modal open onClose={onClose} title={att.file_name} wide
      footer={q.data && <a className="btn-ghost" href={q.data.url} download={att.file_name}><Icon name="download" />تحميل</a>}>
      {q.loading ? <Spinner /> : q.error ? <Alert tone="danger">{q.error}</Alert> : (
        IMG.includes(ext) ? <img src={q.data!.url} alt={att.file_name} className="max-w-full mx-auto rounded-xl" /> :
        ext === 'pdf' ? <iframe src={q.data!.url} title={att.file_name} className="w-full rounded-xl border border-border" style={{ height: '70vh' }} /> :
        q.data!.rows ? (
          <div className="overflow-x-auto"><table className="table"><tbody>{q.data!.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{String(c)}</td>)}</tr>)}</tbody></table></div>
        ) : <pre className="whitespace-pre-wrap text-sm" style={{ fontFamily: 'Tajawal' }}>{q.data!.text ?? 'لا تتوفر معاينة لهذا النوع.'}</pre>
      )}
    </Modal>
  );
}
