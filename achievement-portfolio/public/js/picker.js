(function () {
  'use strict';
  const { api, esc, icon, toast, confirmDialog, initials, norm } = window.EP;
  const list = document.getElementById('list');
  const q = document.getElementById('q');
  let classes = [];

  function render() {
    const term = norm(q.value);
    const groups = classes
      .map((c) => ({ ...c, students: c.students.filter((s) => !term || norm(s.name).includes(term)) }))
      .filter((c) => c.students.length);

    if (!classes.length || !classes.some((c) => c.students.length)) {
      list.innerHTML = `<div class="empty-state">${icon('users')}<h3>لا توجد أسماء بعد</h3><p>لم يُضف المعلم أسماء الطلاب حتى الآن. حاول لاحقًا.</p></div>`;
      return;
    }
    if (!groups.length) {
      list.innerHTML = `<div class="empty-state">${icon('search')}<h3>لا نتائج</h3><p>لم نجد اسمًا مطابقًا لـ «${esc(q.value)}». تأكد من الكتابة أو تواصل مع المعلم.</p></div>`;
      return;
    }
    list.innerHTML = groups
      .map(
        (c) => `
        <section class="class-group">
          <h2>${icon('folder')} ${esc(c.name)} <span class="badge">${c.students.length} طالب</span></h2>
          <div class="name-grid">
            ${c.students
              .map(
                (s) => `<button type="button" class="name-btn" data-id="${s.id}" data-name="${esc(s.name)}" data-class="${esc(c.name)}">
                  <span class="avatar">${esc(initials(s.name))}</span><span>${esc(s.name)}</span></button>`
              )
              .join('')}
          </div>
        </section>`
      )
      .join('');
  }

  list.addEventListener('click', async (e) => {
    const b = e.target.closest('.name-btn');
    if (!b) return;
    const ok = await confirmDialog({
      title: 'تأكيد الاسم',
      message: `هل أنت <b>${esc(b.dataset.name)}</b> من <b>${esc(b.dataset.class)}</b>؟<br><span class="muted">اختر اسمك أنت فقط.</span>`,
      confirmText: 'نعم، هذا أنا',
      cancelText: 'رجوع',
    });
    if (!ok) return;
    b.disabled = true;
    try {
      await api('/api/auth/student', { method: 'POST', body: { studentId: Number(b.dataset.id) } });
      location.href = '/student';
    } catch (err) {
      toast(err.message, 'error');
      b.disabled = false;
    }
  });

  q.addEventListener('input', render);

  (async () => {
    try {
      const me = await api('/api/auth/me');
      if (me.role === 'student') {
        const box = document.getElementById('resume');
        box.hidden = false;
        box.innerHTML = `${icon('user')}<div style="flex:1">أنت مسجّل باسم <b>${esc(me.student.name)}</b>.</div>
          <a class="btn btn-primary btn-sm" href="/student">متابعة</a>`;
      }
      classes = (await api('/api/public/students')).classes;
      render();
    } catch (err) {
      list.innerHTML = `<div class="empty-state">${icon('alert')}<h3>تعذّر التحميل</h3><p>${esc(err.message)}</p><a class="btn" href="/">إعادة المحاولة</a></div>`;
    }
  })();
})();
