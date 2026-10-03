// اختبار RLS لكل دور على الجداول الرئيسية، عبر PostgREST وGoTrue الحقيقيين.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resetData, makeUser, signedIn, anonClient, staleClient, service, pool, MAIN_TABLES, URL, ANON } from './helpers';

let guide: SupabaseClient, principal: SupabaseClient, nurse: SupabaseClient, member: SupabaseClient;
let guideId = '';
let studentId = '', conditionId = '', programId = '';

beforeAll(async () => {
  await resetData();
  const g = await makeUser('health_guide');
  guideId = g.id;
  const [p, n, m] = await Promise.all([makeUser('principal'), makeUser('nurse'), makeUser('committee_member')]);
  [guide, principal, nurse, member] = await Promise.all([signedIn(g.email), signedIn(p.email), signedIn(n.email), signedIn(m.email)]);
  // بيانات أساسية بصلاحيات الموجه
  const { data: st } = await guide.from('stages').insert({ name: 'ابتدائي', gender: 'boys' }).select().single();
  const { data: gr } = await guide.from('grades').insert({ stage_id: st!.id, name: 'الأول' }).select().single();
  const { data: se } = await guide.from('sections').insert({ grade_id: gr!.id, name: '1' }).select().single();
  const { data: s, error } = await guide.from('students').insert({ full_name: 'طالب تجريبي', name_key: 'طالب تجريبي', section_id: se!.id }).select().single();
  if (error) throw error;
  studentId = s!.id;
  const { data: t } = await guide.from('condition_types').select('id').eq('name', 'سكري').single();
  const { data: c } = await guide.from('student_conditions').insert({ student_id: studentId, type_id: t!.id, medication: 'أنسولين' }).select().single();
  conditionId = c!.id;
  await guide.from('official_records').insert({ kind: 'chronic', disease_name: 'سكري', student_id: studentId });
  const { error: ve } = await guide.from('violence_cases').insert({ student_id: studentId, case_type: 'إهمال' });
  if (ve) throw ve;
  const { data: prog } = await guide.from('programs').select('id').eq('name', 'اليوم العالمي للسكري').single();
  programId = prog!.id;
});
afterAll(async () => { await pool.end(); });

describe('غير المصادَق', () => {
  it('لا يُرجع أي صف من أي جدول', async () => {
    const anon = anonClient();
    for (const t of MAIN_TABLES) {
      const { data } = await anon.from(t).select('*').limit(5);
      expect(data ?? [], t).toHaveLength(0);
    }
    const { error } = await anon.rpc('dashboard_stats');
    expect(error).not.toBeNull();
  });
});

describe('عضو اللجنة', () => {
  it('لا يقرأ جداول الطلاب ولا الحالات ولا السجلات الرسمية', async () => {
    for (const t of ['students', 'student_conditions', 'official_records', 'violence_cases', 'clinic_visits', 'referrals', 'sections']) {
      const { data } = await member.from(t).select('*');
      expect(data ?? [], t).toHaveLength(0);
    }
  });
  it('يقرأ البرامج ويحدّث حالة التنفيذ ويرى أعدادًا مجمّعة فقط', async () => {
    const { data } = await member.from('programs').select('id');
    expect(data!.length).toBeGreaterThan(20);
    const { error } = await member.rpc('update_program_execution', { p_id: programId, p: { status: 'done', actual_date: '2026-11-14', beneficiaries: 120 } });
    expect(error).toBeNull();
    const { data: stats, error: se } = await member.rpc('dashboard_stats');
    expect(se).toBeNull();
    expect(stats.students_total).toBe(1);
    expect(JSON.stringify(stats)).not.toContain('طالب تجريبي');
  });
  it('لا يعدّل البرامج مباشرة ولا يحذف', async () => {
    const { data } = await member.from('programs').update({ name: 'x' }).eq('id', programId).select();
    expect(data ?? []).toHaveLength(0);
    const { data: d } = await member.from('programs').delete().eq('id', programId).select();
    expect(d ?? []).toHaveLength(0);
  });
});

