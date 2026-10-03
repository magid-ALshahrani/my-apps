import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Icon } from './Icon';
import { Modal } from './ui';
import { useAuth, ROLE_LABEL, type Role } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { dual } from '../lib/dates';

export interface NavItem { to: string; label: string; icon: string; roles: Role[]; mobile?: boolean }

const ALL: Role[] = ['health_guide', 'principal', 'nurse', 'committee_member'];
const STAFF: Role[] = ['health_guide', 'principal', 'nurse'];
const LEAD: Role[] = ['health_guide', 'principal'];

// القوائم تظهر حسب الدور. الحماية الفعلية في RLS.
export const NAV: NavItem[] = [
  { to: '/', label: 'لوحة التحكم', icon: 'home', roles: ALL, mobile: true },
  { to: '/classes', label: 'الصفوف والطلاب', icon: 'classes', roles: STAFF, mobile: true },
  { to: '/programs', label: 'البرامج والتقويم', icon: 'calendar', roles: ALL, mobile: true },
  { to: '/plan', label: 'خطة المتابعة السنوية', icon: 'clipboard', roles: ALL },
  { to: '/reports', label: 'التقارير', icon: 'report', roles: STAFF },
  { to: '/visits', label: 'زيارات العيادة', icon: 'stethoscope', roles: STAFF, mobile: true },
  { to: '/records', label: 'السجلات الرسمية', icon: 'clipboard', roles: STAFF },
  { to: '/violence', label: 'سجل العنف الأسري', icon: 'lock', roles: ['health_guide'] },
  { to: '/referrals', label: 'التحويلات', icon: 'referral', roles: STAFF },
  { to: '/committee', label: 'لجنة الصحة المدرسية', icon: 'users', roles: LEAD },
  { to: '/environment', label: 'تفقد البيئة المدرسية', icon: 'building', roles: LEAD },
  { to: '/clinic', label: 'العيادة المدرسية', icon: 'stethoscope', roles: STAFF },
  { to: '/school', label: 'بيانات المدرسة والموجه', icon: 'building', roles: LEAD },
  { to: '/forms', label: 'الأدلة والنماذج', icon: 'book', roles: ALL },
  { to: '/about', label: 'الرسالة والرؤية', icon: 'star', roles: ALL },
  { to: '/import', label: 'استيراد القوائم', icon: 'upload', roles: ['health_guide'] },
  { to: '/users', label: 'المستخدمون', icon: 'users', roles: ['health_guide'] },
  { to: '/settings', label: 'الإعدادات', icon: 'settings', roles: ['health_guide'] },
];

export function navFor(role: Role | null) {
  return role ? NAV.filter((n) => n.roles.includes(role)) : [];
}

export function Layout() {
  const { profile, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const [more, setMore] = useState(false);
  const loc = useLocation();
  const items = navFor(profile?.role ?? null);
  const mobileItems = items.filter((i) => i.mobile).slice(0, 3);
  const extra = items.filter((i) => !mobileItems.includes(i));

  const link = (n: NavItem, compact = false) => (
    <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={() => setMore(false)}
      className={({ isActive }) => compact
        ? `flex flex-1 flex-col items-center justify-center gap-0.5 text-xs ${isActive ? 'text-primary font-bold' : 'text-muted'}`
        : `flex items-center gap-3 rounded-xl px-3 ${isActive ? 'bg-primary text-on-primary font-bold' : 'text-text hover:bg-surface-2'}`}
      style={{ minHeight: compact ? 56 : 44 }}>
      <Icon name={n.icon} size={compact ? 22 : 20} />
      <span>{n.label}</span>
    </NavLink>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* شريط جانبي على سطح المكتب (يمين الشاشة في RTL) */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 lg:start-0 bg-surface border-e border-border no-print">
        <div className="px-4 py-5 border-b border-border">
          <div className="font-heading font-bold text-lg leading-tight">سجل الموجه الصحي</div>
          <div className="text-sm text-muted">العام الدراسي 1448هـ</div>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-1" aria-label="القائمة الرئيسية">{items.map((n) => link(n))}</nav>
        <div className="p-3 border-t border-border text-sm">
          <div className="font-medium truncate">{profile?.full_name}</div>
          <div className="text-muted">{profile && ROLE_LABEL[profile.role]}</div>
        </div>
      </aside>

      <div className="flex-1 lg:ms-64 print:ms-0 min-w-0">
        <header className="sticky top-0 z-30 bg-bg/95 backdrop-blur border-b border-border no-print">
          <div className="flex items-center gap-2 px-4 lg:px-8 h-14">
            <div className="lg:hidden font-heading font-bold truncate">سجل الموجه الصحي</div>
            <div className="hidden lg:block text-sm text-muted">{dual(new Date())}</div>
            <div className="ms-auto flex items-center gap-1">
              <span className="hidden sm:inline badge bg-primary-soft text-text">{profile && ROLE_LABEL[profile.role]}</span>
              <button className="icon-btn" onClick={toggle} aria-label={theme === 'dark' ? 'التبديل إلى الثيم الفاتح' : 'التبديل إلى الثيم الداكن'} title="تبديل الثيم">
                <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
              </button>
              <button className="icon-btn" onClick={() => signOut()} aria-label="تسجيل الخروج" title="تسجيل الخروج"><Icon name="logout" /></button>
            </div>
          </div>
        </header>

        <main key={loc.pathname} className="px-4 lg:px-8 py-5 pb-28 lg:pb-10 max-w-7xl mx-auto">
          <Outlet />
        </main>
      </div>

      {/* تنقل سفلي على الجوال */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface border-t border-border flex safe-bottom no-print" aria-label="التنقل السفلي">
        {mobileItems.map((n) => link(n, true))}
        {extra.length > 0 && (
          <button className="flex flex-1 flex-col items-center justify-center gap-0.5 text-xs text-muted" style={{ minHeight: 56 }} onClick={() => setMore(true)}>
            <Icon name="menu" size={22} /><span>المزيد</span>
          </button>
        )}
      </nav>
      <Modal open={more} onClose={() => setMore(false)} title="المزيد">
        <div className="space-y-1">{extra.map((n) => link(n))}</div>
      </Modal>
    </div>
  );
}
