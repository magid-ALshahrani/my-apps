import { useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase';
import { useAsync } from '../lib/data';
import { useAuth, ROLE_LABEL, type Role } from '../lib/auth';
import { PageHeader, Spinner, Alert, Modal, Field, useToast, useConfirm } from '../components/ui';
import { Icon } from '../components/Icon';

interface U { id: string; full_name: string; email: string | null; role: Role; active: boolean; must_change_password: boolean }

/** كل العمليات عبر Edge Function تتحقق أن المنادي موجه صحي؛ مفتاح الخدمة لا يصل للواجهة */
async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    let msg = 'تعذّر تنفيذ العملية';
    try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* تجاهل */ }
    throw new Error(msg);
  }
  return data as T;
}

export default function Users() {
  const { profile } = useAuth();
  const toast = useToast();
  const { ask, ui } = useConfirm();
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const q = useAsync(async () => (await call<{ users: U[] }>({ action: 'list' })).users);

  const act = async (body: Record<string, unknown>, done: string) => {
    try { await call(body); toast(done); void q.reload(); } catch (e) { toast(friendlyError(e), 'danger'); }
  };

  return (
    <div>
      <PageHeader title="المستخدمون والصلاحيات" subtitle="لا يوجد تسجيل ذاتي؛ الحسابات تُضاف من هنا فقط."
        actions={<button className="btn-primary" onClick={() => setAdding(true)}><Icon name="plus" />دعوة مستخدم</button>} />
      {q.loading && !q.data ? <Spinner /> : q.error ? <Alert tone="danger">{q.error}</Alert> : (
        <ul className="card divide-y divide-border">
          {q.data!.map((u) => (
            <li key={u.id} className="p-3 flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{u.full_name} {u.id === profile?.id && <span className="badge bg-surface-2 text-muted">أنت</span>}</div>
                <div className="text-sm text-muted" dir="ltr" style={{ textAlign: 'right' }}>{u.email}</div>
                <div className="flex gap-1 mt-1">
                  {!u.active && <span className="badge bg-danger-soft text-text">معطّل</span>}
                  {u.must_change_password && <span className="badge bg-warning-soft text-text">بانتظار أول دخول</span>}
                </div>
              </div>
              <select className="field" style={{ width: 180 }} aria-label={`دور ${u.full_name}`} value={u.role} disabled={u.id === profile?.id}
                onChange={(e) => act({ action: 'set_role', user_id: u.id, role: e.target.value }, 'تم تغيير الدور')}>
                {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              {u.id !== profile?.id && <>
                <button className="btn-ghost" onClick={async () => {
                  if (!(await ask(`إعادة تعيين كلمة مرور ${u.full_name}؟`))) return;
                  try { const r = await call<{ temporary_password: string }>({ action: 'reset_password', user_id: u.id }); setSecret({ email: u.email ?? '', password: r.temporary_password }); void q.reload(); }
                  catch (e) { toast(friendlyError(e), 'danger'); }
                }}><Icon name="lock" />كلمة مرور</button>
                <button className={u.active ? 'btn-ghost text-danger' : 'btn-ghost'} onClick={async () => {
                  if (u.active && !(await ask(`تعطيل حساب ${u.full_name}؟ لن يتمكن من الدخول.`))) return;
                  void act({ action: 'set_active', user_id: u.id, active: !u.active }, u.active ? 'تم التعطيل' : 'تم التفعيل');
                }}>{u.active ? 'تعطيل' : 'تفعيل'}</button>
              </>}
            </li>
          ))}
        </ul>
      )}
      {adding && <AddUser onClose={() => setAdding(false)} onCreated={(email, password) => { setAdding(false); setSecret({ email, password }); void q.reload(); }} />}
      <Modal open={!!secret} onClose={() => setSecret(null)} title="كلمة المرور المؤقتة" footer={<button className="btn-primary" onClick={() => setSecret(null)}>تم</button>}>
        <div className="space-y-3">
          <Alert tone="warning">تظهر مرة واحدة فقط. سلّمها لصاحب الحساب بطريقة آمنة، وسيُطلب منه تغييرها عند أول دخول.</Alert>
          <div className="text-sm text-muted" dir="ltr">{secret?.email}</div>
          <div className="font-mono text-xl text-center p-3 rounded-xl bg-surface-2 select-all" dir="ltr">{secret?.password}</div>
        </div>
      </Modal>
      {ui}
    </div>
  );
}

function AddUser({ onClose, onCreated }: { onClose(): void; onCreated(email: string, password: string): void }) {
  const [f, setF] = useState({ email: '', full_name: '', role: 'nurse' as Role, title: 'عضو' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await call<{ temporary_password: string }>({ action: 'create', ...f });
      onCreated(f.email, r.temporary_password);
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="دعوة مستخدم" footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" onClick={save} disabled={busy}>إنشاء الحساب</button></>}>
      <div className="space-y-4">
        <Field label="الاسم" required><input className="field" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="البريد الإلكتروني" required><input className="field" type="email" dir="ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="الدور" required>
          <select className="field" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </Field>
        {f.role === 'committee_member' && (
          <Field label="الصفة في اللجنة" hint="يُسجَّل العضو أيضًا في سجل تشكيل اللجنة الرسمي.">
            <select className="field" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })}>
              {['رئيس/ة اللجنة', 'نائب/ة الرئيس', 'مقرر/ة', 'عضو'].map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}
