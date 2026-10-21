// Runs before the first paint so the page never flashes the other theme; the choice is kept per browser.
(function () {
  var theme = 'system';
  try { theme = JSON.parse(localStorage.getItem('fm.theme')) || 'system'; } catch (e) { /* private mode */ }
  if (theme === 'system') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
})();
