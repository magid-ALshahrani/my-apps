'use strict';
const Database = require('better-sqlite3');

const MAX_SLOTS = 10;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND ${MAX_SLOTS}),
  title TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('upload','camera')),
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted','rejected')),
  points INTEGER NOT NULL DEFAULT 1 CHECK (points IN (0,1)),
  reject_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (student_id, slot)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS student_overrides (
  student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  until TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

// بيانات تجريبية وهمية فقط، ولا تعمل إلا مع SEED_DEMO=1 وقاعدة فارغة.
function seedDemo(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM classes').get();
  if (n > 0) return false;
  const addClass = db.prepare('INSERT INTO classes (name) VALUES (?)');
  const addStudent = db.prepare('INSERT INTO students (class_id, name) VALUES (?, ?)');
  db.transaction(() => {
    const a = addClass.run('فصل تجريبي (أ)').lastInsertRowid;
    const b = addClass.run('فصل تجريبي (ب)').lastInsertRowid;
    ['طالب تجريبي ١', 'طالب تجريبي ٢', 'طالب تجريبي ٣'].forEach((s) => addStudent.run(a, s));
    ['طالب تجريبي ٤', 'طالب تجريبي ٥', 'طالب تجريبي ٦'].forEach((s) => addStudent.run(b, s));
  })();
  return true;
}

module.exports = { openDb, seedDemo, MAX_SLOTS };
