// Simulateur minimal de la couche d'écriture Grist pour les tests.
'use strict';

function createFakeApi(opts) {
  const options = opts || {};
  const applied = [];
  return {
    applied,
    // options.tables : { Table: { id: [..], Colonne: [..] } } lues par fetchTable, comme grist.docApi.
    async fetchTable(name) {
      if (!options.tables || !options.tables[name]) throw new Error('Table inconnue : ' + name);
      return options.tables[name];
    },
    async applyUserActions(actions) {
      if (options.failWith) throw new Error(options.failWith);
      applied.push(...actions);
    },
  };
}

// Faux document : tables en mémoire avec AddTable, AddRecord et UpdateRecord, comme grist.docApi.
function createFakeDoc(initialTables, opts) {
  const options = opts || {};
  const tables = new Map(Object.entries(initialTables || {}).map(([name, columns]) => [name, { columns, rows: [] }]));
  let nextId = 1;
  return {
    tables,
    async listTables() { return [...tables.keys()]; },
    async fetchTable(name) {
      const table = tables.get(name);
      if (!table) throw new Error('Table inconnue : ' + name);
      const data = { id: table.rows.map((r) => r.id) };
      for (const column of table.columns) data[column] = table.rows.map((r) => r[column]);
      return data;
    },
    async applyUserActions(actions) {
      for (const [kind, name, rowId, values] of actions) {
        if (kind === 'AddTable') {
          if (options.rejectFormulaColumns && rowId.some((c) => c.formula)) throw new Error('Colonne à formule refusée');
          tables.set(name, { columns: rowId.map((c) => c.id), rows: [], spec: rowId });
        } else if (kind === 'AddRecord') {
          tables.get(name).rows.push({ id: nextId++, ...values });
        } else if (kind === 'UpdateRecord') {
          Object.assign(tables.get(name).rows.find((r) => r.id === rowId), values);
        }
      }
    },
  };
}

module.exports = { createFakeApi, createFakeDoc };
