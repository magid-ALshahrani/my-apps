(function () {
  'use strict';
  const { api, esc, icon, toast, confirmDialog, fmtDateTime, fmtSize, toRiyadhLocal, openModal, closeModal, norm, loadScript } = window.EP;
  const $ = (id) => document.getElementById(id);

  let role = null;
  let data = null; // overview
  let sort = { key: 'className', dir: 1 };
  let settings = null;
  const isTeacher = () => role === 'teacher';

  // ================= الدخول =================
  let loginRole = 'teacher';
  document.querySelectorAll('[data-role]').forEach((b) =>
    b.addEventListener('click', () => {
      loginRole = b.dataset.role;
      document.querySelectorAll('[data-role]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      $('pin').focus();
    })
  );

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = $('pin').value;
    const err = $('loginError');
    err.hidden = true;
    if (!pin) {
      err.hidden = false;
      err.innerHTML = `${icon('alert')}<div>أدخل الرمز.</div>`;
      return;
    }
    $('loginBtn').disabled = true;
    try {
      await api('/api/auth/pin', { method: 'POST', body: { role: loginRole, pin } });
      $('pin').value = '';
      await boot();
    } catch (ex) {
      err.hidden = false;
      err.innerHTML = `${icon('alert')}<div>${esc(ex.message)}</div>`;
    } finally {
      $('loginBtn').disabled = false;
    }
  });

  $('logout').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.reload();
  });

  function showLogin() {
    $('boot').hidden = true;
    $('dash').hidden = true;
    $('login').hidden = false;
    $('logout').hidden = true;
    $('roleBadge').hidden = true;
    $('pin').focus();
  }

  async function boot() {
    const me = await api('/api/auth/me').catch(() => ({ role: null }));
    if (me.role !== 'teacher' && me.role !== 'manager') return showLogin();
    role = me.role;
    document.body.classList.toggle('readonly', !isTeacher());
    $('readonlyNote').hidden = isTeacher();
    const rb = $('roleBadge');
    rb.hidden = false;
    rb.className = `badge ${isTeacher() ? 'badge-teal' : 'badge-gold'}`;
    rb.textContent = isTeacher() ? 'المعلم' : 'المدير · اطلاع';
    $('login').hidden = true;
    $('logout').hidden = false;
    await refresh();
    $('boot').hidden = true;
    $('dash').hidden = false;
  }

  function handleAuth(err) {
    if (err.status === 401) {
      toast('انتهت الجلسة. سجّل الدخول من جديد.', 'error');
      showLogin();
      return true;
    }
    return false;
  }

  // ================= البيانات =================
  async function refresh() {
    try {
      const [ov, st] = await Promise.all([api('/api/admin/overview'), api('/api/admin/settings')]);
      data = ov;
      settings = st;
      renderAll();
    } catch (err) {
      if (!handleAuth(err)) toast(err.message, 'error');
    }
  }

  function renderAll() {
    renderSummary();
    renderChart();
    renderClassSelects();
    renderTable();
    renderDeadlineInfo();
    if ($('manageDlg').open) renderClassList();
    if ($('settingsDlg').open) renderSettings();
  }

  function renderSummary() {
    $('kStudents').textContent = data.summary.students;
    $('kAvg').textContent = `${data.summary.avgPercent}%`;
    $('kDone').textContent = data.summary.completed;
  }

  function renderDeadlineInfo() {
    const box = $('deadlineInfo');
    const d = settings?.deadline;
    if (!d) {
      box.innerHTML = `<div class="notice">${icon('clock')}<div>لا يوجد موعد نهائي محدد؛ الرفع مفتوح للجميع.</div></div>`;
      return;
    }
    const passed = Date.parse(d) <= Date.parse(settings.serverNow);
    box.innerHTML = `<div class="notice ${passed ? 'danger' : 'ok'}">${icon('clock')}<div>الموعد النهائي: <b>${esc(fmtDateTime(d))}</b> ${
      passed ? '— <b>انتهى</b>، الرفع مغلق' : '— الرفع مفتوح'
    }${settings.overrides.length ? ` · استثناءات: ${settings.overrides.length}` : ''}</div></div>`;
  }

  function renderChart() {
    const box = $('chart');
    if (!data.classes.length) {
      box.innerHTML = `<div class="empty-state">${icon('chart')}<h3>لا توجد فصول بعد</h3>${
        isTeacher() ? '<p>أضف فصلًا من زر «الفصول والطلاب».</p>' : ''
      }</div>`;
      return;
    }
    box.innerHTML = data.classes
      .map(
        (c) => `<div class="chart-row" title="${esc(c.name)}: ${c.avgPercent}%">
          <span class="name">${esc(c.name)} <span class="muted" style="font-size:.8rem">(${c.studentCount})</span></span>
          <div class="bar" role="progressbar" aria-valuenow="${c.avgPercent}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(c.name)}"><span data-w="${c.avgPercent}"></span></div>
          <span class="val">${c.avgPercent}%</span></div>`
      )
      .join('');
    requestAnimationFrame(() => box.querySelectorAll('[data-w]').forEach((s) => (s.style.width = `${s.dataset.w}%`)));
  }

  function classOptions(sel, { all = false, selected } = {}) {
    const cur = selected ?? sel.value;
    sel.innerHTML =
      (all ? '<option value="">كل الفصول</option>' : '') +
      data.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    if ([...sel.options].some((o) => o.value === String(cur))) sel.value = String(cur);
  }

  function renderClassSelects() {
    classOptions($('fClass'), { all: true });
    classOptions($('targetClass'));
    const rc = $('repClass');
    const cur = rc.value || 'all';
    rc.innerHTML = '<option value="all">كل الفصول (فصل في كل صفحة)</option>' + data.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    rc.value = [...rc.options].some((o) => o.value === cur) ? cur : 'all';
    updateReportLinks();
  }

  // ================= الجدول =================
  function filtered() {
    const term = norm($('fSearch').value);
    const cls = $('fClass').value;
    const pct = $('fPct').value;
    const list = data.students.filter((s) => {
      if (term && !norm(s.name).includes(term)) return false;
      if (cls && String(s.classId) !== cls) return false;
      if (pct === 'done' && s.percent < 100) return false;
      if (pct === 'high' && (s.percent < 50 || s.percent >= 100)) return false;
      if (pct === 'low' && (s.percent < 10 || s.percent >= 50)) return false;
      if (pct === 'zero' && s.percent !== 0) return false;
      return true;
    });
    const { key, dir } = sort;
    return list.sort((a, b) => {
      let r = typeof a[key] === 'number' ? a[key] - b[key] : String(a[key]).localeCompare(String(b[key]), 'ar');
      if (r === 0 && key !== 'name') r = a.name.localeCompare(b.name, 'ar');
      return r * dir;
    });
  }

  function renderTable() {
    const rows = filtered();
    document.querySelectorAll('#table th[data-sort]').forEach((th) => {
      th.setAttribute('aria-sort', th.dataset.sort === sort.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none');
    });
    const empty = $('tableEmpty');
    $('table').parentElement.hidden = !rows.length;
    empty.hidden = !!rows.length;
    if (!rows.length) {
      empty.innerHTML = data.students.length
        ? `<div class="empty-state">${icon('search')}<h3>لا نتائج</h3><p>لا يوجد طلاب مطابقون للبحث أو الفلاتر.</p></div>`
        : `<div class="empty-state">${icon('users')}<h3>لا يوجد طلاب بعد</h3>${
            isTeacher() ? '<p>ابدأ بإضافة فصل ثم أضف الطلاب من زر «الفصول والطلاب».</p>' : ''
          }</div>`;
      $('tbody').innerHTML = '';
      return;
    }
    $('tbody').innerHTML = rows
      .map(
        (s, i) => `<tr data-id="${s.id}" tabindex="0">
          <td class="c-num">${i + 1}</td>
          <td class="c-name"><b>${esc(s.name)}</b></td>
          <td data-label="الفصل">${esc(s.className)}</td>
          <td data-label="الإضافات">${s.count} / ${data.maxSlots}</td>
          <td data-label="الدرجة"><span class="score">${s.score}</span> / ${data.maxSlots}</td>
          <td class="c-pct" data-label="نسبة الإنجاز"><div class="pct"><div class="progress"><span style="width:${s.percent}%"></span></div><b>${s.percent}%</b></div></td>
        </tr>`
      )
      .join('');
  }

  document.querySelectorAll('#table th[data-sort] button').forEach((b) =>
    b.addEventListener('click', () => {
      const key = b.parentElement.dataset.sort;
      sort = { key, dir: sort.key === key ? -sort.dir : key === 'name' || key === 'className' ? 1 : -1 };
      renderTable();
    })
  );
  ['fSearch', 'fClass', 'fPct'].forEach((id) => $(id).addEventListener('input', renderTable));
  $('tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) openDrawer(Number(tr.dataset.id));
  });
  $('tbody').addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openDrawer(Number(tr.dataset.id));
    }
  });

  // ================= درج الطالب =================
  let drawerId = null;
  let lastFocus = null;

  async function openDrawer(id) {
    drawerId = id;
    lastFocus = document.activeElement;
    $('drawer').classList.add('open');
    $('drawerBg').classList.add('open');
    $('dName').textContent = data.students.find((s) => s.id === id)?.name || '';
    $('dMeta').textContent = '';
    $('dBody').innerHTML = '<div class="loading-state"><div class="spinner"></div><span>جارٍ تحميل الأعمال…</span></div>';
    $('drawerClose').focus();
    try {
      renderDrawer(await api(`/api/admin/students/${id}`));
    } catch (err) {
      if (handleAuth(err)) return;
      $('dBody').innerHTML = `<div class="empty-state">${icon('alert')}<h3>تعذّر التحميل</h3><p>${esc(err.message)}</p></div>`;
    }
  }

  function closeDrawer() {
    $('drawer').classList.remove('open');
    $('drawerBg').classList.remove('open');
    drawerId = null;
    lastFocus?.focus?.();
  }

  $('drawerClose').addEventListener('click', closeDrawer);
  $('drawerBg').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawerId && !document.querySelector('dialog[open]')) closeDrawer();
  });

  function renderDrawer(p) {
    const st = p.student;
    $('dName').textContent = st.name;
    $('dMeta').innerHTML = `${esc(st.className)} · الدرجة <b class="score">${p.score}</b> / ${p.maxSlots} · ${p.count} إضافات`;
    const subs = p.submissions;
    const items = subs.length
      ? subs
          .map((s) => {
            const rej = s.status === 'rejected';
            return `<div class="sub-item ${rej ? 'rejected' : ''}">
              <div class="row">
                <span class="badge badge-gold">خانة ${s.slot}</span>
                <h4>${esc(s.title)}</h4>
                ${rej ? `<span class="badge badge-danger">مرفوض · 0</span>` : `<span class="badge badge-success">مقبول · 1</span>`}
              </div>
              <div class="meta">${esc(s.original_name)} · ${fmtSize(s.size)} · ${
              s.source === 'camera' ? 'تصوير كاميرا' : 'رفع ملف'
            }<br>أُضيف: ${esc(fmtDateTime(s.created_at))}${
              rej && s.reject_reason ? `<br><span style="color:var(--danger)">السبب: ${esc(s.reject_reason)}</span>` : ''
            }</div>
              <div class="actions">
                <a class="btn btn-sm" href="/api/files/${s.id}" target="_blank" rel="noopener">${icon('eye')}فتح</a>
                <a class="btn btn-sm" href="/api/files/${s.id}?download=1" download>${icon('download')}تحميل</a>
                ${
                  rej
                    ? `<button class="btn btn-sm" type="button" data-write data-accept="${s.id}">${icon('check')}إلغاء الرفض</button>`
                    : `<button class="btn btn-sm btn-danger" type="button" data-write data-reject="${s.id}">${icon('slash')}رفض / خصم</button>`
                }
              </div>
            </div>`;
          })
          .join('')
      : `<div class="empty-state">${icon('folder')}<h3>لا توجد أعمال</h3><p>لم يرفع هذا الطالب أي عمل بعد.</p></div>`;

    const manage = `<div class="manage-section" data-write>
        <h3>بيانات الطالب</h3>
        <form class="inline-form" id="dRename" style="margin-bottom:10px">
          <input class="input" name="name" value="${esc(st.name)}" maxlength="100" aria-label="اسم الطالب" required>
          <button class="btn" type="submit">${icon('edit')}حفظ الاسم</button>
        </form>
        <form class="inline-form" id="dMove" style="margin-bottom:10px">
          <select class="input" name="classId" aria-label="نقل إلى فصل">${data.classes
            .map((c) => `<option value="${c.id}" ${c.id === st.classId ? 'selected' : ''}>${esc(c.name)}</option>`)
            .join('')}</select>
          <button class="btn" type="submit">نقل للفصل</button>
        </form>
        <button class="btn btn-danger btn-block" type="button" id="dDelete">${icon('trash')}حذف الطالب</button>
      </div>`;

    $('dBody').innerHTML = `<h3 class="card-title" style="font-size:1rem">الأعمال (${subs.length})</h3>${items}${manage}`;

    const body = $('dBody');
    body.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => rejectSub(Number(b.dataset.reject))));
    body.querySelectorAll('[data-accept]').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          renderDrawer(await api(`/api/admin/submissions/${b.dataset.accept}`, { method: 'PATCH', body: { status: 'accepted' } }));
          toast('أُعيد قبول العمل.');
          refresh();
        } catch (err) {
          if (!handleAuth(err)) toast(err.message, 'error');
        }
      })
    );
    $('dRename')?.addEventListener('submit', (e) => {
      e.preventDefault();
      updateStudent(st.id, { name: e.target.name.value });
    });
    $('dMove')?.addEventListener('submit', (e) => {
      e.preventDefault();
      updateStudent(st.id, { classId: Number(e.target.classId.value) });
    });
    $('dDelete')?.addEventListener('click', () => deleteStudent(st, p.count));
  }

  async function rejectSub(id) {
    const reason = await promptDialog({
      title: 'رفض العمل / خصم الدرجة',
      label: 'سبب الرفض (اختياري، يظهر للطالب)',
      confirmText: 'رفض العمل',
      danger: true,
    });
    if (reason === null) return;
    try {
      renderDrawer(await api(`/api/admin/submissions/${id}`, { method: 'PATCH', body: { status: 'rejected', reason } }));
      toast('تم رفض العمل وأصبحت درجته 0.');
      refresh();
    } catch (err) {
      if (!handleAuth(err)) toast(err.message, 'error');
    }
  }

  async function updateStudent(id, body, allowDuplicates = false) {
    try {
      await api(`/api/admin/students/${id}`, { method: 'PATCH', body: { ...body, allowDuplicates } });
      toast('تم حفظ التعديل.');
      await refresh();
      if (drawerId === id) openDrawer(id);
    } catch (err) {
      if (handleAuth(err)) return;
      if (err.status === 409 && err.data?.duplicates) {
        const ok = await confirmDialog({
          title: 'اسم مكرر',
          message: `يوجد طالب بالاسم «<b>${esc(err.data.duplicates[0])}</b>» في هذا الفصل. هل تريد المتابعة رغم التكرار؟`,
          confirmText: 'متابعة رغم التكرار',
        });
        if (ok) updateStudent(id, body, true);
        return;
      }
      toast(err.message, 'error');
    }
  }

  async function deleteStudent(st, count) {
    const ok = await confirmDialog({
      title: 'حذف الطالب',
      message: `سيتم حذف الطالب «<b>${esc(st.name)}</b>» نهائيًا، <b>ومعه جميع ملفاته (${count}) ودرجاته</b>. لا يمكن التراجع عن هذا.`,
      confirmText: 'نعم، احذف الطالب وملفاته',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/admin/students/${st.id}`, { method: 'DELETE' });
      toast('تم حذف الطالب.');
      closeDrawer();
      refresh();
    } catch (err) {
      if (!handleAuth(err)) toast(err.message, 'error');
    }
  }

  function promptDialog({ title, label, confirmText, danger, value = '' }) {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.className = 'modal';
      dlg.innerHTML = `<form method="dialog">
        <div class="modal-head"><h2>${esc(title)}</h2></div>
        <div class="modal-body"><div class="field"><label for="pd-in">${esc(label)}</label>
          <textarea id="pd-in" class="input" maxlength="300" style="min-height:90px">${esc(value)}</textarea></div></div>
        <div class="modal-foot"><button class="btn ${danger ? 'btn-danger solid' : 'btn-primary'}" value="ok">${esc(confirmText)}</button>
          <button class="btn" value="cancel" formnovalidate>إلغاء</button></div></form>`;
      document.body.appendChild(dlg);
      dlg.addEventListener('close', () => {
        const v = dlg.returnValue === 'ok' ? dlg.querySelector('textarea').value.trim() : null;
        dlg.remove();
        resolve(v);
      });
      dlg.showModal();
      dlg.querySelector('textarea').focus();
    });
  }

  // ================= إدارة الفصول =================
  $('openManage').addEventListener('click', () => {
    renderClassList();
    setMTab(data.classes.length ? 'students' : 'classes');
    openModal($('manageDlg'));
  });
  $('manageDlg').addEventListener('close', stopOcrCamera);

  function setMTab(name) {
    document.querySelectorAll('[data-mtab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mtab === name)));
    document.querySelectorAll('[data-mpanel]').forEach((p) => (p.hidden = p.dataset.mpanel !== name));
    if (name !== 'students') stopOcrCamera();
  }
  document.querySelectorAll('[data-mtab]').forEach((t) => t.addEventListener('click', () => setMTab(t.dataset.mtab)));

  function renderClassList() {
    const box = $('classList');
    if (!data.classes.length) {
      box.innerHTML = `<div class="empty-state">${icon('folder')}<h3>لا توجد فصول</h3><p>أضف أول فصل بالأعلى.</p></div>`;
      return;
    }
    box.innerHTML = data.classes
      .map(
        (c) => `<div class="class-item" data-cid="${c.id}">
          <span class="name">${esc(c.name)}</span><span class="badge">${c.studentCount} طالب</span>
          <button class="btn btn-sm" type="button" data-rename>${icon('edit')}تعديل</button>
          <button class="btn btn-sm btn-danger icon-btn" type="button" data-delclass aria-label="حذف ${esc(c.name)}">${icon('trash')}</button>
        </div>`
      )
      .join('');
  }

  $('classList').addEventListener('click', async (e) => {
    const item = e.target.closest('[data-cid]');
    if (!item) return;
    const c = data.classes.find((x) => x.id === Number(item.dataset.cid));
    if (e.target.closest('[data-rename]')) {
      const name = await promptDialog({ title: 'تعديل اسم الفصل', label: 'الاسم الجديد', confirmText: 'حفظ', value: c.name });
      if (!name) return;
      try {
        await api(`/api/admin/classes/${c.id}`, { method: 'PATCH', body: { name } });
        toast('تم تعديل اسم الفصل.');
        refresh();
      } catch (err) {
        if (!handleAuth(err)) toast(err.message, 'error');
      }
    }
    if (e.target.closest('[data-delclass]')) {
      const ok = await confirmDialog({
        title: 'حذف الفصل',
        message: c.studentCount
          ? `سيتم حذف الفصل «<b>${esc(c.name)}</b>» <b>ومعه ${c.studentCount} طالب بكل ملفاتهم ودرجاتهم</b>. لا يمكن التراجع.`
          : `سيتم حذف الفصل «<b>${esc(c.name)}</b>».`,
        confirmText: 'نعم، احذف',
        danger: true,
      });
      if (!ok) return;
      try {
        await api(`/api/admin/classes/${c.id}`, { method: 'DELETE' });
        toast('تم حذف الفصل.');
        refresh();
      } catch (err) {
        if (!handleAuth(err)) toast(err.message, 'error');
      }
    }
  });

  $('addClassForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('newClass').value.trim();
    if (!name) return toast('اكتب اسم الفصل.', 'error');
    try {
      const r = await api('/api/admin/classes', { method: 'POST', body: { name } });
      $('newClass').value = '';
      toast('تمت إضافة الفصل.');
      await refresh();
      $('targetClass').value = String(r.id);
    } catch (err) {
      if (!handleAuth(err)) toast(err.message, 'error');
    }
  });

  // ================= إضافة الطلاب =================
  let method = 'one';
  let preview = []; // [{name, className}]
  let previewHasClass = false;

  function setMethod(m) {
    method = m;
    document.querySelectorAll('[data-method]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.method === m)));
    document.querySelectorAll('[data-method-panel]').forEach((p) => (p.hidden = p.dataset.methodPanel !== m));
    if (m !== 'ocr') stopOcrCamera();
    setPreview([], false);
  }
  document.querySelectorAll('[data-method]').forEach((t) => t.addEventListener('click', () => setMethod(t.dataset.method)));
  $('targetClass').addEventListener('change', () => renderPreview());

  async function saveStudents(payload, allowDuplicates = false) {
    if (!payload.classId && !payload.students?.every((s) => s.className)) {
      toast('أضف فصلًا أولًا ثم اختره.', 'error');
      return false;
    }
    try {
      const r = await api('/api/admin/students', { method: 'POST', body: { ...payload, allowDuplicates } });
      toast(
        `تمت إضافة ${r.added} طالب${r.newClasses?.length ? `، وأُنشئت فصول جديدة: ${r.newClasses.join('، ')}` : ''}.`
      );
      await refresh();
      return true;
    } catch (err) {
      if (handleAuth(err)) return false;
      if (err.status === 409 && err.data?.duplicates) {
        const ok = await confirmDialog({
          title: 'أسماء مكررة في الفصل نفسه',
          message: `الأسماء التالية موجودة مسبقًا أو مكررة في القائمة:<br><b>${err.data.duplicates.map(esc).join('، ')}</b><br>هل تريد إضافتها رغم ذلك؟`,
          confirmText: 'إضافة رغم التكرار',
          cancelText: 'رجوع للتعديل',
        });
        return ok ? saveStudents(payload, true) : false;
      }
      toast(err.message, 'error');
      return false;
    }
  }

  $('oneForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('oneName').value.trim();
    if (!name) return toast('اكتب اسم الطالب.', 'error');
    if (await saveStudents({ classId: Number($('targetClass').value), names: [name] })) {
      $('oneName').value = '';
      $('oneName').focus();
    }
  });

  function splitLines(text) {
    return text
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  $('pastePreview').addEventListener('click', () => {
    const names = splitLines($('pasteBox').value);
    if (!names.length) return toast('الصق الأسماء أولًا.', 'error');
    setPreview(names.map((name) => ({ name, className: '' })), false);
  });

  // ---- قائمة المراجعة ----
  function setPreview(rows, hasClass) {
    preview = rows;
    previewHasClass = hasClass;
    renderPreview();
  }

  function dupFlags() {
    const target = Number($('targetClass').value);
    const classByName = (n) => data.classes.find((c) => norm(c.name) === norm(n));
    const existing = new Set(data.students.map((s) => `${s.classId}|${norm(s.name)}`));
    const seen = new Set();
    return preview.map((r) => {
      const cid = r.className ? classByName(r.className)?.id ?? `new:${norm(r.className)}` : target;
      const k = `${cid}|${norm(r.name)}`;
      const dup = existing.has(k) || seen.has(k);
      seen.add(k);
      return dup;
    });
  }

  function renderPreview() {
    const box = $('previewBox');
    box.hidden = !preview.length;
    if (!preview.length) return;
    const dups = dupFlags();
    $('previewCount').textContent = `${preview.length} اسم${dups.some(Boolean) ? ` · ${dups.filter(Boolean).length} مكرر` : ''}`;
    $('previewList').innerHTML = preview
      .map(
        (r, i) => `<div class="edit-row ${dups[i] ? 'dup' : ''}" data-i="${i}">
          <span class="num">${i + 1}</span>
          <input class="input" data-f="name" value="${esc(r.name)}" aria-label="الاسم ${i + 1}" maxlength="100">
          ${previewHasClass ? `<input class="input" data-f="className" value="${esc(r.className)}" placeholder="الفصل المختار" aria-label="الفصل ${i + 1}" style="max-width:40%">` : ''}
          <button type="button" class="btn btn-danger icon-btn" data-rm aria-label="حذف السطر">${icon('x')}</button>
        </div>`
      )
      .join('');
    const tc = data.classes.find((c) => String(c.id) === $('targetClass').value);
    $('previewSave').querySelector('span').textContent = `اعتماد وحفظ ${preview.length} اسم${!previewHasClass && tc ? ` في «${tc.name}»` : ''}`;
  }

  $('previewList').addEventListener('input', (e) => {
    const row = e.target.closest('[data-i]');
    if (!row || !e.target.dataset.f) return;
    preview[Number(row.dataset.i)][e.target.dataset.f] = e.target.value;
    const dups = dupFlags();
    $('previewList').querySelectorAll('[data-i]').forEach((r, i) => r.classList.toggle('dup', dups[i]));
  });
  $('previewList').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (!rm) return;
    preview.splice(Number(rm.closest('[data-i]').dataset.i), 1);
    renderPreview();
  });
  $('previewAdd').addEventListener('click', () => {
    preview.push({ name: '', className: '' });
    renderPreview();
    const inputs = $('previewList').querySelectorAll('[data-f="name"]');
    inputs[inputs.length - 1]?.focus();
  });
  $('previewSave').addEventListener('click', async () => {
    const rows = preview.map((r) => ({ name: r.name.trim(), className: (r.className || '').trim() })).filter((r) => r.name);
    if (!rows.length) return toast('لا توجد أسماء للحفظ.', 'error');
    const classId = Number($('targetClass').value) || undefined;
    const payload = previewHasClass ? { classId, students: rows } : { classId, names: rows.map((r) => r.name) };
    const btn = $('previewSave');
    btn.disabled = true;
    const ok = await saveStudents(payload);
    btn.disabled = false;
    if (ok) {
      setPreview([], false);
      $('pasteBox').value = '';
      $('importFile').value = '';
      $('ocrImg').hidden = true;
      $('ocrStatus').hidden = true;
    }
  });

  // ---- استيراد CSV / XLSX (يُقرأ في المتصفح فقط) ----
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await loadScript('/vendor/xlsx.full.min.js');
      let wb;
      if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
        let text = new TextDecoder('utf-8').decode(await file.arrayBuffer());
        if (text.includes('�')) text = new TextDecoder('windows-1256').decode(await file.arrayBuffer());
        wb = window.XLSX.read(text.replace(/^﻿/, ''), { type: 'string', raw: true });
      } else {
        wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
      }
      const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
      const parsed = parseRows(rows);
      if (!parsed.rows.length) return toast('لم نجد أسماء في الملف.', 'error');
      setPreview(parsed.rows, parsed.hasClass);
      toast(`قُرئ ${parsed.rows.length} اسم${parsed.hasClass ? ' مع عمود الفصل' : ''}. راجعها ثم اعتمد.`);
    } catch (err) {
      toast('تعذّر قراءة الملف. تأكد أنه CSV أو XLSX صالح.', 'error');
    }
  });

  function parseRows(rows) {
    rows = rows.map((r) => r.map((c) => String(c ?? '').trim())).filter((r) => r.some(Boolean));
    if (!rows.length) return { rows: [], hasClass: false };
    const head = rows[0].map(norm);
    const nameRe = /^(الاسم|اسم الطالب|اسم الطالبه|الطالب|الطالبه|name|student|student name)$/;
    const classRe = /^(الفصل|الشعبه|الصف|القسم|المجموعه|class|section|group)$/;
    let nameCol = head.findIndex((h) => nameRe.test(h));
    let classCol = head.findIndex((h) => classRe.test(h));
    let body = rows;
    if (nameCol >= 0 || classCol >= 0) body = rows.slice(1);
    if (nameCol < 0) {
      // أول عمود يحتوي نصًا عربيًا أو غير رقمي
      nameCol = Math.max(0, rows[0].findIndex((c, i) => i !== classCol && c && !/^[\d\s.-]+$/.test(c)));
    }
    return {
      hasClass: classCol >= 0,
      rows: body
        .map((r) => ({ name: (r[nameCol] || '').replace(/\s+/g, ' ').trim(), className: classCol >= 0 ? (r[classCol] || '').trim() : '' }))
        .filter((r) => r.name && !/^[\d\s.-]+$/.test(r.name)),
    };
  }

  // ---- الكاميرا + OCR ----
  let ocrStream = null;

  function stopOcrCamera() {
    if (ocrStream) ocrStream.getTracks().forEach((t) => t.stop());
    ocrStream = null;
    $('ocrVideo').srcObject = null;
    $('ocrLive').hidden = true;
    $('ocrStartRow').hidden = false;
  }

  $('ocrCam').addEventListener('click', async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast('الكاميرا المباشرة غير مدعومة؛ استخدم «اختيار صورة».', 'error');
      return $('ocrFile').click();
    }
    try {
      ocrStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } },
        audio: false,
      });
      $('ocrVideo').srcObject = ocrStream;
      $('ocrLive').hidden = false;
      $('ocrStartRow').hidden = true;
    } catch {
      toast('تعذّر تشغيل الكاميرا؛ استخدم «اختيار صورة» لالتقاطها بكاميرا الجهاز.', 'error');
    }
  });
  $('ocrStop').addEventListener('click', stopOcrCamera);
  $('ocrSnap').addEventListener('click', () => {
    const v = $('ocrVideo');
    if (!v.videoWidth) return toast('انتظر لحظة حتى تعمل الكاميرا.', 'error');
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    stopOcrCamera();
    c.toBlob((b) => runOcr(b), 'image/jpeg', 0.95);
  });
  $('ocrFile').addEventListener('change', (e) => e.target.files[0] && runOcr(e.target.files[0]));

  function cleanOcrLine(l) {
    return l
      .replace(/[0-9٠-٩۰-۹]/g, ' ')
      .replace(/[|_.,:;()[\]{}<>«»"'`~!@#$%^&*+=\\/؟?،؛ـ-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function runOcr(blob) {
    const img = $('ocrImg');
    img.src = URL.createObjectURL(blob);
    img.hidden = false;
    $('ocrStatus').hidden = false;
    $('ocrBar').style.width = '0%';
    $('ocrMsg').textContent = 'جارٍ تحميل محرك القراءة العربية (قد يستغرق أول مرة دقيقة)…';
    setPreview([], false);
    let worker;
    try {
      await loadScript('/vendor/tesseract/tesseract.min.js');
      worker = await window.Tesseract.createWorker('ara', 1, {
        workerPath: '/vendor/tesseract/worker.min.js',
        corePath: '/vendor/tesseract-core',
        workerBlobURL: false,
        logger: (m) => {
          if (m.status === 'recognizing text') {
            $('ocrMsg').textContent = 'جارٍ قراءة الأسماء…';
            $('ocrBar').style.width = `${Math.round(m.progress * 100)}%`;
          }
        },
      });
      const { data: res } = await worker.recognize(blob);
      const names = res.text
        .split(/\n/)
        .map(cleanOcrLine)
        .filter((l) => l.length >= 3 && /[؀-ۿ]/.test(l))
        .filter((l) => !/^(الاسم|اسم الطالب|م|الفصل|كشف|الرقم)$/.test(l));
      $('ocrBar').style.width = '100%';
      if (!names.length) {
        $('ocrMsg').textContent = 'لم نتمكن من قراءة أسماء. جرّب صورة أوضح.';
        return;
      }
      $('ocrMsg').textContent = `قُرئ ${names.length} سطرًا. راجع الأسماء وصحّحها قبل الاعتماد.`;
      setPreview(names.map((name) => ({ name, className: '' })), false);
    } catch (err) {
      $('ocrMsg').textContent = 'تعذّر تشغيل القراءة الآلية. تحقق من الاتصال بالإنترنت (يُحمَّل ملف اللغة العربية أول مرة) ثم حاول مجددًا.';
    } finally {
      worker?.terminate();
    }
  }

  // ================= الإعدادات =================
  $('openSettings').addEventListener('click', () => {
    renderSettings();
    openModal($('settingsDlg'));
  });

  function renderSettings() {
    $('deadlineInput').value = toRiyadhLocal(settings.deadline);
    $('deadlineNow').textContent = settings.deadline ? `الحالي: ${fmtDateTime(settings.deadline)}` : 'لا يوجد موعد نهائي حاليًا.';
    $('sizeInput').value = settings.maxFileMb;
    const sel = $('ovStudent');
    sel.innerHTML = data.classes
      .map(
        (c) =>
          `<optgroup label="${esc(c.name)}">${data.students
            .filter((s) => s.classId === c.id)
            .map((s) => `<option value="${s.id}">${esc(s.name)}</option>`)
            .join('')}</optgroup>`
      )
      .join('');
    $('ovList').innerHTML = settings.overrides.length
      ? settings.overrides
          .map(
            (o) => `<div class="class-item"><span class="name">${esc(o.name)} <span class="muted">· ${esc(o.className)}</span></span>
              <span class="badge badge-teal">${o.until ? `حتى ${esc(fmtDateTime(o.until))}` : 'مفتوح بلا حد'}</span>
              <button class="btn btn-sm btn-danger" type="button" data-ovdel="${o.studentId}">إلغاء</button></div>`
          )
          .join('')
      : '<p class="muted" style="margin:0">لا توجد استثناءات.</p>';
  }

  async function saveSettings(body, msg) {
    try {
      settings = await api('/api/admin/settings', { method: 'PUT', body });
      toast(msg);
      renderSettings();
      renderDeadlineInfo();
    } catch (err) {
      if (!handleAuth(err)) toast(err.message, 'error');
    }
  }

  $('deadlineForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('deadlineInput').value;
    if (!v) return toast('اختر التاريخ والوقت.', 'error');
    saveSettings({ deadline: v }, 'تم حفظ الموعد النهائي.');
  });
  document.querySelectorAll('[data-extend]').forEach((b) =>
    b.addEventListener('click', () => {
      const days = Number(b.dataset.extend);
      const base = settings.deadline ? Math.max(Date.parse(settings.deadline), Date.now()) : Date.now();
      const v = toRiyadhLocal(new Date(base + days * 864e5).toISOString());
      saveSettings({ deadline: v }, `تم تمديد الموعد ${days === 1 ? 'يومًا' : days === 7 ? 'أسبوعًا' : `${days} أيام`}.`);
    })
  );
  $('clearDeadline').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'إلغاء الموعد النهائي', message: 'سيصبح الرفع مفتوحًا للجميع بلا موعد. متابعة؟', confirmText: 'إلغاء الموعد' });
    if (ok) saveSettings({ deadline: null }, 'أُلغي الموعد النهائي.');
  });
  $('sizeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveSettings({ maxFileMb: Number($('sizeInput').value) }, 'تم حفظ الحد الأقصى لحجم الملف.');
  });
  $('overrideForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('ovStudent').value;
    if (!id) return toast('اختر الطالب.', 'error');
    try {
      settings = await api(`/api/admin/overrides/${id}`, { method: 'PUT', body: { until: $('ovUntil').value || null } });
      toast('تم فتح الرفع للطالب.');
      $('ovUntil').value = '';
      renderSettings();
      renderDeadlineInfo();
    } catch (err) {
      if (!handleAuth(err)) toast(err.message, 'error');
    }
  });
  $('ovList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ovdel]');
    if (!b) return;
    try {
      settings = await api(`/api/admin/overrides/${b.dataset.ovdel}`, { method: 'DELETE' });
      toast('أُلغي الاستثناء.');
      renderSettings();
      renderDeadlineInfo();
    } catch (err) {
      if (!handleAuth(err)) toast(err.message, 'error');
    }
  });

  // ================= الكشوف =================
  $('openReports').addEventListener('click', () => openModal($('reportsDlg')));
  function updateReportLinks() {
    const v = encodeURIComponent($('repClass').value || 'all');
    $('repPrint').href = `/print?classId=${v}`;
    $('repExcel').href = `/api/admin/export.xlsx?classId=${v}`;
  }
  $('repClass').addEventListener('change', updateReportLinks);
  $('repExcel').addEventListener('click', () => closeModal($('reportsDlg')));

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && role) refresh();
  });

  boot().catch((err) => {
    $('boot').innerHTML = `${icon('alert')}<h3>تعذّر التحميل</h3><p>${esc(err.message)}</p>`;
  });
})();
