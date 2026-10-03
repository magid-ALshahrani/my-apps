// بوابة محلية للاختبار فقط تحاكي واجهة Supabase على منفذ واحد (54321):
//   /auth/v1      ← GoTrue (Supabase Auth الحقيقي)
//   /rest/v1      ← PostgREST الحقيقي (RLS في Postgres)
//   /storage/v1   ← محاكاة مبسطة للتخزين تفرض سياسات storage.objects عبر Postgres
//   /functions/v1/admin-users ← نفس منطق Edge Function (handler.ts)
// لا تُستخدم في الإنتاج.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { handle, supabaseDeps } from '../../supabase/functions/admin-users/handler.ts';

const SECRET = process.env.JWT_SECRET ?? 'local-test-secret-not-for-production-0123456789';
const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const STORE = process.env.STORAGE_DIR ?? '/var/tmp/hr-stack/storage';
fs.mkdirSync(STORE, { recursive: true });

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
export function signJwt(payload: Record<string, unknown>) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify(payload));
  const s = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
function verifyJwt(token: string): Record<string, unknown> | null {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  if (s.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expect))) return null;
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (claims.exp && claims.exp < Date.now() / 1000) return null;
  return claims;
}

const far = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600;
export const ANON_KEY = signJwt({ role: 'anon', iss: 'local', exp: far });
export const SERVICE_KEY = signJwt({ role: 'service_role', iss: 'local', exp: far });

const pool = new pg.Pool({ connectionString: 'postgres://postgres@127.0.0.1:54322/postgres' });

