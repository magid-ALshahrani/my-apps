// تشفير النسخ الاحتياطية بكلمة مرور: PBKDF2-SHA256 → AES-256-GCM
export const ENCRYPTED_FORMAT = 'sandooq-backup-encrypted';
const ITERATIONS = 310000;

const enc = new TextEncoder();
const dec = new TextDecoder();
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function chunkedB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function encryptJSON(obj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return {
    format: ENCRYPTED_FORMAT,
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: toB64(salt),
    iv: toB64(iv),
    data: chunkedB64(new Uint8Array(ct)),
  };
}

export async function decryptJSON(wrapper, password) {
  if (wrapper?.format !== ENCRYPTED_FORMAT) throw new Error('ليس ملفاً مشفّراً');
  const iterations = Number(wrapper.iterations);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 5000000) throw new Error('ملف مشفّر غير صالح');
  const key = await deriveKey(password, fromB64(wrapper.salt), iterations);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(wrapper.iv) }, key, fromB64(wrapper.data));
  } catch {
    throw new Error('كلمة مرور الملف غير صحيحة أو الملف تالف');
  }
  return JSON.parse(dec.decode(plain));
}
