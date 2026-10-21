// Stockage dans le document Grist : tables Automation_Workflows (un graphe par table de vue) et Automation_Logs (journal des exécutions).
// api : { listTables(), fetchTable(nom), applyUserActions(actions) } (grist.docApi dans le widget, un faux document dans les tests).
// Les colonnes « Auteur » sont des colonnes à formule déclenchée `user.Email` : Grist y met l'email de la personne qui crée la ligne.
// Attention : c'est celle dont le navigateur exécute le widget, pas forcément celle qui a modifié la ligne d'origine.
(function (root) {
  'use strict';
  const Graph = typeof module !== 'undefined' && module.exports ? require('./graph.js') : root.Graph;

  const WORKFLOWS = 'Automation_Workflows';
  const LOGS = 'Automation_Logs';
  const PREFIX = 'Automation_';

  const author = { id: 'Auteur', type: 'Text', isFormula: false, formula: 'user.Email', recalcWhen: 0 };
  const COLUMNS = {
    [WORKFLOWS]: [
      { id: 'Table', type: 'Text' },
      { id: 'Actif', type: 'Bool' },
      { id: 'Version', type: 'Int' },
      { id: 'Resume', type: 'Text' },
      { id: 'Config', type: 'Text' },
      author,
    ],
    [LOGS]: [
      { id: 'Date', type: 'DateTime:UTC' },
      { id: 'Table', type: 'Text' },
      { id: 'Evenement', type: 'Text' },
      { id: 'Ligne', type: 'Int' },
      { id: 'Resultat', type: 'Text' },
      { id: 'Detail', type: 'Text' },
      author,
    ],
  };

  const isOwnTable = (name) => name.startsWith(PREFIX);

  async function missingTables(api) {
    const existing = await api.listTables();
    return [WORKFLOWS, LOGS].filter((name) => !existing.includes(name));
  }

  // Crée les tables absentes. Si Grist refuse la formule d'auteur, on les crée sans (la colonne Auteur reste vide).
  async function ensureTables(api) {
    const missing = await missingTables(api);
    if (!missing.length) return false;
    try {
      await api.applyUserActions(missing.map((name) => ['AddTable', name, COLUMNS[name]]));
    } catch (err) {
      const plain = (name) => COLUMNS[name].map(({ id, type }) => ({ id, type }));
      await api.applyUserActions(missing.map((name) => ['AddTable', name, plain(name)]));
    }
    return true;
  }

  function rows(data) {
    return (data.id || []).map((id, i) => Object.fromEntries(Object.keys(data).map((key) => [key, data[key][i]])));
  }

  async function loadGraph(api, tableId) {
    const row = rows(await api.fetchTable(WORKFLOWS)).find((r) => r.Table === tableId);
    return row ? Graph.parse(row.Config) : null;
  }

  async function saveGraph(api, graph, tableId, summary) {
    const values = { Table: tableId, Actif: graph.active, Version: graph.version, Resume: summary, Config: JSON.stringify(graph) };
    const row = rows(await api.fetchTable(WORKFLOWS)).find((r) => r.Table === tableId);
    await api.applyUserActions([row ? ['UpdateRecord', WORKFLOWS, row.id, values] : ['AddRecord', WORKFLOWS, null, values]]);
  }

  async function appendLog(api, entry) {
    await api.applyUserActions([['AddRecord', LOGS, null, {
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
    return rows(await api.fetchTable(LOGS))
      .filter((r) => r.Table === tableId)
      .sort((a, b) => a.Date - b.Date)
      .slice(-count);
  }

  const api = { WORKFLOWS, LOGS, COLUMNS, isOwnTable, missingTables, ensureTables, loadGraph, saveGraph, appendLog, recentLogs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Store = api;
})(typeof window !== 'undefined' ? window : globalThis);
