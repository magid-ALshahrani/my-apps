import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth';

export type Theme = 'light' | 'dark';

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function stored(): Theme | null {
  try {
    const t = localStorage.getItem('theme');
    return t === 'light' || t === 'dark' ? t : null;
  } catch { return null; }
}
export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#080f1e' : '#0f766e');
}

/** الافتراضي يتبع الجهاز، واختيار المستخدم يُحفظ في ملفه الشخصي (ونسخة محلية لتفادي الوميض) */
export function useTheme() {
  const { profile } = useAuth();
  const [theme, setTheme] = useState<Theme>(() => stored() ?? systemTheme());

  useEffect(() => {
    if (profile?.theme) setTheme(profile.theme);
  }, [profile?.theme]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem('theme', next); } catch { /* تجاهل */ }
    if (profile) void supabase.rpc('set_my_theme', { p_theme: next });
  };
  return { theme, toggle };
}

/** يقرأ لونًا من رموز التصميم (للرسوم) */
export function token(name: string, alpha = 1): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  return v ? `rgb(${v.split(/\s+/).join(' ')} / ${alpha})` : 'currentColor';
}
