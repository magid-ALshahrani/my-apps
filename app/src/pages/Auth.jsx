import { useState } from 'react';
import { supabase, friendlyError } from '../api.js';
import { Field } from '../components/ui.jsx';

const redirectTo = () => `${window.location.origin}${window.location.pathname}`;

export function AuthPage() {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState(0);
  const [lockUntil, setLockUntil] = useState(0);

  const run = async (fn) => {
    if (Date.now() < lockUntil) {
      setMsg({ err: true, text: `انتظر ${Math.ceil((lockUntil - Date.now()) / 1000)} ثانية ثم حاول` });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      const n = fails + 1;
      setFails(n);
      // تأخير متزايد بعد المحاولات الخاطئة
      if (n >= 3) setLockUntil(Date.now() + Math.min(2 ** (n - 2), 60) * 1000);
      setMsg({ err: true, text: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  const cleanEmail = email.trim().toLowerCase();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail);

  const login = () =>
    run(async () => {
      const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password: pw });
      if (error) throw error;
    });

  const signup = () =>
    run(async () => {
      if (!name.trim()) throw new Error('أدخل اسمك');
      if (pw.length < 8) throw new Error('كلمة المرور 8 أحرف على الأقل');
      if (pw !== pw2) throw new Error('كلمتا المرور غير متطابقتين');
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: pw,
        options: { data: { display_name: name.trim().slice(0, 60) }, emailRedirectTo: redirectTo() },
      });
      if (error) throw error;
      if (!data.session) setMsg({ text: '📧 أرسلنا رابط تأكيد إلى بريدك. افتحه ثم سجّل الدخول.' });
    });

  const forgot = () =>
    run(async () => {
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, { redirectTo: redirectTo() });
      if (error) throw error;
      setMsg({ text: '📧 إذا كان البريد مسجلاً فستصلك رسالة لتعيين كلمة مرور جديدة.' });
    });

  const submit = (e) => {
    e.preventDefault();
    if (!emailOk) return setMsg({ err: true, text: 'البريد الإلكتروني غير صحيح' });
    if (mode === 'login') login();
    else if (mode === 'signup') signup();
    else forgot();
  };

  return (
    <div className="auth-bg">
      <div className="auth-box">
        <div className="logo">🏦</div>
        <h1>صندوق الإخوة</h1>
        <p className="sub">نظام إدارة الصندوق المغلق</p>
        {mode !== 'forgot' && (
          <div className="tabs" role="tablist">
            <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setMsg(null); }}>دخول</button>
            <button type="button" className={mode === 'signup' ? 'on' : ''} onClick={() => { setMode('signup'); setMsg(null); }}>حساب جديد</button>
          </div>
        )}
        <form onSubmit={submit}>
          {mode === 'signup' && (
            <Field label="الاسم"><input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
          )}
          <Field label="البريد الإلكتروني">
            <input className="input num" style={{ textAlign: 'right', width: '100%' }} type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {mode !== 'forgot' && (
            <Field label="كلمة المرور" hint={mode === 'signup' ? '8 أحرف على الأقل' : null}>
              <input className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
          )}
          {mode === 'signup' && (
            <Field label="تأكيد كلمة المرور">
              <input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </Field>
          )}
          {msg && <div className={`alert ${msg.err ? 'red' : 'grn'}`}>{msg.text}</div>}
          <button className="btn primary block" disabled={busy}>
            {busy ? '...' : mode === 'login' ? '🔓 دخول' : mode === 'signup' ? 'إنشاء الحساب' : 'إرسال رابط الاستعادة'}
          </button>
        </form>
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          {mode === 'login' && <button className="linkish" onClick={() => { setMode('forgot'); setMsg(null); }}>نسيت كلمة المرور؟</button>}
          {mode === 'forgot' && <button className="linkish" onClick={() => { setMode('login'); setMsg(null); }}>رجوع لتسجيل الدخول</button>}
        </div>
        {mode === 'signup' && <p className="small muted" style={{ marginTop: 10, textAlign: 'center' }}>بعد التسجيل ينتظر حسابك موافقة مدير الصندوق.</p>}
      </div>
    </div>
  );
}

export function ResetPassword({ onDone }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (pw.length < 8) return setMsg('8 أحرف على الأقل');
    if (pw !== pw2) return setMsg('غير متطابقتين');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) setMsg(friendlyError(error));
    else onDone();
  };
  return (
    <div className="auth-bg">
      <form className="auth-box" onSubmit={submit}>
        <div className="logo">🔐</div>
        <h1>كلمة مرور جديدة</h1>
        <p className="sub">اختر كلمة مرور قوية لحسابك</p>
        <Field label="كلمة المرور الجديدة"><input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label="تأكيدها"><input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        {msg && <div className="alert red">{msg}</div>}
        <button className="btn primary block" disabled={busy}>حفظ</button>
      </form>
    </div>
  );
}

export function Pending({ profile, onRefresh }) {
  return (
    <div className="auth-bg">
      <div className="auth-box" style={{ textAlign: 'center' }}>
        <div className="logo">{profile?.role === 'disabled' ? '⛔' : '⏳'}</div>
        <h1>{profile?.role === 'disabled' ? 'الحساب موقوف' : 'بانتظار الموافقة'}</h1>
        <p className="sub" style={{ marginTop: 8 }}>
          {profile?.role === 'disabled'
            ? 'أوقف مدير الصندوق هذا الحساب.'
            : 'تم إنشاء حسابك. سيظهر لك الصندوق بعد أن يعتمده المدير ويربطه باسمك.'}
        </p>
        <p className="small muted" style={{ marginBottom: 16, overflowWrap: 'anywhere' }}>{profile?.email}</p>
        <div className="row">
          <button className="btn primary" style={{ flex: 1 }} onClick={onRefresh}>🔄 تحديث</button>
          <button className="btn" style={{ flex: 1 }} onClick={() => supabase.auth.signOut()}>خروج</button>
        </div>
      </div>
    </div>
  );
}
