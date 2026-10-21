// Stockage dans le document Grist : une seule table, `Automation`, qui contient à la fois les workflows (Type = Workflow, un graphe par table de vue)
// et le journal des exécutions (Type = Log). Une seule table à autoriser, à auditer et à masquer.
// api : { listTables(), fetchTable(nom), applyUserActions(actions) } (grist.docApi dans le widget, un faux document dans les tests).
// La colonne « Auteur » est une colonne à formule déclenchée `user.Email` : Grist y met l'email de la personne qui crée la ligne.
// Attention : c'est celle dont le navigateur exécute le widget, pas forcément celle qui a modifié la ligne d'origine.
(function (root) {
  'use strict';
  const Graph = typeof module !== 'undefined' && module.exports ? require('./graph.js') : root.Graph;

  const TABLE = 'Automation';
  const WORKFLOW = 'Workflow';
  const LOG = 'Log';

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

  // Les `count` dernières entrées de la table, de la plus ancienne à la plus récente.
  async function recentLogs(api, tableId, count) {
    return rows(await api.fetchTable(TABLE))
      .filter((r) => r.Type === LOG && r.Table === tableId)
      .sort((a, b) => a.Date - b.Date)
      .slice(-count);
  }

  const api = { TABLE, WORKFLOW, LOG, COLUMNS, isOwnTable, missingTables, ensureTables, loadGraph, saveGraph, appendLog, recentLogs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Store = api;
})(typeof window !== 'undefined' ? window : globalThis);
