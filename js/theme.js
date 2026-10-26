/* Applies the saved theme before the page paints, so there is no flash. Device-only setting. */
(function () {
  var t = 'system';
  try {
    t = localStorage.getItem('myexpense-theme') || 'system';
  } catch (e) {}
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
})();
