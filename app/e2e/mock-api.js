// بديل لـ src/api.js لاختبار الواجهة محلياً: نفس مخطط قاعدة البيانات يعمل داخل المتصفح (PGlite)
// مع محاكاة لنظام الدخول في Supabase. لا يُستخدم في التطبيق المنشور.
import { PGlite } from '@electric-sql/pglite';
import schema from '../../supabase/schema.sql?raw';
import { friendlyError } from '../src/lib/errors.js';

export { friendlyError };

const STUB = `
  create role anon nologin; create role authenticated nologin; create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated;`;

const db = new PGlite();
const ready = (async () => {
  await db.exec(STUB);
  await db.exec(schema);
})();
window.__db = db;

let lock = Promise.resolve();
let session = null;
const users = new Map();
const listeners = new Set();

function run(fn) {
  const p = lock.then(async () => {
    await ready;
    return fn();
  });
  lock = p.catch(() => {});
  return p;
}

const as = (sql, params = []) =>
  run(async () => {
    const uid = session?.user.id || '';
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
    try {
      return (await db.query(sql, params)).rows;
    } catch (e) {
      throw new Error(e.message);
    } finally {
      await db.exec('reset role;');
    }
  });

const rowsOf = async (sql, params) => (await as(sql, params)).map((r) => r.j);
const table = (t, order) => rowsOf(`select to_jsonb(x) j from public.${t} x ${order ? `order by ${order}` : ''}`);

function insertSQL(t, obj) {
  const keys = Object.keys(obj);
  return [`insert into public.${t} (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) returning to_jsonb(${t}.*) j`, keys.map((k) => obj[k])];
}
function updateSQL(t, patch, where, whereVal) {
  const keys = Object.keys(patch);
  return [
    `update public.${t} set ${keys.map((k, i) => `${k} = $${i + 1}`).join(',')} where ${where} = $${keys.length + 1} returning to_jsonb(${t}.*) j`,
    [...keys.map((k) => patch[k]), whereVal],
  ];
}
const first = async ([sql, params]) => (await rowsOf(sql, params))[0];

function emit(event) {
  for (const l of listeners) l(event, session);
}

export const supabase = {
  auth: {
    getSession: async () => ({ data: { session } }),
    onAuthStateChange: (cb) => {
      listeners.add(cb);
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
    },
    signUp: async ({ email, password, options }) => {
      await ready;
      if (users.has(email)) return { error: { message: 'User already registered' } };
      const id = crypto.randomUUID();
      users.set(email, { id, password });
      await run(() => db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [id, email, JSON.stringify(options?.data || {})]));
      session = { user: { id, email } };
      emit('SIGNED_IN');
      return { data: { session } };
    },
    signInWithPassword: async ({ email, password }) => {
      const u = users.get(email);
      if (!u || u.password !== password) return { error: { message: 'Invalid login credentials' } };
      session = { user: { id: u.id, email } };
      emit('SIGNED_IN');
      return { data: { session } };
    },
    signOut: async () => {
      session = null;
      emit('SIGNED_OUT');
      return {};
    },
    resetPasswordForEmail: async () => ({}),
    updateUser: async () => ({}),
  },
};

export const loadMyProfile = async (id) => (await rowsOf('select to_jsonb(p) j from public.profiles p where id = $1', [id]))[0] || null;

export async function loadAll(isStaff) {
  const [settings] = await table('settings');
  const [s] = await as('select public.fund_summary() s');
  const num = (x) => ({ ...x, amount: Number(x.amount) });
  return {
    settings,
    rates: (await table('contribution_rates', 'effective_from')).map(num),
    members: await table('members', 'name'),
    entries: (await table('entries', 'created_at')).map(num),
    closures: await table('month_closures', 'period'),
    summary: Object.fromEntries(Object.entries(s.s).map(([k, v]) => [k, Number(v)])),
    profiles: isStaff ? await table('profiles', 'created_at') : [],
  };
}

export const loadAudit = (limit = 200) => rowsOf(`select to_jsonb(a) j from public.audit_log a order by id desc limit ${Number(limit)}`);
export const addEntry = (e) => first(insertSQL('entries', e));
export const reverseEntry = (id, note) => first(insertSQL('entries', { kind: 'reversal', reverses: id, note, amount: 1 }));
export const addMember = (m) => first(insertSQL('members', m));
export const updateMember = (id, p) => first(updateSQL('members', p, 'id', id));
export const updateProfile = (id, p) => first(updateSQL('profiles', p, 'id', id));
export const updateSettings = (p) => first(updateSQL('settings', { ...p, updated_at: new Date().toISOString() }, 'id', 1));
export const addRate = (effective_from, amount) => first(insertSQL('contribution_rates', { effective_from, amount }));
export const deleteRate = (f) => as('delete from public.contribution_rates where effective_from = $1', [f]);
export const closeMonth = (period) => first(insertSQL('month_closures', { period }));
export const reopenMonth = (period) => as('delete from public.month_closures where period = $1', [period]);
export const markBackup = async () => (await as('select public.mark_backup() t'))[0].t;
export const importData = async (payload) => (await as('select public.import_data($1::jsonb) r', [JSON.stringify(payload)]))[0].r;
