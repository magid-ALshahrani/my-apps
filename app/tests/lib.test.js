import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addMonths, addMonthsToDate, monthRange, currentMonth, todayISO } from '../src/lib/dates.js';
import {
  indexEntries, summarize, rateFor, memberStats, loansView, installmentSchedule, balanceSeries, monthReport, unpaidFor,
} from '../src/lib/ledger.js';
import { convertLegacy } from '../src/lib/legacy.js';
import { validateDataset, toImportPayload, buildBackup } from '../src/lib/dataset.js';
import { encryptJSON, decryptJSON } from '../src/lib/crypto.js';
import { waPhone, statementText } from '../src/lib/text.js';

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

describe('التواريخ', () => {
  it('جمع الأشهر عبر السنوات', () => {
    expect(addMonths('2025-11-01', 3)).toBe('2026-02-01');
    expect(addMonths('2025-01-01', -1)).toBe('2024-12-01');
    expect(monthRange('2025-11-01', '2026-01-01')).toEqual(['2025-11-01', '2025-12-01', '2026-01-01']);
    expect(addMonthsToDate('2026-03-31', -1)).toBe('2026-02-28');
  });
});

describe('الحسابات', () => {
  const settings = { start_month: '2026-01-01', fund_name: 'ص' };
  const rates = [{ effective_from: '2026-01-01', amount: 100 }, { effective_from: '2026-04-01', amount: 150 }];
  const A = { id: 'a', name: 'محمد', joined_on: '2026-01-01', archived: false };
  const B = { id: 'b', name: 'سعد', joined_on: '2026-03-01', archived: false };
  const entries = [
    { id: '1', kind: 'contribution', member_id: 'a', amount: 100, period: '2026-01-01', entry_date: '2026-01-05' },
    { id: '2', kind: 'contribution', member_id: 'a', amount: 100, period: '2026-02-01', entry_date: '2026-02-05' },
    { id: '3', kind: 'contribution', member_id: 'a', amount: 50, period: '2026-04-01', entry_date: '2026-04-05' },
    { id: '4', kind: 'contribution', member_id: 'b', amount: 100, period: '2026-03-01', entry_date: '2026-03-05' },
    { id: '5', kind: 'expense', amount: 30, entry_date: '2026-03-10', note: 'ضيافة' },
    { id: '6', kind: 'loan', member_id: 'b', amount: 200, entry_date: '2026-03-15', due_on: '2026-05-15', installments: 2 },
    { id: '7', kind: 'repayment', member_id: 'b', loan_id: '6', amount: 50, entry_date: '2026-04-15' },
    { id: '8', kind: 'repayment', member_id: 'b', loan_id: '6', amount: 25, entry_date: '2026-04-16' },
    { id: '9', kind: 'reversal', reverses: '8', member_id: 'b', amount: 25, entry_date: '2026-04-17', note: 'تكرار' },
  ];
  const { live } = indexEntries(entries);

  it('الرصيد يستبعد المعكوس', () => {
    const s = summarize(live);
    expect(s.collected).toBe(350);
    expect(s.repaid).toBe(50);
    expect(s.loans_outstanding).toBe(150);
    expect(s.balance).toBe(350 - 30 - 200 + 50);
  });

  it('السعر حسب تاريخ السريان', () => {
    expect(rateFor(rates, '2026-03-01')).toBe(100);
    expect(rateFor(rates, '2026-04-01')).toBe(150);
    expect(rateFor(rates, '2025-12-01')).toBeNull();
  });

  it('الالتزام يُحسب على الأشهر المستحقة فقط', () => {
    const a = memberStats({ member: A, live, settings, rates, curMonth: '2026-04-01' });
    expect(a.dueMonths).toBe(4);
    expect(a.fullMonths).toBe(2);
    expect(a.arrears).toBe(100 + 100); // مارس كامل + باقي أبريل
    expect(a.commitment).toBe(50);
    const b = memberStats({ member: B, live, settings, rates, curMonth: '2026-04-01' });
    expect(b.dueMonths).toBe(2);
    expect(b.loansOut).toBe(150);
    expect(b.net).toBe(100 - 150);
  });

  it('العضو المؤرشف لا تُحسب عليه أشهر بعد أرشفته', () => {
    const arch = { ...A, archived: true, archived_at: '2026-02-20T10:00:00Z' };
    expect(memberStats({ member: arch, live, settings, rates, curMonth: '2026-06-01' }).dueMonths).toBe(2);
  });

  it('جدول الأقساط والتأخر', () => {
    expect(installmentSchedule({ amount: 100, due_on: '2026-05-15', installments: 3 })).toEqual([
      { date: '2026-03-15', amount: 33.33, cumulative: 33.33 },
      { date: '2026-04-15', amount: 33.33, cumulative: 66.66 },
      { date: '2026-05-15', amount: 33.34, cumulative: 100 },
    ]);
    const [l] = loansView(entries, '2026-04-20');
    expect(l.repaid).toBe(50);
    expect(l.status).toBe('overdue');
    expect(l.overdueAmount).toBe(50);
    expect(loansView(entries, '2026-04-10')[0].status).toBe('active');
  });

  it('تقرير الشهر وتطور الرصيد متسقان', () => {
    const r = monthReport(entries, '2026-04-01');
    expect(r.opening).toBe(100 + 100 + 100 - 30 - 200);
    expect(r.inflow).toBe(100);
    expect(r.closing).toBe(summarize(live).balance);
    const series = balanceSeries(live, '2026-01-01', '2026-04-01');
    expect(series.at(-1).balance).toBe(summarize(live).balance);
  });

  it('قائمة غير الدافعين', () => {
    const u = unpaidFor({ members: [A, B], live, rates, settings, period: '2026-04-01' });
    expect(u.map((x) => [x.member.name, x.remaining])).toEqual([['محمد', 100], ['سعد', 150]]);
  });

  it('نص كشف الحساب', () => {
    const stats = memberStats({ member: A, live, settings, rates, curMonth: '2026-04-01' });
    expect(statementText({ fundName: 'ص', member: A, stats, today: '2026-04-20' })).toContain('المتأخرات');
  });
});

