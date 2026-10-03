-- سجل الموجه الصحي 1448هـ — المخطط الأساسي
-- كل جدول هنا عليه RLS (في المهاجرة 0002)، وسجل تدقيق (في المهاجرة 0003).

create extension if not exists pgcrypto;

-- ============ الأنواع ============
create type public.app_role as enum ('health_guide', 'principal', 'nurse', 'committee_member');
create type public.gender as enum ('boys', 'girls');
create type public.condition_status as enum ('active', 'recovered');
create type public.record_kind as enum ('infectious', 'chronic', 'emergency');
create type public.referral_status as enum ('sent', 'reviewed', 'closed');
create type public.visit_outcome as enum ('returned', 'sent_home', 'referred');
create type public.semester as enum ('pre', 'first', 'second', 'both');
create type public.program_status as enum ('planned', 'done', 'not_done', 'postponed');
create type public.skip_reason as enum (
  'holiday', 'weather', 'exams', 'team_absent', 'no_time', 'no_content', 'other');

-- ============ الملفات الشخصية والأدوار ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  role public.app_role not null,
  active boolean not null default true,
  must_change_password boolean not null default true,
  theme text check (theme in ('light', 'dark')),
  created_at timestamptz not null default now()
);

-- الدور يُقرأ دائمًا من الجدول، ولا يُقبل من العميل.
-- الحساب المعطّل أو الذي لم يغيّر كلمة المرور المؤقتة بعد لا يحصل على أي دور.
create or replace function public.app_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles
  where id = auth.uid() and active and not must_change_password
$$;

create or replace function public.has_role(variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = any(roles), false)
$$;

create or replace function public.is_guide() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('health_guide')
$$;

-- إعادة إدخال كلمة المرور: الجلسة الحالية سُجّلت بكلمة المرور خلال آخر 10 دقائق (من amr في JWT)
create or replace function public.recent_password_auth(max_age interval default interval '10 minutes')
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) e
    where e ->> 'method' = 'password'
      and to_timestamp((e ->> 'timestamp')::bigint) > now() - max_age)
$$;

-- عند تغيير كلمة المرور في Auth يُرفع إلزام التغيير تلقائيًا
create or replace function public.on_password_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    update public.profiles set must_change_password = false where id = new.id;
  end if;
  return new;
end $$;
create trigger on_auth_password_changed after update of encrypted_password on auth.users
  for each row execute function public.on_password_changed();

-- ============ بيانات المدرسة (صف واحد لكل جدول) ============
create table public.school_info (
  id int primary key default 1 check (id = 1),
  school_name text not null default '',
  region text not null default '',
  stage_label text not null default '',
  gender public.gender,
  founded_year text, stat_number text,
  education_type text, building_type text, ownership text,
  district text, health_center_name text, phone text, email text,
  shift text,
  student_count int, guide_count int, teacher_count int, admin_count int, worker_count int,
  class_count int, inclusion_class_count int,
  clinic_exists boolean, clinic_equipment text, clinic_location text,
  class_crowding text, yard_crowding text,
  year_start date not null default '2026-08-23',
  sem1_end date not null default '2027-01-07',
  sem2_start date not null default '2027-01-17',
  year_end date not null default '2027-06-10',
  show_unofficial_days boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.school_info (id) values (1);

create table public.guide_info (
  id int primary key default 1 check (id = 1),
  full_name text, qualification text, specialty text, cadre text,
  weekly_classes int, has_foundation_cert boolean, guidance_years int, service_years int,
  phone text, email text, other_tasks text, has_first_aid boolean,
  updated_at timestamptz not null default now()
);
insert into public.guide_info (id) values (1);

create table public.professional_development (
  id uuid primary key default gen_random_uuid(),
  title text not null, kind text, provider text, duration text, held_on date, notes text,
  created_at timestamptz not null default now()
);

create table public.building_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null, count int not null default 1 check (count >= 0), notes text,
  created_at timestamptz not null default now()
);

create table public.health_center (
  id int primary key default 1 check (id = 1),
  name text, location text, shifts text, hours text,
  director_name text, director_phone text,
  medical_director_name text, medical_director_phone text,
  coordinator_name text, coordinator_phone text,
  updated_at timestamptz not null default now()
);
insert into public.health_center (id) values (1);

-- 22 عنصرًا تجهيزيًا: items = {"1": {"ok": true, "note": ""}, ...}
create table public.clinic_info (
  id int primary key default 1 check (id = 1),
  nurse_name text, nurse_phone text, nurse_email text,
  items jsonb not null default '{}'::jsonb,
  notes text,
  updated_at timestamptz not null default now()
);
insert into public.clinic_info (id) values (1);

-- ============ الصفوف والطلاب ============
create table public.stages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  gender public.gender not null default 'boys',
  sort int not null default 0,
  unique (name, gender)
);
create table public.grades (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.stages(id) on delete cascade,
  name text not null, sort int not null default 0,
  unique (stage_id, name)
);
create table public.sections (
  id uuid primary key default gen_random_uuid(),
  grade_id uuid not null references public.grades(id) on delete cascade,
  name text not null, sort int not null default 0,
  unique (grade_id, name)
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) > 1),
  name_key text not null,
  section_id uuid references public.sections(id) on delete set null,
  guardian_phone text check (guardian_phone is null or guardian_phone ~ '^\+9665[0-9]{8}$'),
  phone_needs_review boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index students_section_idx on public.students(section_id);
create index students_key_idx on public.students(name_key);

create table public.condition_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null,          -- رمز لون من نظام التصميم (مثل diabetes) أو لون hex للأنواع المخصصة
  icon text not null,           -- اسم رمز من مكتبة الرموز في الواجهة
  is_critical boolean not null default false,
  is_builtin boolean not null default false,
  sort int not null default 100
);

