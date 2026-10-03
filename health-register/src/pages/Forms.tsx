// الأدلة والنماذج الإضافية (11 نموذجًا) كمكتبة ملفات قابلة للتحميل.
import { useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase';
import { useAsync, must } from '../lib/data';
import { useRole } from '../lib/auth';
import { validateAttachment, extOf, safeStorageName, ACCEPT_ATTR } from '../lib/files';
import { dual } from '../lib/dates';
import { PageHeader, Spinner, Alert, useToast } from '../components/ui';
import { signedUrl } from '../components/Attachments';
import { Icon } from '../components/Icon';

interface Form { id: string; number: number; title: string; path: string | null; file_name: string | null; updated_at: string }

export default function Forms() {
  const isGuide = useRole() === 'health_guide';
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const q = useAsync(async () => must(await supabase.from('forms_library').select('*').order('number')) as Form[]);

  const upload = async (f: Form, file?: File) => {
    if (!file) return;
    setBusy(f.number);
    try {
      const check = await validateAttachment(file);
      if (!check.ok) throw new Error(check.error);
      const path = `forms/${f.number}-${crypto.randomUUID()}.${extOf(file.name)}`;
      const up = await supabase.storage.from('files').upload(path, file, { contentType: check.mime });
      if (up.error) throw up.error;
      const { error } = await supabase.from('forms_library').update({ path, file_name: safeStorageName(file.name) }).eq('id', f.id);
      if (error) throw error;
      if (f.path) await supabase.storage.from('files').remove([f.path]);
      toast('رُفع النموذج'); void q.reload();
    } catch (e) { toast(friendlyError(e), 'danger'); } finally { setBusy(null); }
  };

  return (
    <div>
      <PageHeader title="أدلة ونماذج إضافية" subtitle="مكتبة ملفات قابلة للتحميل" />
      {q.loading ? <Spinner /> : q.error ? <Alert tone="danger">{q.error}</Alert> : (
        <ul className="card divide-y divide-border">{q.data!.map((f) => (
          <li key={f.id} className="p-3 flex flex-wrap items-center gap-2">
            <span className="tabular-nums text-muted w-6">{f.number}</span>
            <div className="flex-1 min-w-0">
              <div className="font-medium">{f.title}</div>
              <div className="text-xs text-muted">{f.path ? `${f.file_name} · ${dual(f.updated_at, true)}` : 'لم يُرفع الملف بعد'}</div>
            </div>
            {f.path && <button className="btn-ghost" onClick={async () => {
              try { const a = document.createElement('a'); a.href = await signedUrl(f.path!); a.download = f.file_name ?? 'form'; a.target = '_blank'; a.rel = 'noreferrer'; a.click(); }
              catch (e) { toast(friendlyError(e), 'danger'); }
            }}><Icon name="download" />تحميل</button>}
            {isGuide && <label className="btn-ghost cursor-pointer">{busy === f.number ? 'جارٍ الرفع…' : <><Icon name="upload" />{f.path ? 'استبدال' : 'رفع'}</>}
              <input type="file" className="sr-only" accept={ACCEPT_ATTR} onChange={(e) => { void upload(f, e.target.files?.[0]); e.target.value = ''; }} />
            </label>}
          </li>
        ))}</ul>
      )}
    </div>
  );
}
