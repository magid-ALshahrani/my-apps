// بيانات تجريبية وهمية بالكامل (أسماء وأرقام غير حقيقية)، تُحذف بأمر واحد.
//   إضافة:  SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… DEMO_PASSWORD=… node scripts/demo-data.mjs
//   حذف:    SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/demo-data.mjs --remove
// لا تشغّله على مشروع فيه بيانات حقيقية إلا للتجربة؛ الحذف يطال ما أنشأه هذا السكربت فقط
// (المعرّفات محفوظة في .demo-ids.json، والمستخدمون التجريبيون ببريد @demo.invalid).
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_PASSWORD } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { console.error('يلزم SUPABASE_URL وSUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const IDS_FILE = new URL('../.demo-ids.json', import.meta.url);
const ok = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };

async function remove() {
  const ids = fs.existsSync(IDS_FILE) ? JSON.parse(fs.readFileSync(IDS_FILE, 'utf8')) : { stages: [], users: [], programs: [], meetings: [], inspections: [], committee: [] };
  if (ids.stages.length) ok(await sb.from('students').delete().in('section_id', ids.sections ?? []));
  for (const [table, key] of [['stages', 'stages'], ['committee_meetings', 'meetings'], ['env_inspections', 'inspections'], ['committee_members', 'committee']]) {
    if (ids[key]?.length) ok(await sb.from(table).delete().in('id', ids[key]));
  }
  if (ids.programs?.length) ok(await sb.from('programs').update({ status: 'planned', actual_date: null, beneficiaries: null, skip_reason: null, skip_note: null, new_date: null }).in('id', ids.programs));
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
  for (const u of list?.users ?? []) if (u.email?.endsWith('@demo.invalid')) await sb.auth.admin.deleteUser(u.id);
  if (fs.existsSync(IDS_FILE)) fs.unlinkSync(IDS_FILE);
  console.log('✅ حُذفت البيانات التجريبية');
}

const FIRST = ['محمد', 'عبدالله', 'فهد', 'سعود', 'خالد', 'ناصر', 'تركي', 'سلمان', 'يوسف', 'عمر', 'بدر', 'ريان', 'زياد', 'مشعل', 'نواف', 'هشام', 'وليد', 'ماجد', 'أنس', 'حمد'];
const FATHER = ['أحمد', 'علي', 'إبراهيم', 'صالح', 'سعد', 'عبدالرحمن', 'حسن', 'منصور', 'سليمان', 'فيصل'];
const FAMILY = ['التجريبي', 'المثالي', 'النموذجي', 'الافتراضي', 'الوهمي'];
const rnd = (a, i) => a[i % a.length];
const phone = (i) => `+9665${String(10000000 + i * 7919).slice(-8)}`;

async function add() {
  if (!DEMO_PASSWORD || DEMO_PASSWORD.length < 10) { console.error('ضع DEMO_PASSWORD (10 أحرف على الأقل) لحسابات التجربة'); process.exit(1); }
  const ids = { stages: [], sections: [], users: [], programs: [], meetings: [], inspections: [], committee: [] };
  // تُحفظ المعرّفات حتى لو فشلت الإضافة في منتصفها، ليعمل الحذف دائمًا
  try { await fill(ids); } finally { fs.writeFileSync(IDS_FILE, JSON.stringify(ids)); }
}

async function fill(ids) {
  const users = [
    ['guide@demo.invalid', 'أ. نورة الموجهة (تجريبي)', 'health_guide'],
    ['principal@demo.invalid', 'أ. سارة المديرة (تجريبي)', 'principal'],
    ['nurse@demo.invalid', 'أ. هند الممرضة (تجريبي)', 'nurse'],
    ['member@demo.invalid', 'أ. ريم عضو اللجنة (تجريبي)', 'committee_member'],
  ];
  for (const [email, name, role] of users) {
    const { data, error } = await sb.auth.admin.createUser({ email, password: DEMO_PASSWORD, email_confirm: true });
    if (error) throw error;
    ok(await sb.from('profiles').insert({ id: data.user.id, email, full_name: name, role, active: true, must_change_password: false }));
    ids.users.push(data.user.id);
    if (role === 'committee_member') ids.committee.push(ok(await sb.from('committee_members').insert({ full_name: name, title: 'مقرر/ة', profile_id: data.user.id }).select('id').single()).id);
  }
  ok(await sb.from('school_info').update({ school_name: 'المدرسة التجريبية', region: 'منطقة تجريبية', stage_label: 'ابتدائي' }).eq('id', 1));

  const types = ok(await sb.from('condition_types').select('id,name'));
  const T = Object.fromEntries(types.map((t) => [t.name, t.id]));
  const stage = ok(await sb.from('stages').insert({ name: 'ابتدائي', gender: 'boys', sort: 0 }).select('id').single());
  ids.stages.push(stage.id);
  let n = 0;
  // الحذف يتم عبر stages (يتتالى إلى الصفوف والفصول) والطلاب عبر sections
  const conds = [];
  for (const [gi, gname] of ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس'].entries()) {
    const g = ok(await sb.from('grades').insert({ stage_id: stage.id, name: gname, sort: gi }).select('id').single());
    for (const sname of ['1', '2']) {
      const s = ok(await sb.from('sections').insert({ grade_id: g.id, name: sname }).select('id').single());
      ids.sections.push(s.id);
      const rows = [];
      for (let k = 0; k < 12; k++, n++) {
        const full = `${rnd(FIRST, n * 3 + gi)} ${rnd(FATHER, n + k)} ${rnd(FIRST, n + 5)} ${rnd(FAMILY, n)}`;
        rows.push({ full_name: full, name_key: full, section_id: s.id, guardian_phone: phone(n), phone_needs_review: k === 11 && sname === '2' });
      }
      const st = ok(await sb.from('students').insert(rows).select('id'));
      st.forEach((x, k) => {
        const m = (k + gi * 3 + Number(sname)) % 13;
        if (m === 0) conds.push({ student_id: x.id, type_id: T['سكري'], medication: 'أنسولين قبل الوجبة', emergency_action: 'عند الهبوط: عصير سكري ثم قياس السكر' });
        if (m === 3) conds.push({ student_id: x.id, type_id: T['ضغط الدم'], medication: '—', emergency_action: 'الجلوس والراحة وقياس الضغط' });
        if (m === 5 || m === 0) conds.push({ student_id: x.id, type_id: T['حساسية (غذائية/ربو)'], medication: 'بخاخ موسّع للشعب', emergency_action: 'استخدام البخاخ والاتصال بولي الأمر' });
        if (m === 7) conds.push({ student_id: x.id, type_id: T['إعفاء من النشاط الرياضي'], doctor_notes: 'إعفاء لمدة فصل دراسي' });
        if (m === 9) conds.push({ student_id: x.id, type_id: T['حالة مزمنة أخرى'], notes: 'صرع - متابعة' });
        if (m === 11) conds.push({ student_id: x.id, type_id: T['متابعة دورية'], status: k % 2 ? 'active' : 'recovered' });
        if (m === 4 && gi % 2 === 0) conds.push({ student_id: x.id, type_id: T['حساسية مفرطة (تأق)'], medication: 'قلم إبينفرين', emergency_action: 'حقن الإبينفرين فورًا والاتصال بالإسعاف 997' });
      });
    }
  }
  ok(await sb.from('student_conditions').insert(conds.map((c) => ({ status: 'active', medication: null, emergency_action: null, doctor_notes: null, notes: null, ...c }))));

  // حالات تنفيذ لبعض البرامج
  const progs = ok(await sb.from('programs').select('id,name').eq('is_unofficial_day', false));
  const P = Object.fromEntries(progs.map((p) => [p.name, p.id]));
  const upd = [
    ['حملة العودة إلى المدارس 1448هـ', { status: 'done', actual_date: '2026-08-24', beneficiaries: 140 }],
    ['اللقاء التعريفي لبرامج الصحة المدرسية', { status: 'done', actual_date: '2026-08-30', beneficiaries: 4 }],
    ['اليوم الخليجي للصحة المدرسية', { status: 'not_done', skip_reason: 'exams' }],
    ['فحص اللياقة 1448هـ', { status: 'done', actual_date: '2026-08-10', beneficiaries: 24 }],
  ];
  for (const [name, p] of upd) {
    ok(await sb.from('programs').update(p).eq('id', P[name]));
    ids.programs.push(P[name]);
  }
  ids.inspections.push(ok(await sb.from('env_inspections').insert({ inspected_on: '2026-09-20', answers: Object.fromEntries(Array.from({ length: 22 }, (_, i) => [`k${i}`, { yes: i % 5 !== 0, note: '' }])) }).select('id').single()).id);
  console.log(`✅ أُضيفت بيانات تجريبية: ${n} طالبًا، ${conds.length} حالة، 4 مستخدمين (@demo.invalid)`);
}

if (process.argv.includes('--remove')) await remove(); else await add();
