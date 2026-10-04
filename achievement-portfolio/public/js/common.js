// أدوات مشتركة لكل الصفحات
(function () {
  'use strict';

  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 16v-5M12 16V8M17 16v-8"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>',
    sheet: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8M12 11v8"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    alert: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    slash: '<circle cx="12" cy="12" r="10"/><path d="M4.9 4.9l14.2 14.2"/>',
    unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  };

  function icon(name, cls = '') {
    return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  // ---------- طلبات الخادم ----------
  async function api(url, { method = 'GET', body, form } = {}) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (form) opts.body = form;
    else if (body !== undefined) {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch {
      throw Object.assign(new Error('تعذّر الاتصال بالخادم. تحقق من الإنترنت وحاول مجددًا.'), { status: 0 });
    }
    let data = null;
    if ((res.headers.get('content-type') || '').includes('json')) data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(data?.error || 'حدث خطأ غير متوقع.');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // رفع مع مؤشر تقدم
  function uploadWithProgress(url, form, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.responseType = 'json';
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        const data = xhr.response;
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(Object.assign(new Error(data?.error || 'تعذّر رفع الملف.'), { status: xhr.status, data }));
      };
      xhr.onerror = () => reject(new Error('انقطع الاتصال أثناء الرفع. حاول مرة أخرى.'));
      xhr.send(form);
    });
  }

  // ---------- إشعارات ----------
  function toast(msg, type = 'success') {
    let box = document.querySelector('.toasts');
    if (!box) {
      box = document.createElement('div');
      box.className = 'toasts';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `${icon(type === 'error' ? 'alert' : 'check')}<span>${esc(msg)}</span>`;
    box.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, type === 'error' ? 5500 : 3200);
  }

  // ---------- نوافذ ----------
  function openModal(dlg) {
    if (!dlg.open) dlg.showModal();
  }

  function closeModal(dlg) {
    if (dlg.open) dlg.close();
  }

  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-close]');
    if (c) closeModal(c.closest('dialog'));
  });

  // نافذة تأكيد بدل confirm() الأصلية
  function confirmDialog({ title, message, confirmText = 'تأكيد', danger = false, cancelText = 'إلغاء' }) {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.className = 'modal';
      dlg.innerHTML = `
        <div class="modal-head"><h2>${esc(title)}</h2></div>
        <div class="modal-body"><div class="notice ${danger ? 'danger' : 'warn'}">${icon('alert')}<div>${message}</div></div></div>
        <div class="modal-foot">
          <button class="btn ${danger ? 'btn-danger solid' : 'btn-primary'}" data-ok>${esc(confirmText)}</button>
          <button class="btn" data-cancel>${esc(cancelText)}</button>
        </div>`;
      document.body.appendChild(dlg);
      const done = (v) => {
        dlg.close();
        dlg.remove();
        resolve(v);
      };
      dlg.querySelector('[data-ok]').onclick = () => done(true);
      dlg.querySelector('[data-cancel]').onclick = () => done(false);
      dlg.addEventListener('cancel', (e) => {
        e.preventDefault();
        done(false);
      });
      dlg.showModal();
      dlg.querySelector('[data-cancel]').focus();
    });
  }

  // ---------- النمط ----------
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try {
      localStorage.setItem('ep-theme', t);
    } catch {
      /* التخزين غير متاح */
    }
    document.querySelectorAll('[data-theme-toggle]').forEach(paintThemeBtn);
  }

  function paintThemeBtn(btn) {
    const dark = currentTheme() === 'dark';
    btn.innerHTML = icon(dark ? 'sun' : 'moon');
    btn.setAttribute('aria-label', dark ? 'التبديل إلى النمط الفاتح' : 'التبديل إلى النمط الداكن');
    btn.title = btn.getAttribute('aria-label');
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      paintThemeBtn(btn);
      btn.addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
    });
    document.querySelectorAll('[data-icon]').forEach((el) => {
      el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
    });
  });

  // ---------- تنسيق ----------
  const TZ = 'Asia/Riyadh';
  const LOCALE = 'ar-SA-u-ca-gregory-nu-latn';
  const dtFmt = new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const dFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  function fmtDateTime(iso) {
    return iso ? dtFmt.format(new Date(iso)) : '';
  }

  function fmtDate(iso) {
    return dFmt.format(iso ? new Date(iso) : new Date());
  }

  // ISO → "YYYY-MM-DDTHH:mm" بتوقيت الرياض (لحقول datetime-local)
  function toRiyadhLocal(iso) {
    if (!iso) return '';
    const d = new Date(new Date(iso).getTime() + 3 * 3600 * 1000);
    return d.toISOString().slice(0, 16);
  }

  function fmtSize(b) {
    if (b < 1024) return `${b} بايت`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} ك.ب`;
    return `${(b / 1024 / 1024).toFixed(1)} م.ب`;
  }

  function initials(name) {
    return String(name || '؟').trim().charAt(0);
  }

  // توحيد للبحث العربي
  function norm(s) {
    return String(s || '')
      .replace(/[ً-ْـ]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .toLowerCase()
      .trim();
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('تعذّر تحميل مكوّن مطلوب.'));
      document.head.appendChild(s);
    });
  }

  window.EP = {
    icon,
    esc,
    api,
    uploadWithProgress,
    toast,
    openModal,
    closeModal,
    confirmDialog,
    fmtDateTime,
    fmtDate,
    toRiyadhLocal,
    fmtSize,
    initials,
    norm,
    loadScript,
  };
})();
