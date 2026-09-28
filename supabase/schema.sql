-- ============================================================================
-- صندوق الإخوة — مخطط قاعدة البيانات (Supabase / PostgreSQL)
--
-- طريقة التشغيل: انسخ هذا الملف كاملاً والصقه في Supabase → SQL Editor ثم Run.
-- يُشغَّل مرة واحدة فقط على مشروع جديد.
--
-- المبادئ:
--   • دفتر قيود (entries) لا يُعدَّل ولا يُحذف؛ التصحيح بقيد عكسي مع ذكر السبب.
--   • الصلاحيات تُفرض هنا في قاعدة البيانات (RLS)، لا في الواجهة.
--   • كل عملية تُسجَّل تلقائياً في سجل التدقيق (audit_log).
--   • أول حساب يُسجَّل يصبح «مدير»، وكل حساب بعده ينتظر موافقة المدير.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- الجداول
-- ---------------------------------------------------------------------------

create table public.settings (
  id               int primary key default 1 check (id = 1),
  fund_name        text not null default 'صندوق الإخوة' check (length(btrim(fund_name)) between 1 and 60),
  start_month      date not null default date_trunc('month', current_date)::date
                   check (extract(day from start_month) = 1),
  members_see_all  boolean not null default true,
  last_backup_at   timestamptz,
  updated_at       timestamptz not null default now()
);
insert into public.settings (id) values (1);

create table public.members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 60),
  phone       text check (phone ~ '^[0-9+ ]{6,20}$'),
  joined_on   date not null default date_trunc('month', current_date)::date
              check (extract(day from joined_on) = 1),
  archived    boolean not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid
);
create unique index members_name_unique on public.members (btrim(name));

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text check (length(display_name) <= 60),
  role         text not null default 'pending'
               check (role in ('admin', 'treasurer', 'member', 'pending', 'disabled')),
  member_id    uuid references public.members (id),
  created_at   timestamptz not null default now()
);

create table public.contribution_rates (
  effective_from date primary key check (extract(day from effective_from) = 1),
  amount         numeric(12, 2) not null check (amount > 0),
  created_at     timestamptz not null default now(),
  created_by     uuid
);

-- دفتر القيود: كل حركة مالية قيد مستقل
--   contribution  اشتراك شهري (period = الشهر المدفوع عنه)
--   withdrawal    سحب نهائي لعضو
--   loan          قرض لعضو (due_on / installments اختياريان)
--   repayment     سداد قرض (loan_id)
--   expense       مصروف عام للصندوق
--   reversal      قيد عكسي يلغي أثر قيد سابق (reverses) — مع سبب إلزامي
create table public.entries (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null
               check (kind in ('contribution', 'withdrawal', 'loan', 'repayment', 'expense', 'reversal')),
  member_id    uuid references public.members (id),
  amount       numeric(12, 2) not null check (amount > 0 and amount <= 10000000),
  entry_date   date not null default current_date,
  period       date,
  loan_id      uuid references public.entries (id),
  due_on       date,
  installments int check (installments between 1 and 120),
  reverses     uuid unique references public.entries (id),
  note         text check (length(note) <= 300),
  created_at   timestamptz not null default now(),
  created_by   uuid,
  constraint entries_shape check (
       (kind = 'contribution' and member_id is not null and period is not null
          and extract(day from period) = 1 and loan_id is null and reverses is null)
    or (kind in ('withdrawal', 'loan') and member_id is not null and period is null
          and loan_id is null and reverses is null)
    or (kind = 'repayment' and loan_id is not null and period is null and reverses is null)
    or (kind = 'expense' and member_id is null and period is null and loan_id is null
          and reverses is null and length(btrim(coalesce(note, ''))) >= 2)
    or (kind = 'reversal' and reverses is not null and period is null and loan_id is null
          and length(btrim(coalesce(note, ''))) >= 3)
  ),
  constraint entries_loan_fields check (kind = 'loan' or (due_on is null and installments is null))
);
create index entries_member_idx on public.entries (member_id);
create index entries_loan_idx on public.entries (loan_id);
create index entries_period_idx on public.entries (member_id, period) where kind = 'contribution';

create table public.month_closures (
  period    date primary key check (extract(day from period) = 1),
  closed_at timestamptz not null default now(),
  closed_by uuid
);

create table public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid,
  actor_email text,
  action      text not null,
  table_name  text not null,
  record_id   text,
  old_data    jsonb,
  new_data    jsonb
);

