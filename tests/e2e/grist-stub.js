// Simulateur de l'API de widgets Grist pour les tests de bout en bout : sert à la place de grist-plugin-api.js.
// Contacts et Archive sont fixes ; la table du widget se crée par AddTable et garde ses lignes (window.__stub.docTables).
// Deux jeux de noms (consigne 028 de GFS) : un document neuf a `Automation_Store` et les colonnes anglaises ; avec window.__legacyNames, le document est d'avant la 0.15.6 :
// `Automation` et ses colonnes françaises (Actif, Resume, Evenement, Ligne, Resultat, Auteur). window.__stub.store est la table du widget, sous le nom que le document lui donne.
// window.__noTables : le document démarre sans la table du widget. `applied` ne liste que les écritures hors tables du widget.
// window.__preloadTables : tables ajoutées au démarrage { nom: ['Colonne', …] } (avec __noTables, pour une table du widget incomplète ou un nom pris à la casse près).
// window.__preloadRows : lignes ajoutées à la table du widget au démarrage, avec les noms de colonnes anglais (traduits en noms d'avant quand le document est d'avant).
// window.__preloadTableRows : { table: [lignes] } ajoutées telles quelles, sous les noms de colonnes donnés, à n'importe quelle table du document (les deux tables du widget dans un même document).
// window.__fetchDelay : délai (ms) de la lecture des tables du widget, pour modifier le graphe avant la fin du démarrage.
// window.__optionsDelay : délai (ms) avant que les réglages de la vue arrivent (Grist les donne tout de suite, mais rien ne le garantit), pour qu'ils arrivent après la fin du démarrage.
// Comme Grist : une écriture dans une colonne qui n'existe pas échoue en entier, et un identifiant déjà pris (sans tenir compte de la casse) devient `nom_2`.
// Comme Grist encore : à `ready`, le thème de Grist (window.__gristAppearance, sombre par défaut) est posé dans <style id="grist-theme">, créée si la page n'a pas
// d'élément de ce nom, et en style en ligne sur <html> ; en lecture seule (`readonly=true` dans l'adresse), toute écriture est refusée et notée dans `refused`.
// `calls` compte les appels faits à l'API, par nom. window.__fixedTables : d'autres tables fixes à la place de Contacts et Archive (les captures de la prise en main
// en anglais, tests/e2e/tutorial-shots.mjs : les mêmes tables, des colonnes en anglais) ; la table de la vue reste Contacts.
const FIXED = window.__fixedTables || {
  Contacts: { id: [1], manualSort: [1], Nom: ['A'], Statut: ['Nouveau'], Montant: [10], gristHelper_Display: [''] },
  Archive: { id: [1, 2], manualSort: [1, 2], Motif: ['a', 'b'], Source: [10, 500] },
};
// window.__metaTables : des tables de métadonnées de Grist (_grist_Tables, _grist_Tables_column), lues par fetchTable sans paraître dans listTables, comme dans Grist.
// window.__refuseGristInternal : le courtier de GFS refuse toute lecture d'une table `_grist_*` que le manifeste de l'app ne déclare pas (permissions.gristInterne), avec le message qu'il donne (prototype/js/filter.js de GFS).
const META = window.__metaTables || {};
const docTables = {};
function createTable(name, columns) { docTables[name] = { name, columns: columns.map((c) => c.id), rows: [], nextId: 1 }; }
const ENGLISH = ['Type', 'Table', 'Date', 'Active', 'Version', 'Summary', 'Config', 'Event', 'Row', 'Result', 'Detail', 'Author'];
const LEGACY = { Active: 'Actif', Summary: 'Resume', Event: 'Evenement', Row: 'Ligne', Result: 'Resultat', Author: 'Auteur' };
const legacy = Boolean(window.__legacyNames);
const STORE = legacy ? 'Automation' : 'Automation_Store';
const named = (key) => (legacy && LEGACY[key]) || key;
const nameRow = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [named(key), value]));
if (!window.__noTables && !window.__foreignLock) createTable(STORE, ENGLISH.map((id) => ({ id: named(id) })));
for (const [name, columns] of Object.entries(window.__preloadTables || {})) createTable(name, columns.map((id) => ({ id })));
if (window.__preloadRows && docTables[STORE]) {
  for (const row of window.__preloadRows) docTables[STORE].rows.push({ id: docTables[STORE].nextId++, ...nameRow(row) });
}
for (const [name, rows] of Object.entries(window.__preloadTableRows || {})) {
  if (docTables[name]) for (const row of rows) docTables[name].rows.push({ id: docTables[name].nextId++, ...row });
}
// window.__preloadLogs : nombre d'anciennes exécutions déjà dans le journal.
if (window.__preloadLogs && docTables[STORE]) {
  for (let i = 1; i <= window.__preloadLogs; i += 1) docTables[STORE].rows.push({ id: docTables[STORE].nextId++, ...nameRow({ Type: 'Log', Table: 'Contacts', Date: 1700000000 + i, Event: 'update', Row: i, Result: 'success', Detail: '[]', Author: 'moi@exemple.fr' }) });
}
// window.__foreignLock : un autre onglet exécute déjà (verrou à jour, renouvelé chaque seconde).
if (window.__foreignLock) {
  createTable(STORE, ENGLISH.map((id) => ({ id: named(id) })));
  const lock = { id: 1, Type: 'Lock', Table: 'Contacts', Config: 'autre-onglet', Date: 1 };
  docTables[STORE].rows.push(lock);
  docTables[STORE].nextId = 2;
  setInterval(() => { lock.Date += 1; }, 1000);
}
// window.__stub.writeDelay (ms) ralentit chaque écriture ; window.__stub.failWith (un message) fait échouer chaque écriture ; writes : chaque action reçue (genre, table, ligne, valeurs), avec l'heure à laquelle elle a eu lieu (Date.now()).
window.__stub = { applied: [], refused: [], calls: {}, options: window.__preloadOptions || {}, pushRecords: null, docTables, writes: [], writeDelay: 0, failWith: '',
  // La table du widget, sous le nom que le document lui donne (Automation_Store, ou Automation dans un document d'avant ; null : le document n'en a pas). Quand il porte les deux, la nouvelle.
  get store() { return docTables.Automation_Store || docTables.Automation || null; } };
