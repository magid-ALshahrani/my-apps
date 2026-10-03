// أدوات اختبارات قاعدة البيانات على البيئة المحلية (npm run stack).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';

export const URL = 'http://localhost:54321';
const keys = JSON.parse(fs.readFileSync('/var/tmp/hr-stack/keys.json', 'utf8')) as { anon: string; service: string };
export const ANON = keys.anon;
export const SERVICE = keys.service;
const SECRET = 'local-test-secret-not-for-production-0123456789';

export const pool = new pg.Pool({ connectionString: 'postgres://postgres@127.0.0.1:54322/postgres' });
export const service = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
export const anonClient = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

export type Role = 'health_guide' | 'principal' | 'nurse' | 'committee_member';
export const PASSWORD = 'Local-Test-Pass-123';

export async function resetData() {
  await pool.query(`delete from auth.users`);
  await pool.query(`truncate public.students, public.stages, public.committee_members, public.committee_meetings,
    public.env_inspections, public.attachments, public.import_templates, public.report_approvals, public.audit_log,
    public.clinic_visits, public.referrals, public.official_records, public.violence_cases, public.student_trainings cascade`);
  await pool.query(`delete from storage.objects`);
  await pool.query(`update public.programs set status='planned', actual_date=null, beneficiaries=null, skip_reason=null, skip_note=null, new_date=null`);
}

export async function makeUser(role: Role, opts: { mustChange?: boolean; email?: string } = {}) {
  const email = opts.email ?? `${role}-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  const id = data.user!.id;
  const { error: e2 } = await service.from('profiles').insert({ id, email, full_name: `مستخدم ${role}`, role, active: true, must_change_password: opts.mustChange ?? false });
  if (e2) throw e2;
  return { id, email };
}

export async function signedIn(email: string): Promise<SupabaseClient> {
  const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return c;
}

/** عميل بجلسة قديمة: amr بكلمة مرور قبل ساعة (لاختبار إعادة إدخال كلمة المرور) */
export function staleClient(userId: string): SupabaseClient {
  const now = Math.floor(Date.now() / 1000);
  const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b64u({ alg: 'HS256', typ: 'JWT' });
  const p = b64u({ sub: userId, role: 'authenticated', aud: 'authenticated', exp: now + 600, iat: now - 3600, amr: [{ method: 'password', timestamp: now - 3600 }] });
  const s = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  return createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${h}.${p}.${s}` } }, auth: { persistSession: false, autoRefreshToken: false } });
}

export const MAIN_TABLES = [
  'profiles', 'students', 'stages', 'grades', 'sections', 'condition_types', 'student_conditions', 'official_records',
  'violence_cases', 'referrals', 'clinic_visits', 'programs', 'committee_members', 'committee_meetings', 'env_inspections',
  'attachments', 'audit_log', 'school_info', 'clinic_info', 'health_center', 'guide_info', 'import_templates',
];
