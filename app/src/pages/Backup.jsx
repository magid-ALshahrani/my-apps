import { useState } from 'react';
import { useFund } from '../fund.jsx';
import { importData, markBackup } from '../api.js';
import { buildBackup, toImportPayload, validateDataset } from '../lib/dataset.js';
import { decryptJSON, encryptJSON, ENCRYPTED_FORMAT } from '../lib/crypto.js';
import { convertLegacy, isLegacyExport } from '../lib/legacy.js';
import { fmtDate, monthName } from '../lib/format.js';
import { indexEntries, summarize } from '../lib/ledger.js';
import { Confirm, download, Field, Money, useSubmit, useToast } from '../components/ui.jsx';

export function Backup() {
  const { data, derived, can, reload } = useFund();
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [encrypt, setEncrypt] = useState(true);
  const [pending, setPending] = useState(null); // ملف مستورد بانتظار التأكيد
  const [needPw, setNeedPw] = useState(null);
  const [filePw, setFilePw] = useState('');
  const pwErr = encrypt && (pw.length < 8 ? '8 أحرف على الأقل' : pw !== pw2 ? 'غير متطابقة' : null);

  const [doExport, exporting] = useSubmit(async () => {
    const backup = buildBackup(data);
    const body = encrypt ? await encryptJSON(backup, pw) : backup;
    download(`صندوق-نسخة-${derived.today}${encrypt ? '-مشفرة' : ''}.json`, JSON.stringify(body), 'application/json');
    await markBackup();
    reload();
    toast.ok('✅ تم حفظ النسخة الاحتياطية');
  });

  const readDataset = (json) => {
    if (isLegacyExport(json)) {
      const { dataset, warnings } = convertLegacy(json, { fundName: data.settings.fund_name });
      return { dataset: validateDataset(dataset), warnings, legacy: true };
    }
    return { dataset: validateDataset(json), warnings: [], legacy: false };
  };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) return toast.error('الملف كبير جداً');
    try {
      const json = JSON.parse(await f.text());
      if (json?.format === ENCRYPTED_FORMAT) setNeedPw(json);
      else setPending(readDataset(json));
    } catch (err) {
      toast.error(err instanceof SyntaxError ? 'الملف ليس JSON صالحاً' : err);
    }
  };

  const [unlock, unlocking] = useSubmit(async () => {
    const json = await decryptJSON(needPw, filePw);
    setPending(readDataset(json));
    setNeedPw(null);
    setFilePw('');
  });

  const empty = data.entries.length === 0 && data.members.length === 0;
  const preview = pending && summarize(indexEntries(pending.dataset.entries).live);

  return (
    <>
      <div className="page-h"><h2>💾 النسخ الاحتياطي والنقل</h2></div>
      <div className="card">
        <div className="card-t">📥 أخذ نسخة احتياطية</div>
        <p className="small muted" style={{ marginBottom: 10 }}>
          آخر نسخة: {data.settings.last_backup_at ? fmtDate(data.settings.last_backup_at.slice(0, 10)) : 'لا يوجد'} ·
          احفظ الملف في Google Drive أو iCloud أو أرسله لنفسك.
        </p>
        <label className="check"><input type="checkbox" checked={encrypt} onChange={(e) => setEncrypt(e.target.checked)} /> تشفير الملف بكلمة مرور (مُوصى به)</label>
        {encrypt && (
          <div className="frow">
            <Field label="كلمة مرور الملف" error={pw && pwErr === '8 أحرف على الأقل' ? pwErr : null} hint="احفظها؛ لا يمكن فتح الملف بدونها">
              <input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
            <Field label="تأكيد كلمة المرور" error={pw2 && pwErr === 'غير متطابقة' ? pwErr : null}>
              <input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </Field>
          </div>
        )}
        <button className="btn ok block" disabled={exporting || !!pwErr} onClick={doExport}>{exporting ? 'جارٍ التجهيز...' : '📥 تنزيل النسخة الاحتياطية'}</button>
      </div>

      <div className="card">
        <div className="card-t">📤 استيراد / استعادة {!can.admin && <span className="badge b-mut">للمدير فقط</span>}</div>
        <p className="small muted" style={{ marginBottom: 10 }}>
          يقبل ملف التصدير من <strong>النسخة القديمة</strong> (sandooq-desktop.html ← النسخ الاحتياطي ← تصدير البيانات) أو نسخة احتياطية من هذا التطبيق.
          الاستيراد مسموح فقط على صندوق فارغ، ويتم كاملاً أو لا يتم إطلاقاً.
        </p>
        {!empty && <div className="alert blu">الصندوق يحتوي بيانات؛ الاستيراد متاح فقط لصندوق فارغ لمنع التكرار.</div>}
        {can.admin && empty && (
          <label className="btn info block" style={{ cursor: 'pointer' }}>
            📂 اختيار ملف
            <input type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onFile} />
          </label>
        )}
      </div>

      {needPw && (
        <div className="card">
          <div className="card-t">🔐 الملف مشفّر</div>
          <form onSubmit={(e) => { e.preventDefault(); unlock(); }}>
            <Field label="كلمة مرور الملف"><input className="input" type="password" value={filePw} onChange={(e) => setFilePw(e.target.value)} autoFocus /></Field>
            <div className="row">
              <button className="btn primary" disabled={unlocking || !filePw}>{unlocking ? '...' : 'فتح'}</button>
              <button type="button" className="btn" onClick={() => setNeedPw(null)}>إلغاء</button>
            </div>
          </form>
        </div>
      )}

      {pending && (
        <Confirm
          title={pending.legacy ? 'نقل البيانات من النسخة القديمة' : 'استعادة نسخة احتياطية'}
          message={
            <>
              <span style={{ display: 'block', marginBottom: 8 }}>
                {pending.dataset.members.length} عضو · {pending.dataset.entries.length} حركة · التأسيس {monthName(pending.dataset.settings.start_month)}
                <br />
                المحصّل <Money v={preview.collected} /> · الرصيد <Money v={preview.balance} /> · قروض قائمة <Money v={preview.loans_outstanding} />
              </span>
              {pending.legacy && <span className="small muted" style={{ display: 'block' }}>مبلغ الاشتراك في النسخة القديمة 100 ﷼ شهرياً. بعد النقل راجع «بداية الاشتراك» لكل عضو من صفحة الأعضاء، وأضف أرقام الجوال.</span>}
              {pending.warnings.map((w) => <span key={w} className="small" style={{ display: 'block', color: 'var(--amb)' }}>⚠️ {w}</span>)}
            </>
          }
          confirmLabel="تأكيد الاستيراد"
          onConfirm={async () => {
            const r = await importData(toImportPayload(pending.dataset));
            toast.ok(`✅ تم استيراد ${r.entries} حركة`);
            reload();
          }}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}
