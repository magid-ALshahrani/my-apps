// سياسات المخزن والمرفقات والاعتماد وتوثيق البرامج.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resetData, makeUser, signedIn, anonClient, pool } from './helpers';

let guide: SupabaseClient, principal: SupabaseClient, nurse: SupabaseClient, member: SupabaseClient;
let programId = '', conditionId = '', meetingId = '';
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

beforeAll(async () => {
  await resetData();
  const [g, p, n, m] = await Promise.all([makeUser('health_guide'), makeUser('principal'), makeUser('nurse'), makeUser('committee_member')]);
  [guide, principal, nurse, member] = await Promise.all([signedIn(g.email), signedIn(p.email), signedIn(n.email), signedIn(m.email)]);
  programId = (await guide.from('programs').select('id').eq('name', 'التوعية بالحساسية').single()).data!.id;
  const { data: st } = await guide.from('students').insert({ full_name: 'طالب', name_key: 'طالب' }).select().single();
  const { data: t } = await guide.from('condition_types').select('id').limit(1).single();
  conditionId = (await guide.from('student_conditions').insert({ student_id: st!.id, type_id: t!.id }).select().single()).data!.id;
  meetingId = (await guide.from('committee_meetings').insert({ number: 1, items: [{ item: 'بند', recommendation: 'توصية' }] }).select().single()).data!.id;
});
afterAll(async () => { await pool.end(); });

const up = (c: SupabaseClient, path: string, type = 'image/png') => c.storage.from('files').upload(path, png, { contentType: type });

describe('مخزن الملفات الخاص', () => {
  it('عضو اللجنة يرفع شواهد البرامج ولا يرفع لحالات الطلاب', async () => {
    expect((await up(member, `program/${programId}/a.png`)).error).toBeNull();
    expect((await up(member, `condition/${conditionId}/a.png`)).error).not.toBeNull();
  });
  it('الممرض يرفع لحالات الطلاب ولا يرفع للبرامج', async () => {
    expect((await up(nurse, `condition/${conditionId}/b.png`)).error).toBeNull();
    expect((await up(nurse, `program/${programId}/b.png`)).error).not.toBeNull();
  });
  it('المدير لا يرفع شيئًا', async () => {
    expect((await up(principal, `program/${programId}/c.png`)).error).not.toBeNull();
  });
  it('عضو اللجنة لا يحصل على رابط لملفات الحالات، والمدير يحصل', async () => {
    expect((await member.storage.from('files').createSignedUrl(`condition/${conditionId}/b.png`, 60)).data).toBeNull();
    const r = await principal.storage.from('files').createSignedUrl(`condition/${conditionId}/b.png`, 60);
    expect(r.data?.signedUrl).toBeTruthy();
    const res = await fetch(r.data!.signedUrl);
    expect(res.status).toBe(200);
  });
  it('الرابط الموقّع مؤقت وغير المصادق لا يصل', async () => {
    const r = await guide.storage.from('files').createSignedUrl(`program/${programId}/a.png`, 1);
    await new Promise((x) => setTimeout(x, 2100));
    expect((await fetch(r.data!.signedUrl)).status).not.toBe(200);
    expect((await anonClient().storage.from('files').createSignedUrl(`program/${programId}/a.png`, 60)).data).toBeNull();
  });
  it('نوع غير مسموح يُرفض من المخزن', async () => {
    expect((await up(guide, `program/${programId}/x.exe`, 'application/x-msdownload')).error).not.toBeNull();
  });
  it('الحذف من المخزن للموجه فقط', async () => {
    const del = await member.storage.from('files').remove([`program/${programId}/a.png`]);
    expect(del.data ?? []).toHaveLength(0);
    const ok = await guide.storage.from('files').remove([`program/${programId}/a.png`]);
    expect(ok.data).toHaveLength(1);
  });
});

describe('جدول المرفقات', () => {
  it('عضو اللجنة يسجّل شاهد برنامج ولا يرى مرفقات الحالات', async () => {
    expect((await member.from('attachments').insert({ owner_type: 'program', owner_id: programId, path: `program/${programId}/z.png`, file_name: 'z.png', mime: 'image/png', size_bytes: 12 })).error).toBeNull();
    expect((await nurse.from('attachments').insert({ owner_type: 'condition', owner_id: conditionId, path: `condition/${conditionId}/z.png`, file_name: 'z.png', mime: 'image/png', size_bytes: 12 })).error).toBeNull();
    expect((await member.from('attachments').select('owner_type')).data!.every((a) => a.owner_type === 'program')).toBe(true);
    expect((await nurse.from('attachments').insert({ owner_type: 'program', owner_id: programId, path: 'program/q.png', file_name: 'q', mime: 'image/png', size_bytes: 1 })).error).not.toBeNull();
  });
});

describe('الاعتماد والتوثيق', () => {
  it('المدير وحده يعتمد المحاضر', async () => {
    expect((await guide.rpc('approve_record', { p_table: 'committee_meetings', p_id: meetingId })).error).not.toBeNull();
    expect((await principal.rpc('approve_record', { p_table: 'committee_meetings', p_id: meetingId })).error).toBeNull();
    expect((await principal.from('committee_meetings').select('approved_at').eq('id', meetingId).single()).data!.approved_at).not.toBeNull();
    // المدير لا يعدّل المحضر نفسه
    const { data } = await principal.from('committee_meetings').update({ notes: 'x' }).eq('id', meetingId).select();
    expect(data ?? []).toHaveLength(0);
  });
  it('التوثيق وحده لا يمس حالة التنفيذ', async () => {
    expect((await member.rpc('update_program_execution', { p_id: programId, p: { status: 'not_done', skip_reason: 'weather' } })).error).toBeNull();
    expect((await member.rpc('update_program_execution', { p_id: programId, p: { executor: 'المنفذ', mechanisms: ['محاضرة'], classes_count: 4 } })).error).toBeNull();
    const { data } = await guide.from('programs').select('status,skip_reason,executor,mechanisms,classes_count').eq('id', programId).single();
    expect(data).toEqual({ status: 'not_done', skip_reason: 'weather', executor: 'المنفذ', mechanisms: ['محاضرة'], classes_count: 4 });
  });
  it('الممرض والمدير لا يحدّثان التنفيذ', async () => {
    expect((await nurse.rpc('update_program_execution', { p_id: programId, p: { status: 'planned' } })).error).not.toBeNull();
    expect((await principal.rpc('update_program_execution', { p_id: programId, p: { status: 'planned' } })).error).not.toBeNull();
  });
  it('عضو اللجنة لا يرى المحاضر ولا التفقد ولا بيانات الموجه', async () => {
    for (const t of ['committee_meetings', 'env_inspections', 'guide_info', 'clinic_info', 'health_center']) {
      expect((await member.from(t).select('*')).data ?? [], t).toHaveLength(0);
    }
  });
  it('الممرض يكتب بيانات العيادة ولا يكتب بيانات المركز', async () => {
    expect((await nurse.from('clinic_info').update({ nurse_name: 'هند' }).eq('id', 1).select()).data).toHaveLength(1);
    expect((await nurse.from('health_center').update({ name: 'x' }).eq('id', 1).select()).data ?? []).toHaveLength(0);
  });
});
