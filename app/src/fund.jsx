// حالة التطبيق: تحميل البيانات، الحسابات المشتقة، الصلاحيات، والتخزين المؤقت للعمل بدون إنترنت.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { loadAll } from './api.js';
import { addMonths, currentMonth, monthRange, todayISO } from './lib/dates.js';
import { indexEntries, loansView, paidMap, summarize } from './lib/ledger.js';

const FundCtx = createContext(null);
export const useFund = () => useContext(FundCtx);

const cacheKey = (uid) => `sandooq-cache-v1:${uid}`;
export const clearCache = () => {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('sandooq-cache-v1:')) localStorage.removeItem(k);
  } catch {
    /* التخزين غير متاح */
  }
};

export function usePref(key, initial) {
  const [v, setV] = useState(() => {
    try {
      const s = localStorage.getItem(`sandooq-pref:${key}`);
      return s == null ? initial : JSON.parse(s);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (nv) => {
      setV(nv);
      try {
        localStorage.setItem(`sandooq-pref:${key}`, JSON.stringify(nv));
      } catch {
        /* التخزين غير متاح */
      }
    },
    [key],
  );
  return [v, set];
}

export function FundProvider({ session, profile, children }) {
  const role = profile.role;
  const isStaff = role === 'admin' || role === 'treasurer';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [fromCache, setFromCache] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [hijri, setHijri] = usePref('hijri', false);

  const reload = useCallback(async () => {
    try {
      const d = await loadAll(isStaff);
      setData(d);
      setError(null);
      setFromCache(false);
      setNow(new Date());
      try {
        localStorage.setItem(cacheKey(session.user.id), JSON.stringify({ at: Date.now(), d }));
      } catch {
        /* لا مساحة — ليس حرجاً */
      }
    } catch (e) {
      let cached = null;
      try {
        cached = JSON.parse(localStorage.getItem(cacheKey(session.user.id)) || 'null');
      } catch {
        cached = null;
      }
      if (cached) {
        setData((cur) => cur || cached.d);
        setFromCache(true);
      }
      setError(e);
    }
  }, [isStaff, session.user.id]);

  useEffect(() => {
    reload();
    const onFocus = () => document.visibilityState === 'visible' && reload();
    const up = () => {
      setOnline(true);
      reload();
    };
    const down = () => setOnline(false);
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    // تحديث الشهر الحالي تلقائياً إذا بقيت الصفحة مفتوحة
    const tick = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      clearInterval(tick);
    };
  }, [reload]);

  const derived = useMemo(() => {
    if (!data) return null;
    const today = todayISO(now);
    const curMonth = currentMonth(now);
    const { live, reversedBy } = indexEntries(data.entries);
    const members = data.members;
    const activeMembers = members.filter((m) => !m.archived);
    const start = data.settings.start_month;
    return {
      today,
      curMonth,
      live,
      reversedBy,
      paid: paidMap(live),
      // الإدارة ترى كل القيود فتحسب محلياً؛ العضو المقيّد يعتمد على ملخص الخادم
      summary: isStaff || data.settings.members_see_all ? summarize(live) : data.summary,
      memberById: new Map(members.map((m) => [m.id, m])),
      activeMembers,
      closed: new Set(data.closures.map((c) => c.period)),
      // أشهر الصندوق: من التأسيس حتى 12 شهراً قادمة (للدفع المقدّم)
      months: monthRange(start, addMonths(curMonth > start ? curMonth : start, 12)),
      pastMonths: monthRange(start, curMonth),
      loans: loansView(data.entries, today),
    };
  }, [data, now, isStaff]);

  const can = {
    write: isStaff && online && !fromCache,
    admin: role === 'admin' && online && !fromCache,
    staff: isStaff,
    seeAll: isStaff || !!data?.settings.members_see_all,
  };

  const value = { session, profile, role, data, derived, reload, error, online, fromCache, can, hijri, setHijri };
  return <FundCtx.Provider value={value}>{children}</FundCtx.Provider>;
}
