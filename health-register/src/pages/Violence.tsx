// سجل متابعة حالات العنف الأسري: للموجه الصحي فقط وبعد إعادة إدخال كلمة المرور.
// قاعدة البيانات نفسها ترفض القراءة ما لم تكن الجلسة مسجّلة بكلمة المرور خلال آخر 10 دقائق.
import { useEffect, useState, type FormEvent } from 'react';
import { supabase, friendlyError } from '../lib/supabase';
import { reauthenticate } from '../lib/auth';
import { RECORD_NOTE } from '../lib/register';
import { PageHeader, Spinner, Empty, Field, Alert, useConfirm, useToast } from '../components/ui';
import { useStudents } from '../components/StudentPicker';
import { RecordTable, RecordDialog, type RecordRow } from './Records';
import { Icon } from '../components/Icon';

const WINDOW_MS = 10 * 60 * 1000;

export default function Violence() {
  const [unlockedAt, setUnlockedAt] = useState<number | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<RecordRow[] | null>(null);
  const [editing, setEditing] = useState<Partial<RecordRow> | null>(null);
  const students = useStudents();
  const toast = useToast();
  const { ask, ui } = useConfirm();

  const load = async () => {
    const { data, error } = await supabase.from('violence_cases').select('*').order('case_date', { ascending: false });
    if (error) setError(friendlyError(error)); else setRows(data as RecordRow[]);
  };

  // يُقفل تلقائيًا بانتهاء نافذة كلمة المرور
  useEffect(() => {
    if (!unlockedAt) return;
    const t = setTimeout(() => { setUnlockedAt(null); setRows(null); }, WINDOW_MS - (Date.now() - unlockedAt));
    return () => clearTimeout(t);
  }, [unlockedAt]);

  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!(await reauthenticate(password))) return setError('كلمة المرور غير صحيحة.');
    setPassword('');
    setUnlockedAt(Date.now());
    await load();
  };

  if (!unlockedAt) {
    return (
      <div className="max-w-md mx-auto">
        <PageHeader title="سجل متابعة حالات العنف الأسري" />
        <form onSubmit={unlock} className="card p-5 space-y-4">
          <div className="flex items-center gap-2"><Icon name="lock" className="text-accent" /><span className="font-medium">وحدة مقيّدة بالموجه الصحي</span></div>
          <p className="text-sm text-muted">أعد إدخال كلمة المرور لفتح السجل. يُقفل تلقائيًا بعد 10 دقائق. لا تظهر بياناته في نقاط الصفوف ولا لوحة التحكم ولا التقارير إلا باختيارك.</p>
          <Field label="كلمة المرور"><input className="field" type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <button className="btn-primary w-full"><Icon name="lock" />فتح السجل</button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="سجل متابعة حالات العنف الأسري بالمدرسة" subtitle={RECORD_NOTE}
        actions={<>
          <button className="btn-ghost" onClick={() => { setUnlockedAt(null); setRows(null); }}><Icon name="lock" />قفل</button>
          <button className="btn-primary" onClick={() => setEditing({})}><Icon name="plus" />إضافة حالة</button>
        </>} />
      {error && <Alert tone="danger">{error}</Alert>}
      {!rows || students.loading ? <Spinner /> : rows.length === 0 ? <Empty title="لا توجد حالات مسجلة" /> : (
        <RecordTable rows={rows} students={students.data ?? []} nameLabel="الحالة" nameKey="case_type" canEdit canDelete
          onEdit={setEditing} onDelete={async (r) => {
            if (!(await ask('حذف هذه الحالة؟'))) return;
            const { error } = await supabase.from('violence_cases').delete().eq('id', r.id);
            if (error) toast(friendlyError(error), 'danger'); else void load();
          }} />
      )}
      {editing && <RecordDialog title={editing.id ? 'تعديل حالة' : 'إضافة حالة'} nameLabel="الحالة" nameKey="case_type" row={editing} students={students.data ?? []}
        onClose={() => setEditing(null)} onSave={async (rec) => {
          const r = editing.id ? await supabase.from('violence_cases').update(rec).eq('id', editing.id) : await supabase.from('violence_cases').insert(rec);
          if (r.error) return friendlyError(r.error);
          setEditing(null); void load(); return null;
        }} />}
      {ui}
    </div>
  );
}