describe('الممرض', () => {
  it('يقرأ الطلاب ويكتب الحالات والزيارات', async () => {
    expect((await nurse.from('students').select('id')).data).toHaveLength(1);
    const { error } = await nurse.from('clinic_visits').insert({ student_id: studentId, complaint: 'صداع' });
    expect(error).toBeNull();
    const { data } = await nurse.from('student_conditions').update({ doctor_notes: 'متابعة' }).eq('id', conditionId).select();
    expect(data).toHaveLength(1);
  });
  it('لا يقرأ سجل العنف الأسري ولا يكتب فيه', async () => {
    expect((await nurse.from('violence_cases').select('*')).data).toHaveLength(0);
    const { error } = await nurse.from('violence_cases').insert({ student_id: studentId, case_type: 'x' });
    expect(error).not.toBeNull();
  });
  it('لا يحذف ولا يضيف طلابًا', async () => {
    const { data } = await nurse.from('student_conditions').delete().eq('id', conditionId).select();
    expect(data ?? []).toHaveLength(0);
    const { error } = await nurse.from('students').insert({ full_name: 'س', name_key: 'س' });
    expect(error).not.toBeNull();
  });
  it('لا يدير المستخدمين (Edge Function ترفض)', async () => {
    const { data, error } = await nurse.functions.invoke('admin-users', { body: { action: 'list' } });
    expect(data).toBeNull();
    expect((error as { context?: Response }).context?.status).toBe(403);
    expect((await nurse.from('profiles').select('*')).data).toHaveLength(1); // ملفه فقط
  });
});

describe('المدير', () => {
  it('يقرأ الطلاب والحالات لكنه لا يعدّلها', async () => {
    expect((await principal.from('student_conditions').select('id')).data).toHaveLength(1);
    const { data } = await principal.from('student_conditions').update({ medication: 'x' }).eq('id', conditionId).select();
    expect(data ?? []).toHaveLength(0);
    const { error } = await principal.from('student_conditions').insert({ student_id: studentId, type_id: (await principal.from('condition_types').select('id').limit(1).single()).data!.id });
    expect(error).not.toBeNull();
    const { data: row } = await service.from('student_conditions').select('medication').eq('id', conditionId).single();
    expect(row!.medication).toBe('أنسولين');
  });
  it('لا يقرأ سجل العنف الأسري', async () => {
    expect((await principal.from('violence_cases').select('*')).data).toHaveLength(0);
  });
  it('يعتمد التقارير، ولا يحذف', async () => {
    const { error } = await principal.from('report_approvals').insert({ report_kind: 'semester', period: '1448-1' });
    expect(error).toBeNull();
    const { data } = await principal.from('students').delete().eq('id', studentId).select();
    expect(data ?? []).toHaveLength(0);
  });
});

describe('الموجه الصحي', () => {
  it('يقرأ سجل العنف بعد إدخال كلمة المرور حديثًا، ولا يقرؤه بجلسة قديمة', async () => {
    expect((await guide.from('violence_cases').select('*')).data).toHaveLength(1);
    expect((await staleClient(guideId).from('violence_cases').select('*')).data ?? []).toHaveLength(0);
    // ولا يحذف منه بجلسة قديمة
    const { data } = await staleClient(guideId).from('violence_cases').delete().neq('id', '00000000-0000-0000-0000-000000000000').select();
    expect(data ?? []).toHaveLength(0);
  });
  it('هو الوحيد الذي يستدعي Edge Function لإدارة المستخدمين', async () => {
    const { data, error } = await guide.functions.invoke('admin-users', { body: { action: 'list' } });
    expect(error).toBeNull();
    expect(data.users.length).toBe(4);
    for (const c of [principal, member]) {
      const r = await c.functions.invoke('admin-users', { body: { action: 'list' } });
      expect((r.error as { context?: Response }).context?.status).toBe(403);
    }
    const noAuth = await fetch(`${URL}/functions/v1/admin-users`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: '{"action":"list"}' });
    expect(noAuth.status).toBe(401);
  });
  it('دعوة مستخدم: كلمة مرور مؤقتة وإلزام التغيير، وعضو اللجنة يُسجَّل في سجل اللجنة', async () => {
    const { data, error } = await guide.functions.invoke('admin-users', { body: { action: 'create', email: 'new-member@example.test', full_name: 'عضو جديد', role: 'committee_member', title: 'مقرر' } });
    expect(error).toBeNull();
    expect(data.temporary_password).toHaveLength(14);
    const { data: prof } = await service.from('profiles').select('must_change_password, role').eq('id', data.user_id).single();
    expect(prof).toEqual({ must_change_password: true, role: 'committee_member' });
    const { data: cm } = await service.from('committee_members').select('title').eq('profile_id', data.user_id).single();
    expect(cm!.title).toBe('مقرر');
    // قبل تغيير كلمة المرور: لا يرى شيئًا
    const fresh = (await import('@supabase/supabase-js')).createClient(URL, ANON, { auth: { persistSession: false } });
    await fresh.auth.signInWithPassword({ email: 'new-member@example.test', password: data.temporary_password });
    expect((await fresh.from('programs').select('id')).data).toHaveLength(0);
    // تغيير كلمة المرور يرفع الإلزام تلقائيًا
    const short = await fresh.auth.updateUser({ password: 'short' });
    expect(short.error).not.toBeNull();
    await fresh.auth.updateUser({ password: 'A-New-Strong-Pass-1' });
    expect((await service.from('profiles').select('must_change_password').eq('id', data.user_id).single()).data!.must_change_password).toBe(false);
    expect((await fresh.from('programs').select('id')).data!.length).toBeGreaterThan(0);
  });
  it('تعطيل حساب يمنع الوصول', async () => {
    const victim = await makeUser('nurse');
    const c = await signedIn(victim.email);
    const { error } = await guide.functions.invoke('admin-users', { body: { action: 'set_active', user_id: victim.id, active: false } });
    expect(error).toBeNull();
    expect((await c.from('students').select('id')).data ?? []).toHaveLength(0);
  });
  it('هو الوحيد الذي يحذف', async () => {
    const { data: v } = await guide.from('clinic_visits').select('id').limit(1).single();
    const { data } = await guide.from('clinic_visits').delete().eq('id', v!.id).select();
    expect(data).toHaveLength(1);
  });
});

