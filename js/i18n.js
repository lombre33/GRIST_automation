// Langue de l'interface, français ou anglais : celle choisie dans les Réglages (gardée dans localStorage sous ab_lang, la seule qui s'enregistre), sinon celle du navigateur.
// Les textes eux-mêmes sont dans js/i18n-texts.js ; ici, le choix de la langue, les paramètres et les pluriels, et la pose des textes dans la page (attributs data-i18n*).
(function (root) {
  'use strict';

  // I18N_TEXTS : déclaré par js/i18n-texts.js, que la page charge juste avant ce script.
  const DICT = typeof module !== 'undefined' && module.exports ? require('./i18n-texts.js') : I18N_TEXTS;

  const LANGS = ['fr', 'en'];
  const STORAGE_KEY = 'ab_lang';
  let lang = 'fr';

  // Sans choix enregistré : première langue (fr, en) proposée par le navigateur, l'anglais s'il n'en propose aucune des deux.
  function initialLang(saved, browserLanguages) {
    if (LANGS.includes(saved)) return saved;
    for (const tag of browserLanguages || []) {
      const short = String(tag).slice(0, 2).toLowerCase();
      if (LANGS.includes(short)) return short;
    }
    return browserLanguages && browserLanguages.length ? 'en' : 'fr';
  }

  function plural(n, singular, pluralForm, language) {
    const isSingular = language === 'fr' ? n <= 1 : n === 1;
    return isSingular ? singular : pluralForm;
  }

  function translate(key, params, language) {
    const text = DICT[language || lang][key];
    if (text === undefined) return key;
    const values = params || {};
    return text
      .replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (_, name, one, many) => plural(Number(values[name]), one, many, language || lang))
      .replace(/\{(\w+)\}/g, (_, name) => (name in values ? String(values[name]) : '{' + name + '}'));
  }

  const api = { DICT, LANGS, initialLang, plural, translate };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  function readSaved() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (err) { return null; }
  }

  function apply() {
    document.documentElement.lang = lang;
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = translate(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = translate(el.dataset.i18nPlaceholder);
    for (const el of document.querySelectorAll('[data-i18n-label]')) {
      el.setAttribute('aria-label', translate(el.dataset.i18nLabel));
      el.title = translate(el.dataset.i18nLabel);
    }
    document.dispatchEvent(new CustomEvent('langchange'));
  }

  lang = initialLang(readSaved(), navigator.languages);
  root.I18n = {
    t: (key, params) => translate(key, params),
    get lang() { return lang; },
    LANGS,
    apply,
    // Le choix fait dans Réglages est le seul qui s'enregistre.
    set(next) {
      lang = next;
      try { localStorage.setItem(STORAGE_KEY, next); } catch (err) { /* stockage indisponible : le choix vaut pour la séance */ }
      apply();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