const readOnly = new URLSearchParams(location.search).get('readonly') === 'true';
const count = (name) => { window.__stub.calls[name] = (window.__stub.calls[name] || 0) + 1; };
const refuse = (what) => { window.__stub.refused.push(what); return Promise.reject(new Error('No write access')); };

// Ce que fait attachCssThemeVars dans le script d'API de Grist (version de novembre 2026).
function attachTheme() {
  const appearance = window.__gristAppearance || 'dark';
  let style = document.head.querySelector('#grist-theme');
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('id', 'grist-theme');
    document.head.append(style);
  }
  style.textContent = `@layer grist-theme {\n  :root {\n--grist-theme-text: ${appearance === 'dark' ? '#efefef' : '#262633'};\n  }\n}\n`;
  document.documentElement.style.setProperty('color-scheme', appearance);
  document.documentElement.setAttribute('data-grist-appearance', appearance);
}

window.grist = {
  ready() { count('ready'); attachTheme(); },
  onOptions(cb) { if (window.__optionsDelay) setTimeout(() => cb(window.__stub.options), window.__optionsDelay); else cb(window.__stub.options); },
  setOption(key, value) {
    if (readOnly) return refuse(['setOption', key]);
    window.__stub.options[key] = value;
    return Promise.resolve();
  },
  onRecord(cb) { window.__stub.pushRecord = (record) => cb(record); },
  onRecords(cb) { window.__stub.pushRecords = (records) => cb(records); },
  selectedTable: { getTableId: () => { count('getTableId'); return Promise.resolve('Contacts'); } },
  docApi: {
    listTables: () => Promise.resolve([...Object.keys(FIXED), ...Object.keys(docTables)]),
    fetchTable: (name) => {
      if (window.__refuseGristInternal && /^_grist_/.test(name)) return Promise.reject(new Error(`Lecture de ${name} non déclarée (permissions.gristInterne).`));
      if (FIXED[name]) return Promise.resolve(FIXED[name]);
      if (META[name]) return Promise.resolve(META[name]);
      if (!docTables[name]) return Promise.reject(new Error(`Table not found "${name}"`));
      const table = docTables[name];
      const data = { id: table.rows.map((r) => r.id) };
      for (const column of table.columns) data[column] = table.rows.map((r) => r[column]);
      return window.__fetchDelay ? new Promise((resolve) => setTimeout(() => resolve(data), window.__fetchDelay)) : Promise.resolve(data);
    },
    applyUserActions: (actions) => {
      if (readOnly) return refuse(actions);
      if (window.__stub.failWith) return Promise.reject(new Error(window.__stub.failWith));
      // Comme le moteur de Grist : une table ou une colonne qui n'existe pas fait échouer toute l'écriture, « [Sandbox] KeyError 'Nom' » (vu dans un vrai Grist le 2026-11-25).
      for (const [kind, name, , values] of actions) {
        if ((kind === 'AddRecord' || kind === 'UpdateRecord') && !docTables[name] && !FIXED[name]) return Promise.reject(new Error(`[Sandbox] KeyError '${name}'`));
        const unknown = docTables[name] && values && Object.keys(values).find((column) => !docTables[name].columns.includes(column));
        if (unknown) return Promise.reject(new Error(`[Sandbox] KeyError '${unknown}'`));
      }
      const apply = () => {
        for (const [kind, name, rowId, values] of actions) {
          window.__stub.writes.push({ kind, table: name, row: rowId, values, at: Date.now() });
          if (kind === 'AddTable') {
            let id = name;
            for (let n = 2; Object.keys(docTables).some((existing) => existing.toLowerCase() === id.toLowerCase()); n += 1) id = `${name}_${n}`;
            createTable(id, rowId);
            continue;
          }
          const own = docTables[name];
          if (!own) { window.__stub.applied.push([kind, name, rowId, values]); continue; }
          if (kind === 'AddRecord') own.rows.push({ id: own.nextId++, ...values });
          else if (kind === 'UpdateRecord') Object.assign(own.rows.find((r) => r.id === rowId), values);
        }
        return [];
      };
      // writeDelay : l'écriture n'a lieu, et ne répond, qu'au bout de ce délai (ms), comme un document lent ; elle ne se voit pas avant.
      if (!window.__stub.writeDelay) return Promise.resolve(apply());
      return new Promise((resolve) => setTimeout(() => resolve(apply()), window.__stub.writeDelay));
    },
  },
};
