// Stockage dans le document Grist : une seule table, `Automation`, qui contient à la fois les workflows (Type = Workflow, un graphe par table de vue)
// le journal des exécutions (Type = Log) et le verrou d'exécution de chaque table de vue (Type = Lock, voir js/executor.js). Une seule table à autoriser, à auditer et à masquer.
// api : { listTables(), fetchTable(nom), applyUserActions(actions) } (grist.docApi dans le widget, un faux document dans les tests).
// La colonne « Auteur » est une colonne à formule déclenchée `user.Email` : Grist y met l'email de la personne qui crée la ligne.
// Attention : c'est celle dont le navigateur exécute le widget, pas forcément celle qui a modifié la ligne d'origine.
(function (root) {
  'use strict';
  const Graph = typeof module !== 'undefined' && module.exports ? require('./graph.js') : root.Graph;

  const TABLE = 'Automation';
  const WORKFLOW = 'Workflow';
  const LOG = 'Log';
  const LOCK = 'Lock';

  const author = { id: 'Auteur', type: 'Text', isFormula: false, formula: 'user.Email', recalcWhen: 0 };
  const COLUMNS = [
    { id: 'Type', type: 'Text' },
    { id: 'Table', type: 'Text' },
    { id: 'Date', type: 'DateTime:UTC' },
    { id: 'Actif', type: 'Bool' },
    { id: 'Version', type: 'Int' },
    { id: 'Resume', type: 'Text' },
    { id: 'Config', type: 'Text' },
    { id: 'Evenement', type: 'Text' },
    { id: 'Ligne', type: 'Int' },
    { id: 'Resultat', type: 'Text' },
    { id: 'Detail', type: 'Text' },
    author,
  ];

  const isOwnTable = (name) => name === TABLE || name.startsWith(TABLE + '_');

  async function missingTables(api) {
    return (await api.listTables()).includes(TABLE) ? [] : [TABLE];
  }

  // Crée la table si elle est absente. Si Grist refuse la formule d'auteur, on la crée sans (la colonne Auteur reste vide).
  async function ensureTables(api) {
    if (!(await missingTables(api)).length) return false;
    try {
      await api.applyUserActions([['AddTable', TABLE, COLUMNS]]);
    } catch (err) {
      await api.applyUserActions([['AddTable', TABLE, COLUMNS.map(({ id, type }) => ({ id, type }))]]);
    }
    return true;
  }

  function rows(data) {
    return (data.id || []).map((id, i) => Object.fromEntries(Object.keys(data).map((key) => [key, data[key][i]])));
  }

  async function loadGraph(api, tableId) {
    const row = rows(await api.fetchTable(TABLE)).find((r) => r.Type === WORKFLOW && r.Table === tableId);
    return row ? Graph.parse(row.Config) : null;
  }

  async function saveGraph(api, graph, tableId, summary) {
    const values = { Type: WORKFLOW, Table: tableId, Actif: graph.active, Version: graph.version, Resume: summary, Config: JSON.stringify(graph) };
    const row = rows(await api.fetchTable(TABLE)).find((r) => r.Type === WORKFLOW && r.Table === tableId);
    await api.applyUserActions([row ? ['UpdateRecord', TABLE, row.id, values] : ['AddRecord', TABLE, null, values]]);
  }

  async function appendLog(api, entry) {
    await api.applyUserActions([['AddRecord', TABLE, null, {
      Type: LOG,
      Date: Math.floor((entry.date || Date.now()) / 1000),
      Table: entry.table,
      Evenement: entry.event,
      Ligne: entry.row,
      Resultat: entry.result,
      Detail: entry.detail || '',
    }]]);
  }

  // Une page du journal d'une table de vue, de la plus récente à la plus ancienne. beforeId : ne prend que les lignes plus anciennes que celle-ci
  // (curseur stable même si d'autres exécutions s'ajoutent entre deux pages). more : il reste des entrées plus anciennes.
  async function logsPage(api, tableId, count, beforeId) {
    const all = rows(await api.fetchTable(TABLE))
      .filter((r) => r.Type === LOG && r.Table === tableId && (beforeId === null || beforeId === undefined || r.id < beforeId))
      .sort((a, b) => b.id - a.id);
    return { rows: all.slice(0, count), more: all.length > count };
  }

  // Verrou d'exécution : une ligne par table de vue. Plusieurs lignes possibles si deux onglets l'ont créée en même temps : la plus ancienne fait foi.
  async function readLock(api, tableId) {
    const row = rows(await api.fetchTable(TABLE)).filter((r) => r.Type === LOCK && r.Table === tableId).sort((a, b) => a.id - b.id)[0];
    return row ? { id: row.id, owner: row.Config || '', date: row.Date } : null;
  }

  async function writeLock(api, tableId, owner, date, rowId) {
    const values = { Type: LOCK, Table: tableId, Config: owner, Date: date };
    await api.applyUserActions([rowId ? ['UpdateRecord', TABLE, rowId, values] : ['AddRecord', TABLE, null, values]]);
  }

  const api = { TABLE, WORKFLOW, LOG, LOCK, readLock, writeLock, COLUMNS, isOwnTable, missingTables, ensureTables, loadGraph, saveGraph, appendLog, logsPage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Store = api;
})(typeof window !== 'undefined' ? window : globalThis);
