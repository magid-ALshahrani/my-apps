-- إصلاح: دالة الاستيراد (Supabase يرفض DELETE بدون WHERE)
-- شغّل هذا الملف مرة واحدة في SQL Editor إذا كنت شغّلت schema.sql قبل هذا الإصلاح.

create or replace function public.import_data(payload jsonb) returns jsonb
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
    delete from public.contribution_rates where true;
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
