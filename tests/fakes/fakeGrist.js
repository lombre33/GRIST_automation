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
// Comme Grist : un identifiant de table déjà pris (sans tenir compte de la casse) est changé en `nom_2`, et une écriture dans une table ou une colonne
// qui n'existe pas échoue en entier, avec le message du moteur de Grist (« [Sandbox] KeyError 'Nom' », vu dans un vrai Grist le 2026-11-25) ; lire une table qui n'existe pas
// répond « Table not found "Nom" ». options.renameTables : { demandé: obtenu } force un autre identifiant. failNext : le prochain appel à applyUserActions échoue.
function createFakeDoc(initialTables, opts) {
  const options = opts || {};
  const tables = new Map(Object.entries(initialTables || {}).map(([name, columns]) => [name, { columns, rows: [] }]));
  let nextId = 1;
  const taken = (name) => [...tables.keys()].some((existing) => existing.toLowerCase() === name.toLowerCase());
  return {
    tables,
    failNext: null,
    seedRow(name, values) { tables.get(name).rows.push({ id: nextId++, ...values }); },
    async listTables() { return [...tables.keys()]; },
    async fetchTable(name) {
      const table = tables.get(name);
      if (!table) throw new Error('Table not found "' + name + '"');
      const data = { id: table.rows.map((r) => r.id) };
      for (const column of table.columns) data[column] = table.rows.map((r) => r[column]);
      return data;
    },
    async applyUserActions(actions) {
      if (this.failNext) {
        const message = this.failNext;
        this.failNext = null;
        throw new Error(message);
      }
      for (const [kind, name, , values] of actions) {
        if (kind !== 'AddRecord' && kind !== 'UpdateRecord') continue;
        if (!tables.has(name)) throw new Error("[Sandbox] KeyError '" + name + "'");
        const column = Object.keys(values).find((candidate) => !tables.get(name).columns.includes(candidate));
        if (column) throw new Error("[Sandbox] KeyError '" + column + "'");
      }
      for (const [kind, name, rowId, values] of actions) {
        if (kind === 'AddTable') {
          if (options.rejectFormulaColumns && rowId.some((c) => c.formula)) throw new Error('Colonne à formule refusée');
          let id = (options.renameTables && options.renameTables[name]) || name;
          for (let n = 2; taken(id); n += 1) id = `${name}_${n}`;
          tables.set(id, { columns: rowId.map((c) => c.id), rows: [], spec: rowId });
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
