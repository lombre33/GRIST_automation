// Simulateur de l'API de widgets Grist pour les tests de bout en bout : sert à la place de grist-plugin-api.js.
// Contacts et Archive sont fixes ; les tables Automation_* se créent par AddTable et gardent leurs lignes (window.__stub.docTables).
// window.__noTables : le document démarre sans tables Automation_*. `applied` ne liste que les écritures hors tables Automation_*.
const FIXED = {
  Contacts: { id: [1], manualSort: [1], Nom: ['A'], Statut: ['Nouveau'], Montant: [10], gristHelper_Display: [''] },
  Archive: { id: [], manualSort: [], Motif: [], Source: [] },
};
const docTables = {};
function createTable(name, columns) { docTables[name] = { columns: columns.map((c) => c.id), rows: [], nextId: 1 }; }
if (!window.__noTables) {
  createTable('Automation_Workflows', ['Table', 'Actif', 'Version', 'Resume', 'Config', 'Auteur'].map((id) => ({ id })));
  createTable('Automation_Logs', ['Date', 'Table', 'Evenement', 'Ligne', 'Resultat', 'Detail', 'Auteur'].map((id) => ({ id })));
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
