// معالج الاستيراد: التحليل كله داخل المتصفح، والملف الأصلي لا يُرفع إلى أي خادم.
import { useMemo, useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase';
import { useAsync, must, GENDER_LABEL } from '../lib/data';
import { parseTableFile, applyManualHeaderRow, type ParsedTable } from '../lib/import/parse';
import { STUDENT_FIELDS, COMMITTEE_FIELDS, type Field as ImportField, type ImportKind } from '../lib/import/dictionary';
import {
  autoMap, toMapping, buildStudentRows, classifyDuplicates, missingPlacements, buildCommitteeRows, idRemovalLine,
  type ColumnInfo, type ImportItem, type ImportReport, type PlacementNeed, type Gender, type Rejected, type CommitteeRow,
} from '../lib/import/build';
import { commitStudentImport, commitCommitteeImport, loadExistingStudents, loadPlacements, flattenPlacements } from '../lib/import/commit';
import { MASK } from '../lib/protect';
import { displayPhone } from '../lib/phone';
import { PageHeader, Alert, Field, Spinner, useToast } from '../components/ui';
import { Icon } from '../components/Icon';

type Step = 'file' | 'header' | 'map' | 'preview' | 'done';
const STEPS: { key: Step; label: string }[] = [
  { key: 'file', label: 'الملف' }, { key: 'header', label: 'صف العناوين' }, { key: 'map', label: 'ربط الأعمدة' },
  { key: 'preview', label: 'المعاينة والتأكيد' }, { key: 'done', label: 'التقرير' },
];
const STATUS_BADGE: Record<string, { text: string; cls: string }> = {
  exact: { text: 'مطابق', cls: 'bg-primary-soft text-text' },
  fuzzy: { text: 'مطابق تقريبيًا', cls: 'bg-primary-soft text-text' },
  unmapped: { text: 'غير مربوط', cls: 'bg-warning-soft text-text' },
  rejected: { text: 'غير مربوط (الفصل الدراسي ليس الشعبة)', cls: 'bg-warning-soft text-text' },
};

interface Template { id: string; name: string; kind: ImportKind; mapping: Record<string, string> }

export default function ImportWizard() {
  const toast = useToast();
  const [step, setStep] = useState<Step>('file');
  const [kind, setKind] = useState<ImportKind>('students');
  const [templateId, setTemplateId] = useState<string>('noor');
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [fileLabel, setFileLabel] = useState('');
  const [cols, setCols] = useState<ColumnInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // المعاينة
  const [items, setItems] = useState<ImportItem[]>([]);
  const [committeeRows, setCommitteeRows] = useState<CommitteeRow[]>([]);
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [needs, setNeeds] = useState<PlacementNeed[]>([]);
  const [approveNeeds, setApproveNeeds] = useState(true);
  const [defaultStage, setDefaultStage] = useState('');
  const [defaultGender, setDefaultGender] = useState<Gender>('boys');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [tplName, setTplName] = useState('');

  const templates = useAsync(async () => (must(await supabase.from('import_templates').select('*').order('name')) ?? []) as Template[]);
  const fields = kind === 'students' ? STUDENT_FIELDS : COMMITTEE_FIELDS;

  const reset = () => {
    setStep('file'); setTable(null); setCols([]); setItems([]); setCommitteeRows([]); setRejected([]); setNeeds([]); setReport(null); setError(null); setFileLabel('');
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null); setBusy(true);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('حجم الملف أكبر من 10 ميجابايت.');
      // التحليل وحذف أعمدة الهوية يحدثان داخل parseTableFile قبل أي state
      const t = await parseTableFile(file, kind);
      if (!t.rows.length) throw new Error('الملف فارغ.');
      setTable(t);
      setFileLabel(file.name.replace(/[0-9٠-٩]{6,}/g, '…'));
      if (t.headerRow >= 0) { prepareMapping(t); setStep('map'); } else setStep('header');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const prepareMapping = (t: ParsedTable) => {
    const tpl = templates.data?.find((x) => x.id === templateId);
    setCols(autoMap(t, kind, templateId === 'custom' ? {} : tpl?.mapping));
  };

  const goPreview = async () => {
    if (!table) return;
    const mapping = toMapping(cols);
    const mapped = new Set(Object.values(mapping));
    if (!mapped.has('full_name')) return setError('اربط عمود الاسم أولًا.');
    setError(null); setBusy(true);
    try {
      if (kind === 'students') {
        if (!mapped.has('grade') || !mapped.has('section')) throw new Error('اربط عمودي الصف والفصل.');
        const { rows, rejected } = buildStudentRows(table, mapping, { stage: defaultStage || undefined, gender: defaultGender });
        const existing = await loadExistingStudents(supabase);
        setItems(classifyDuplicates(rows, existing));
        setNeeds(missingPlacements(rows, flattenPlacements(await loadPlacements(supabase))));
        setRejected(rejected);
      } else {
        const { rows, rejected } = buildCommitteeRows(table, mapping);
        setCommitteeRows(rows); setRejected(rejected);
      }
      setStep('preview');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!table) return;
    setBusy(true); setError(null);
    try {
      const r = kind === 'students'
        ? await commitStudentImport(supabase, items, approveNeeds ? needs : [], rejected, table.removed.length, defaultGender)
        : await commitCommitteeImport(supabase, committeeRows, rejected, table.removed.length);
      setReport(r);
      setStep('done');
      // لا يبقى أي شيء من الملف في الذاكرة
      setTable(null); setItems([]); setCommitteeRows([]);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const saveTemplate = async () => {
    if (!tplName.trim()) return;
    // أسماء الأعمدة وحقولها فقط، بلا أي قيمة
    const mapping = Object.fromEntries(cols.filter((c) => c.header.trim()).map((c) => [c.header, c.field]));
    const { error } = await supabase.from('import_templates').upsert({ name: tplName.trim(), kind, mapping }, { onConflict: 'name' });
    if (error) toast(friendlyError(error), 'danger'); else { toast('حُفظ القالب'); setTplName(''); void templates.reload(); }
  };

  const counts = useMemo(() => ({
    add: items.filter((i) => i.action === 'add').length,
    update: items.filter((i) => i.action === 'update').length,
    skip: items.filter((i) => i.action === 'skip').length,
    dups: items.filter((i) => i.duplicate).length,
    phones: items.filter((i) => i.row.phone_needs_review).length,
  }), [items]);

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div>
      <PageHeader title="استيراد القوائم" subtitle="من ملف تصدير نور أو أي جدول Excel/CSV/Word. التحليل يتم على جهازك، ولا يُرفع الملف." />

      <ol className="flex gap-1 overflow-x-auto mb-5 text-sm" aria-label="خطوات الاستيراد">
        {STEPS.map((s, i) => (
          <li key={s.key} className={`flex items-center gap-1 shrink-0 rounded-full px-3 py-1 ${i === stepIndex ? 'bg-primary text-on-primary font-bold' : i < stepIndex ? 'bg-primary-soft text-text' : 'bg-surface-2 text-muted'}`} aria-current={i === stepIndex ? 'step' : undefined}>
            <span className="tabular-nums">{i + 1}</span>{s.label}
          </li>
        ))}
      </ol>

      {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}

      {step === 'file' && (
        <div className="card p-4 space-y-4 max-w-2xl">
          <fieldset>
            <legend className="label">نوع القائمة</legend>
            <div className="flex gap-2 flex-wrap">
              {([['students', 'قائمة الطلاب'], ['committee', 'أعضاء اللجنة']] as const).map(([k, l]) => (
                <button key={k} className={`chip ${kind === k ? 'chip-on' : ''}`} style={{ minHeight: 44 }} aria-pressed={kind === k} onClick={() => { setKind(k); setTemplateId(k === 'students' ? 'noor' : 'committee'); }}>{l}</button>
              ))}
            </div>
          </fieldset>
          <Field label="القالب">
            <select className="field" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {kind === 'students' ? <option value="noor">قالب «نور» (افتراضي)</option> : <option value="committee">قالب قوائم أعضاء اللجنة</option>}
              <option value="custom">قالب مخصص (ربط يدوي)</option>
              {(templates.data ?? []).filter((t) => t.kind === kind).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          {kind === 'students' && (
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="المرحلة الافتراضية" hint="تُستخدم إن لم يحدد الملف المرحلة ولم تُفهم من اسم الصف.">
                <select className="field" value={defaultStage} onChange={(e) => setDefaultStage(e.target.value)}>
                  <option value="">— لا شيء —</option>
                  {['رياض أطفال', 'ابتدائي', 'متوسط', 'ثانوي'].map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="الجنس الافتراضي">
                <select className="field" value={defaultGender} onChange={(e) => setDefaultGender(e.target.value as Gender)}>
                  {(['boys', 'girls'] as const).map((g) => <option key={g} value={g}>{GENDER_LABEL[g]}</option>)}
                </select>
              </Field>
            </div>
          )}
          <label className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border p-8 cursor-pointer hover:bg-surface-2 text-center">
            <Icon name="upload" size={32} className="text-primary" />
            <span className="font-medium">اختر الملف (xlsx أو xls أو csv أو docx)</span>
            <span className="text-sm text-muted">أعمدة الهوية تُكتشف وتُحذف تلقائيًا ولا تُحفظ</span>
            <input type="file" className="sr-only" accept=".xlsx,.xls,.csv,.docx" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {busy && <Spinner label="جارٍ تحليل الملف على جهازك…" />}
          <details className="text-sm text-muted">
            <summary className="cursor-pointer" style={{ minHeight: 44 }}>كيف أصدّر القائمة من نور؟</summary>
            <ol className="list-decimal ps-6 space-y-1 mt-2">
              <li>ادخل نظام نور بنفسك، ثم افتح تقارير الطلاب واختر كشف أسماء الطلاب حسب الصف والفصل.</li>
              <li>صدّر التقرير بصيغة Excel واحفظه على جهازك.</li>
              <li>ارفعه هنا. لا يتصل هذا التطبيق بنور ولا يطلب بيانات دخولك إليه.</li>
            </ol>
          </details>
        </div>
      )}

      {step === 'header' && table && (
        <div className="card p-4 space-y-3">
          <Alert tone="warning">لم يُعثر تلقائيًا على صف العناوين. اختر الصف الذي يحتوي عناوين الأعمدة.</Alert>
          <div className="overflow-x-auto">
            <table className="table">
              <tbody>
                {table.rows.slice(0, 15).map((r, i) => (
                  <tr key={i}>
                    <td><button className="btn-ghost" onClick={() => { const t = applyManualHeaderRow(table, i); setTable(t); prepareMapping(t); setStep('map'); }}>صف {i + 1}</button></td>
                    {r.slice(0, 8).map((c, j) => <td key={j} className="whitespace-nowrap">{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn-ghost" onClick={reset}>رجوع</button>
        </div>
      )}

      {step === 'map' && table && (
        <div className="space-y-4">
          <div className="card p-4">
            <div className="text-sm text-muted mb-3">الملف: {fileLabel} · صف العناوين: {table.headerRow + 1} · عدد الصفوف: {table.rows.length - table.headerRow - 1}</div>
            <ul className="divide-y divide-border">
              {table.removed.map((r) => (
                <li key={`id-${r.index}`} className="py-2 flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.header}</span>
                  <span className="badge bg-danger-soft text-text"><Icon name="lock" size={12} />لن يُحفظ</span>
                  <span className="text-muted font-mono" dir="ltr">{MASK}</span>
                  <span className="text-xs text-muted">{r.reason === 'header' ? 'عمود هوية (بالعنوان)' : 'عمود هوية (بالمحتوى)'}، حُذف من البيانات</span>
                </li>
              ))}
              {cols.map((c, i) => (
                <li key={c.index} className="py-2 grid sm:grid-cols-[1fr_auto_220px] items-center gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{c.header || `عمود ${c.index + 1}`}</div>
                    <div className="text-xs text-muted truncate">مثال: {table.rows[table.headerRow + 1]?.[c.index] || '—'}</div>
                  </div>
                  <span className={`badge ${c.field === 'ignore' ? STATUS_BADGE[c.status === 'rejected' ? 'rejected' : 'unmapped'].cls : STATUS_BADGE[c.status === 'fuzzy' ? 'fuzzy' : 'exact'].cls}`}>
                    {c.field === 'ignore' ? STATUS_BADGE[c.status === 'rejected' ? 'rejected' : 'unmapped'].text : STATUS_BADGE[c.status === 'fuzzy' ? 'fuzzy' : 'exact'].text}
                  </span>
                  <select className="field" aria-label={`حقل العمود ${c.header}`} value={c.field} onChange={(e) => {
                    const next = [...cols];
                    const v = e.target.value as ImportField | 'ignore';
                    // حقل واحد لكل عمود
                    next.forEach((x, k) => { if (k !== i && v !== 'ignore' && x.field === v) next[k] = { ...x, field: 'ignore', status: 'unmapped' }; });
                    next[i] = { ...c, field: v, status: v === 'ignore' ? 'unmapped' : 'exact' };
                    setCols(next);
                  }}>
                    <option value="ignore">تجاهل</option>
                    {Object.entries(fields).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted mt-2">الأعمدة المتجاهلة لا تُحفظ.</p>
          </div>
          <div className="card p-4 flex flex-wrap items-end gap-2">
            <Field label="حفظ هذا الربط كقالب (أسماء الأعمدة فقط)"><input className="field" value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="مثال: نور - الابتدائي" /></Field>
            <button className="btn-ghost" onClick={saveTemplate} disabled={!tplName.trim()}>حفظ القالب</button>
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={reset}>رجوع</button>
            <button className="btn-primary" onClick={goPreview} disabled={busy}>معاينة</button>
          </div>
        </div>
      )}

      {step === 'preview' && table && (
        <div className="space-y-4">
          {table.removed.length > 0 && <Alert tone="info">{table.removed.length === 1 ? 'عمود هوية واحد' : `${table.removed.length} أعمدة هوية`} حُذف من البيانات ولن يُرسل أو يُحفظ.</Alert>}
          {kind === 'students' ? (<>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="card p-3"><div className="text-sm text-muted">إضافة</div><div className="text-2xl font-bold text-primary">{counts.add}</div></div>
              <div className="card p-3"><div className="text-sm text-muted">تحديث</div><div className="text-2xl font-bold">{counts.update}</div></div>
              <div className="card p-3"><div className="text-sm text-muted">تخطي</div><div className="text-2xl font-bold">{counts.skip}</div></div>
              <div className="card p-3"><div className="text-sm text-muted">مرفوض</div><div className="text-2xl font-bold text-danger">{rejected.length}</div></div>
            </div>
            {needs.length > 0 && (
              <div className="card p-4">
                <h2 className="font-heading font-bold mb-2">صفوف وفصول جديدة ستُنشأ</h2>
                <ul className="text-sm list-disc ps-6">{needs.map((n, i) => <li key={i}>{n.stage} · {n.grade} · فصل {n.section}</li>)}</ul>
                <label className="flex items-center gap-2 mt-2" style={{ minHeight: 44 }}>
                  <input type="checkbox" className="h-5 w-5" checked={approveNeeds} onChange={(e) => setApproveNeeds(e.target.checked)} />
                  أوافق على إنشائها
                </label>
              </div>
            )}
            {counts.dups > 0 && (
              <div className="card p-4">
                <h2 className="font-heading font-bold mb-1">أسماء مكررة تحتاج قرارك</h2>
                <p className="text-sm text-muted mb-2">لا يُدمج أي مكرر تلقائيًا. اختر لكل حالة.</p>
                <ul className="divide-y divide-border">
                  {items.map((it, i) => it.duplicate && (
                    <li key={i} className="py-2 flex flex-wrap items-center gap-2">
                      <span className="font-medium">{it.row.full_name}</span>
                      <span className="text-sm text-muted">{it.row.grade} · فصل {it.row.section}</span>
                      <span className="badge bg-warning-soft text-text">{it.duplicate === 'existing' ? 'موجود مسبقًا' : `مكرر في الملف (الصف ${it.duplicateOfRow})`}</span>
                      <select className="field ms-auto" style={{ width: 200 }} aria-label={`قرار ${it.row.full_name}`} value={it.action} onChange={(e) => {
                        const next = [...items]; next[i] = { ...it, action: e.target.value as ImportItem['action'] }; setItems(next);
                      }}>
                        <option value="skip">تخطي</option>
                        {it.duplicate === 'existing' && <option value="update">تحديث الموجود</option>}
                        <option value="add">إضافة كطالب مستقل</option>
                      </select>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="card overflow-x-auto">
              <table className="table">
                <thead><tr><th>#</th><th>الاسم</th><th>المرحلة</th><th>الصف</th><th>الفصل</th><th>جوال ولي الأمر</th><th>القرار</th></tr></thead>
                <tbody>
                  {items.slice(0, 100).map((it, i) => (
                    <tr key={i}>
                      <td className="tabular-nums text-muted">{it.row.rowNumber}</td>
                      <td className="whitespace-nowrap">{it.row.full_name}</td><td>{it.row.stage}</td><td>{it.row.grade}</td><td>{it.row.section}</td>
                      <td dir="ltr" className="text-end">{it.row.guardian_phone ? displayPhone(it.row.guardian_phone) : it.row.phone_needs_review ? <span className="badge bg-warning-soft text-text">يحتاج مراجعة</span> : '—'}</td>
                      <td>{{ add: 'إضافة', update: 'تحديث', skip: 'تخطي' }[it.action]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {items.length > 100 && <p className="text-sm text-muted p-3">تُعرض أول 100 صف من {items.length}.</p>}
            </div>
          </>) : (
            <div className="card overflow-x-auto">
              <table className="table">
                <thead><tr><th>الاسم</th><th>الجوال</th><th>الصفة</th></tr></thead>
                <tbody>{committeeRows.map((r, i) => <tr key={i}><td>{r.full_name}</td><td dir="ltr" className="text-end">{displayPhone(r.phone) || '—'}</td><td>{r.title}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {rejected.length > 0 && (
            <div className="card p-4">
              <h2 className="font-heading font-bold mb-2">صفوف مرفوضة</h2>
              <ul className="text-sm list-disc ps-6">{rejected.map((r, i) => <li key={i}>الصف {r.rowNumber}: {r.reason}</li>)}</ul>
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => setStep('map')}>رجوع</button>
            <button className="btn-primary" onClick={confirm} disabled={busy}><Icon name="check" />تأكيد الاستيراد</button>
          </div>
        </div>
      )}

      {step === 'done' && report && (
        <div className="card p-5 space-y-3 max-w-2xl">
          <h2 className="font-heading font-bold text-lg">تقرير الاستيراد</h2>
          <ul className="space-y-1">
            <li>المضاف: <b>{report.added}</b></li>
            <li>المحدّث: <b>{report.updated}</b></li>
            <li>المتخطّى: <b>{report.skipped}</b></li>
            <li>المرفوض: <b>{report.rejected.length}</b></li>
            {report.phonesFlagged > 0 && <li>أرقام جوال تحتاج مراجعة: <b>{report.phonesFlagged}</b></li>}
          </ul>
          {report.rejected.length > 0 && <ul className="text-sm list-disc ps-6 text-muted">{report.rejected.map((r, i) => <li key={i}>{r.rowNumber ? `الصف ${r.rowNumber}: ` : ''}{r.reason}</li>)}</ul>}
          <Alert tone="success"><b>{idRemovalLine(report.idColumnsRemoved)}</b></Alert>
          <button className="btn-primary" onClick={reset}>استيراد ملف آخر</button>
        </div>
      )}
    </div>
  );
}