function proxy(req: http.IncomingMessage, res: http.ServerResponse, port: number, strip: string) {
  const target = (req.url ?? '/').slice(strip.length) || '/';
  const up = http.request({ host: '127.0.0.1', port, path: target, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on('error', () => { res.writeHead(502); res.end('upstream error'); });
  req.pipe(up);
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...cors, ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-upsert, cache-control, x-supabase-api-version, accept-profile, content-profile, prefer, range',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

/** يشغّل استعلامًا بصلاحيات المستخدم صاحب الـ JWT (RLS مفعّل) */
async function asUser<T>(claims: Record<string, unknown>, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const role = claims.role === 'service_role' ? 'service_role' : claims.role === 'authenticated' ? 'authenticated' : 'anon';
    await c.query(`set local role ${role}`);
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

const fileOf = (bucket: string, name: string) => path.join(STORE, bucket, ...name.split('/').map((s) => s.replace(/\.\./g, '')));

async function storage(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  const p = decodeURIComponent(url.pathname.replace(/^\/storage\/v1/, ''));
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const claims = verifyJwt(token);

  // تحميل برابط موقّع
  let m = p.match(/^\/object\/sign\/([^/]+)\/(.+)$/);
  if (m && req.method === 'GET') {
    const [, bucket, name] = m;
    const t = url.searchParams.get('token') ?? '';
    const c = verifyJwt(t);
    if (!c || c.url !== `${bucket}/${name}`) return send(res, 400, { error: 'InvalidSignature', message: 'رابط غير صالح أو منتهي' });
    if (!fs.existsSync(fileOf(bucket, name))) return send(res, 404, { error: 'not_found' });
    res.writeHead(200, { ...cors, 'Content-Type': String(c.mime ?? 'application/octet-stream') });
    return fs.createReadStream(fileOf(bucket, name)).pipe(res);
  }
  if (!claims) return send(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'Invalid JWT' });

  if (m && req.method === 'POST') {
    const [, bucket, name] = m;
    const { expiresIn = 60 } = JSON.parse((await readBody(req)).toString() || '{}');
    const row = await asUser(claims, (c) => c.query('select metadata from storage.objects where bucket_id=$1 and name=$2', [bucket, name]));
    if (!row.rowCount) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    const t = signJwt({ url: `${bucket}/${name}`, mime: row.rows[0].metadata?.mimetype, exp: Math.floor(Date.now() / 1000) + Number(expiresIn) });
    return send(res, 200, { signedURL: `/object/sign/${bucket}/${encodeURI(name)}?token=${t}` });
  }

  m = p.match(/^\/object\/(?:authenticated\/)?([^/]+)\/(.+)$/);
  if (m && (req.method === 'POST' || req.method === 'PUT')) {
    const [, bucket, name] = m;
    const body = await readBody(req);
    const mime = String(req.headers['content-type'] ?? 'application/octet-stream').split(';')[0];
    const b = await pool.query('select file_size_limit, allowed_mime_types from storage.buckets where id=$1', [bucket]);
    if (!b.rowCount) return send(res, 400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
    if (body.length > Number(b.rows[0].file_size_limit)) return send(res, 400, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
    if (b.rows[0].allowed_mime_types && !b.rows[0].allowed_mime_types.includes(mime)) return send(res, 400, { statusCode: '415', error: 'invalid_mime_type', message: `mime type ${mime} is not supported` });
    try {
      await asUser(claims, (c) => c.query('insert into storage.objects (bucket_id, name, owner, metadata) values ($1,$2,$3,$4)',
        [bucket, name, claims.sub ?? null, { mimetype: mime, size: body.length }]));
    } catch (e) {
      const msg = (e as Error).message;
      return send(res, 400, { statusCode: '403', error: 'Unauthorized', message: msg.includes('row-level security') ? 'new row violates row-level security policy' : 'upload failed' });
    }
    fs.mkdirSync(path.dirname(fileOf(bucket, name)), { recursive: true });
    fs.writeFileSync(fileOf(bucket, name), body);
    return send(res, 200, { Key: `${bucket}/${name}` });
  }
  if (m && req.method === 'GET') {
    const [, bucket, name] = m;
    const row = await asUser(claims, (c) => c.query('select metadata from storage.objects where bucket_id=$1 and name=$2', [bucket, name]));
    if (!row.rowCount) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    res.writeHead(200, { ...cors, 'Content-Type': row.rows[0].metadata?.mimetype ?? 'application/octet-stream' });
    return fs.createReadStream(fileOf(bucket, name)).pipe(res);
  }
  m = p.match(/^\/object\/([^/]+)$/);
  if (m && req.method === 'DELETE') {
    const [, bucket] = m;
    const { prefixes = [] } = JSON.parse((await readBody(req)).toString() || '{}');
    const del = await asUser(claims, (c) => c.query('delete from storage.objects where bucket_id=$1 and name = any($2) returning name', [bucket, prefixes]));
    for (const r of del.rows) fs.rmSync(fileOf(bucket, r.name), { force: true });
    return send(res, 200, del.rows.map((r) => ({ name: r.name })));
  }
  return send(res, 404, { error: 'not_found' });
}

async function functions(req: http.IncomingMessage, res: http.ServerResponse) {
  if (!req.url?.startsWith('/functions/v1/admin-users')) return send(res, 404, { error: 'not_found' });
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  const admin = createClient(`http://127.0.0.1:${PORT}`, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let body: unknown = null;
  try { body = JSON.parse((await readBody(req)).toString()); } catch { /* فارغ */ }
  const r = await handle(req.headers.authorization ?? null, body, supabaseDeps(admin, (a) => crypto.getRandomValues(a)));
  return send(res, r.status, r.body);
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const u = req.url ?? '/';
  const fail = (e: unknown) => { if (!res.headersSent) send(res, 500, { error: String((e as Error)?.message ?? e) }); };
  if (u.startsWith('/auth/v1')) return proxy(req, res, 9999, '/auth/v1');
  if (u.startsWith('/rest/v1')) return proxy(req, res, 3000, '/rest/v1');
  if (u.startsWith('/storage/v1')) return void storage(req, res).catch(fail);
  if (u.startsWith('/functions/v1')) return void functions(req, res).catch(fail);
  send(res, 404, { error: 'not_found' });
}).listen(PORT, '127.0.0.1', () => {
  fs.writeFileSync(path.join(path.dirname(STORE), 'keys.json'), JSON.stringify({ anon: ANON_KEY, service: SERVICE_KEY }));
  console.log(`local gateway on http://127.0.0.1:${PORT}`);
});
