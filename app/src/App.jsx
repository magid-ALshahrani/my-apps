import { useCallback, useEffect, useState } from 'react';
import { supabase, loadMyProfile, friendlyError } from './api.js';
import { IDLE_MINUTES } from './config.js';
import { clearCache, FundProvider, useFund } from './fund.jsx';
import { monthName, ROLE_LABEL } from './lib/format.js';
import { Modal, ToastProvider } from './components/ui.jsx';
import { AuthPage, Pending, ResetPassword } from './pages/Auth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import { Payments, YearView } from './pages/Payments.jsx';
import { Ledger, Loans } from './pages/Ledger.jsx';
import { Members, Reminders, Statement } from './pages/Members.jsx';
import { Reports } from './pages/Reports.jsx';
import { applyTheme, Audit, Settings } from './pages/Settings.jsx';
import { Backup } from './pages/Backup.jsx';

try {
  applyTheme(JSON.parse(localStorage.getItem('sandooq-pref:theme') || '"system"'));
} catch {
  /* التخزين غير متاح */
}

const signOut = async () => {
  clearCache();
  // المستخدم التالي يبدأ من الرئيسية
  window.history.replaceState(null, '', window.location.pathname);
  await supabase.auth.signOut();
};

export default function App() {
  return (
    <ToastProvider>
      <Root />
    </ToastProvider>
  );
}

function Root() {
  const [session, setSession] = useState(undefined);
  const [recovery, setRecovery] = useState(false);
  const [profile, setProfile] = useState(undefined);
  const [profileErr, setProfileErr] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const uid = session?.user?.id;
  const loadProfile = useCallback(async () => {
    if (!uid) return;
    try {
      setProfile(await loadMyProfile(uid));
      setProfileErr(null);
    } catch (e) {
      setProfileErr(e);
    }
  }, [uid]);

  useEffect(() => {
    setProfile(undefined);
    loadProfile();
  }, [loadProfile]);

  if (session === undefined) return <Splash />;
  if (recovery && session) return <ResetPassword onDone={() => setRecovery(false)} />;
  if (!session) return <AuthPage />;
  if (profileErr && profile === undefined) return <Splash error={profileErr} retry={loadProfile} />;
  if (profile === undefined) return <Splash />;
  if (!profile || !['admin', 'treasurer', 'member'].includes(profile.role)) return <Pending profile={profile} onRefresh={loadProfile} />;
  return (
    <FundProvider key={uid} session={session} profile={profile}>
      <Shell />
    </FundProvider>
  );
}

function Splash({ error, retry }) {
  return (
    <div className="auth-bg">
      <div className="auth-box" style={{ textAlign: 'center' }}>
        <div className="logo">🏦</div>
        {error ? (
          <>
            <div className="alert red">{friendlyError(error)}</div>
            <p className="small muted" style={{ marginBottom: 12 }}>
              إذا استمرت المشكلة فربما توقف مشروع Supabase مؤقتاً لعدم الاستخدام؛ افتح لوحة Supabase واضغط Restore.
            </p>
            <div className="row">
              <button className="btn primary" style={{ flex: 1 }} onClick={retry}>إعادة المحاولة</button>
              <button className="btn" style={{ flex: 1 }} onClick={signOut}>خروج</button>
            </div>
          </>
        ) : (
          <p className="muted">جارٍ التحميل...</p>
        )}
      </div>
    </div>
  );
}

