-- نبض حقيقي: keep_alive تكتب سطراً في جدول heartbeat بدل الاكتفاء بقراءة الوقت،
-- لأن Supabase أوقف المشروع رغم نجاح الاستدعاء الخفيف (لم يُحتسب نشاطاً).
-- الجدول منفصل تماماً عن بقية البيانات، ولا يحتفظ إلا بآخر 50 سطراً.
-- يُشغَّل أكثر من مرة بلا ضرر.

create table if not exists public.heartbeat (
  id bigint generated always as identity primary key,
  at timestamptz not null default now()
);

alter table public.heartbeat enable row level security;
revoke all on public.heartbeat from anon, authenticated, public;

create or replace function public.keep_alive() returns timestamptz
language plpgsql volatile security definer set search_path = '' as $$
declare v_now timestamptz := now();
begin
  -- سطر واحد في الساعة على الأكثر، فلا يمكن إغراق الجدول باستدعاءات متكررة
  if not exists (select 1 from public.heartbeat where at > v_now - interval '1 hour') then
    insert into public.heartbeat (at) values (v_now);
    delete from public.heartbeat
    where id not in (select id from public.heartbeat order by id desc limit 50);
  end if;
  return (select max(at) from public.heartbeat);
end $$;

revoke execute on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated;
