-- الصلاحيات تُفرض هنا في قاعدة البيانات. إخفاء الواجهة للتجربة فقط.
-- القاعدة العامة: الحذف للموجه الصحي وحده، ولا شيء لغير المصادَق.

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','school_info','guide_info','professional_development','building_rooms','health_center',
    'clinic_info','stages','grades','sections','students','condition_types','student_conditions',
    'official_records','violence_cases','referrals','clinic_visits','programs','student_trainings',
    'committee_members','committee_meetings','env_inspections','attachments','forms_library',
    'import_templates','report_approvals','audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
    -- حذف أي صف: للموجه الصحي فقط (سجل التدقيق والملفات الشخصية لا تُحذف من الواجهة)
    if t not in ('audit_log', 'profiles', 'violence_cases', 'school_info', 'guide_info', 'health_center', 'clinic_info') then
      execute format('create policy guide_delete on public.%I for delete to authenticated using (public.is_guide())', t);
    end if;
  end loop;
end $$;
revoke all on public.programs_view from anon;

-- ============ profiles ============
create policy profiles_self_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_guide());
-- لا insert/update من العميل: الدعوة وتعديل الدور والتعطيل عبر Edge Function بمفتاح الخدمة،
-- والثيم عبر دالة set_my_theme.

-- ============ جداول الصف الواحد ============
create policy school_read on public.school_info for select to authenticated using (public.app_role() is not null);
create policy school_write on public.school_info for update to authenticated using (public.is_guide()) with check (public.is_guide());

create policy guide_info_read on public.guide_info for select to authenticated using (public.has_role('health_guide','principal'));
create policy guide_info_write on public.guide_info for update to authenticated using (public.is_guide()) with check (public.is_guide());

create policy pd_read on public.professional_development for select to authenticated using (public.has_role('health_guide','principal'));
create policy pd_insert on public.professional_development for insert to authenticated with check (public.is_guide());
create policy pd_update on public.professional_development for update to authenticated using (public.is_guide()) with check (public.is_guide());

create policy rooms_read on public.building_rooms for select to authenticated using (public.has_role('health_guide','principal'));
create policy rooms_insert on public.building_rooms for insert to authenticated with check (public.is_guide());
create policy rooms_update on public.building_rooms for update to authenticated using (public.is_guide()) with check (public.is_guide());

create policy hc_read on public.health_center for select to authenticated using (public.has_role('health_guide','principal','nurse'));
create policy hc_write on public.health_center for update to authenticated using (public.is_guide()) with check (public.is_guide());

create policy clinic_read on public.clinic_info for select to authenticated using (public.has_role('health_guide','principal','nurse'));
create policy clinic_write on public.clinic_info for update to authenticated
  using (public.has_role('health_guide','nurse')) with check (public.has_role('health_guide','nurse'));

-- ============ الصفوف والطلاب: قراءة للموجه والمدير والممرض، كتابة للموجه ============
do $$
declare t text;
begin
  foreach t in array array['stages','grades','sections','students','condition_types'] loop
    execute format('create policy read_staff on public.%I for select to authenticated using (public.has_role(''health_guide'',''principal'',''nurse''))', t);
    execute format('create policy guide_insert on public.%I for insert to authenticated with check (public.is_guide())', t);
    execute format('create policy guide_update on public.%I for update to authenticated using (public.is_guide()) with check (public.is_guide())', t);
  end loop;
end $$;

-- ============ الحالات والسجلات والزيارات والتحويلات: قراءة للثلاثة، كتابة للموجه والممرض ============
do $$
declare t text;
begin
  foreach t in array array['student_conditions','official_records','referrals','clinic_visits'] loop
    execute format('create policy read_staff on public.%I for select to authenticated using (public.has_role(''health_guide'',''principal'',''nurse''))', t);
    execute format('create policy care_insert on public.%I for insert to authenticated with check (public.has_role(''health_guide'',''nurse''))', t);
    execute format('create policy care_update on public.%I for update to authenticated using (public.has_role(''health_guide'',''nurse'')) with check (public.has_role(''health_guide'',''nurse''))', t);
  end loop;
end $$;

-- ============ العنف الأسري: الموجه فقط وبكلمة مرور حديثة ============
create policy violence_all on public.violence_cases for all to authenticated
  using (public.is_guide() and public.recent_password_auth())
  with check (public.is_guide() and public.recent_password_auth());

-- ============ البرامج: قراءة للجميع، كتابة للموجه، وتحديث التنفيذ للعضو عبر الدالة ============
create policy programs_read on public.programs for select to authenticated using (public.app_role() is not null);
create policy programs_insert on public.programs for insert to authenticated with check (public.is_guide());
create policy programs_update on public.programs for update to authenticated using (public.is_guide()) with check (public.is_guide());

create policy trainings_read on public.student_trainings for select to authenticated using (public.has_role('health_guide','principal','committee_member'));
create policy trainings_insert on public.student_trainings for insert to authenticated with check (public.is_guide());
create policy trainings_update on public.student_trainings for update to authenticated using (public.is_guide()) with check (public.is_guide());

-- ============ اللجنة والتفقد: قراءة للموجه والمدير، كتابة للموجه، والاعتماد للمدير عبر دالة ============
do $$
declare t text;
begin
  foreach t in array array['committee_members','committee_meetings','env_inspections'] loop
    execute format('create policy read_lead on public.%I for select to authenticated using (public.has_role(''health_guide'',''principal''))', t);
    execute format('create policy guide_insert on public.%I for insert to authenticated with check (public.is_guide())', t);
    execute format('create policy guide_update on public.%I for update to authenticated using (public.is_guide()) with check (public.is_guide())', t);
  end loop;
end $$;

-- ============ المرفقات ============
create policy att_read on public.attachments for select to authenticated using (
  public.has_role('health_guide','principal')
  or (owner_type = 'condition' and public.has_role('nurse'))
  or (owner_type = 'program' and public.has_role('nurse','committee_member')));
create policy att_insert on public.attachments for insert to authenticated with check (
  public.is_guide()
  or (owner_type = 'condition' and public.has_role('nurse'))
  or (owner_type = 'program' and public.has_role('committee_member')));

create policy forms_read on public.forms_library for select to authenticated using (public.app_role() is not null);
create policy forms_insert on public.forms_library for insert to authenticated with check (public.is_guide());
create policy forms_update on public.forms_library for update to authenticated using (public.is_guide()) with check (public.is_guide());

create policy tpl_all on public.import_templates for all to authenticated using (public.is_guide()) with check (public.is_guide());

create policy appr_read on public.report_approvals for select to authenticated using (public.has_role('health_guide','principal'));
create policy appr_insert on public.report_approvals for insert to authenticated
  with check (public.has_role('principal') and approved_by = auth.uid());

-- سجل التدقيق: قراءة للموجه فقط، والكتابة من المشغّلات فقط
create policy audit_read on public.audit_log for select to authenticated using (public.is_guide());
revoke insert, update, delete on public.audit_log from authenticated;