describe('واتساب', () => {
  it('تحويل الأرقام السعودية', () => {
    expect(waPhone('0551234567')).toBe('966551234567');
    expect(waPhone('+966 55 123 4567')).toBe('966551234567');
  });
});

const cm = currentMonth();
const OLD = {
  members: ['محمد', 'عبد-الله', 'ماجد'],
  payments: {
    [`محمد-${addMonths(cm, -2).slice(0, 7)}`]: true,
    [`محمد-${addMonths(cm, -1).slice(0, 7)}`]: true,
    [`عبد-الله-${addMonths(cm, -1).slice(0, 7)}`]: true,
    [`ماجد-${addMonths(cm, -1).slice(0, 7)}`]: false,
    [`علي-${addMonths(cm, -2).slice(0, 7)}`]: true, // عضو محذوف في النسخة القديمة
  },
  transactions: [
    { id: 1, member: 'عبد-الله', amount: 100, type: 'قرض', note: 'ظرف', date: `${addMonths(cm, -1).slice(0, 7)}-10`, repaid: 150, returned: true },
    { id: 2, member: 'محمد', amount: 50, type: 'سحب', note: '', date: `${addMonths(cm, -1).slice(0, 7)}-12`, repaid: 0, returned: false },
  ],
  expenses: [{ id: 3, desc: 'ض', amount: 20, date: `${addMonths(cm, -1).slice(0, 7)}-20` }],
};

describe('النقل من النسخة القديمة', () => {
  it('يحوّل ويصحّح أخطاء النسخة القديمة', () => {
    const { dataset, warnings } = convertLegacy(OLD, { uuid });
    validateDataset(dataset);
    const names = dataset.members.map((m) => [m.name, m.archived]);
    expect(names).toContainEqual(['عبد-الله', false]);
    expect(names).toContainEqual(['علي', true]);
    expect(dataset.entries.filter((e) => e.kind === 'contribution')).toHaveLength(4);
    expect(dataset.entries.find((e) => e.kind === 'repayment').amount).toBe(100);
    expect(dataset.entries.find((e) => e.kind === 'expense').note).toBe('مصروف ض');
    expect(warnings.length).toBe(2);
    const { live } = indexEntries(dataset.entries);
    expect(summarize(live).balance).toBe(400 - 50 - 20);
  });

  it('يرفض الملفات العبثية', () => {
    expect(() => convertLegacy({ members: 'x', payments: {} })).toThrow();
    expect(() => convertLegacy({ members: ['<img src=x onerror=alert(1)>'], payments: { bad: true } })).toThrow(/مفتاح دفعة/);
    expect(() => validateDataset({ format: 'sandooq-backup', version: 1, settings: { fund_name: 'x', start_month: 'x' } })).toThrow(/شهر التأسيس/);
  });

  it('قاعدة البيانات تقبل البيانات المحوّلة كما هي', async () => {
    const schema = readFileSync(fileURLToPath(new URL('../../supabase/schema.sql', import.meta.url)), 'utf8');
    const db = new PGlite();
    await db.exec(`create role anon nologin; create role authenticated nologin; create schema auth;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;`);
    await db.exec(schema);
    const admin = '99999999-9999-4999-8999-999999999999';
    await db.query('insert into auth.users (id, email) values ($1, $2)', [admin, 'a@x.com']);
    await db.exec(`select set_config('request.jwt.claim.sub', '${admin}', false); set role authenticated;`);
    const { dataset } = convertLegacy(OLD, { uuid: () => crypto.randomUUID() });
    const res = await db.query('select public.import_data($1::jsonb) r', [JSON.stringify(toImportPayload(dataset))]);
    expect(Number(res.rows[0].r.balance)).toBe(330);

    // النسخة الاحتياطية من قاعدة البيانات تُستعاد في قاعدة جديدة بنفس النتيجة
    const q = async (sql) => (await db.query(sql)).rows;
    const backup = buildBackup({
      settings: (await q('select fund_name, start_month::text, members_see_all from public.settings'))[0],
      rates: await q('select effective_from::text, amount::float8 as amount from public.contribution_rates'),
      members: await q(`select id::text, name, phone, joined_on::text, archived, to_char(archived_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') archived_at, to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') created_at from public.members`),
      entries: await q(`select id::text, kind, member_id::text, amount::float8 as amount, entry_date::text, period::text, loan_id::text, due_on::text, installments, reverses::text, note, to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') created_at from public.entries`),
      closures: [],
    });
    const encrypted = await encryptJSON(backup, 'كلمة-سر-قوية');
    await expect(decryptJSON(encrypted, 'خطأ')).rejects.toThrow(/غير صحيحة/);
    const restored = validateDataset(await decryptJSON(encrypted, 'كلمة-سر-قوية'));
    expect(restored.entries).toHaveLength(backup.entries.length);
  }, 60000);
});

describe('أدوات', () => {
  it('todayISO محلي', () => {
    expect(todayISO(new Date(2026, 0, 5, 1, 0))).toBe('2026-01-05');
  });
});
