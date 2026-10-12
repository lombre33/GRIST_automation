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
