import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type Role = 'health_guide' | 'principal' | 'nurse' | 'committee_member';
export const ROLE_LABEL: Record<Role, string> = {
  health_guide: 'الموجه الصحي',
  principal: 'مدير/ة المدرسة',
  nurse: 'ممرض/ة العيادة',
  committee_member: 'عضو اللجنة',
};

export interface Profile { id: string; full_name: string; email: string | null; role: Role; active: boolean; must_change_password: boolean; theme: 'light' | 'dark' | null }

interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  locked: boolean;
  refreshProfile(): Promise<void>;
  signOut(reason?: 'idle'): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
export const IDLE_MS = 15 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) { setProfile(null); return; }
    const { data } = await supabase.from('profiles').select('id,full_name,email,role,active,must_change_password,theme').eq('id', s.user.id).maybeSingle();
    setProfile((data as Profile) ?? null);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadProfile(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      // لا await داخل المستمع (توصية supabase-js)
      setTimeout(() => void loadProfile(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const signOut = useCallback(async (reason?: 'idle') => {
    await supabase.auth.signOut();
    setProfile(null);
    if (reason === 'idle') setLocked(true);
  }, []);

  // قفل تلقائي بعد 15 دقيقة خمول
  const last = useRef(Date.now());
  useEffect(() => {
    if (!session) return;
    const bump = () => { last.current = Date.now(); };
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = window.setInterval(() => {
      if (Date.now() - last.current > IDLE_MS) void signOut('idle');
    }, 15_000);
    return () => { events.forEach((e) => window.removeEventListener(e, bump)); clearInterval(t); };
  }, [session, signOut]);

  useEffect(() => { if (session) setLocked(false); }, [session]);

  return (
    <Ctx.Provider value={{ loading, session, profile, locked, refreshProfile: () => loadProfile(session), signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider missing');
  return v;
}

export function useRole(): Role | null {
  return useAuth().profile?.role ?? null;
}

/** إعادة إدخال كلمة المرور (للوحدات المقيّدة): تسجيل دخول جديد يحدّث amr في الجلسة */
export async function reauthenticate(password: string): Promise<boolean> {
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;
  if (!email) return false;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return !error;
}
