// اختبار مخطط قاعدة البيانات على PostgreSQL حقيقي (PGlite) مع محاكاة لطبقة auth في Supabase
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const schema = readFileSync(fileURLToPath(new URL('../../supabase/schema.sql', import.meta.url)), 'utf8');

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated;
`;

const ADMIN = '00000000-0000-4000-8000-000000000001';
const TREAS = '00000000-0000-4000-8000-000000000002';
const MEMBER = '00000000-0000-4000-8000-000000000003';
const STRANGER = '00000000-0000-4000-8000-000000000004';

let db;

async function as(uid, sql, params) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role;');
  }
}
const one = async (uid, sql, params) => (await as(uid, sql, params)).rows[0];
const fails = async (uid, sql, re, params) => {
  await expect(as(uid, sql, params)).rejects.toThrow(re);
};

const month = (offset) => {
  const d = new Date();
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
  return x.toISOString().slice(0, 10);
};

let m1, m2, loanId, repayId;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(schema);
  for (const [id, email] of [[ADMIN, 'a@x.com'], [TREAS, 't@x.com'], [MEMBER, 'm@x.com'], [STRANGER, 's@x.com']]) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
  }
}, 60000);

describe('الحسابات والأدوار', () => {
  it('أول حساب مدير والبقية بانتظار الموافقة', async () => {
    const { rows } = await db.query('select id, role from public.profiles order by email');
    const roles = Object.fromEntries(rows.map((r) => [r.id, r.role]));
    expect(roles[ADMIN]).toBe('admin');
    expect(roles[TREAS]).toBe('pending');
    expect(roles[MEMBER]).toBe('pending');
  });

  it('الحساب المعلّق لا يرى أي بيانات', async () => {
    const r = await as(STRANGER, 'select * from public.members');
    expect(r.rows).toHaveLength(0);
    await fails(STRANGER, 'select public.fund_summary()', /غير مصرّح/);
  });

  it('المعلّق لا يستطيع ترقية نفسه', async () => {
    await as(STRANGER, `update public.profiles set role = 'admin' where id = $1`, [STRANGER]);
    const { rows } = await db.query('select role from public.profiles where id = $1', [STRANGER]);
    expect(rows[0].role).toBe('pending');
  });

  it('المدير يعتمد أمين الصندوق والعضو', async () => {
    await as(ADMIN, `update public.profiles set role = 'treasurer' where id = $1`, [TREAS]);
    await as(ADMIN, `update public.profiles set role = 'member' where id = $1`, [MEMBER]);
    const { rows } = await db.query(`select role from public.profiles where id in ($1, $2) order by role`, [TREAS, MEMBER]);
    expect(rows.map((r) => r.role)).toEqual(['member', 'treasurer']);
  });

  it('لا يمكن إزالة آخر مدير', async () => {
    await fails(ADMIN, `update public.profiles set role = 'member' where id = $1`, /آخر مدير/, [ADMIN]);
  });
});

describe('الإعداد والأعضاء', () => {
  it('المدير يضبط التأسيس والسعر، وأمين الصندوق لا يستطيع', async () => {
    await as(ADMIN, `update public.settings set start_month = $1`, [month(-6)]);
    await as(ADMIN, `insert into public.contribution_rates (effective_from, amount) values ($1, 100)`, [month(-6)]);
    await fails(TREAS, `insert into public.contribution_rates (effective_from, amount) values ($1, 200)`, /row-level security/, [month(0)]);
    await as(TREAS, `update public.settings set fund_name = 'x'`);
    const { rows } = await db.query('select fund_name from public.settings');
    expect(rows[0].fund_name).toBe('صندوق الإخوة');
  });

  it('أمين الصندوق يضيف الأعضاء، والعضو لا يستطيع', async () => {
    m1 = (await one(TREAS, `insert into public.members (name, joined_on) values ('محمد', $1) returning id`, [month(-6)])).id;
    m2 = (await one(TREAS, `insert into public.members (name, joined_on) values ('عبد-الله', $1) returning id`, [month(-6)])).id;
    await fails(MEMBER, `insert into public.members (name) values ('دخيل')`, /row-level security/);
    await fails(TREAS, `insert into public.members (name) values (' محمد ')`, /duplicate key/);
  });

  it('لا يمكن حذف عضو', async () => {
    await db.exec(`select set_config('request.jwt.claim.sub', '${ADMIN}', false)`);
    await expect(db.query('delete from public.members where id = $1', [m1])).rejects.toThrow(/لا تُعدَّل ولا تُحذف/);
  });
});

describe('دفتر القيود', () => {
  it('تسجيل الاشتراكات مع منع تجاوز المستحق', async () => {
    await as(TREAS, `insert into public.entries (kind, member_id, amount, period) values ('contribution', $1, 60, $2)`, [m1, month(-1)]);
    await as(TREAS, `insert into public.entries (kind, member_id, amount, period) values ('contribution', $1, 40, $2)`, [m1, month(-1)]);
    await fails(TREAS, `insert into public.entries (kind, member_id, amount, period) values ('contribution', $1, 1, $2)`, /يتجاوز المستحق/, [m1, month(-1)]);
    await as(TREAS, `insert into public.entries (kind, member_id, amount, period) values ('contribution', $1, 100, $2)`, [m2, month(-1)]);
    await as(TREAS, `insert into public.entries (kind, member_id, amount, period) values ('contribution', $1, 100, $2)`, [m2, month(0)]);
    await fails(TREAS, `insert into public.entries (kind, member_id, amount, period) values ('contribution', $1, 100, $2)`, /قبل تاريخ تأسيس/, [m2, month(-7)]);
    await fails(TREAS, `insert into public.entries (kind, member_id, amount, period) values ('contribution', $1, 100, $2)`, /12 شهراً/, [m2, month(14)]);
    expect(Number((await one(ADMIN, 'select public.fund_balance() b')).b)).toBe(300);
  });

  it('العضو لا يستطيع التسجيل', async () => {
    await fails(MEMBER, `insert into public.entries (kind, member_id, amount, period) values ('contribution', $1, 100, $2)`, /row-level security|غير مصرّح/, [m1, month(0)]);
  });

  it('منع السحب أكبر من الرصيد', async () => {
    await fails(TREAS, `insert into public.entries (kind, member_id, amount) values ('withdrawal', $1, 301)`, /لا يكفي/, [m1]);
    await fails(TREAS, `insert into public.entries (kind, amount, note) values ('expense', 10, null)`, /entries_shape/);
    await as(TREAS, `insert into public.entries (kind, amount, note) values ('expense', 50, 'ضيافة')`);
  });

  it('القروض والسداد والعكس', async () => {
    loanId = (await one(TREAS, `insert into public.entries (kind, member_id, amount, due_on, installments) values ('loan', $1, 200, current_date + 60, 2) returning id`, [m2])).id;
    await fails(TREAS, `insert into public.entries (kind, loan_id, amount) values ('repayment', $1, 201)`, /أكبر من المتبقي/, [loanId]);
    repayId = (await one(TREAS, `insert into public.entries (kind, loan_id, amount) values ('repayment', $1, 150) returning id, member_id`, [loanId])).id;
    const rep = await db.query('select member_id from public.entries where id = $1', [repayId]);
    expect(rep.rows[0].member_id).toBe(m2);
    expect(Number((await one(ADMIN, 'select public.loan_outstanding($1) o', [loanId])).o)).toBe(50);
    await fails(TREAS, `insert into public.entries (kind, reverses, note) values ('reversal', $1, 'خطأ')`, /اعكس سدادات/, [loanId]);
    await fails(TREAS, `insert into public.entries (kind, reverses, note) values ('reversal', $1, '')`, /entries_shape/, [repayId]);
    await as(TREAS, `insert into public.entries (kind, reverses, note, amount) values ('reversal', $1, 'تسجيل خاطئ', 1)`, [repayId]);
    await fails(TREAS, `insert into public.entries (kind, reverses, note) values ('reversal', $1, 'مرة ثانية')`, /معكوس مسبقاً/, [repayId]);
    const rev = await db.query(`select amount from public.entries where reverses = $1`, [repayId]);
    expect(Number(rev.rows[0].amount)).toBe(150);
    // 300 − 50 مصروف − 200 قرض = 50
    expect(Number((await one(ADMIN, 'select public.fund_balance() b')).b)).toBe(50);
  });

  it('القيود لا تُعدَّل ولا تُحذف حتى من المالك', async () => {
    await db.exec('reset role');
    await expect(db.query('update public.entries set amount = 1')).rejects.toThrow(/لا تُعدَّل/);
    await expect(db.query('delete from public.entries')).rejects.toThrow(/لا تُعدَّل/);
  });

  it('الأرشفة تمنع قيوداً جديدة للعضو', async () => {
    await as(TREAS, `update public.members set archived = true where id = $1`, [m1]);
    await fails(TREAS, `insert into public.entries (kind, member_id, amount, period) values ('contribution', $1, 100, $2)`, /مؤرشف/, [m1, month(0)]);
    await as(TREAS, `update public.members set archived = false where id = $1`, [m1]);
  });
});

describe('الأسعار والإقفال', () => {
  it('لا تغيير لسعر بأثر رجعي على أشهر مدفوعة', async () => {
    await fails(ADMIN, `insert into public.contribution_rates (effective_from, amount) values ($1, 150)`, /توجد دفعات/, [month(-2)]);
    await as(ADMIN, `insert into public.contribution_rates (effective_from, amount) values ($1, 150)`, [month(1)]);
    await fails(ADMIN, `delete from public.contribution_rates where effective_from = $1`, /لا يمكن حذف/, [month(-6)]);
  });

  it('إقفال الشهر يمنع التسجيل بتاريخه', async () => {
    await fails(TREAS, `insert into public.month_closures (period) values ($1)`, /الشهر الحالي/, [month(0)]);
    await as(TREAS, `insert into public.month_closures (period) values ($1)`, [month(-1)]);
    await fails(TREAS, `insert into public.entries (kind, amount, note, entry_date) values ('expense', 5, 'قديم', $1)`, /مقفل/, [month(-1)]);
    await as(TREAS, `delete from public.month_closures where period = $1`, [month(-1)]);
    const still = await db.query('select count(*)::int c from public.month_closures');
    expect(still.rows[0].c).toBe(1);
  });
});

describe('رؤية العضو والتدقيق', () => {
  it('العضو يرى الملخص ويرى كل القيود افتراضياً', async () => {
    const s = (await one(MEMBER, 'select public.fund_summary() s')).s;
    expect(Number(s.balance)).toBe(50);
    expect(Number(s.loans_outstanding)).toBe(200);
    const all = await as(MEMBER, 'select count(*)::int c from public.entries');
    expect(all.rows[0].c).toBeGreaterThan(5);
  });

  it('عند تقييد الرؤية يرى العضو قيوده والمصروفات فقط', async () => {
    await as(ADMIN, `update public.profiles set member_id = $1 where id = $2`, [m1, MEMBER]);
    await as(ADMIN, 'update public.settings set members_see_all = false');
    const { rows } = await as(MEMBER, 'select distinct member_id from public.entries');
    const ids = rows.map((r) => r.member_id);
    expect(ids).not.toContain(m2);
    expect(ids).toContain(m1);
    await as(ADMIN, 'update public.settings set members_see_all = true');
  });

  it('سجل التدقيق يسجّل كل شيء ولا يراه إلا الإدارة', async () => {
    const staff = await as(TREAS, 'select count(*)::int c from public.audit_log');
    expect(staff.rows[0].c).toBeGreaterThan(10);
    const mem = await as(MEMBER, 'select count(*)::int c from public.audit_log');
    expect(mem.rows[0].c).toBe(0);
    await fails(TREAS, `insert into public.audit_log (action, table_name) values ('x', 'y')`, /row-level security/);
  });
});

describe('الاستيراد', () => {
  it('يرفض الاستيراد على قاعدة غير فارغة', async () => {
    await fails(ADMIN, `select public.import_data('{}'::jsonb)`, /قاعدة فارغة/);
  });

  it('ينجح على قاعدة فارغة ويحافظ على صحة الرصيد', async () => {
    const fresh = new PGlite();
    await fresh.exec(SUPABASE_STUB);
    await fresh.exec(schema);
    await fresh.query('insert into auth.users (id, email) values ($1, $2)', [ADMIN, 'a@x.com']);
    const mA = '11111111-1111-4111-8111-111111111111';
    const loan = '22222222-2222-4222-8222-222222222222';
    const payload = {
      settings: { fund_name: 'صندوق الإخوة', start_month: month(-3) },
      rates: [{ effective_from: month(-3), amount: 100 }],
      members: [{ id: mA, name: 'سعد', joined_on: month(-3) }],
      entries: [
        { id: '33333333-3333-4333-8333-333333333331', kind: 'contribution', member_id: mA, amount: 100, entry_date: month(-3), period: month(-3) },
        { id: '33333333-3333-4333-8333-333333333332', kind: 'contribution', member_id: mA, amount: 100, entry_date: month(-2), period: month(-2) },
        { id: loan, kind: 'loan', member_id: mA, amount: 150, entry_date: month(-2) },
        { id: '33333333-3333-4333-8333-333333333333', kind: 'repayment', member_id: mA, loan_id: loan, amount: 50, entry_date: month(-2) },
      ],
      closures: [{ period: month(-3) }],
    };
    await fresh.exec(`select set_config('request.jwt.claim.sub', '${ADMIN}', false); set role authenticated;`);
    // سعر مضبوط مسبقاً بنفس الشهر لا يعطّل الاستيراد
    await fresh.query(`insert into public.contribution_rates (effective_from, amount) values ($1, 50)`, [month(-3)]);
    const res = await fresh.query('select public.import_data($1::jsonb) r', [JSON.stringify(payload)]);
    const rate = await fresh.query('select amount::float8 a from public.contribution_rates');
    expect(rate.rows).toEqual([{ a: 100 }]);
    expect(Number(res.rows[0].r.balance)).toBe(100);
    await expect(fresh.query('select public.import_data($1::jsonb)', ['{}'])).rejects.toThrow(/قاعدة فارغة/);
    // بعد الاستيراد يعود الإقفال فعّالاً
    await expect(
      fresh.query(`insert into public.entries (kind, amount, note, entry_date) values ('expense', 5, 'قديم', $1)`, [month(-3)]),
    ).rejects.toThrow(/مقفل/);
  });

  it('يتراجع بالكامل إذا فشل أي قيد', async () => {
    const fresh = new PGlite();
    await fresh.exec(SUPABASE_STUB);
    await fresh.exec(schema);
    await fresh.query('insert into auth.users (id, email) values ($1, $2)', [ADMIN, 'a@x.com']);
    const mA = '11111111-1111-4111-8111-111111111111';
    const payload = {
      settings: { start_month: month(-3) },
      rates: [{ effective_from: month(-3), amount: 100 }],
      members: [{ id: mA, name: 'سعد', joined_on: month(-3) }],
      entries: [{ id: '33333333-3333-4333-8333-333333333339', kind: 'withdrawal', member_id: mA, amount: 999, entry_date: month(-1) }],
    };
    await fresh.exec(`select set_config('request.jwt.claim.sub', '${ADMIN}', false); set role authenticated;`);
    await expect(fresh.query('select public.import_data($1::jsonb)', [JSON.stringify(payload)])).rejects.toThrow(/لا يكفي/);
    const { rows } = await fresh.query('select count(*)::int c from public.members');
    expect(rows[0].c).toBe(0);
  });
});