function useHashRoute() {
  const parse = () => {
    const [, page = 'home', param = null] = window.location.hash.replace(/^#/, '').split('/');
    return { page: page || 'home', param };
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((page, param) => {
    window.location.hash = `/${page}${param ? `/${param}` : ''}`;
    window.scrollTo(0, 0);
  }, []);
  return [route, go];
}

function useIdleSignOut(minutes) {
  useEffect(() => {
    let t;
    const reset = () => {
      clearTimeout(t);
      t = setTimeout(() => signOut(), minutes * 60 * 1000);
    };
    const evs = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(t);
      evs.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [minutes]);
}

function Shell() {
  const { data, derived, can, error, online, fromCache, profile, reload } = useFund();
  const [route, go] = useHashRoute();
  const [more, setMore] = useState(false);
  useIdleSignOut(IDLE_MINUTES);

  if (!data || !derived) {
    return error ? <Splash error={error} retry={reload} /> : <Splash />;
  }

  const NAV = [
    { k: 'home', ic: '🏠', l: 'الرئيسية' },
    { k: 'payments', ic: '💳', l: 'الدفعات', show: can.seeAll },
    { k: 'year', ic: '📅', l: 'عرض السنة', show: can.seeAll },
    { k: 'ledger', ic: '📋', l: 'الحركات', show: can.seeAll },
    { k: 'loans', ic: '🔄', l: 'القروض', show: can.seeAll },
    { k: 'members', ic: '👥', l: 'الأعضاء', show: can.seeAll },
    { k: 'statement', ic: '📄', l: 'كشف حساب' },
    { k: 'reminders', ic: '🔔', l: 'التذكير', show: can.staff },
    { k: 'reports', ic: '📈', l: 'التقارير', show: can.seeAll },
    { k: 'backup', ic: '💾', l: 'النسخ الاحتياطي', show: can.staff },
    { k: 'audit', ic: '🛡️', l: 'سجل التدقيق', show: can.staff },
    { k: 'settings', ic: '⚙️', l: 'الإعدادات' },
  ].filter((x) => x.show !== false);
  const page = NAV.some((n) => n.k === route.page) ? route.page : 'home';
  const primaryKeys = can.staff ? ['home', 'payments', 'ledger', 'members'] : can.seeAll ? ['home', 'payments', 'statement', 'reports'] : ['home', 'statement'];
  const primary = primaryKeys.map((k) => NAV.find((n) => n.k === k)).filter(Boolean);
  const navTo = (k, p) => {
    setMore(false);
    go(k, p);
  };

  const pages = {
    home: <Dashboard go={navTo} />,
    payments: <Payments />,
    year: <YearView />,
    ledger: <Ledger />,
    loans: <Loans />,
    members: <Members go={navTo} />,
    statement: <Statement key={route.param || 'me'} memberId={route.param} />,
    reminders: <Reminders />,
    reports: <Reports />,
    backup: <Backup />,
    audit: <Audit />,
    settings: <Settings />,
  };

  return (
    <div className="shell">
      {(!online || fromCache) && <div className="banner">📴 بدون اتصال — تعرض آخر بيانات محفوظة (قراءة فقط)</div>}
      {online && !fromCache && error && (
        <div className="banner">⚠️ تعذّر التحديث: {friendlyError(error)} <button className="linkish" style={{ color: '#fff' }} onClick={reload}>إعادة</button></div>
      )}
      <header className="hdr">
        <div className="hdr-title">
          <h1>🏦 {data.settings.fund_name}</h1>
          <p>{monthName(derived.curMonth)} · {profile.display_name || profile.email} · {ROLE_LABEL[profile.role]}</p>
        </div>
        <div className="hdr-actions">
          <button className="icon-btn" onClick={reload} aria-label="تحديث" title="تحديث">🔄</button>
          <button className="icon-btn" onClick={signOut} aria-label="خروج" title="خروج">🚪</button>
        </div>
      </header>
      <div className="main">
        <nav className="side" aria-label="القائمة">
          {NAV.map((n) => (
            <button key={n.k} className={`nav-item ${page === n.k ? 'on' : ''}`} onClick={() => navTo(n.k)}>
              <span className="nav-ic">{n.ic}</span>{n.l}
            </button>
          ))}
        </nav>
        <main className="content">{pages[page]}</main>
      </div>
      <nav className="bottom-nav" style={{ gridTemplateColumns: `repeat(${primary.length + 1}, 1fr)` }} aria-label="التنقل">
        {primary.map((n) => (
          <button key={n.k} className={`bn-item ${page === n.k ? 'on' : ''}`} onClick={() => navTo(n.k)}>
            <span className="nav-ic">{n.ic}</span>{n.l}
          </button>
        ))}
        <button className={`bn-item ${!primaryKeys.includes(page) ? 'on' : ''}`} onClick={() => setMore(true)}>
          <span className="nav-ic">☰</span>المزيد
        </button>
      </nav>
      {more && (
        <Modal title="القائمة" onClose={() => setMore(false)}>
          <div className="sheet-grid">
            {NAV.map((n) => (
              <button key={n.k} className={`nav-item ${page === n.k ? 'on' : ''}`} onClick={() => navTo(n.k)}>
                <span className="nav-ic">{n.ic}</span>{n.l}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
