import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { AuthProvider, useAuth, type Role } from './lib/auth';
import { configured } from './lib/supabase';
import { Layout } from './components/Layout';
import { Spinner, ToastProvider } from './components/ui';
import { Login, ChangePassword, Disabled, NotConfigured } from './pages/Auth';
import { Icon } from './components/Icon';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Classes = lazy(() => import('./pages/Classes'));
const SectionView = lazy(() => import('./pages/SectionView'));
const ImportWizard = lazy(() => import('./pages/ImportWizard'));
const Users = lazy(() => import('./pages/Users'));
const Settings = lazy(() => import('./pages/Settings'));

export function Unauthorized() {
  return (
    <div className="card p-8 text-center max-w-lg mx-auto mt-8">
      <Icon name="lock" size={40} className="mx-auto text-accent" />
      <h1 className="font-heading font-bold text-xl mt-3">غير مصرح</h1>
      <p className="text-muted mt-1">لا تملك صلاحية الوصول إلى هذه الصفحة.</p>
    </div>
  );
}

/** حارس المسار حسب الدور (للتجربة فقط؛ الحماية الفعلية في RLS) */
function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { profile } = useAuth();
  if (!profile || !roles.includes(profile.role)) return <Unauthorized />;
  return <>{children}</>;
}

const STAFF: Role[] = ['health_guide', 'principal', 'nurse'];
const GUIDE: Role[] = ['health_guide'];

function Gate() {
  const { loading, session, profile } = useAuth();
  if (loading) return <Spinner />;
  if (!session) return <Login />;
  if (!profile) return <Spinner label="جارٍ تحميل الحساب…" />;
  if (!profile.active) return <Disabled />;
  if (profile.must_change_password) return <ChangePassword />;
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="classes" element={<Guard roles={STAFF}><Classes /></Guard>} />
          <Route path="classes/:sectionId" element={<Guard roles={STAFF}><SectionView /></Guard>} />
          <Route path="import" element={<Guard roles={GUIDE}><ImportWizard /></Guard>} />
          <Route path="users" element={<Guard roles={GUIDE}><Users /></Guard>} />
          <Route path="settings" element={<Guard roles={GUIDE}><Settings /></Guard>} />
          <Route path="*" element={<Unauthorized />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  if (!configured) return <NotConfigured />;
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthProvider>
        <ToastProvider>
          <Gate />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