-- ---------------------------------------------------------------------------
-- دوال مساعدة للصلاحيات
-- ---------------------------------------------------------------------------

create function public.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

create function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() in ('admin', 'treasurer'), false)
$$;

create function public.is_reader() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() in ('admin', 'treasurer', 'member'), false)
$$;

create function public.my_member_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select member_id from public.profiles where id = auth.uid()
$$;

create function public.members_see_all() returns boolean
language sql stable security definer set search_path = '' as $$
  select members_see_all from public.settings where id = 1
$$;

create function public.is_importing() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('app.importing', true), '') = 'on'
$$;

-- ---------------------------------------------------------------------------
-- دوال محاسبية
-- ---------------------------------------------------------------------------

-- رصيد الصندوق = الاشتراكات + السدادات − السحوبات − القروض − المصروفات (بعد استبعاد المعكوس)
create function public.fund_balance() returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case when e.kind in ('contribution', 'repayment') then e.amount else -e.amount end), 0)
  from public.entries e
  where e.kind <> 'reversal'
    and not exists (select 1 from public.entries r where r.reverses = e.id)
$$;

create function public.loan_outstanding(p_loan uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select l.amount - coalesce((
    select sum(r.amount) from public.entries r
    where r.loan_id = l.id and r.kind = 'repayment'
      and not exists (select 1 from public.entries x where x.reverses = r.id)
  ), 0)
  from public.entries l where l.id = p_loan
$$;

create function public.rate_for(p_period date) returns numeric
language sql stable security definer set search_path = '' as $$
  select amount from public.contribution_rates
  where effective_from <= p_period
  order by effective_from desc limit 1
$$;

-- ملخص عام يراه كل الأعضاء حتى لو كانت رؤية التفاصيل مقيّدة
create function public.fund_summary() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  if not public.is_reader() then
    raise exception 'غير مصرّح';
  end if;
  with live as (
    select e.* from public.entries e
    where e.kind <> 'reversal'
      and not exists (select 1 from public.entries r where r.reverses = e.id)
  )
  select jsonb_build_object(
    'balance',       coalesce(sum(case when kind in ('contribution', 'repayment') then amount else -amount end), 0),
    'collected',     coalesce(sum(amount) filter (where kind = 'contribution'), 0),
    'withdrawals',   coalesce(sum(amount) filter (where kind = 'withdrawal'), 0),
    'expenses',      coalesce(sum(amount) filter (where kind = 'expense'), 0),
    'loans_issued',  coalesce(sum(amount) filter (where kind = 'loan'), 0),
    'repaid',        coalesce(sum(amount) filter (where kind = 'repayment'), 0)
  ) into res from live;
  return res || jsonb_build_object(
    'loans_outstanding', (res->>'loans_issued')::numeric - (res->>'repaid')::numeric
  );
end $$;

-- ---------------------------------------------------------------------------
-- التحقق من القيود قبل الإدخال
-- ---------------------------------------------------------------------------

create function public.entries_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_importing boolean := public.is_importing();
  v_rate      numeric;
  v_paid      numeric;
  v_target    public.entries%rowtype;
  v_loan      public.entries%rowtype;
  v_start     date;
  v_archived  boolean;
begin
  -- تسلسل عمليات الكتابة لمنع تجاوز الرصيد بطلبين متزامنين
  perform pg_advisory_xact_lock(hashtext('sandooq_entries'));

  if not public.is_staff() then
    raise exception 'غير مصرّح: التسجيل للمدير وأمين الصندوق فقط';
  end if;

  if not v_importing then
    new.created_at := now();
    new.created_by := auth.uid();
    if new.kind = 'reversal' then
      new.entry_date := current_date;
    end if;
    if new.entry_date > current_date + 1 then
      raise exception 'لا يمكن تسجيل حركة بتاريخ مستقبلي';
    end if;
    if exists (select 1 from public.month_closures c
               where c.period = date_trunc('month', new.entry_date)::date) then
      raise exception 'شهر % مقفل؛ سجّل الحركة بتاريخ ضمن شهر مفتوح', to_char(new.entry_date, 'YYYY-MM');
    end if;
  end if;

  if new.member_id is not null and new.kind <> 'reversal' and not v_importing then
    select archived into v_archived from public.members where id = new.member_id;
    if v_archived then
      raise exception 'العضو مؤرشف؛ أعد تفعيله أولاً';
    end if;
  end if;

  if new.kind = 'contribution' then
    select start_month into v_start from public.settings where id = 1;
    if new.period < v_start then
      raise exception 'الشهر قبل تاريخ تأسيس الصندوق';
    end if;
    if not v_importing and new.period > (date_trunc('month', current_date) + interval '12 months')::date then
      raise exception 'لا يمكن الدفع المقدّم لأكثر من 12 شهراً';
    end if;
    v_rate := public.rate_for(new.period);
    if v_rate is null then
      raise exception 'لا يوجد مبلغ اشتراك محدد لهذا الشهر؛ أضفه من الإعدادات';
    end if;
    select coalesce(sum(e.amount), 0) into v_paid from public.entries e
    where e.kind = 'contribution' and e.member_id = new.member_id and e.period = new.period
      and not exists (select 1 from public.entries r where r.reverses = e.id);
    if v_paid + new.amount > v_rate then
      raise exception 'المبلغ يتجاوز المستحق لهذا الشهر (المتبقي: %)', v_rate - v_paid;
    end if;

  elsif new.kind in ('withdrawal', 'loan', 'expense') then
    if new.amount > public.fund_balance() then
      raise exception 'رصيد الصندوق لا يكفي (الرصيد الحالي: %)', public.fund_balance();
    end if;
    if new.kind = 'loan' and new.due_on is not null and new.due_on < new.entry_date then
      raise exception 'تاريخ الاستحقاق قبل تاريخ القرض';
    end if;

  elsif new.kind = 'repayment' then
    select * into v_loan from public.entries where id = new.loan_id;
    if v_loan.id is null or v_loan.kind <> 'loan' then
      raise exception 'القرض غير موجود';
    end if;
    if exists (select 1 from public.entries r where r.reverses = v_loan.id) then
      raise exception 'القرض ملغى';
    end if;
    new.member_id := v_loan.member_id;
    if new.amount > public.loan_outstanding(v_loan.id) then
      raise exception 'السداد أكبر من المتبقي على القرض (المتبقي: %)', public.loan_outstanding(v_loan.id);
    end if;

  elsif new.kind = 'reversal' then
    select * into v_target from public.entries where id = new.reverses;
    if v_target.id is null then
      raise exception 'القيد المطلوب عكسه غير موجود';
    end if;
    if v_target.kind = 'reversal' then
      raise exception 'لا يمكن عكس قيد عكسي';
    end if;
    if exists (select 1 from public.entries r where r.reverses = v_target.id) then
      raise exception 'هذا القيد معكوس مسبقاً';
    end if;
    if v_target.kind = 'loan' and exists (
      select 1 from public.entries r where r.loan_id = v_target.id and r.kind = 'repayment'
        and not exists (select 1 from public.entries x where x.reverses = r.id)) then
      raise exception 'اعكس سدادات هذا القرض أولاً';
    end if;
    new.amount    := v_target.amount;
    new.member_id := v_target.member_id;
    if v_target.kind in ('contribution', 'repayment') and v_target.amount > public.fund_balance() then
      raise exception 'عكس هذا القيد يجعل الرصيد سالباً';
    end if;
  end if;

  return new;
end $$;

create trigger entries_before_insert before insert on public.entries
  for each row execute function public.entries_before_insert();

-- منع أي تعديل أو حذف (حتى من لوحة التحكم) للجداول غير القابلة للتغيير
create function public.forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception 'السجلات في % لا تُعدَّل ولا تُحذف؛ استخدم قيداً عكسياً', tg_table_name;
end $$;

create trigger entries_immutable before update or delete on public.entries
  for each row execute function public.forbid_change();
create trigger audit_immutable before update or delete on public.audit_log
  for each row execute function public.forbid_change();
create trigger members_no_delete before delete on public.members
  for each row execute function public.forbid_change();

-- الأعضاء: تثبيت المعرّف وتسجيل وقت الأرشفة
create function public.members_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    if not public.is_importing() then
      new.created_at := now();
      new.created_by := auth.uid();
    end if;
  else
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  if new.archived and (tg_op = 'INSERT' or not old.archived) then
    new.archived_at := coalesce(new.archived_at, now());
  elsif not new.archived then
    new.archived_at := null;
  end if;
  return new;
end $$;

create trigger members_before_write before insert or update on public.members
  for each row execute function public.members_before_write();

-- أسعار الاشتراك: لا تغيير بأثر رجعي على أشهر فيها دفعات
create function public.rates_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_from date := coalesce(new.effective_from, old.effective_from);
begin
  if tg_op = 'UPDATE' then
    raise exception 'لا يُعدَّل السعر؛ أضف سعراً جديداً بتاريخ سريان جديد';
  end if;
  if not public.is_importing()
     and (tg_op = 'DELETE' or v_from < date_trunc('month', current_date)::date)
     and exists (select 1 from public.entries e
                 where e.kind = 'contribution' and e.period >= v_from
                   and not exists (select 1 from public.entries r where r.reverses = e.id)) then
    if tg_op = 'DELETE' then
      raise exception 'لا يمكن حذف سعر طُبّق على دفعات مسجلة';
    end if;
    raise exception 'توجد دفعات مسجلة بعد هذا التاريخ؛ اختر تاريخ سريان من الشهر الحالي أو بعده';
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
    return new;
  end if;
  return old;
end $$;

create trigger rates_guard before insert or update or delete on public.contribution_rates
  for each row execute function public.rates_guard();

-- إقفال الشهر: فقط لشهر منتهٍ
create function public.closures_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_importing() then
    if new.period >= date_trunc('month', current_date)::date then
      raise exception 'لا يمكن إقفال الشهر الحالي أو شهر مستقبلي';
    end if;
    new.closed_at := now();
    new.closed_by := auth.uid();
  end if;
  return new;
end $$;

create trigger closures_guard before insert on public.month_closures
  for each row execute function public.closures_guard();

-- الملفات الشخصية: البريد ثابت، ولا يُزال آخر مدير
create function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.id := old.id;
  new.email := old.email;
  new.created_at := old.created_at;
  if old.role = 'admin' and new.role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'لا يمكن إزالة آخر مدير';
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- إنشاء الملف الشخصي عند التسجيل: الأول مدير، والبقية بانتظار الموافقة
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  lock table public.profiles in exclusive mode;
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    left(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 60),
    case when exists (select 1 from public.profiles) then 'pending' else 'admin' end
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- سجل التدقيق
-- ---------------------------------------------------------------------------

create function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  insert into public.audit_log (actor, actor_email, action, table_name, record_id, old_data, new_data)
  values (
    auth.uid(),
    (select email from public.profiles where id = auth.uid()),
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'period', v_row ->> 'effective_from'),
    v_old,
    v_new
  );
  return null;