describe('سجل التدقيق', () => {
  it('يسجّل المستخدم ودوره والوقت لكل إضافة وتعديل وحذف، بلا محتوى', async () => {
    const { rows } = await pool.query(`select user_role, table_name, action from audit_log where user_id is not null`);
    const acts = new Set(rows.map((r) => `${r.table_name}:${r.action}:${r.user_role}`));
    expect(acts.has('students:INSERT:health_guide')).toBe(true);
    expect(acts.has('student_conditions:UPDATE:nurse')).toBe(true);
    expect(acts.has('clinic_visits:DELETE:health_guide')).toBe(true);
    expect(acts.has('programs:UPDATE:committee_member')).toBe(true);
    const { rows: all } = await pool.query(`select row_to_json(a)::text j from audit_log a`);
    expect(all.map((r) => r.j).join()).not.toContain('أنسولين');
    // لا يقرؤه إلا الموجه
    expect((await nurse.from('audit_log').select('*')).data).toHaveLength(0);
    expect((await guide.from('audit_log').select('id')).data!.length).toBeGreaterThan(0);
  });
});

describe('متابعة تنفيذ البرامج', () => {
  it('«لم يُنفذ» أو «مؤجل» بلا سبب تُرفض من قاعدة البيانات', async () => {
    const r1 = await guide.rpc('update_program_execution', { p_id: programId, p: { status: 'not_done' } });
    expect(r1.error?.message).toMatch(/program_reason_required/);
    const r2 = await guide.rpc('update_program_execution', { p_id: programId, p: { status: 'postponed', skip_reason: 'weather' } });
    expect(r2.error?.message).toMatch(/program_postponed_needs_date/);
    const r3 = await guide.rpc('update_program_execution', { p_id: programId, p: { status: 'not_done', skip_reason: 'other', skip_note: '  ' } });
    expect(r3.error?.message).toMatch(/program_other_needs_text/);
    const r4 = await guide.from('programs').update({ status: 'not_done' }).eq('id', programId);
    expect(r4.error?.message).toMatch(/program_reason_required/);
    const ok = await guide.rpc('update_program_execution', { p_id: programId, p: { status: 'postponed', skip_reason: 'exams', new_date: '2026-12-01' } });
    expect(ok.error).toBeNull();
  });
  it('البرنامج المتجاوز تاريخه بحالة «مخطط» يظهر «متأخر التحديث»', async () => {
    const { data } = await guide.from('programs_view').select('name,effective_status').eq('name', 'اليوم الدولي لنقاوة الهواء').single();
    expect(data!.effective_status).toBe('late'); // 7 سبتمبر 2026 مضى
    const { data: future } = await guide.from('programs_view').select('effective_status').eq('name', 'الأسبوع العالمي للتحصينات').single();
    expect(future!.effective_status).toBe('planned');
  });
});
