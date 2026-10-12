// Simulateur de l'API de widgets Grist pour les tests de bout en bout : sert à la place de grist-plugin-api.js.
window.__stub = { applied: [], options: window.__preloadOptions || {}, pushRecords: null };
window.grist = {
  ready() {},
  onOptions(cb) { cb(window.__stub.options); },
  setOption(key, value) { window.__stub.options[key] = value; return Promise.resolve(); },
  onRecords(cb) { window.__stub.pushRecords = (records) => cb(records); },
  selectedTable: { getTableId: () => Promise.resolve('Contacts') },
  docApi: {
    listTables: () => Promise.resolve(['Contacts', 'Archive']),
    fetchTable: (name) => Promise.resolve(name === 'Contacts'
      ? { id: [1], manualSort: [1], Nom: ['A'], Statut: ['Nouveau'], Montant: [10], gristHelper_Display: [''] }
      : { id: [], manualSort: [], Motif: [], Source: [] }),
    applyUserActions: (actions) => { window.__stub.applied.push(...actions); return Promise.resolve([]); },
  },
};
