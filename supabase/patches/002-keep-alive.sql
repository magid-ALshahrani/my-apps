-- إبقاء المشروع نشطاً: دالة صغيرة تستدعيها مهمة GitHub التلقائية كل 3 أيام
-- حتى لا يوقف Supabase المجاني المشروع بعد أسبوع بلا استخدام.
-- لا تقرأ ولا تكتب أي بيانات من بيانات الصندوق؛ ترجع الوقت الحالي فقط.

create or replace function public.keep_alive() returns timestamptz
language sql stable set search_path = '' as $$
  select now()
$$;

revoke execute on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated;
