import { useCallback, useEffect, useState } from 'react';
import { friendlyError } from './supabase';

/** جلب بسيط مع إعادة التحميل */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await run());
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [run]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

/** يرمي الخطأ إن وُجد ويُرجع البيانات */
export function must<T>(r: { data: T | null; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data as T;
}

export const PROGRAM_STATUS: Record<string, { label: string; token: string; icon: string }> = {
  done: { label: 'منفذ', token: 'success', icon: 'check' },
  not_done: { label: 'لم يُنفذ', token: 'danger', icon: 'close' },
  postponed: { label: 'مؤجل', token: 'warning', icon: 'clock' },
  planned: { label: 'مخطط', token: 'chart-3', icon: 'calendar' },
  late: { label: 'متأخر التحديث', token: 'chart-5', icon: 'warning' },
};

export const SKIP_REASONS: Record<string, string> = {
  holiday: 'إجازة أو تعليق دراسة',
  weather: 'ظروف جوية',
  exams: 'تعارض مع الاختبارات',
  team_absent: 'عدم حضور الفريق الصحي',
  no_time: 'ضيق الوقت',
  no_content: 'نقص المحتوى أو الأدوات',
  other: 'أخرى',
};

export const SEMESTER_LABEL: Record<string, string> = {
  pre: 'قبل العام الدراسي', first: 'الفصل الأول', second: 'الفصل الثاني', both: 'الفصلان',
};

export const GENDER_LABEL: Record<string, string> = { boys: 'بنين', girls: 'بنات' };
