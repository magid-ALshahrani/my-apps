// طبقة الوصول للبيانات — كل القراءة والكتابة تمر من هنا.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { friendlyError } from './lib/errors.js';

export { friendlyError };

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

function unwrap({ data, error }) {
  if (error) throw new Error(friendlyError(error));
  return data;
}

async function fetchAll(table, order) {
  const size = 1000;
  let from = 0;
  const rows = [];
  for (;;) {
    let q = supabase.from(table).select('*').range(from, from + size - 1);
    if (order) q = q.order(order, { ascending: true });
    const data = unwrap(await q);
    rows.push(...data);
    if (data.length < size) return rows;
    from += size;
  }
}

export async function loadMyProfile(userId) {
  return unwrap(await supabase.from('profiles').select('*').eq('id', userId).maybeSingle());
}

export async function loadAll(isStaff) {
  const [settings, rates, members, entries, closures, summary, profiles] = await Promise.all([
    supabase.from('settings').select('*').eq('id', 1).single().then(unwrap),
    fetchAll('contribution_rates', 'effective_from'),
    fetchAll('members', 'name'),
    fetchAll('entries', 'created_at'),
    fetchAll('month_closures', 'period'),
    supabase.rpc('fund_summary').then(unwrap),
    isStaff ? fetchAll('profiles', 'created_at') : Promise.resolve([]),
  ]);
  const num = (x) => ({ ...x, amount: Number(x.amount) });
  return {
    settings,
    rates: rates.map(num),
    members,
    entries: entries.map(num),
    closures,
    summary: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, Number(v)])),
    profiles,
  };
}

export async function loadAudit(limit = 200) {
  return unwrap(await supabase.from('audit_log').select('*').order('id', { ascending: false }).limit(limit));
}

export const addEntry = async (entry) => unwrap(await supabase.from('entries').insert(entry).select().single());
export const reverseEntry = async (id, note) =>
  // المبلغ يُنسخ من القيد الأصلي في قاعدة البيانات
  unwrap(await supabase.from('entries').insert({ kind: 'reversal', reverses: id, note, amount: 1 }).select().single());

export const addMember = async (m) => unwrap(await supabase.from('members').insert(m).select().single());
export const updateMember = async (id, patch) => unwrap(await supabase.from('members').update(patch).eq('id', id).select().single());
export const updateProfile = async (id, patch) => unwrap(await supabase.from('profiles').update(patch).eq('id', id).select().single());
export const updateSettings = async (patch) =>
  unwrap(await supabase.from('settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1).select().single());
export const addRate = async (effective_from, amount) =>
  unwrap(await supabase.from('contribution_rates').insert({ effective_from, amount }).select().single());
export const deleteRate = async (effective_from) =>
  unwrap(await supabase.from('contribution_rates').delete().eq('effective_from', effective_from));
export const closeMonth = async (period) => unwrap(await supabase.from('month_closures').insert({ period }).select().single());
export const reopenMonth = async (period) => unwrap(await supabase.from('month_closures').delete().eq('period', period));
export const markBackup = async () => unwrap(await supabase.rpc('mark_backup'));
export const importData = async (payload) => unwrap(await supabase.rpc('import_data', { payload }));
