'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');

// رموز اختبار مؤقتة تُولَّد عشوائيًا لكل تشغيل
const crypto = require('crypto');
const TEACHER = crypto.randomBytes(4).toString('hex');
const MANAGER = crypto.randomBytes(4).toString('hex');

let server, base, db, dataDir;

function riyadh(offsetMs) {
  // تاريخ بصيغة YYYY-MM-DDTHH:mm بتوقيت الرياض
  const d = new Date(Date.now() + offsetMs + 3 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
}

class Client {
  constructor() {
    this.cookie = '';
  }
  async req(method, url, { json, form, headers = {} } = {}) {
    const h = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    let body;
    if (json !== undefined) {
      h['content-type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) body = form;
    const res = await fetch(base + url, { method, headers: h, body, redirect: 'manual' });
    const set = res.headers.get('set-cookie');
    if (set) {
      const v = set.split(';')[0];
      this.cookie = v.endsWith('=') ? '' : v;
    }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  }
  get(u) {
    return this.req('GET', u);
  }
  post(u, json) {
    return this.req('POST', u, { json });
  }
  put(u, json) {
    return this.req('PUT', u, { json });
  }
  patch(u, json) {
    return this.req('PATCH', u, { json });
  }
  del(u) {
    return this.req('DELETE', u);
  }
  upload(title, name, content, { source = 'upload', type = 'application/octet-stream' } = {}) {
    const fd = new FormData();
    fd.append('title', title);
    fd.append('source', source);
    fd.append('file', new Blob([content], { type }), name);
    return this.req('POST', '/api/student/submissions', { form: fd });
  }
}

async function teacher() {
  const c = new Client();
  const r = await c.post('/api/auth/pin', { role: 'teacher', pin: TEACHER });
  assert.equal(r.status, 200);
  return c;
}

async function studentClient(id) {
  const c = new Client();
  const r = await c.post('/api/auth/student', { studentId: id });
  assert.equal(r.status, 200);
  return c;
}

let T, classA, classB, s1, s2, s3;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-test-'));
  const built = createApp({
    port: 0,
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
    dbPath: path.join(dataDir, 'app.db'),
    maxFileMb: 1,
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    adminPin: TEACHER,
    managerPin: MANAGER,
    seedDemo: false,
  });
  db = built.db;
  await new Promise((r) => (server = built.app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}`;

  T = await teacher();
  classA = (await T.post('/api/admin/classes', { name: 'الفصل أ' })).data.id;
  classB = (await T.post('/api/admin/classes', { name: 'الفصل ب' })).data.id;
  await T.post('/api/admin/students', { classId: classA, names: ['سالم', 'نورة'] });
  await T.post('/api/admin/students', { classId: classB, names: ['خالد'] });
  const list = (await T.get('/api/admin/overview')).data.students;
  [s1, s2, s3] = ['سالم', 'نورة', 'خالد'].map((n) => list.find((s) => s.name === n).id);
});

after(() => {
  server?.close();
  db?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// ================= الدرجات =================
test('الدرجات: كل إضافة = درجة، والحذف ينقصها، والرفض يجعلها 0', async () => {
  const st = await studentClient(s1);
  let r = await st.upload('بحث ١', 'a.pdf', '%PDF-1.4 test');
  assert.equal(r.status, 201);
  r = await st.upload('صورة', 'b.png', 'png-bytes', { type: 'image/png' });
  assert.equal(r.data.count, 2);
  assert.equal(r.data.score, 2);
  const [first, second] = r.data.submissions;

  // رفض المعلم: الدرجة 0 مع السبب
  const rej = await T.patch(`/api/admin/submissions/${first.id}`, { status: 'rejected', reason: 'غير مكتمل' });
  assert.equal(rej.status, 200);
  const me = (await st.get('/api/student/me')).data;
  assert.equal(me.score, 1);
  assert.equal(me.count, 2);
  const rejected = me.submissions.find((s) => s.id === first.id);
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.reject_reason, 'غير مكتمل');

  // إعادة القبول
  await T.patch(`/api/admin/submissions/${first.id}`, { status: 'accepted' });
  assert.equal((await st.get('/api/student/me')).data.score, 2);

  // حذف: الخانة تعود فارغة والدرجة تنقص
  r = await st.del(`/api/student/submissions/${second.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.score, 1);
  assert.equal(r.data.count, 1);
  assert.ok(!r.data.submissions.some((s) => s.slot === second.slot));

  // تقرير المعلم يطابق
  const ov = (await T.get('/api/admin/overview')).data;
  assert.equal(ov.students.find((s) => s.id === s1).score, 1);
  await st.del(`/api/student/submissions/${first.id}`);
});

test('منع تجاوز 10 خانات', async () => {
  const st = await studentClient(s2);
  for (let i = 1; i <= 10; i++) {
    const r = await st.upload(`عمل ${i}`, `f${i}.txt`, `content ${i}`);
    assert.equal(r.status, 201, `upload ${i}`);
  }
  const r = await st.upload('عمل 11', 'f11.txt', 'x');
  assert.equal(r.status, 409);
  assert.match(r.data.error, /اكتملت/);
  const me = (await st.get('/api/student/me')).data;
  assert.equal(me.count, 10);
  assert.equal(me.score, 10);
  assert.deepEqual(
    me.submissions.map((s) => s.slot),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  );
  // لا ملفات يتيمة: عدد الملفات على القرص = عدد السجلات
  const onDisk = fs.readdirSync(path.join(dataDir, 'uploads')).length;
  const inDb = db.prepare('SELECT COUNT(*) n FROM submissions').get().n;
  assert.equal(onDisk, inDb);
  // ملخص المكتملين
  assert.equal((await T.get('/api/admin/overview')).data.summary.completed, 1);
});

test('الموعد النهائي يمنع الرفع والحذف ويُبقي العرض والتحميل، واستثناء طالب معيّن', async () => {
  const st = await studentClient(s3);
  const up = await st.upload('قبل الموعد', 'early.txt', 'early');
  const subId = up.data.id;

  // موعد في الماضي
  let r = await T.put('/api/admin/settings', { deadline: riyadh(-60_000) });
  assert.equal(r.status, 200);
  let me = (await st.get('/api/student/me')).data;
  assert.equal(me.canEdit, false);
  r = await st.upload('بعد الموعد', 'late.txt', 'late');
  assert.equal(r.status, 403);
  assert.match(r.data.error, /انتهى الموعد/);
  r = await st.del(`/api/student/submissions/${subId}`);
  assert.equal(r.status, 403);
  r = await st.get(`/api/files/${subId}?download=1`);
  assert.equal(r.status, 200);
  assert.equal(r.data.toString(), 'early');

  // استثناء الطالب s3 فقط
  r = await T.put(`/api/admin/overrides/${s3}`, {});
  assert.equal(r.status, 200);
  me = (await st.get('/api/student/me')).data;
  assert.equal(me.canEdit, true);
  assert.equal(me.viaOverride, true);
  r = await st.upload('بعد الموعد باستثناء', 'late.txt', 'late');
  assert.equal(r.status, 201);
  // طالب آخر ما زال ممنوعًا
  const other = await studentClient(s1);
  assert.equal((await other.upload('x', 'x.txt', 'x')).status, 403);

  // استثناء منتهي الصلاحية لا يفتح الرفع
  await T.put(`/api/admin/overrides/${s3}`, { until: riyadh(-30_000) });
  assert.equal((await st.upload('x', 'x.txt', 'x')).status, 403);
  await T.del(`/api/admin/overrides/${s3}`);

  // تمديد الموعد يعيد الفتح للجميع
  await T.put('/api/admin/settings', { deadline: riyadh(3600_000) });
  assert.equal((await other.upload('بعد التمديد', 'x.txt', 'x')).status, 201);
  await T.put('/api/admin/settings', { deadline: null });
});

// ================= الصلاحيات =================
test('الطالب لا يصل لملفات أو بيانات غيره', async () => {
  const a = await studentClient(s1);
  const b = await studentClient(s3);
  const mine = (await a.upload('سري', 'secret.txt', 'secret of s1')).data.id;
  assert.equal((await a.get(`/api/files/${mine}`)).status, 200);
  assert.equal((await b.get(`/api/files/${mine}`)).status, 404);
  assert.equal((await b.del(`/api/student/submissions/${mine}`)).status, 404);
  assert.equal((await b.get(`/api/admin/students/${s1}`)).status, 401);
  assert.equal((await b.get('/api/admin/overview')).status, 401);
  // كوكي مزوّر مرفوض
  const forged = new Client();
  forged.cookie = `ep_sess=${Buffer.from(JSON.stringify({ r: 'teacher', exp: Date.now() + 1e9 })).toString('base64url')}.abc`;
  assert.equal((await forged.get('/api/admin/overview')).status, 401);
  // زائر بلا جلسة
  assert.equal((await new Client().get(`/api/files/${mine}`)).status, 401);
  // المعلم يصل للملف
  assert.equal((await T.get(`/api/files/${mine}`)).status, 200);
});

test('المدير: قراءة كاملة و403 على كل عملية تعديل', async () => {
  const m = new Client();
  assert.equal((await m.post('/api/auth/pin', { role: 'manager', pin: MANAGER })).status, 200);
  const ov = await m.get('/api/admin/overview');
  assert.equal(ov.status, 200);
  assert.equal(ov.data.role, 'manager');
  assert.equal((await m.get(`/api/admin/students/${s1}`)).status, 200);
  assert.equal((await m.get('/api/admin/settings')).status, 200);
  assert.equal((await m.get('/api/admin/report?classId=all')).status, 200);
  const x = await m.get(`/api/admin/export.xlsx?classId=${classA}`);
  assert.equal(x.status, 200);
  assert.equal(x.data.subarray(0, 2).toString(), 'PK');
  const subId = db.prepare('SELECT id FROM submissions LIMIT 1').get().id;
  assert.equal((await m.get(`/api/files/${subId}?download=1`)).status, 200);

  const writes = [
    ['POST', '/api/admin/classes', { name: 'x' }],
    ['PATCH', `/api/admin/classes/${classA}`, { name: 'x' }],
    ['DELETE', `/api/admin/classes/${classA}`],
    ['POST', '/api/admin/students', { classId: classA, names: ['x'] }],
    ['PATCH', `/api/admin/students/${s1}`, { name: 'x' }],
    ['DELETE', `/api/admin/students/${s1}`],
    ['PATCH', `/api/admin/submissions/${subId}`, { status: 'rejected' }],
    ['PUT', '/api/admin/settings', { maxFileMb: 5 }],
    ['PUT', `/api/admin/overrides/${s1}`, {}],
    ['DELETE', `/api/admin/overrides/${s1}`],
    ['POST', '/api/student/submissions', {}],
    ['DELETE', `/api/student/submissions/${subId}`],
  ];
  for (const [method, url, json] of writes) {
    const r = await m.req(method, url, { json: json ?? {} });
    assert.equal(r.status, 403, `${method} ${url}`);
  }
  // لم يتغير شيء
  assert.equal((await T.get('/api/admin/overview')).data.students.length, 3);
});

test('PIN خاطئ مرفوض ومحدود المحاولات مع قفل مؤقت', async () => {
  const c = new Client();
  const ip = { 'x-forwarded-for': '10.9.9.9' };
  for (let i = 1; i <= 4; i++) {
    const r = await c.req('POST', '/api/auth/pin', { json: { role: 'teacher', pin: 'wrong' }, headers: ip });
    assert.equal(r.status, 401);
    assert.match(r.data.error, /غير صحيح/);
  }
  let r = await c.req('POST', '/api/auth/pin', { json: { role: 'teacher', pin: 'wrong' }, headers: ip });
  assert.equal(r.status, 429);
  // حتى الرمز الصحيح مرفوض أثناء القفل
  r = await c.req('POST', '/api/auth/pin', { json: { role: 'teacher', pin: TEACHER }, headers: ip });
  assert.equal(r.status, 429);
  assert.match(r.data.error, /إيقاف/);
  assert.equal((await c.get('/api/admin/overview')).status, 401);
  // الرمز الصحيح من عنوان آخر يعمل
  assert.equal((await teacher()).cookie.length > 0, true);
  // رمز المدير لا يعطي صلاحية المعلم
  const m = new Client();
  assert.equal((await m.req('POST', '/api/auth/pin', { json: { role: 'teacher', pin: MANAGER }, headers: { 'x-forwarded-for': '10.8.8.8' } })).status, 401);
});

// ================= الملفات =================
test('رفع أنواع مختلفة، تجاوز الحد، والتنزيل بترويسات آمنة', async () => {
  // مساحة جديدة
  await T.post('/api/admin/students', { classId: classB, names: ['ملفات'] });
  const id = (await T.get('/api/admin/overview')).data.students.find((s) => s.name === 'ملفات').id;
  const st = await studentClient(id);
  const png = Buffer.from('89504e470d0a1a0a0000', 'hex');
  const cases = [
    ['صورة', 'صورة الدرس.png', png, 'image/png', 'inline'],
    ['كاميرا', 'camera.jpg', Buffer.from('ffd8ffe0', 'hex'), 'image/jpeg', 'inline'],
    ['ملف وورد', 'تقرير.docx', Buffer.from('PK docx'), 'application/octet-stream', 'attachment'],
    ['صفحة', 'evil.html', Buffer.from('<script>alert(1)</script>'), 'application/octet-stream', 'attachment'],
    ['svg', 'x.svg', Buffer.from('<svg onload=alert(1)>'), 'application/octet-stream', 'attachment'],
    ['تنفيذي', '../../etc/passwd.sh', Buffer.from('#!/bin/sh'), 'application/octet-stream', 'attachment'],
  ];
  for (const [title, name, content, expType, expDisp] of cases) {
    const r = await st.upload(title, name, content, { source: title === 'كاميرا' ? 'camera' : 'upload' });
    assert.equal(r.status, 201, name);
    const sub = r.data.submissions.find((s) => s.id === r.data.id);
    assert.ok(!sub.original_name.includes('/'), 'sanitized name');
    if (title === 'كاميرا') assert.equal(sub.source, 'camera');
    const f = await st.get(`/api/files/${r.data.id}`);
    assert.equal(f.status, 200);
    assert.ok(f.headers.get('content-type').startsWith(expType), `${name}: ${f.headers.get('content-type')}`);
    assert.ok(f.headers.get('content-disposition').startsWith(expDisp), name);
    assert.equal(f.headers.get('x-content-type-options'), 'nosniff');
    assert.match(f.headers.get('content-security-policy'), /sandbox/);
    assert.deepEqual(Buffer.from(f.data), content);
    const d = await st.get(`/api/files/${r.data.id}?download=1`);
    assert.ok(d.headers.get('content-disposition').startsWith('attachment'));
  }
  // الاسم العربي محفوظ
  const me = (await st.get('/api/student/me')).data;
  assert.ok(me.submissions.some((s) => s.original_name === 'صورة الدرس.png'));
  assert.ok(me.submissions.some((s) => s.original_name === 'passwd.sh'));
  // أسماء التخزين UUID وخارج المجلد العام
  for (const r of db.prepare('SELECT stored_name FROM submissions').all()) {
    assert.match(r.stored_name, /^[0-9a-f-]{36}$/);
  }

  // تجاوز الحد (1 ميجابايت في الاختبار)
  const before = fs.readdirSync(path.join(dataDir, 'uploads')).length;
  const big = await st.upload('كبير', 'big.bin', Buffer.alloc(1024 * 1024 + 10));
  assert.equal(big.status, 413);
  assert.match(big.data.error, /يتجاوز الحد المسموح \(1 ميجابايت\)/);
  assert.equal(fs.readdirSync(path.join(dataDir, 'uploads')).length, before, 'no leftover file');
  // رفع الحد من الإعدادات
  await T.put('/api/admin/settings', { maxFileMb: 2 });
  assert.equal((await st.upload('كبير', 'big.bin', Buffer.alloc(1024 * 1024 + 10))).status, 201);

  // عنوان إلزامي
  assert.equal((await st.upload('  ', 'a.txt', 'a')).status, 400);
  // مسار ملفات بمعرّف غير صالح
  assert.equal((await T.get('/api/files/..%2F..%2Fapp.db')).status, 404);
});

test('إدارة الطلاب: التكرار، النقل، الاستيراد بعمود الفصل، والحذف مع الملفات', async () => {
  let r = await T.post('/api/admin/students', { classId: classA, names: ['سالم'] });
  assert.equal(r.status, 409);
  assert.deepEqual(r.data.duplicates, ['سالم']);
  r = await T.post('/api/admin/students', { classId: classA, names: ['مكرر', 'مكرر'] });
  assert.equal(r.status, 409);
  r = await T.post('/api/admin/students', { classId: classA, names: ['سالم'], allowDuplicates: true });
  assert.equal(r.status, 201);

  r = await T.post('/api/admin/students', {
    students: [
      { name: 'ريم', className: 'الفصل ب' },
      { name: 'فهد', className: 'فصل مستورد' },
    ],
  });
  assert.equal(r.status, 201);
  assert.deepEqual(r.data.newClasses, ['فصل مستورد']);

  const ov = (await T.get('/api/admin/overview')).data;
  const reem = ov.students.find((s) => s.name === 'ريم');
  assert.equal(reem.classId, classB);
  // نقل وتعديل
  assert.equal((await T.patch(`/api/admin/students/${reem.id}`, { classId: classA, name: 'ريم محمد' })).status, 200);
  const moved = (await T.get('/api/admin/overview')).data.students.find((s) => s.id === reem.id);
  assert.equal(moved.classId, classA);
  assert.equal(moved.name, 'ريم محمد');

  // حذف طالب يحذف ملفاته
  const st = await studentClient(reem.id);
  await st.upload('ع', 'r.txt', 'r');
  const before = fs.readdirSync(path.join(dataDir, 'uploads')).length;
  assert.equal((await T.del(`/api/admin/students/${reem.id}`)).status, 200);
  assert.equal(fs.readdirSync(path.join(dataDir, 'uploads')).length, before - 1);
  assert.equal((await st.get('/api/student/me')).status, 401);
});

test('كشف الطباعة وتصدير Excel', async () => {
  const r = (await T.get('/api/admin/report?classId=all')).data;
  assert.ok(r.classes.length >= 2);
  assert.ok(r.classes[0].students.every((s, i) => s.no === i + 1));
  const x = await T.get(`/api/admin/export.xlsx?classId=${classA}`);
  assert.equal(x.status, 200);
  assert.match(x.headers.get('content-disposition'), /filename\*=UTF-8''/);
  const XLSX = require('xlsx');
  const wb = XLSX.read(x.data);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  assert.deepEqual(rows[0], ['م', 'اسم الطالب', 'عدد الإضافات', 'الدرجة من 10']);
});
