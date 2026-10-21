// Simulateur de l'API de widgets Grist pour les tests de bout en bout : sert à la place de grist-plugin-api.js.
// Contacts et Archive sont fixes ; la table Automation se crée par AddTable et gardent leurs lignes (window.__stub.docTables).
// window.__noTables : le document démarre sans la table Automation. `applied` ne liste que les écritures hors table Automation.
// window.__preloadTables : tables ajoutées au démarrage { nom: ['Colonne', …] } (avec __noTables, pour une table Automation incomplète ou un nom pris à la casse près).
// window.__preloadRows : lignes ajoutées à la table Automation au démarrage.
// window.__fetchDelay : délai (ms) de la lecture des tables du widget, pour modifier le graphe avant la fin du démarrage.
// Comme Grist : une écriture dans une colonne qui n'existe pas échoue en entier, et un identifiant déjà pris (sans tenir compte de la casse) devient `nom_2`.
const FIXED = {
  Contacts: { id: [1], manualSort: [1], Nom: ['A'], Statut: ['Nouveau'], Montant: [10], gristHelper_Display: [''] },
  Archive: { id: [1, 2], manualSort: [1, 2], Motif: ['a', 'b'], Source: [10, 500] },
};
const docTables = {};
function createTable(name, columns) { docTables[name] = { columns: columns.map((c) => c.id), rows: [], nextId: 1 }; }
if (!window.__noTables && !window.__foreignLock) {
  createTable('Automation', ['Type', 'Table', 'Date', 'Actif', 'Version', 'Resume', 'Config', 'Evenement', 'Ligne', 'Resultat', 'Detail', 'Auteur'].map((id) => ({ id })));
}
for (const [name, columns] of Object.entries(window.__preloadTables || {})) createTable(name, columns.map((id) => ({ id })));
if (window.__preloadRows && docTables.Automation) {
  for (const row of window.__preloadRows) docTables.Automation.rows.push({ id: docTables.Automation.nextId++, ...row });
}
// window.__preloadLogs : nombre d'anciennes exécutions déjà dans le journal.
if (window.__preloadLogs && docTables.Automation) {
  for (let i = 1; i <= window.__preloadLogs; i += 1) docTables.Automation.rows.push({ id: docTables.Automation.nextId++, Type: 'Log', Table: 'Contacts', Date: 1700000000 + i, Evenement: 'update', Ligne: i, Resultat: 'success', Detail: '[]', Auteur: 'moi@exemple.fr' });
}
// window.__foreignLock : un autre onglet exécute déjà (verrou à jour, renouvelé chaque seconde).
if (window.__foreignLock) {
  createTable('Automation', ['Type', 'Table', 'Date', 'Actif', 'Version', 'Resume', 'Config', 'Evenement', 'Ligne', 'Resultat', 'Detail', 'Auteur'].map((id) => ({ id })));
  const lock = { id: 1, Type: 'Lock', Table: 'Contacts', Config: 'autre-onglet', Date: 1 };
  docTables.Automation.rows.push(lock);
  docTables.Automation.nextId = 2;
  setInterval(() => { lock.Date += 1; }, 1000);
}
window.__stub = { applied: [], options: window.__preloadOptions || {}, pushRecords: null, docTables };
window.grist = {
  ready() {},
  onOptions(cb) { cb(window.__stub.options); },
  setOption(key, value) { window.__stub.options[key] = value; return Promise.resolve(); },
  onRecord(cb) { window.__stub.pushRecord = (record) => cb(record); },
  onRecords(cb) { window.__stub.pushRecords = (records) => cb(records); },
  selectedTable: { getTableId: () => Promise.resolve('Contacts') },
  docApi: {
    listTables: () => Promise.resolve([...Object.keys(FIXED), ...Object.keys(docTables)]),
    fetchTable: (name) => {
      if (FIXED[name]) return Promise.resolve(FIXED[name]);
      const table = docTables[name];
      const data = { id: table.rows.map((r) => r.id) };
      for (const column of table.columns) data[column] = table.rows.map((r) => r[column]);
      return window.__fetchDelay ? new Promise((resolve) => setTimeout(() => resolve(data), window.__fetchDelay)) : Promise.resolve(data);
    },
    applyUserActions: (actions) => {
      for (const [kind, name, , values] of actions) {
        const unknown = docTables[name] && values && Object.keys(values).find((column) => !docTables[name].columns.includes(column));
        if (unknown) return Promise.reject(new Error(`Invalid column "${unknown}"`));
      }
      for (const [kind, name, rowId, values] of actions) {
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
      return Promise.resolve([]);
    },
  },
};
