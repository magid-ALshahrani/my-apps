'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { openDb, seedDemo, MAX_SLOTS } = require('./db');
const auth = require('./auth');
const files = require('./files');

const STUDENT_TTL = 30 * 24 * 3600 * 1000;
const STAFF_TTL = 12 * 3600 * 1000;
const RIYADH_OFFSET = '+03:00'; // السعودية بلا توقيت صيفي

// ---------- أدوات ----------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cleanName(s) {
  return String(s ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

// مفتاح مقارنة لاكتشاف التكرار: يتجاهل التشكيل والتطويل وأشكال الألف
function nameKey(s) {
  return cleanName(s)
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase();
}

function riyadhLocalToIso(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return null;
  const d = new Date(`${s}:00${RIYADH_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function intId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function createApp(config) {
  if (!config.sessionSecret) throw new Error('SESSION_SECRET مطلوب');
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  const db = openDb(config.dbPath);
  if (config.seedDemo) seedDemo(db);

  const pins = { teacher: auth.hashPin(config.adminPin), manager: auth.hashPin(config.managerPin) };
  // لا نُبقي النص الصريح في الذاكرة بعد التجزئة
  config.adminPin = undefined;
  config.managerPin = undefined;

  const codec = auth.createSessionCodec(config.sessionSecret);
  const limiter = auth.createPinLimiter();

  // ---------- استعلامات ----------
  const q = {
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ),
    student: db.prepare(
      'SELECT s.id, s.name, s.class_id, c.name AS class_name FROM students s JOIN classes c ON c.id = s.class_id WHERE s.id = ?'
    ),
    classes: db.prepare('SELECT id, name FROM classes ORDER BY id'),
    classById: db.prepare('SELECT id, name FROM classes WHERE id = ?'),
    studentsAll: db.prepare(`
      SELECT s.id, s.name, s.class_id, c.name AS class_name,
             COUNT(sub.id) AS count, COALESCE(SUM(sub.points), 0) AS score
      FROM students s JOIN classes c ON c.id = s.class_id
      LEFT JOIN submissions sub ON sub.student_id = s.id
      GROUP BY s.id ORDER BY c.id, s.id`),
    subsByStudent: db.prepare(
      `SELECT id, slot, title, original_name, mime, size, source, status, points, reject_reason, created_at
       FROM submissions WHERE student_id = ? ORDER BY slot`
    ),
    subById: db.prepare('SELECT * FROM submissions WHERE id = ?'),
    override: db.prepare('SELECT until FROM student_overrides WHERE student_id = ?'),
    overridesAll: db.prepare('SELECT student_id, until FROM student_overrides'),
  };

  const getSetting = (k) => q.getSetting.get(k)?.value ?? null;
  const maxFileMb = () => {
    const v = Number(getSetting('max_file_mb'));
    return Number.isFinite(v) && v > 0 ? v : config.maxFileMb;
  };

  // هل يُسمح للطالب بالرفع/الحذف الآن؟
  function editState(studentId, now = Date.now()) {
    const deadline = getSetting('deadline');
    const ov = q.override.get(studentId);
    const override = ov ? { until: ov.until } : null;
    if (!deadline || now < Date.parse(deadline)) return { open: true, deadline, override };
    if (ov && (!ov.until || now < Date.parse(ov.until))) return { open: true, deadline, override, viaOverride: true };
    return { open: false, deadline, override };
  }

  function studentPayload(studentId) {
    const st = q.student.get(studentId);
    const subs = q.subsByStudent.all(studentId);
    const es = editState(studentId);
    return {
      student: { id: st.id, name: st.name, classId: st.class_id, className: st.class_name },
      submissions: subs,
      count: subs.length,
      score: subs.reduce((a, s) => a + s.points, 0),
      maxSlots: MAX_SLOTS,
      canEdit: es.open,
      viaOverride: !!es.viaOverride,
      deadline: es.deadline,
      overrideUntil: es.override?.until ?? null,
      maxFileMb: maxFileMb(),
      serverNow: new Date().toISOString(),
    };
  }

  function unlinkStored(names) {
    for (const n of names) files.safeUnlink(files.storedPath(config.uploadsDir, n));
  }

  // ---------- التطبيق ----------
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        'font-src https://fonts.gstatic.com',
        "img-src 'self' blob: data:",
        "media-src 'self' blob:",
        "connect-src 'self' https://cdn.jsdelivr.net",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    });
    next();
  });

  // الجلسة
  app.use((req, res, next) => {
    const token = auth.parseCookies(req.headers.cookie)[auth.COOKIE];
    let s = codec.decode(token);
    if (s?.r === 'student' && !q.student.get(s.sid)) s = null; // طالب محذوف
    req.session = s;
    next();
  });

  // عمليات التعديل: تحقق المصدر + منع المدير من أي تعديل
  app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin) {
      let host = null;
      try {
        host = new URL(origin).host;
      } catch {
        /* أصل غير صالح */
      }
      if (host !== req.get('host')) return res.status(403).json({ error: 'طلب من مصدر غير مسموح.' });
    }
    if (req.session?.r === 'manager' && !req.path.startsWith('/api/auth/')) {
      return res.status(403).json({ error: 'صلاحية المدير للاطلاع فقط، ولا يمكنه التعديل.' });
    }
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  const requireStudent = (req, res, next) =>
    req.session?.r === 'student' ? next() : res.status(401).json({ error: 'اختر اسمك أولاً.' });
  const requireStaff = (req, res, next) =>
    req.session && (req.session.r === 'teacher' || req.session.r === 'manager')
      ? next()
      : res.status(401).json({ error: 'يلزم تسجيل الدخول برمز المعلم أو المدير.' });
  const requireTeacher = (req, res, next) =>
    req.session?.r === 'teacher' ? next() : res.status(403).json({ error: 'هذه العملية للمعلم فقط.' });

  // ---------- عام ----------
  app.get('/api/public/students', (req, res) => {
    const classes = q.classes.all().map((c) => ({ id: c.id, name: c.name, students: [] }));
    const byId = new Map(classes.map((c) => [c.id, c]));
    for (const s of q.studentsAll.all()) byId.get(s.class_id)?.students.push({ id: s.id, name: s.name });
    for (const c of classes) c.students.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    res.json({ classes });
  });

  // ---------- الدخول ----------
  app.get('/api/auth/me', (req, res) => {
    const s = req.session;
    if (!s) return res.json({ role: null });
    if (s.r === 'student') {
      const st = q.student.get(s.sid);
      return res.json({ role: 'student', student: { id: st.id, name: st.name, className: st.class_name } });
    }
    res.json({ role: s.r });
  });

  app.post('/api/auth/student', (req, res) => {
    const id = intId(req.body?.studentId);
    const st = id && q.student.get(id);
    if (!st) return res.status(404).json({ error: 'الاسم غير موجود في القائمة.' });
    const exp = Date.now() + STUDENT_TTL;
    auth.setSessionCookie(req, res, codec.encode({ r: 'student', sid: st.id, exp }), STUDENT_TTL);
    res.json({ ok: true });
  });

  app.post('/api/auth/pin', (req, res) => {
    const role = req.body?.role === 'manager' ? 'manager' : 'teacher';
    const key = `${req.ip}`;
    const lock = limiter.check(key);
    if (lock.locked) {
      const mins = Math.ceil(lock.retryMs / 60000);
      return res.status(429).json({ error: `تم إيقاف الدخول مؤقتًا بسبب محاولات خاطئة. حاول بعد ${mins} دقيقة.` });
    }
    if (!pins[role]) return res.status(503).json({ error: 'رمز الدخول لهذا الدور غير مضبوط على الخادم.' });
    if (!auth.verifyPin(pins[role], typeof req.body?.pin === 'string' ? req.body.pin : '')) {
      const f = limiter.fail(key);
      if (f.locked) {
        return res
          .status(429)
          .json({ error: `تم إيقاف الدخول مؤقتًا بسبب محاولات خاطئة. حاول بعد ${Math.ceil(f.retryMs / 60000)} دقيقة.` });
      }
      return res.status(401).json({ error: `الرمز غير صحيح. المحاولات المتبقية: ${f.remaining}` });
    }
    limiter.success(key);
    auth.setSessionCookie(req, res, codec.encode({ r: role, exp: Date.now() + STAFF_TTL }), STAFF_TTL);
    res.json({ ok: true, role });
  });

  app.post('/api/auth/logout', (req, res) => {
    auth.clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // ---------- الطالب ----------
  app.get('/api/student/me', requireStudent, (req, res) => res.json(studentPayload(req.session.sid)));

  const storage = multer.diskStorage({
    destination: config.uploadsDir,
    filename: (req, file, cb) => cb(null, crypto.randomUUID()),
  });

  function checkCanAdd(studentId) {
    const es = editState(studentId);
    if (!es.open) throw new HttpError(403, 'انتهى الموعد النهائي. لا يمكن الإضافة أو الحذف، ويمكنك الاطلاع والتحميل فقط.');
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM submissions WHERE student_id = ?').get(studentId);
    if (n >= MAX_SLOTS) throw new HttpError(409, `اكتملت الخانات العشر. احذف عملاً قبل إضافة جديد.`);
  }

  app.post(
    '/api/student/submissions',
    requireStudent,
    (req, res, next) => {
      // فحص مبكر قبل استقبال الملف
      try {
        checkCanAdd(req.session.sid);
      } catch (e) {
        return next(e);
      }
      const mb = maxFileMb();
      multer({
        storage,
        defParamCharset: 'utf8',
        limits: { fileSize: Math.floor(mb * 1024 * 1024), files: 1, fields: 5, fieldSize: 4096 },
      }).single('file')(req, res, (err) => {
        if (!err) return next();
        if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `حجم الملف يتجاوز الحد المسموح (${mb} ميجابايت).`));
        next(new HttpError(400, 'تعذّر استلام الملف. حاول مرة أخرى.'));
      });
    },
    (req, res, next) => {
      const file = req.file;
      const fail = (status, msg) => {
        if (file) files.safeUnlink(file.path);
        next(new HttpError(status, msg));
      };
      if (!file) return fail(400, 'لم يتم اختيار ملف.');
      if (file.size === 0) return fail(400, 'الملف فارغ.');
      const title = cleanName(req.body?.title).slice(0, 120);
      if (!title) return fail(400, 'عنوان العمل مطلوب.');
      const source = req.body?.source === 'camera' ? 'camera' : 'upload';
      const original = files.sanitizeFileName(file.originalname);
      const wanted = intId(req.body?.slot);
      const sid = req.session.sid;
      try {
        const id = db.transaction(() => {
          checkCanAdd(sid);
          const used = new Set(q.subsByStudent.all(sid).map((s) => s.slot));
          let slot = wanted && wanted <= MAX_SLOTS && !used.has(wanted) ? wanted : null;
          for (let i = 1; !slot && i <= MAX_SLOTS; i++) if (!used.has(i)) slot = i;
          return db
            .prepare(
              `INSERT INTO submissions (student_id, slot, title, original_name, stored_name, mime, size, source)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(sid, slot, title, original, file.filename, files.mimeFromName(original), file.size, source)
            .lastInsertRowid;
        })();
        res.status(201).json({ ok: true, id, ...studentPayload(sid) });
      } catch (e) {
        fail(e.status || 500, e.status ? e.message : 'تعذّر حفظ العمل.');
      }
    }
  );

  app.delete('/api/student/submissions/:id', requireStudent, (req, res) => {
    const sub = q.subById.get(intId(req.params.id) || 0);
    if (!sub || sub.student_id !== req.session.sid) return res.status(404).json({ error: 'العمل غير موجود.' });
    if (!editState(req.session.sid).open) {
      return res.status(403).json({ error: 'انتهى الموعد النهائي. لا يمكن الحذف بعد الموعد.' });
    }
    db.prepare('DELETE FROM submissions WHERE id = ?').run(sub.id);
    unlinkStored([sub.stored_name]);
    res.json({ ok: true, ...studentPayload(req.session.sid) });
  });

  // ---------- تقديم الملفات (محمي) ----------
  app.get('/api/files/:id', (req, res) => {
    const s = req.session;
    if (!s) return res.status(401).json({ error: 'غير مصرح.' });
    const sub = q.subById.get(intId(req.params.id) || 0);
    // الطالب لا يرى إلا ملفاته؛ ونُرجع 404 حتى لا نكشف وجود ملفات غيره
    if (!sub || (s.r === 'student' && sub.student_id !== s.sid)) return res.status(404).json({ error: 'الملف غير موجود.' });
    if (!['student', 'teacher', 'manager'].includes(s.r)) return res.status(403).json({ error: 'غير مصرح.' });
    const full = files.storedPath(config.uploadsDir, sub.stored_name);
    if (!full || !fs.existsSync(full)) return res.status(404).json({ error: 'الملف غير موجود على الخادم.' });
    const inline = req.query.download !== '1' && files.INLINE_SAFE.has(sub.mime);
    res.set({
      'Content-Type': inline ? sub.mime : 'application/octet-stream',
      'Content-Disposition': files.contentDisposition(inline ? 'inline' : 'attachment', sub.original_name),
      'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
      'Cache-Control': 'private, no-store',
    });
    res.sendFile(full, { dotfiles: 'deny', headers: {} });
  });

  // ---------- المعلم والمدير ----------
  const admin = express.Router();
  admin.use(requireStaff);
  admin.use((req, res, next) =>
    ['GET', 'HEAD'].includes(req.method) ? next() : requireTeacher(req, res, next)
  );

  function overview() {
    const students = q.studentsAll.all().map((s) => ({
      id: s.id,
      name: s.name,
      classId: s.class_id,
      className: s.class_name,
      count: s.count,
      score: s.score,
      percent: Math.round((s.count / MAX_SLOTS) * 100),
    }));
    const classes = q.classes.all().map((c) => {
      const list = students.filter((s) => s.classId === c.id);
      const avg = list.length ? Math.round(list.reduce((a, s) => a + s.percent, 0) / list.length) : 0;
      return { id: c.id, name: c.name, studentCount: list.length, avgPercent: avg };
    });
    const avg = students.length ? Math.round(students.reduce((a, s) => a + s.percent, 0) / students.length) : 0;
    return {
      summary: {
        students: students.length,
        avgPercent: avg,
        completed: students.filter((s) => s.count >= MAX_SLOTS).length,
      },
      classes,
      students,
      maxSlots: MAX_SLOTS,
    };
  }

  admin.get('/overview', (req, res) => res.json({ role: req.session.r, ...overview() }));

  admin.get('/students/:id', (req, res) => {
    const id = intId(req.params.id);
    const st = id && q.student.get(id);
    if (!st) return res.status(404).json({ error: 'الطالب غير موجود.' });
    res.json(studentPayload(id));
  });

  admin.patch('/submissions/:id', (req, res) => {
    const sub = q.subById.get(intId(req.params.id) || 0);
    if (!sub) return res.status(404).json({ error: 'العمل غير موجود.' });
    const status = req.body?.status;
    if (status === 'rejected') {
      const reason = cleanName(req.body?.reason).slice(0, 300) || null;
      db.prepare("UPDATE submissions SET status='rejected', points=0, reject_reason=? WHERE id=?").run(reason, sub.id);
    } else if (status === 'accepted') {
      db.prepare("UPDATE submissions SET status='accepted', points=1, reject_reason=NULL WHERE id=?").run(sub.id);
    } else {
      return res.status(400).json({ error: 'حالة غير صالحة.' });
    }
    res.json({ ok: true, ...studentPayload(sub.student_id) });
  });

  // الفصول
  admin.post('/classes', (req, res) => {
    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'اسم الفصل مطلوب.' });
    const dup = q.classes.all().some((c) => nameKey(c.name) === nameKey(name));
    if (dup) return res.status(409).json({ error: 'يوجد فصل بالاسم نفسه.' });
    const id = db.prepare('INSERT INTO classes (name) VALUES (?)').run(name).lastInsertRowid;
    res.status(201).json({ ok: true, id });
  });

  admin.patch('/classes/:id', (req, res) => {
    const id = intId(req.params.id);
    const name = cleanName(req.body?.name);
    if (!id || !q.classById.get(id)) return res.status(404).json({ error: 'الفصل غير موجود.' });
    if (!name) return res.status(400).json({ error: 'اسم الفصل مطلوب.' });
    if (q.classes.all().some((c) => c.id !== id && nameKey(c.name) === nameKey(name))) {
      return res.status(409).json({ error: 'يوجد فصل بالاسم نفسه.' });
    }
    db.prepare('UPDATE classes SET name = ? WHERE id = ?').run(name, id);
    res.json({ ok: true });
  });

  admin.delete('/classes/:id', (req, res) => {
    const id = intId(req.params.id);
    if (!id || !q.classById.get(id)) return res.status(404).json({ error: 'الفصل غير موجود.' });
    const stored = db
      .prepare('SELECT sub.stored_name FROM submissions sub JOIN students s ON s.id = sub.student_id WHERE s.class_id = ?')
      .all(id)
      .map((r) => r.stored_name);
    db.prepare('DELETE FROM classes WHERE id = ?').run(id);
    unlinkStored(stored);
    res.json({ ok: true });
  });

  // الطلاب: إضافة جماعية. كل عنصر {name, className?}؛ أو names[] مع classId
  admin.post('/students', (req, res) => {
    const body = req.body || {};
    const classId = intId(body.classId);
    let items = [];
    if (Array.isArray(body.names)) items = body.names.map((n) => ({ name: n, classId }));
    if (Array.isArray(body.students)) {
      items = body.students.map((s) => ({ name: s?.name, className: cleanName(s?.className), classId }));
    }
    items = items.map((i) => ({ ...i, name: cleanName(i.name) })).filter((i) => i.name);
    if (!items.length) return res.status(400).json({ error: 'لا توجد أسماء صالحة للإضافة.' });
    if (items.length > 2000) return res.status(400).json({ error: 'عدد الأسماء كبير جدًا في دفعة واحدة.' });
    if (items.some((i) => !i.className && !i.classId)) return res.status(400).json({ error: 'اختر الفصل.' });
    if (classId && !q.classById.get(classId)) return res.status(404).json({ error: 'الفصل غير موجود.' });

    const classes = q.classes.all();
    const findClass = (name) => classes.find((c) => nameKey(c.name) === nameKey(name));
    const newClasses = [...new Set(items.filter((i) => i.className && !findClass(i.className)).map((i) => i.className))];

    // اكتشاف التكرار داخل الفصل نفسه (مع الموجود ومع الدفعة نفسها)
    const existing = new Set(q.studentsAll.all().map((s) => `${s.class_id}|${nameKey(s.name)}`));
    const seen = new Set();
    const duplicates = [];
    for (const i of items) {
      const cid = i.className ? findClass(i.className)?.id ?? `new:${nameKey(i.className)}` : i.classId;
      const k = `${cid}|${nameKey(i.name)}`;
      if (existing.has(k) || seen.has(k)) duplicates.push(i.name);
      seen.add(k);
    }
    if (duplicates.length && body.allowDuplicates !== true) {
      return res.status(409).json({ error: 'توجد أسماء مكررة في الفصل نفسه.', duplicates: [...new Set(duplicates)] });
    }

    const insClass = db.prepare('INSERT INTO classes (name) VALUES (?)');
    const insStudent = db.prepare('INSERT INTO students (class_id, name) VALUES (?, ?)');
    const added = db.transaction(() => {
      const ids = new Map();
      for (const n of newClasses) ids.set(nameKey(n), insClass.run(n).lastInsertRowid);
      let count = 0;
      for (const i of items) {
        const cid = i.className ? findClass(i.className)?.id ?? ids.get(nameKey(i.className)) : i.classId;
        insStudent.run(cid, i.name);
        count++;
      }
      return count;
    })();
    res.status(201).json({ ok: true, added, newClasses });
  });

  admin.patch('/students/:id', (req, res) => {
    const id = intId(req.params.id);
    const st = id && q.student.get(id);
    if (!st) return res.status(404).json({ error: 'الطالب غير موجود.' });
    const name = req.body?.name !== undefined ? cleanName(req.body.name) : st.name;
    const classId = req.body?.classId !== undefined ? intId(req.body.classId) : st.class_id;
    if (!name) return res.status(400).json({ error: 'اسم الطالب مطلوب.' });
    if (!classId || !q.classById.get(classId)) return res.status(404).json({ error: 'الفصل غير موجود.' });
    const dup = db
      .prepare('SELECT name FROM students WHERE class_id = ? AND id != ?')
      .all(classId, id)
      .some((s) => nameKey(s.name) === nameKey(name));
    if (dup && req.body?.allowDuplicates !== true) {
      return res.status(409).json({ error: 'يوجد طالب بالاسم نفسه في هذا الفصل.', duplicates: [name] });
    }
    db.prepare('UPDATE students SET name = ?, class_id = ? WHERE id = ?').run(name, classId, id);
    res.json({ ok: true });
  });

  admin.delete('/students/:id', (req, res) => {
    const id = intId(req.params.id);
    if (!id || !q.student.get(id)) return res.status(404).json({ error: 'الطالب غير موجود.' });
    const stored = db.prepare('SELECT stored_name FROM submissions WHERE student_id = ?').all(id).map((r) => r.stored_name);
    db.prepare('DELETE FROM students WHERE id = ?').run(id);
    unlinkStored(stored);
    res.json({ ok: true });
  });

  // الإعدادات
  function settingsPayload() {
    const names = new Map(q.studentsAll.all().map((s) => [s.id, s]));
    return {
      deadline: getSetting('deadline'),
      maxFileMb: maxFileMb(),
      overrides: q.overridesAll.all().map((o) => ({
        studentId: o.student_id,
        name: names.get(o.student_id)?.name,
        className: names.get(o.student_id)?.class_name,
        until: o.until,
      })),
      serverNow: new Date().toISOString(),
    };
  }

  admin.get('/settings', (req, res) => res.json(settingsPayload()));

  admin.put('/settings', (req, res) => {
    const b = req.body || {};
    if (b.deadline !== undefined) {
      if (b.deadline === null || b.deadline === '') q.setSetting.run('deadline', null);
      else {
        const iso = riyadhLocalToIso(b.deadline);
        if (!iso) return res.status(400).json({ error: 'صيغة الموعد غير صحيحة.' });
        q.setSetting.run('deadline', iso);
      }
    }
    if (b.maxFileMb !== undefined) {
      const mb = Number(b.maxFileMb);
      if (!Number.isFinite(mb) || mb <= 0 || mb > 1024) return res.status(400).json({ error: 'الحد الأقصى للحجم بين 1 و1024 ميجابايت.' });
      q.setSetting.run('max_file_mb', String(mb));
    }
    res.json({ ok: true, ...settingsPayload() });
  });

  admin.put('/overrides/:studentId', (req, res) => {
    const id = intId(req.params.studentId);
    if (!id || !q.student.get(id)) return res.status(404).json({ error: 'الطالب غير موجود.' });
    let until = null;
    if (req.body?.until) {
      until = riyadhLocalToIso(req.body.until);
      if (!until) return res.status(400).json({ error: 'صيغة التاريخ غير صحيحة.' });
    }
    db.prepare(
      'INSERT INTO student_overrides (student_id, until) VALUES (?, ?) ON CONFLICT(student_id) DO UPDATE SET until = excluded.until'
    ).run(id, until);
    res.json({ ok: true, ...settingsPayload() });
  });

  admin.delete('/overrides/:studentId', (req, res) => {
    db.prepare('DELETE FROM student_overrides WHERE student_id = ?').run(intId(req.params.studentId) || 0);
    res.json({ ok: true, ...settingsPayload() });
  });

  // كشوف الدرجات
  function report(classIdParam) {
    const ov = overview();
    let classes = ov.classes;
    if (classIdParam && classIdParam !== 'all') {
      const id = intId(classIdParam);
      classes = classes.filter((c) => c.id === id);
      if (!classes.length) throw new HttpError(404, 'الفصل غير موجود.');
    }
    return classes.map((c) => ({
      id: c.id,
      name: c.name,
      students: ov.students
        .filter((s) => s.classId === c.id)
        .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
        .map((s, i) => ({ no: i + 1, name: s.name, count: s.count, score: s.score })),
    }));
  }

  admin.get('/report', (req, res) => res.json({ printedAt: new Date().toISOString(), maxSlots: MAX_SLOTS, classes: report(req.query.classId) }));

  admin.get('/export.xlsx', (req, res) => {
    const classes = report(req.query.classId);
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    const used = new Set();
    for (const c of classes) {
      const rows = [
        ['م', 'اسم الطالب', 'عدد الإضافات', `الدرجة من ${MAX_SLOTS}`],
        ...c.students.map((s) => [s.no, s.name, s.count, s.score]),
      ];
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{ wch: 5 }, { wch: 34 }, { wch: 14 }, { wch: 12 }];
      let sheet = c.name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 28).trim() || 'فصل';
      while (used.has(sheet)) sheet = `${sheet.slice(0, 26)}_${used.size}`;
      used.add(sheet);
      XLSX.utils.book_append_sheet(wb, ws, sheet);
    }
    if (!classes.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['لا توجد بيانات']]), 'فارغ');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fname = classes.length === 1 ? `درجات ${classes[0].name}.xlsx` : 'درجات كل الفصول.xlsx';
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': files.contentDisposition('attachment', fname),
      'Cache-Control': 'private, no-store',
    });
    res.send(buf);
  });

  app.use('/api/admin', admin);

  app.use('/api', (req, res) => res.status(404).json({ error: 'المسار غير موجود.' }));

  // ---------- الواجهة ----------
  const nm = path.join(__dirname, '..', 'node_modules');
  app.use('/vendor/tesseract', express.static(path.join(nm, 'tesseract.js', 'dist')));
  app.use('/vendor/tesseract-core', express.static(path.join(nm, 'tesseract.js-core')));
  app.get('/vendor/xlsx.full.min.js', (req, res) => res.sendFile(path.join(nm, 'xlsx', 'dist', 'xlsx.full.min.js')));
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'], index: 'index.html' }));

  // ---------- الأخطاء ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'حجم الطلب كبير جدًا.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'بيانات غير صالحة.' });
    const status = err.status || 500;
    if (status >= 500) console.error('خطأ داخلي:', err.message);
    res.status(status).json({ error: status >= 500 ? 'حدث خطأ في الخادم.' : err.message });
  });

  return { app, db };
}

module.exports = { createApp, riyadhLocalToIso, nameKey };
