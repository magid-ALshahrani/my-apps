(function () {
  'use strict';
  const { api, esc, icon, fmtDate } = window.EP;
  const params = new URLSearchParams(location.search);
  const classId = params.get('classId') || 'all';
  const sel = document.getElementById('cls');
  const box = document.getElementById('sheets');

  function sheet(c, printedAt, max) {
    const rows = c.students.length
      ? c.students
          .map((s) => `<tr><td>${s.no}</td><td class="name">${esc(s.name)}</td><td>${s.count}</td><td><b>${s.score}</b></td></tr>`)
          .join('')
      : `<tr><td colspan="4">لا يوجد طلاب في هذا الفصل.</td></tr>`;
    return `<article class="sheet">
      <header class="sheet-head">
        <div class="right">الفصل: ${esc(c.name)}<br><span class="sub">عدد الطلاب: ${c.students.length}</span></div>
        <div class="title"><h2>كشف درجات ملف الإنجاز</h2><div class="sub">الدرجة من ${max}</div></div>
        <div class="left">تاريخ الطباعة:<br>${esc(fmtDate(printedAt))}</div>
      </header>
      <table>
        <thead><tr><th style="width:9%">رقم</th><th>اسم الطالب</th><th style="width:18%">عدد الإضافات</th><th style="width:18%">الدرجة من ${max}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="sign"><div>اسم المعلم: ........................</div><div>التوقيع: ........................</div></div>
    </article>`;
  }

  async function load() {
    try {
      const [ov, rep] = await Promise.all([api('/api/admin/overview'), api(`/api/admin/report?classId=${encodeURIComponent(classId)}`)]);
      sel.innerHTML =
        '<option value="all">كل الفصول (فصل في كل صفحة)</option>' +
        ov.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
      sel.value = classId;
      document.getElementById('excelBtn').href = `/api/admin/export.xlsx?classId=${encodeURIComponent(classId)}`;
      document.title = rep.classes.length === 1 ? `كشف درجات ${rep.classes[0].name}` : 'كشف درجات كل الفصول';
      box.innerHTML = rep.classes.length
        ? rep.classes.map((c) => sheet(c, rep.printedAt, rep.maxSlots)).join('')
        : `<div class="empty-state">${icon('folder')}<h3>لا توجد فصول</h3></div>`;
    } catch (err) {
      if (err.status === 401) return location.replace('/admin');
      box.innerHTML = `<div class="empty-state">${icon('alert')}<h3>تعذّر تجهيز الكشف</h3><p>${esc(err.message)}</p></div>`;
    }
  }

  sel.addEventListener('change', () => {
    location.search = `?classId=${encodeURIComponent(sel.value)}`;
  });
  document.getElementById('printBtn').addEventListener('click', () => window.print());
  load();
})();