create table public.student_conditions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  type_id uuid not null references public.condition_types(id),
  status public.condition_status not null default 'active',
  medication text, guardian_phone text, doctor_notes text, emergency_action text, notes text,
  started_on date default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index student_conditions_student_idx on public.student_conditions(student_id);

-- ============ السجلات الرسمية ============
create table public.official_records (
  id uuid primary key default gen_random_uuid(),
  kind public.record_kind not null,
  disease_name text not null,
  student_id uuid not null references public.students(id) on delete cascade,
  case_date date not null default current_date,
  actions text,
  guardian_phone text,
  created_at timestamptz not null default now()
);

-- وحدة مقيّدة: الموجه الصحي فقط وبعد إعادة إدخال كلمة المرور
create table public.violence_cases (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  case_date date not null default current_date,
  case_type text not null,
  actions text,
  guardian_phone text,
  created_at timestamptz not null default now()
);

-- ============ التحويل والعيادة ============
create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  reason text not null,
  notes text,
  status public.referral_status not null default 'sent',
  sent_on date not null default current_date,
  follow_up_on date,
  outcome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clinic_visits (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  visited_at timestamptz not null default now(),
  complaint text not null,
  action text,
  outcome public.visit_outcome not null default 'returned',
  created_at timestamptz not null default now()
);
create index clinic_visits_at_idx on public.clinic_visits(visited_at);

-- ============ البرامج ومتابعة التنفيذ ============
create table public.programs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'برنامج',
  description text,
  executing_body text,
  supporting_body text,
  target_group text,
  stages text[] not null default '{}',
  semester public.semester not null,
  start_date date not null,
  end_date date,
  is_official boolean not null default true,
  is_unofficial_day boolean not null default false,
  sort int not null default 100,
  -- حالة التنفيذ
  status public.program_status not null default 'planned',
  actual_date date,
  beneficiaries int check (beneficiaries is null or beneficiaries >= 0),
  skip_reason public.skip_reason,
  skip_note text,
  new_date date,
  status_updated_at timestamptz,
  status_updated_by uuid references auth.users(id) on delete set null,
  -- توثيق التنفيذ كما في السجل
  executor text, goal text, doc_start date, doc_end date,
  classes_count int check (classes_count is null or classes_count >= 0),
  partners text, mechanisms text[] not null default '{}', mechanism_other text, doc_notes text,
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  constraint program_done_fields check (
    status <> 'done' or (actual_date is not null and beneficiaries is not null)),
  constraint program_reason_required check (
    status not in ('not_done', 'postponed') or skip_reason is not null),
  constraint program_other_needs_text check (
    skip_reason is distinct from 'other' or length(trim(coalesce(skip_note, ''))) > 0),
  constraint program_postponed_needs_date check (
    status <> 'postponed' or new_date is not null)
);

-- الحالة الفعلية: «متأخر التحديث» لكل برنامج تجاوز تاريخه وحالته «مخطط»
create view public.programs_view with (security_invoker = true) as
  select p.*,
    case when p.status = 'planned' and coalesce(p.end_date, p.start_date) < current_date
         then 'late' else p.status::text end as effective_status
  from public.programs p;

create table public.student_trainings (
  id uuid primary key default gen_random_uuid(),
  program_name text not null, held_on date, beneficiaries int, goal text, executing_body text,
  created_at timestamptz not null default now()
);

-- ============ اللجنة ============
create table public.committee_members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  title text not null default 'عضو',
  profile_id uuid unique references public.profiles(id) on delete set null,
  sort int not null default 100,
  created_at timestamptz not null default now()
);

create table public.committee_meetings (
  id uuid primary key default gen_random_uuid(),
  number int,
  held_on date not null default current_date,
  held_time text, place text,
  attendees int, absentees int,
  items jsonb not null default '[]'::jsonb, -- [{"item": "...", "recommendation": "..."}]
  notes text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

-- answers = {"<key>": {"yes": true|false|null, "note": ""}}
create table public.env_inspections (
  id uuid primary key default gen_random_uuid(),
  inspected_on date not null default current_date,
  semester public.semester not null default 'first',
  answers jsonb not null default '{}'::jsonb,
  notes text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============ الملفات ============
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('program', 'condition')),
  owner_id uuid not null,
  path text not null unique,
  file_name text not null,
  mime text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index attachments_owner_idx on public.attachments(owner_type, owner_id);

create table public.forms_library (
  id uuid primary key default gen_random_uuid(),
  number int not null unique,
  title text not null,
  path text,
  file_name text,
  updated_at timestamptz not null default now()
);

-- قوالب الاستيراد: أسماء الأعمدة وربطها فقط، بلا أي قيم
create table public.import_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null check (kind in ('students', 'committee')),
  mapping jsonb not null, -- {"<عنوان العمود>": "<الحقل>"|"ignore"}
  created_at timestamptz not null default now()
);

create table public.report_approvals (
  id uuid primary key default gen_random_uuid(),
  report_kind text not null,
  period text not null,
  approved_by uuid references auth.users(id) on delete set null default auth.uid(),
  approved_at timestamptz not null default now(),
  unique (report_kind, period)
);

-- ============ سجل التدقيق ============
-- لا يُخزَّن فيه أي محتوى من البيانات: الجدول والعملية ومعرّف الصف وأسماء الأعمدة المعدّلة فقط.
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  user_role public.app_role,
  table_name text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  row_id text,
  changed_columns text[]
);
create index audit_log_at_idx on public.audit_log(at desc);
