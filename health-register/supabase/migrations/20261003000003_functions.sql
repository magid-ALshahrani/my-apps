-- الدوال: إخفاء الأرقام الحساسة في النصوص، التدقيق، تحديث التنفيذ، الاعتماد، والإحصاءات المجمّعة.

-- ============ إخفاء أي رقم من عشر خانات يبدأ بـ 1 أو 2 داخل النصوص الحرة ============
-- يُطبَّق في الواجهة قبل الحفظ، ويُطبَّق هنا مرة ثانية كخط دفاع أخير.
create or replace function public.mask_sensitive_text(t text) returns text
language sql immutable as $$
  select case when t is null then null else regexp_replace(
    translate(t, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
    '(?<![0-9])[12][0-9]{9}(?![0-9])', '[محذوف]', 'g') end
$$;

create or replace function public.mask_sensitive_jsonb(j jsonb) returns jsonb
language plpgsql immutable as $$
declare r jsonb;
begin
  case jsonb_typeof(j)
    when 'string' then return to_jsonb(public.mask_sensitive_text(j #>> '{}'));
    when 'object' then
      select coalesce(jsonb_object_agg(k, public.mask_sensitive_jsonb(v)), '{}'::jsonb) into r from jsonb_each(j) as e(k, v);
      return r;
    when 'array' then
      select coalesce(jsonb_agg(public.mask_sensitive_jsonb(v)), '[]'::jsonb) into r from jsonb_array_elements(j) as e(v);
      return r;
    else return j;
  end case;
end $$;

create or replace function public.mask_row_text() returns trigger
language plpgsql as $$
declare
  patch jsonb := '{}'::jsonb;
  col record;
  val jsonb := to_jsonb(new);
begin
  for col in
    select a.attname, a.atttypid from pg_attribute a
    where a.attrelid = tg_relid and a.attnum > 0 and not a.attisdropped
      and a.atttypid in ('text'::regtype, 'varchar'::regtype, 'jsonb'::regtype)
  loop
    if val -> col.attname is not null and val -> col.attname <> 'null'::jsonb then
      if col.atttypid = 'jsonb'::regtype then
        patch := patch || jsonb_build_object(col.attname, public.mask_sensitive_jsonb(val -> col.attname));
      else
        patch := patch || jsonb_build_object(col.attname, public.mask_sensitive_text(val ->> col.attname));
      end if;
    end if;
  end loop;
  new := jsonb_populate_record(new, patch);
  return new;
end $$;

-- ============ سجل التدقيق ============
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  changed text[];
  rid text;
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into changed
    from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value;
  end if;
  rid := coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id');
  insert into public.audit_log (user_id, user_role, table_name, action, row_id, changed_columns)
  values (auth.uid(), (select role from public.profiles where id = auth.uid()),
          tg_table_name, tg_op, rid, changed);
  return coalesce(new, old);
end $$;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','school_info','guide_info','professional_development','building_rooms','health_center',
    'clinic_info','stages','grades','sections','students','condition_types','student_conditions',
    'official_records','violence_cases','referrals','clinic_visits','programs','student_trainings',
    'committee_members','committee_meetings','env_inspections','attachments','forms_library',
    'import_templates','report_approvals']
  loop
    execute format('create trigger a_mask before insert or update on public.%I for each row execute function public.mask_row_text()', t);
    execute format('create trigger z_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
  foreach t in array array['school_info','guide_info','health_center','clinic_info','students','student_conditions','referrals','forms_library'] loop
    execute format('create trigger b_touch before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ============ دوال للعميل ============
create or replace function public.set_my_theme(p_theme text) returns void
language sql security definer set search_path = public as $$
  update public.profiles set theme = case when p_theme in ('light', 'dark') then p_theme end
  where id = auth.uid()
$$;

-- تحديث حالة التنفيذ وتوثيقه: الموجه الصحي وعضو اللجنة.
-- قيود CHECK على جدول programs تبقى هي الحَكَم (السبب إلزامي، والتاريخ الجديد للمؤجل).
create or replace function public.update_program_execution(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s public.program_status;
begin
  if not public.has_role('health_guide', 'committee_member') then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  s := coalesce((p ->> 'status')::public.program_status, (select status from public.programs where id = p_id));
  update public.programs set
    -- حقول الحالة تتغير فقط إذا أُرسلت status؛ التوثيق وحده لا يمسّها
    status = s,
    actual_date = case when not (p ? 'status') then actual_date when s = 'done' then (p ->> 'actual_date')::date end,
    beneficiaries = case when not (p ? 'status') then beneficiaries when s = 'done' then (p ->> 'beneficiaries')::int end,
    skip_reason = case when not (p ? 'status') then skip_reason when s in ('not_done', 'postponed') then (p ->> 'skip_reason')::public.skip_reason end,
    skip_note = case when not (p ? 'status') then skip_note when s in ('not_done', 'postponed') then nullif(trim(p ->> 'skip_note'), '') end,
    new_date = case when not (p ? 'status') then new_date when s = 'postponed' then (p ->> 'new_date')::date end,
    status_updated_at = case when p ? 'status' then now() else status_updated_at end,
    status_updated_by = case when p ? 'status' then auth.uid() else status_updated_by end,
    executor = case when p ? 'executor' then p ->> 'executor' else executor end,
    goal = case when p ? 'goal' then p ->> 'goal' else goal end,
    doc_start = case when p ? 'doc_start' then (p ->> 'doc_start')::date else doc_start end,
    doc_end = case when p ? 'doc_end' then (p ->> 'doc_end')::date else doc_end end,
    classes_count = case when p ? 'classes_count' then (p ->> 'classes_count')::int else classes_count end,
    partners = case when p ? 'partners' then p ->> 'partners' else partners end,
    mechanisms = case when p ? 'mechanisms' then array(select jsonb_array_elements_text(p -> 'mechanisms')) else mechanisms end,
    mechanism_other = case when p ? 'mechanism_other' then p ->> 'mechanism_other' else mechanism_other end,
    doc_notes = case when p ? 'doc_notes' then p ->> 'doc_notes' else doc_notes end
  where id = p_id;
  if not found then raise exception 'البرنامج غير موجود' using errcode = 'P0002'; end if;
end $$;

-- اعتماد المدير لمحاضر اللجنة ونماذج التفقد
create or replace function public.approve_record(p_table text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('principal') then
    raise exception 'الاعتماد لمدير المدرسة فقط' using errcode = '42501';
  end if;
  if p_table not in ('committee_meetings', 'env_inspections') then
    raise exception 'نوع غير مدعوم';
  end if;
  execute format('update public.%I set approved_by = auth.uid(), approved_at = now() where id = $1', p_table) using p_id;
end $$;

-- ============ إحصاءات مجمّعة (أعداد فقط) لكل الأدوار، ومنها عضو اللجنة ============
create or replace function public.dashboard_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
  total int;
begin
  if public.app_role() is null then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  select count(*) into total from public.students;
  select jsonb_build_object(
    'students_total', total,
    'conditions_by_type', coalesce((
      select jsonb_agg(jsonb_build_object('type_id', t.id, 'name', t.name, 'color', t.color, 'icon', t.icon,
             'is_critical', t.is_critical, 'count', (select count(*) from public.student_conditions c where c.type_id = t.id and c.status = 'active'))
             order by t.sort, t.name)
      from public.condition_types t), '[]'::jsonb),
    'open_referrals', (select count(*) from public.referrals where status <> 'closed'),
    'beneficiaries_pct', (
      select case when total = 0 then null else round(least(100, avg(least(p.beneficiaries, total)::numeric * 100 / total)), 1) end
      from public.programs p where p.status = 'done' and p.beneficiaries is not null),
    'env_compliance_pct', (
      select round(100.0 * count(*) filter (where (a.value ->> 'yes')::boolean) / nullif(count(*) filter (where a.value ->> 'yes' is not null), 0), 1)
      from (select answers from public.env_inspections order by inspected_on desc, created_at desc limit 1) li,
           jsonb_each(li.answers) a),
    'programs_by_status', coalesce((
      select jsonb_agg(jsonb_build_object('semester', semester, 'status', effective_status, 'count', n))
      from (select semester::text, effective_status, count(*) n from public.programs_view
            where not is_unofficial_day group by 1, 2) x), '[]'::jsonb),
    'skip_reasons', coalesce((
      select jsonb_agg(jsonb_build_object('reason', skip_reason, 'count', n))
      from (select skip_reason::text, count(*) n from public.programs where skip_reason is not null group by 1) x), '[]'::jsonb),
    'conditions_by_grade', coalesce((
      select jsonb_agg(jsonb_build_object('grade', g.name, 'stage', st.name, 'type_id', c.type_id, 'count', c.n) order by st.sort, g.sort)
      from (select sc.type_id, se.grade_id, count(*) n from public.student_conditions sc
            join public.students s on s.id = sc.student_id join public.sections se on se.id = s.section_id
            where sc.status = 'active' group by 1, 2) c
      join public.grades g on g.id = c.grade_id join public.stages st on st.id = g.stage_id), '[]'::jsonb),
    'monthly', coalesce((
      select jsonb_agg(jsonb_build_object('month', m, 'conditions', nc, 'visits', nv) order by m)
      from (
        select m, sum(nc) nc, sum(nv) nv from (
          select to_char(created_at, 'YYYY-MM') m, count(*) nc, 0 nv from public.student_conditions group by 1
          union all
          select to_char(visited_at, 'YYYY-MM'), 0, count(*) from public.clinic_visits group by 1) u
        group by m order by m desc limit 12) mm), '[]'::jsonb)
  ) into result;
  return result;
end $$;

revoke execute on function public.dashboard_stats() from anon;
revoke execute on function public.update_program_execution(uuid, jsonb) from anon;
revoke execute on function public.approve_record(text, uuid) from anon;
revoke execute on function public.set_my_theme(text) from anon;

-- ============ مخزن الملفات: خاص، وروابط موقّعة مؤقتة ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('files', 'files', false, 10485760, array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel', 'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

create policy files_read on storage.objects for select to authenticated using (
  bucket_id = 'files' and (
    ((storage.foldername(name))[1] = 'program' and public.has_role('health_guide','principal','nurse','committee_member'))
    or ((storage.foldername(name))[1] = 'condition' and public.has_role('health_guide','principal','nurse'))
    or ((storage.foldername(name))[1] = 'forms' and public.app_role() is not null)));
create policy files_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'files' and (
    ((storage.foldername(name))[1] = 'program' and public.has_role('health_guide','committee_member'))
    or ((storage.foldername(name))[1] = 'condition' and public.has_role('health_guide','nurse'))
    or ((storage.foldername(name))[1] = 'forms' and public.is_guide())));
create policy files_delete on storage.objects for delete to authenticated using (
  bucket_id = 'files' and public.is_guide());
