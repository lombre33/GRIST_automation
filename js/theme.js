// Thème : « système », « clair » ou « sombre », appliqué par l'attribut data-theme (toujours clair ou sombre, jamais « système »).
// Le choix explicite est mémorisé dans localStorage ; sans choix, la préférence du système joue. Chargé dans <head> pour éviter un éclair.
(function (root) {
  'use strict';
  const STORAGE_KEY = 'ab_theme';
  const MODES = ['system', 'light', 'dark'];
  const media = root.matchMedia('(prefers-color-scheme: dark)');
  let mode = 'system';

  function readSaved() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (err) { return null; }
  }

  function apply() {
    const dark = mode === 'dark' || (mode === 'system' && media.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }

  const saved = readSaved();
  if (MODES.includes(saved)) mode = saved;
  apply();
  media.addEventListener('change', apply);

  // Hébergée par GFS (`gfs=<n>` dans l'adresse du cadre), la page attend l'ambiance avant de s'afficher : sinon elle paraîtrait dans ses couleurs, puis changerait. js/gfs.js lève l'attente ;
  // au plus 2 s, si le kit manque ou que GFS tarde. Seule, rien n'attend.
  if (/[?&]gfs=\d/.test(root.location.search)) {
    document.documentElement.dataset.gfsPending = '';
    setTimeout(() => { delete document.documentElement.dataset.gfsPending; }, 2000);
  }

  root.Theme = {
    MODES,
    get mode() { return mode; },
    set(next) {
      mode = next;
      try { localStorage.setItem(STORAGE_KEY, next); } catch (err) { /* stockage indisponible : le choix vaut pour la séance */ }
      apply();
    },
  };
})(window);
