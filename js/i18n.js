// Textes de l'interface, français et anglais en miroir : toute chaîne ajoutée ou modifiée a ses deux langues dans le même lot.
// Pluriels : `{n|singulier|pluriel}` (en français 0 et 1 sont au singulier, en anglais seul 1). Pas de pluriel entre parenthèses.
(function (root) {
  'use strict';

  const DICT = {
    fr: {
      'app.title': 'Grist Automation Builder',
      'app.badge': 'POC V0.5 — formulaire simple',
      'app.openTab': 'Automation active : elle ne s\'exécute que tant que cette vue reste ouverte dans votre navigateur.',
      'settings.open': 'Réglages',
      'settings.title': 'Réglages',
      'settings.language': 'Langue',
      'settings.theme': 'Thème',
      'theme.system': 'Système',
      'theme.light': 'Clair',
      'theme.dark': 'Sombre',
      'credits.title': 'Crédits',
      'credits.author': 'Auteur',
      'credits.site': 'Site',
      'credits.license': 'Licence',
      'credits.version': 'Version',
      'wf.title': 'Workflow',
      'trigger.legend': 'Déclencheur',
      'trigger.when': 'Quand une ligne est',
      'trigger.update': 'modifiée',
      'trigger.create': 'créée',
      'trigger.delete': 'supprimée',
      'trigger.column': 'Colonne surveillée',
      'cond.legend': 'Condition (optionnel)',
      'cond.column': 'Colonne',
      'cond.operator': 'Opérateur',
      'cond.value': 'Valeur',
      'op.eq': 'est égal à',
      'op.neq': 'est différent de',
      'op.gt': 'est supérieur à',
      'op.lt': 'est inférieur à',
      'op.contains': 'contient',
      'op.empty': 'est vide',
      'op.notEmpty': 'n\'est pas vide',
      'act.legend': 'Action',
      'act.type': 'Type',
      'act.update': 'Mettre à jour la ligne',
      'act.add': 'Ajouter une ligne',
      'act.table': 'Table cible',
      'act.column': 'Colonne',
      'act.value': 'Valeur',
      'list.choose': '— Choisir … —',
      'list.none': '— Aucune —',
      'list.currentTable': '— Table courante —',
      'list.search': 'Rechercher…',
      'list.noResult': 'Aucun résultat',
      'wf.save': 'Enregistrer le workflow',
      'status.title': 'Statut',
      'status.workflow': 'Workflow :',
      'status.active': 'actif',
      'status.inactive': 'inactif',
      'toggle.activate': 'Activer',
      'toggle.deactivate': 'Désactiver',
      'test.run': 'Tester (dry-run)',
      'logs.title': 'Logs',
      'logs.waiting': 'En attente d\'événements Grist…',
      'log.saved': 'Workflow enregistré.',
      'log.activated': 'Workflow activé.',
      'log.deactivated': 'Workflow désactivé.',
      'log.event': '{event} ligne {row} : {status}',
      'log.dryRun': 'Dry-run ligne {row} : {status} — {n} {n|effet|effets}',
      'log.dryNoRow': 'Dry-run impossible : aucune ligne dans la vue.',
      'log.badConfig': 'Configuration illisible, ignorée.',
      'log.schemaError': 'Colonnes de « {table} » illisibles : {error}',
      'event.create': 'création',
      'event.update': 'modification',
      'event.delete': 'suppression',
      'result.success': 'réussi',
      'result.error': 'erreur',
      'modal.close': 'Fermer',
      'modal.copy': 'Copier',
      'modal.copied': 'Copié',
      'firstContact.title': 'Ouvrez ce widget depuis Grist',
      'firstContact.body': 'Cette page est un widget Grist : elle ne fonctionne qu\'à l\'intérieur d\'un document Grist. Elle s\'arrête aussi si le script de l\'API Grist est bloqué par le réseau.',
      'firstContact.how': 'Dans Grist : ajoutez une vue, choisissez le widget « Personnalisé », collez l\'adresse ci-dessous et donnez l\'accès complet au document.',
      'firstContact.address': 'Adresse du widget',
    },
    en: {
      'app.title': 'Grist Automation Builder',
      'app.badge': 'POC V0.5 — simple form',
      'app.openTab': 'Automation is on: it only runs while this view stays open in your browser.',
      'settings.open': 'Settings',
      'settings.title': 'Settings',
      'settings.language': 'Language',
      'settings.theme': 'Theme',
      'theme.system': 'System',
      'theme.light': 'Light',
      'theme.dark': 'Dark',
      'credits.title': 'Credits',
      'credits.author': 'Author',
      'credits.site': 'Website',
      'credits.license': 'License',
      'credits.version': 'Version',
      'wf.title': 'Workflow',
      'trigger.legend': 'Trigger',
      'trigger.when': 'When a row is',
      'trigger.update': 'modified',
      'trigger.create': 'created',
      'trigger.delete': 'deleted',
      'trigger.column': 'Watched column',
      'cond.legend': 'Condition (optional)',
      'cond.column': 'Column',
      'cond.operator': 'Operator',
      'cond.value': 'Value',
      'op.eq': 'equals',
      'op.neq': 'is not equal to',
      'op.gt': 'is greater than',
      'op.lt': 'is less than',
      'op.contains': 'contains',
      'op.empty': 'is empty',
      'op.notEmpty': 'is not empty',
      'act.legend': 'Action',
      'act.type': 'Type',
      'act.update': 'Update the row',
      'act.add': 'Add a row',
      'act.table': 'Target table',
      'act.column': 'Column',
      'act.value': 'Value',
      'list.choose': '— Choose … —',
      'list.none': '— None —',
      'list.currentTable': '— Current table —',
      'list.search': 'Search…',
      'list.noResult': 'No result',
      'wf.save': 'Save the workflow',
      'status.title': 'Status',
      'status.workflow': 'Workflow:',
      'status.active': 'on',
      'status.inactive': 'off',
      'toggle.activate': 'Turn on',
      'toggle.deactivate': 'Turn off',
      'test.run': 'Test (dry run)',
      'logs.title': 'Logs',
      'logs.waiting': 'Waiting for Grist events…',
      'log.saved': 'Workflow saved.',
      'log.activated': 'Workflow turned on.',
      'log.deactivated': 'Workflow turned off.',
      'log.event': '{event} row {row}: {status}',
      'log.dryRun': 'Dry run row {row}: {status} — {n} {n|effect|effects}',
      'log.dryNoRow': 'Dry run impossible: no row in the view.',
      'log.badConfig': 'Unreadable configuration, ignored.',
      'log.schemaError': 'Columns of "{table}" unreadable: {error}',
      'event.create': 'creation',
      'event.update': 'modification',
      'event.delete': 'deletion',
      'result.success': 'done',
      'result.error': 'error',
      'modal.close': 'Close',
      'modal.copy': 'Copy',
      'modal.copied': 'Copied',
      'firstContact.title': 'Open this widget from Grist',
      'firstContact.body': 'This page is a Grist widget: it only works inside a Grist document. It also stops if the Grist API script is blocked by the network.',
      'firstContact.how': 'In Grist: add a view, choose the "Custom" widget, paste the address below and give it full document access.',
      'firstContact.address': 'Widget address',
    },
  };

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
