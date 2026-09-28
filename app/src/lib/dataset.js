// صيغة البيانات الموحدة للنسخ الاحتياطي والاستيراد، مع تحقق صارم قبل الإرسال لقاعدة البيانات.
import { isISODate, isPeriod } from './dates.js';

export const BACKUP_FORMAT = 'sandooq-backup';
const KINDS = new Set(['contribution', 'withdrawal', 'loan', 'repayment', 'expense', 'reversal']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (msg) => {
  throw new Error(`ملف غير صالح: ${msg}`);
};
const isAmount = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 10_000_000;
const optStr = (v, max) => v == null || (typeof v === 'string' && v.length <= max);
const optTs = (v) => v == null || (typeof v === 'string' && !Number.isNaN(Date.parse(v)));

export function validateDataset(d) {
  if (!d || typeof d !== 'object') fail('المحتوى ليس كائناً');
  if (d.format !== BACKUP_FORMAT) fail('ليست نسخة احتياطية لصندوق الإخوة');
  if (d.version !== 1) fail('إصدار غير مدعوم');
  const s = d.settings;
  if (!s || typeof s.fund_name !== 'string' || !s.fund_name.trim() || s.fund_name.length > 60) fail('اسم الصندوق');
  if (!isPeriod(s.start_month)) fail('شهر التأسيس');
  for (const k of ['rates', 'members', 'entries', 'closures']) if (!Array.isArray(d[k])) fail(`القائمة ${k} مفقودة`);
  if (d.members.length > 500 || d.entries.length > 200000) fail('حجم البيانات أكبر من المسموح');

  for (const r of d.rates) {
    if (!isPeriod(r.effective_from) || !isAmount(r.amount)) fail('سعر اشتراك');
  }

  const memberIds = new Set();
  const names = new Set();
  for (const m of d.members) {
    if (!UUID.test(m.id) || memberIds.has(m.id)) fail('معرّف عضو');
    if (typeof m.name !== 'string' || !m.name.trim() || m.name.trim().length > 60) fail('اسم عضو');
    if (names.has(m.name.trim())) fail(`اسم مكرر: ${m.name}`);
    if (m.phone != null && !/^[0-9+ ]{6,20}$/.test(m.phone)) fail(`جوال ${m.name}`);
    if (!isPeriod(m.joined_on)) fail(`تاريخ انضمام ${m.name}`);
    if (typeof m.archived !== 'boolean' || !optTs(m.archived_at) || !optTs(m.created_at)) fail(`بيانات ${m.name}`);
    memberIds.add(m.id);
    names.add(m.name.trim());
  }

  const entryIds = new Map();
  for (const e of d.entries) {
    if (!UUID.test(e.id) || entryIds.has(e.id)) fail('معرّف قيد');
    if (!KINDS.has(e.kind)) fail(`نوع قيد: ${e.kind}`);
    if (!isAmount(e.amount)) fail('مبلغ قيد');
    if (!isISODate(e.entry_date)) fail('تاريخ قيد');
    if (!optStr(e.note, 300) || !optTs(e.created_at)) fail('ملاحظة أو وقت قيد');
    if (e.member_id != null && !memberIds.has(e.member_id)) fail('قيد مرتبط بعضو غير موجود');
    const needsMember = ['contribution', 'withdrawal', 'loan'].includes(e.kind);
    if (needsMember && !e.member_id) fail('قيد بدون عضو');
    if (e.kind === 'contribution' && !isPeriod(e.period)) fail('شهر الاشتراك');
    if (e.kind !== 'contribution' && e.period != null) fail('شهر في قيد غير اشتراك');
    if (e.kind === 'loan') {
      if (e.due_on != null && !isISODate(e.due_on)) fail('تاريخ استحقاق');
      if (e.installments != null && !(Number.isInteger(e.installments) && e.installments >= 1 && e.installments <= 120)) fail('عدد الأقساط');
    } else if (e.due_on != null || e.installments != null) fail('استحقاق في قيد غير قرض');
    if (e.kind === 'repayment') {
      const loan = entryIds.get(e.loan_id);
      if (!loan || loan.kind !== 'loan') fail('سداد يسبق قرضه أو بدون قرض');
    } else if (e.loan_id != null) fail('ربط قرض في قيد غير سداد');
    if (e.kind === 'reversal') {
      if (!entryIds.has(e.reverses)) fail('قيد عكسي يسبق القيد الأصلي');
      if (!e.note || e.note.trim().length < 3) fail('قيد عكسي بدون سبب');
    } else if (e.reverses != null) fail('إشارة عكس في قيد عادي');
    if (e.kind === 'expense' && (!e.note || e.note.trim().length < 2)) fail('مصروف بدون بيان');
    entryIds.set(e.id, e);
  }

  for (const c of d.closures) if (!isPeriod(c.period) || !optTs(c.closed_at)) fail('شهر مقفل');
  return d;
}

/** الحمولة المرسلة لدالة import_data */
export function toImportPayload(d) {
  return {
    settings: { fund_name: d.settings.fund_name, start_month: d.settings.start_month },
    rates: d.rates.map(({ effective_from, amount }) => ({ effective_from, amount })),
    members: d.members.map(({ id, name, phone, joined_on, archived, archived_at, created_at }) => ({
      id, name: name.trim(), phone: phone || null, joined_on, archived, archived_at: archived_at || null, created_at: created_at || null,
    })),
    entries: d.entries.map((e) => ({
      id: e.id, kind: e.kind, member_id: e.member_id ?? null, amount: e.amount, entry_date: e.entry_date,
      period: e.period ?? null, loan_id: e.loan_id ?? null, due_on: e.due_on ?? null,
      installments: e.installments ?? null, reverses: e.reverses ?? null, note: e.note ?? null,
      created_at: e.created_at ?? null,
    })),
    closures: d.closures.map(({ period, closed_at }) => ({ period, closed_at: closed_at || null })),
  };
}

/** يبني نسخة احتياطية من البيانات المحمّلة من قاعدة البيانات */
export function buildBackup({ settings, rates, members, entries, closures }, now = new Date()) {
  const ordered = [...entries].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exported_at: now.toISOString(),
    settings: { fund_name: settings.fund_name, start_month: settings.start_month, members_see_all: settings.members_see_all },
    rates: rates.map((r) => ({ effective_from: r.effective_from, amount: Number(r.amount) })),
    members: members.map((m) => ({
      id: m.id, name: m.name, phone: m.phone || null, joined_on: m.joined_on,
      archived: m.archived, archived_at: m.archived_at || null, created_at: m.created_at || null,
    })),
    entries: ordered.map((e) => ({
      id: e.id, kind: e.kind, member_id: e.member_id || null, amount: Number(e.amount), entry_date: e.entry_date,
      period: e.period || null, loan_id: e.loan_id || null, due_on: e.due_on || null,
      installments: e.installments ?? null, reverses: e.reverses || null, note: e.note || null,
      created_at: e.created_at || null,
    })),
    closures: closures.map((c) => ({ period: c.period, closed_at: c.closed_at || null })),
  };
}
