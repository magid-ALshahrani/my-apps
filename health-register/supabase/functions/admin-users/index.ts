// Supabase Edge Function: إدارة المستخدمين (دعوة، تغيير دور، تعطيل، إعادة تعيين كلمة المرور).
// مفتاح الخدمة يُقرأ من بيئة الدالة على الخادم فقط، ولا يصل للواجهة أبدًا.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle, supabaseDeps } from './handler.ts';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** مفتاح الخدمة من بيئة الدالة: المفتاح القديم إن وُجد، وإلا المفتاح السري الجديد (sb_secret_…) */
function serviceKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
    return keys.default ?? Object.values(keys)[0] ?? '';
  } catch {
    return '';
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let body: unknown = null;
  try { body = await req.json(); } catch { /* جسم فارغ */ }
  const result = await handle(req.headers.get('Authorization'), body, supabaseDeps(admin, (a) => crypto.getRandomValues(a)));
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
