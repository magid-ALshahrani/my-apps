import { useState, type FormEvent } from 'react';
import { supabase, friendlyError } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { Alert, Field } from '../components/ui';
import { Icon } from '../components/Icon';

function Shell({ children }: { children: React.ReactNode }) {
  const { theme, toggle } = useTheme();
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <button className="icon-btn fixed top-3 end-3" onClick={toggle} aria-label="تبديل الثيم"><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
      <div className="card w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-6">
          <img src="/icon.svg" alt="" width={48} height={48} className="rounded-xl" />
          <div>
            <h1 className="font-heading font-bold text-xl leading-tight">سجل الموجه الصحي</h1>
            <p className="text-muted text-sm">الشؤون الصحية المدرسية · 1448هـ</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Login() {
  const { locked } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(friendlyError(error));
  };

  return (
    <Shell>
      {locked && <div className="mb-4"><Alert tone="warning">قُفلت الجلسة بعد 15 دقيقة من عدم النشاط. سجّل الدخول مجددًا.</Alert></div>}
      <form onSubmit={submit} className="space-y-4">
        <Field label="البريد الإلكتروني">
          <input className="field" type="email" dir="ltr" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="كلمة المرور">
          <input className="field" type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'جارٍ الدخول…' : 'دخول'}</button>
        <p className="text-sm text-muted">لا يوجد تسجيل ذاتي. يضيف الموجه الصحي الحسابات من داخل التطبيق.</p>
      </form>
    </Shell>
  );
}

export function ChangePassword() {
  const { refreshProfile, signOut } = useAuth();
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (p1.length < 10) return setError('كلمة المرور 10 أحرف على الأقل.');
    if (p1 !== p2) return setError('كلمتا المرور غير متطابقتين.');
    setBusy(true); setError(null);
    const { error } = await supabase.auth.updateUser({ password: p1 });
    if (error) { setBusy(false); return setError(friendlyError(error)); }
    await refreshProfile();
    setBusy(false);
  };

  return (
    <Shell>
      <h2 className="font-heading font-bold text-lg mb-1">تغيير كلمة المرور</h2>
      <p className="text-muted text-sm mb-4">هذا أول دخول لك. اختر كلمة مرور جديدة (10 أحرف على الأقل) قبل المتابعة.</p>
      <form onSubmit={submit} className="space-y-4">
        <Field label="كلمة المرور الجديدة"><input className="field" type="password" dir="ltr" autoComplete="new-password" minLength={10} required value={p1} onChange={(e) => setP1(e.target.value)} /></Field>
        <Field label="تأكيد كلمة المرور"><input className="field" type="password" dir="ltr" autoComplete="new-password" minLength={10} required value={p2} onChange={(e) => setP2(e.target.value)} /></Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <button className="btn-primary w-full" disabled={busy}>حفظ ومتابعة</button>
        <button type="button" className="btn-ghost w-full" onClick={() => signOut()}>خروج</button>
      </form>
    </Shell>
  );
}

export function Disabled() {
  const { signOut } = useAuth();
  return (
    <Shell>
      <Alert tone="warning">هذا الحساب غير مفعّل. تواصل مع الموجه الصحي.</Alert>
      <button className="btn-ghost w-full mt-4" onClick={() => signOut()}>خروج</button>
    </Shell>
  );
}

export function NotConfigured() {
  return (
    <Shell>
      <Alert tone="warning">لم تُضبط متغيرات البيئة. انسخ <code dir="ltr">.env.example</code> إلى <code dir="ltr">.env</code> وضع رابط مشروع Supabase والمفتاح العام.</Alert>
    </Shell>
  );
}
