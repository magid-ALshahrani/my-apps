-- إبقاء المشروع نشطاً: دالة صغيرة تستدعيها مهمة GitHub التلقائية كل 3 أيام
-- (.github/workflows/keep-alive.yml) حتى لا يوقف Supabase المجاني المشروع بعد أسبوع بلا استخدام.
-- ترجع الوقت الحالي فقط، ولا تقرأ ولا تكتب أي بيانات من بيانات السجل.

create or replace function public.keep_alive() returns timestamptz
language sql stable set search_path = '' as $$
  select now()
$$;

revoke execute on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated;
