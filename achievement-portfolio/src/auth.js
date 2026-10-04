'use strict';
const crypto = require('crypto');

const COOKIE = 'ep_sess';

// ---------- PIN: يُجزّأ عند الإقلاع ولا يُحتفظ بالنص الصريح ----------
function hashPin(pin) {
  if (!pin) return null;
  const salt = crypto.randomBytes(16);
  return { salt, hash: crypto.scryptSync(String(pin), salt, 32) };
}

function verifyPin(stored, input) {
  if (!stored || typeof input !== 'string' || !input) return false;
  const h = crypto.scryptSync(input, stored.salt, 32);
  return crypto.timingSafeEqual(h, stored.hash);
}

// ---------- جلسة موقّعة في كوكي (HMAC) ----------
function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function createSessionCodec(secret) {
  const key = crypto.createHash('sha256').update(String(secret)).digest();
  const mac = (data) => crypto.createHmac('sha256', key).update(data).digest('base64url');
  return {
    encode(payload) {
      const data = b64url(JSON.stringify(payload));
      return `${data}.${mac(data)}`;
    },
    decode(token) {
      if (typeof token !== 'string') return null;
      const [data, sig] = token.split('.');
      if (!data || !sig) return null;
      const expected = Buffer.from(mac(data));
      const given = Buffer.from(sig);
      if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
      try {
        const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
        if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
        return payload;
      } catch {
        return null;
      }
    },
  };
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* تجاهل كوكي تالف */
    }
  }
  return out;
}

function setSessionCookie(req, res, value, maxAgeMs) {
  const parts = [`${COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeMs != null) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  if (req.secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req, res) {
  setSessionCookie(req, res, '', 0);
}

// ---------- حد محاولات الـ PIN ----------
function createPinLimiter({ maxFails = 5, windowMs = 15 * 60 * 1000, lockMs = 15 * 60 * 1000 } = {}) {
  const map = new Map();
  return {
    check(key) {
      const e = map.get(key);
      if (e && e.lockedUntil > Date.now()) return { locked: true, retryMs: e.lockedUntil - Date.now() };
      return { locked: false };
    },
    fail(key) {
      const now = Date.now();
      let e = map.get(key);
      if (!e || now - e.first > windowMs || (e.lockedUntil && e.lockedUntil <= now)) {
        e = { fails: 0, first: now, lockedUntil: 0 };
      }
      e.fails += 1;
      if (e.fails >= maxFails) e.lockedUntil = now + lockMs;
      map.set(key, e);
      return { remaining: Math.max(0, maxFails - e.fails), locked: e.lockedUntil > now, retryMs: lockMs };
    },
    success(key) {
      map.delete(key);
    },
  };
}

module.exports = {
  COOKIE,
  hashPin,
  verifyPin,
  createSessionCodec,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  createPinLimiter,
};
