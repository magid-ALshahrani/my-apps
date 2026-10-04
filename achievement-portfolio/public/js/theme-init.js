// يُحمَّل في <head> قبل الرسم لتجنّب وميض النمط الخاطئ. الداكن هو الافتراضي.
(function () {
  var t = 'dark';
  try {
    t = localStorage.getItem('ep-theme') === 'light' ? 'light' : 'dark';
  } catch (e) {
    /* التخزين غير متاح */
  }
  document.documentElement.setAttribute('data-theme', t);
})();