end $$;

create trigger audit_entries after insert on public.entries
  for each row execute function public.audit_trigger();
create trigger audit_members after insert or update on public.members
  for each row execute function public.audit_trigger();
create trigger audit_rates after insert or delete on public.contribution_rates
  for each row execute function public.audit_trigger();
create trigger audit_settings after update on public.settings
  for each row execute function public.audit_trigger();
create trigger audit_closures after insert or delete on public.month_closures
  for each row execute function public.audit_trigger();
create trigger audit_profiles after update on public.profiles
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- عمليات خاصة (RPC)
-- ---------------------------------------------------------------------------

-- تسجيل تاريخ آخر نسخة احتياطية
create function public.mark_backup() returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := now();
begin
  if not public.is_staff() then
    raise exception 'غير مصرّح';
  end if;
  update public.settings set last_backup_at = v_now, updated_at = v_now where id = 1;
  return v_now;
end $$;

-- استيراد كامل (نقل من النسخة القديمة أو استعادة نسخة احتياطية) — على قاعدة فارغة فقط
-- العملية كلها ذرّية: إما تنجح بالكامل أو لا يتغير شيء.
create function public.import_data(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_row  jsonb;
  v_cnt  int := 0;
begin
  if not public.is_admin() then
    raise exception 'الاستيراد للمدير فقط';
  end if;
  if exists (select 1 from public.entries) or exists (select 1 from public.members) then
    raise exception 'الاستيراد مسموح على قاعدة فارغة فقط';
  end if;
  perform set_config('app.importing', 'on', true);

  if payload ? 'settings' then
    update public.settings set
      fund_name   = coalesce(payload #>> '{settings,fund_name}', fund_name),
      start_month = coalesce((payload #>> '{settings,start_month}')::date, start_month),
      updated_at  = now()
    where id = 1;
  end if;

  -- أسعار الملف تحل محل أي أسعار ضُبطت قبل الاستيراد (لا توجد قيود بعد، فلا أثر رجعي)
  if jsonb_array_length(coalesce(payload -> 'rates', '[]')) > 0 then
    delete from public.contribution_rates;
  end if;
  for v_row in select * from jsonb_array_elements(coalesce(payload -> 'rates', '[]'))
  loop
    insert into public.contribution_rates (effective_from, amount)
    values ((v_row ->> 'effective_from')::date, (v_row ->> 'amount')::numeric);
  end loop;

  for v_row in select * from jsonb_array_elements(coalesce(payload -> 'members', '[]'))
  loop
    insert into public.members (id, name, phone, joined_on, archived, archived_at, created_at, created_by)
    values (
      (v_row ->> 'id')::uuid, v_row ->> 'name', nullif(v_row ->> 'phone', ''),
      (v_row ->> 'joined_on')::date, coalesce((v_row ->> 'archived')::boolean, false),
      (v_row ->> 'archived_at')::timestamptz,
      coalesce((v_row ->> 'created_at')::timestamptz, now()), auth.uid()
    );
  end loop;

  -- القيود بالترتيب الذي أرسله العميل (مرتبة زمنياً مع الإيرادات أولاً)
  for v_row in select * from jsonb_array_elements(coalesce(payload -> 'entries', '[]'))
  loop
    insert into public.entries (id, kind, member_id, amount, entry_date, period, loan_id,
                                due_on, installments, reverses, note, created_at, created_by)
    values (
      (v_row ->> 'id')::uuid, v_row ->> 'kind', (v_row ->> 'member_id')::uuid,
      (v_row ->> 'amount')::numeric, (v_row ->> 'entry_date')::date, (v_row ->> 'period')::date,
      (v_row ->> 'loan_id')::uuid, (v_row ->> 'due_on')::date, (v_row ->> 'installments')::int,
      (v_row ->> 'reverses')::uuid, nullif(v_row ->> 'note', ''),
      coalesce((v_row ->> 'created_at')::timestamptz, now()), auth.uid()
    );
    v_cnt := v_cnt + 1;
  end loop;

  for v_row in select * from jsonb_array_elements(coalesce(payload -> 'closures', '[]'))
  loop
    insert into public.month_closures (period, closed_at, closed_by)
    values ((v_row ->> 'period')::date, coalesce((v_row ->> 'closed_at')::timestamptz, now()), auth.uid())
    on conflict (period) do nothing;
  end loop;

  perform set_config('app.importing', 'off', true);
  return jsonb_build_object('entries', v_cnt, 'balance', public.fund_balance());
end $$;

-- ---------------------------------------------------------------------------
-- الصلاحيات (Row Level Security)
-- ---------------------------------------------------------------------------

alter table public.settings            enable row level security;
alter table public.members             enable row level security;
alter table public.profiles            enable row level security;
alter table public.contribution_rates  enable row level security;
alter table public.entries             enable row level security;
alter table public.month_closures      enable row level security;
alter table public.audit_log           enable row level security;

-- الإعدادات
create policy settings_read   on public.settings for select to authenticated using (public.is_reader());
create policy settings_update on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- الأعضاء
create policy members_read   on public.members for select to authenticated using (public.is_reader());
create policy members_insert on public.members for insert to authenticated with check (public.is_staff());
create policy members_update on public.members for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- الملفات الشخصية
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- أسعار الاشتراك
create policy rates_read   on public.contribution_rates for select to authenticated using (public.is_reader());
create policy rates_insert on public.contribution_rates for insert to authenticated with check (public.is_admin());
create policy rates_delete on public.contribution_rates for delete to authenticated using (public.is_admin());

-- القيود: الإدارة ترى الكل، والعضو يرى الكل أو قيوده والمصروفات فقط حسب الإعداد
create policy entries_read on public.entries for select to authenticated using (
  public.is_staff()
  or (public.is_reader() and (public.members_see_all() or member_id is null or member_id = public.my_member_id()))
);
create policy entries_insert on public.entries for insert to authenticated with check (public.is_staff());

-- إقفال الأشهر
create policy closures_read   on public.month_closures for select to authenticated using (public.is_reader());
create policy closures_insert on public.month_closures for insert to authenticated with check (public.is_staff());
create policy closures_delete on public.month_closures for delete to authenticated using (public.is_admin());

-- سجل التدقيق
create policy audit_read on public.audit_log for select to authenticated using (public.is_staff());

-- منح الصلاحيات الأساسية (RLS أعلاه يحدد ما يُسمح به فعلاً)
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function
  public.my_role(), public.is_admin(), public.is_staff(), public.is_reader(), public.my_member_id(),
  public.members_see_all(), public.is_importing(), public.fund_balance(), public.loan_outstanding(uuid),
  public.rate_for(date), public.fund_summary(), public.mark_backup(), public.import_data(jsonb)
to authenticated;
