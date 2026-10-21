// Simulateur de l'API de widgets Grist pour les tests de bout en bout : sert à la place de grist-plugin-api.js.
// Contacts et Archive sont fixes ; la table Automation se crée par AddTable et gardent leurs lignes (window.__stub.docTables).
// window.__noTables : le document démarre sans la table Automation. `applied` ne liste que les écritures hors table Automation.
const FIXED = {
  Contacts: { id: [1], manualSort: [1], Nom: ['A'], Statut: ['Nouveau'], Montant: [10], gristHelper_Display: [''] },
  Archive: { id: [], manualSort: [], Motif: [], Source: [] },
};
const docTables = {};
function createTable(name, columns) { docTables[name] = { columns: columns.map((c) => c.id), rows: [], nextId: 1 }; }
if (!window.__noTables && !window.__foreignLock) {
  createTable('Automation', ['Type', 'Table', 'Date', 'Actif', 'Version', 'Resume', 'Config', 'Evenement', 'Ligne', 'Resultat', 'Detail', 'Auteur'].map((id) => ({ id })));
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
  onRecords(cb) { window.__stub.pushRecords = (records) => cb(records); },
  selectedTable: { getTableId: () => Promise.resolve('Contacts') },
  docApi: {
    listTables: () => Promise.resolve([...Object.keys(FIXED), ...Object.keys(docTables)]),
    fetchTable: (name) => {
      if (FIXED[name]) return Promise.resolve(FIXED[name]);
      const table = docTables[name];
      const data = { id: table.rows.map((r) => r.id) };
      for (const column of table.columns) data[column] = table.rows.map((r) => r[column]);
      return Promise.resolve(data);
    },
    applyUserActions: (actions) => {
      for (const [kind, name, rowId, values] of actions) {
        if (kind === 'AddTable') { createTable(name, rowId); continue; }
        const own = docTables[name];
        if (!own) { window.__stub.applied.push([kind, name, rowId, values]); continue; }
        if (kind === 'AddRecord') own.rows.push({ id: own.nextId++, ...values });
        else if (kind === 'UpdateRecord') Object.assign(own.rows.find((r) => r.id === rowId), values);
      }
      return Promise.resolve([]);
    },
  },
};
