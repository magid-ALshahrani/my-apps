(function () {
  'use strict';
  const { api, esc, icon, toast, confirmDialog, fmtDateTime, fmtSize, uploadWithProgress, openModal, closeModal } = window.EP;
  const $ = (id) => document.getElementById(id);

  let state = null;
  let clockSkew = 0; // فرق ساعة الجهاز عن الخادم
  let tick = null;
  const R = 86;
  const C = 2 * Math.PI * R;

  // ---------- العرض ----------
  function animateNumber(el, to) {
    const from = Number(el.textContent) || 0;
    if (from === to) return;
    const start = performance.now();
    const dur = 700;
    const step = (t) => {
      const p = Math.min(1, (t - start) / dur);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function renderHead() {
    const s = state;
    $('sName').textContent = s.student.name;
    $('sClass').textContent = s.student.className;
    $('sScore').textContent = `${s.score}/${s.maxSlots}`;
    $('sCount').textContent = s.count;
    $('sLeft').textContent = s.maxSlots - s.count;
    $('ringMax').textContent = s.maxSlots;
    animateNumber($('ringNum'), s.count);
    const bar = $('ringBar');
    bar.style.strokeDasharray = `${C}`;
    bar.style.strokeDashoffset = `${C * (1 - s.count / s.maxSlots)}`;
    $('ringWrap').setAttribute('aria-label', `أنجزت ${s.count} من ${s.maxSlots}`);
  }

  function renderDeadline() {
    const box = $('deadline');
    clearInterval(tick);
    const s = state;
    if (!s.canEdit) {
      box.innerHTML = `<div class="notice danger">${icon('lock')}<div><b>انتهى الموعد النهائي</b> (${esc(fmtDateTime(s.deadline))}).<br>لم يعد بإمكانك إضافة أعمال أو حذفها، ويمكنك عرض أعمالك وتحميلها فقط.</div></div>`;
      return;
    }
    if (s.viaOverride) {
      box.innerHTML = `<div class="notice ok">${icon('unlock')}<div><b>فتح لك المعلم الرفع بعد الموعد</b>${
        s.overrideUntil ? ` حتى ${esc(fmtDateTime(s.overrideUntil))}` : ''
      }.</div></div>`;
      return;
    }
    if (!s.deadline) {
      box.innerHTML = '';
      return;
    }
    const end = Date.parse(s.deadline);
    const paint = () => {
      const left = end - (Date.now() + clockSkew);
      if (left <= 0) {
        clearInterval(tick);
        load(); // يعيد الحالة من الخادم بعد انتهاء الموعد
        return;
      }
      const d = Math.floor(left / 864e5);
      const h = Math.floor((left % 864e5) / 36e5);
      const m = Math.floor((left % 36e5) / 6e4);
      const sec = Math.floor((left % 6e4) / 1e3);
      const urgent = left < 864e5;
      box.innerHTML = `<div class="notice ${urgent ? 'warn' : 'ok'} countdown">${icon('clock')}
        <div style="flex:1;min-width:180px"><b>الوقت المتبقي على الموعد النهائي</b><br><span class="muted">${esc(fmtDateTime(s.deadline))}</span></div>
        <div class="units" aria-live="off">
          <div class="unit"><b>${d}</b><small>يوم</small></div>
          <div class="unit"><b>${h}</b><small>ساعة</small></div>
          <div class="unit"><b>${m}</b><small>دقيقة</small></div>
          <div class="unit"><b>${sec}</b><small>ثانية</small></div>
        </div></div>`;
    };
    paint();
    tick = setInterval(paint, 1000);
  }

  function renderSlots() {
    const bySlot = new Map(state.submissions.map((s) => [s.slot, s]));
    const html = [];
    for (let i = 1; i <= state.maxSlots; i++) {
      const sub = bySlot.get(i);
      if (!sub) {
        html.push(`<button type="button" class="slot empty" data-add="${i}" ${state.canEdit ? '' : 'disabled'} aria-label="إضافة عمل في الخانة ${i}">
          <span class="slot-num">${i}</span>
          <span class="plus">${icon(state.canEdit ? 'plus' : 'lock')}</span>
          <span>${state.canEdit ? 'إضافة عمل' : 'مغلقة'}</span></button>`);
        continue;
      }
      const rejected = sub.status === 'rejected';
      html.push(`<article class="slot ${rejected ? 'rejected' : ''}">
        <span class="slot-num">${i}</span>
        <h3>${esc(sub.title)}</h3>
        <div class="file-name">${icon(sub.source === 'camera' ? 'camera' : 'file')}<span>${esc(sub.original_name)}</span><span class="muted">· ${fmtSize(sub.size)}</span></div>
        <div class="when">${esc(fmtDateTime(sub.created_at))}</div>
        <div>${
          rejected
            ? `<span class="badge badge-danger">${icon('slash')} مرفوض · 0 درجة</span>`
            : `<span class="badge badge-success">${icon('check')} مقبول · درجة واحدة</span>`
        }</div>
        ${rejected && sub.reject_reason ? `<div class="reason">السبب: ${esc(sub.reject_reason)}</div>` : ''}
        <div class="actions">
          <a class="btn btn-sm" href="/api/files/${sub.id}" target="_blank" rel="noopener">${icon('eye')}فتح</a>
          <a class="btn btn-sm" href="/api/files/${sub.id}?download=1" download>${icon('download')}تحميل</a>
          ${state.canEdit ? `<button type="button" class="btn btn-sm btn-danger icon-btn" data-del="${sub.id}" aria-label="حذف ${esc(sub.title)}">${icon('trash')}</button>` : ''}
        </div>
      </article>`);
    }
    $('slots').innerHTML = html.join('');
  }

  function apply(data) {
    state = data;
    clockSkew = Date.parse(data.serverNow) - Date.now();
    $('maxMb').textContent = data.maxFileMb;
    renderHead();
    renderDeadline();
    renderSlots();
  }

  async function load() {
    try {
      apply(await api('/api/student/me'));
      $('loading').hidden = true;
      $('app').hidden = false;
    } catch (err) {
      if (err.status === 401) return location.replace('/');
      $('loading').innerHTML = `${icon('alert')}<h3>تعذّر تحميل ملفك</h3><p>${esc(err.message)}</p><a class="btn" href="/student">إعادة المحاولة</a>`;
    }
  }

  // ---------- الحذف ----------
  $('slots').addEventListener('click', async (e) => {
    const add = e.target.closest('[data-add]');
    if (add && !add.disabled) return openAdd(Number(add.dataset.add));
    const del = e.target.closest('[data-del]');
    if (!del) return;
    const sub = state.submissions.find((s) => s.id === Number(del.dataset.del));
    const ok = await confirmDialog({
      title: 'حذف العمل',
      message: `سيتم حذف «<b>${esc(sub.title)}</b>» نهائيًا، وتعود الخانة فارغة وتنقص درجتك. هل أنت متأكد؟`,
      confirmText: 'نعم، احذف',
      danger: true,
    });
    if (!ok) return;
    del.disabled = true;
    try {
      apply(await api(`/api/student/submissions/${sub.id}`, { method: 'DELETE' }));
      toast('تم حذف العمل.');
    } catch (err) {
      toast(err.message, 'error');
      load();
    }
  });

  // ---------- نافذة الإضافة ----------
  const dlg = $('addDlg');
  let pending = null; // { file, source }
  let slot = null;
  let stream = null;

  function setTab(name) {
    dlg.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    dlg.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== name));
    if (name === 'camera') startCamera();
    else stopCamera();
  }

  function showError(msg) {
    const b = $('formError');
    b.hidden = !msg;
    b.innerHTML = msg ? `${icon('alert')}<div>${esc(msg)}</div>` : '';
  }

  function setPending(file, source) {
    showError('');
    if (file && file.size > state.maxFileMb * 1024 * 1024) {
      pending = null;
      $('picked').hidden = true;
      showError(`حجم الملف (${fmtSize(file.size)}) يتجاوز الحد المسموح (${state.maxFileMb} ميجابايت).`);
      return;
    }
    if (file && file.size === 0) {
      showError('الملف فارغ.');
      return;
    }
    pending = file ? { file, source } : null;
    const p = $('picked');
    p.hidden = !file;
    if (file) {
      p.innerHTML = `${icon(source === 'camera' ? 'camera' : 'file')}<div style="flex:1"><b>${esc(file.name)}</b><br><span class="muted">${fmtSize(
        file.size
      )}</span></div><span class="badge badge-success">${icon('check')} جاهز</span>`;
    }
  }

  function openAdd(n) {
    slot = n;
    $('addSlot').textContent = n;
    $('addForm').reset();
    setPending(null);
    showError('');
    $('upProgress').hidden = true;
    $('saveBtn').disabled = false;
    setTab('file');
    openModal(dlg);
    setTimeout(() => $('title').focus(), 50);
  }

  dlg.addEventListener('close', stopCamera);
  dlg.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));

  $('fileInput').addEventListener('change', (e) => setPending(e.target.files[0], 'upload'));
  $('captureInput').addEventListener('change', (e) => setPending(e.target.files[0], 'camera'));

  const dz = $('dropzone');
  ['dragenter', 'dragover'].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add('drag');
    })
  );
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('drag')));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files[0]) setPending(e.dataTransfer.files[0], 'upload');
  });

  // الكاميرا: getUserMedia أولًا، ثم input capture كبديل
  function camView(which) {
    ['camLive', 'camPreview', 'camStarting', 'camFallback'].forEach((id) => ($(id).hidden = id !== which));
  }

  async function startCamera() {
    if (pending?.source === 'camera') return camView('camPreview');
    camView('camStarting');
    if (!navigator.mediaDevices?.getUserMedia) {
      $('camFallbackMsg').textContent = 'متصفحك لا يدعم تشغيل الكاميرا مباشرة. استخدم كاميرا الجهاز بدلًا من ذلك.';
      return camView('camFallback');
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      });
      if (!dlg.open) return stopCamera();
      $('video').srcObject = stream;
      camView('camLive');
    } catch (err) {
      $('camFallbackMsg').textContent =
        err && err.name === 'NotAllowedError'
          ? 'لم يُسمح باستخدام الكاميرا. يمكنك السماح بها من إعدادات المتصفح، أو استخدام كاميرا الجهاز بالأسفل.'
          : 'تعذّر تشغيل الكاميرا مباشرة. استخدم كاميرا الجهاز بدلًا من ذلك.';
      camView('camFallback');
    }
  }

  function stopCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    $('video').srcObject = null;
  }

  let snapBlob = null;
  $('snap').addEventListener('click', () => {
    const v = $('video');
    if (!v.videoWidth) return toast('انتظر لحظة حتى تعمل الكاميرا.', 'error');
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob(
      (blob) => {
        snapBlob = blob;
        $('snapImg').src = URL.createObjectURL(blob);
        stopCamera();
        camView('camPreview');
      },
      'image/jpeg',
      0.9
    );
  });

  $('retake').addEventListener('click', () => {
    snapBlob = null;
    if (pending?.source === 'camera') setPending(null);
    startCamera();
  });

  $('approve').addEventListener('click', () => {
    if (!snapBlob) return;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    setPending(new File([snapBlob], `camera-${stamp}.jpg`, { type: 'image/jpeg' }), 'camera');
    toast('تم اعتماد الصورة.');
  });

  $('addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('title').value.trim();
    if (!title) {
      showError('اكتب عنوان العمل أولًا.');
      $('title').focus();
      return;
    }
    if (!pending) return showError('اختر ملفًا أو التقط صورة واعتمدها.');
    const fd = new FormData();
    fd.append('title', title);
    fd.append('source', pending.source);
    fd.append('slot', String(slot));
    fd.append('file', pending.file, pending.file.name);
    $('saveBtn').disabled = true;
    $('upProgress').hidden = false;
    try {
      const data = await uploadWithProgress('/api/student/submissions', fd, (p) => {
        $('upBar').style.width = `${Math.round(p * 100)}%`;
        $('upPct').textContent = Math.round(p * 100);
      });
      closeModal(dlg);
      apply(data);
      toast('تم حفظ العمل وإضافة درجة 🎉');
    } catch (err) {
      showError(err.message);
      $('saveBtn').disabled = false;
      $('upProgress').hidden = true;
      if (err.status === 401) location.replace('/');
      if (err.status === 403 || err.status === 409) load();
    }
  });

  $('logout').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.href = '/';
  });

  // تحديث الحالة عند العودة للصفحة (قرارات المعلم، تغيير الموعد)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state && !dlg.open) load();
  });
  setInterval(() => {
    if (!document.hidden && !dlg.open) load();
  }, 60000);

  load();
})();
