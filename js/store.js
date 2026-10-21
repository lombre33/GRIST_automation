// Stockage dans le document Grist : une seule table, `Automation`, qui contient à la fois les workflows (Type = Workflow, un graphe par table de vue)
// le journal des exécutions (Type = Log) et le verrou d'exécution de chaque table de vue (Type = Lock, voir js/executor.js). Une seule table à autoriser, à auditer et à masquer.
// api : { listTables(), fetchTable(nom), applyUserActions(actions) } (grist.docApi dans le widget, un faux document dans les tests).
// La colonne « Auteur » est une colonne à formule déclenchée `user.Email` : Grist y met l'email de la personne qui crée la ligne.
// Attention : c'est celle dont le navigateur exécute le widget, pas forcément celle qui a modifié la ligne d'origine.
// Règles du guide des apps de GFS (1.1) : règle 3, un graphe que cette version ne sait pas lire n'est jamais réécrit ;
// règle 4, jamais d'écriture dans une colonne absente, et l'identifiant réel de la table relu après sa création.
// Les problèmes de table sont des objets { code, ... } (code : name-taken, renamed, missing-columns, unreadable-graph) que le widget traduit (js/main.js).
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

  // Colonnes sans lesquelles une ligne n'a pas de sens : si l'une manque, rien n'est écrit. Les autres ne sont écrites que si elles existent encore.
  const REQUIRED = {
    [WORKFLOW]: ['Type', 'Table', 'Config'],
    [LOG]: ['Type', 'Table', 'Date', 'Evenement', 'Resultat'],
    [LOCK]: ['Type', 'Table', 'Config', 'Date'],
  };
  const ESSENTIAL = [...new Set(Object.values(REQUIRED).flat())];

  const isOwnTable = (name) => name === TABLE || name.startsWith(TABLE + '_');
  const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
  const problemError = (problem) => Object.assign(new Error('Automation : ' + problem.code), problem);

  // api -> colonnes de la table lues la dernière fois (null : fetchTable n'en a renvoyé aucune, on ne peut pas juger) ;
  // vidé quand une écriture échoue ou que la table vient d'être créée.
  const known = new WeakMap();
  const isUserColumn = (name) => name !== 'id' && name !== 'manualSort' && !name.startsWith('gristHelper_');

  function rows(data) {
    return (data.id || []).map((id, i) => Object.fromEntries(Object.keys(data).map((key) => [key, data[key][i]])));
  }

  // Toutes les lignes de la table, en retenant ses colonnes au passage. Les colonnes inconnues sont tolérées : on ne lit que celles qu'on connaît.
  async function load(api) {
    const data = await api.fetchTable(TABLE);
    const names = Object.keys(data).filter(isUserColumn);
    known.set(api, names.length ? new Set(names) : null);
    return rows(data);
  }

  async function missingTables(api) {
    return (await api.listTables()).includes(TABLE) ? [] : [TABLE];
  }

  // Ce qui empêche d'utiliser la table du document ou d'en créer une (null : rien). Une simple absence n'est pas un problème.
  async function problem(api) {
    const names = await api.listTables();
    if (names.includes(TABLE)) {
      await load(api);
      const columns = known.get(api);
      const absent = columns ? ESSENTIAL.filter((column) => !columns.has(column)) : [];
      return absent.length ? { code: 'missing-columns', columns: absent } : null;
    }
    const taken = names.find((name) => sameName(name, TABLE));
    return taken ? { code: 'name-taken', table: taken } : null;
  }

  // Crée la table si elle est absente. Si Grist refuse la formule d'auteur, on la crée sans (la colonne Auteur reste vide).
  // Un nom déjà pris à la casse près est refusé avant de créer (Grist donnerait un autre identifiant à la nôtre) ;
  // après la création, l'identifiant réel est relu : si Grist en a choisi un autre, on ne s'en sert pas et on le dit.
  async function ensureTables(api) {
    const before = await api.listTables();
    if (before.includes(TABLE)) return false;
    const taken = before.find((name) => sameName(name, TABLE));
    if (taken) throw problemError({ code: 'name-taken', table: taken });
    try {
      await api.applyUserActions([['AddTable', TABLE, COLUMNS]]);
    } catch (err) {
      await api.applyUserActions([['AddTable', TABLE, COLUMNS.map(({ id, type }) => ({ id, type }))]]);
    }
    known.delete(api);
    const created = (await api.listTables()).filter((name) => !before.includes(name));
    if (!created.includes(TABLE)) throw problemError({ code: 'renamed', table: created[0] || '—' });
    return true;
  }

  // Écrit une ligne sans jamais toucher une colonne absente. Un échec d'écriture fait relire les colonnes à la prochaine fois.
  async function put(api, kind, rowId, values) {
    if (!known.has(api)) await load(api);
    const columns = known.get(api);
    const absent = columns ? REQUIRED[kind].filter((column) => !columns.has(column)) : [];
    if (absent.length) throw problemError({ code: 'missing-columns', columns: absent });
    const present = columns ? Object.fromEntries(Object.entries(values).filter(([column]) => columns.has(column))) : values;
    try {
      await api.applyUserActions([rowId ? ['UpdateRecord', TABLE, rowId, present] : ['AddRecord', TABLE, null, present]]);
    } catch (err) {
      known.delete(api);
      throw err;
    }
  }

  const workflowRow = (all, tableId) => all.find((r) => r.Type === WORKFLOW && r.Table === tableId);
  const blank = (text) => text === null || text === undefined || String(text).trim() === '';

  // Règle 3 : ce que cette version ne sait pas lire (version plus récente, nœud inconnu, JSON abîmé) n'est ni ouvert ni réécrit.
  // state : 'none' (rien d'enregistré), 'ok', ou 'unreadable'.
  function stateOf(row) {
    if (!row || blank(row.Config)) return { state: 'none', graph: null };
    const graph = Graph.parse(row.Config);
    return graph ? { state: 'ok', graph } : { state: 'unreadable', graph: null };
  }

  async function readGraph(api, tableId) {
    return stateOf(workflowRow(await load(api), tableId));
  }

  async function loadGraph(api, tableId) {
    return (await readGraph(api, tableId)).graph;
  }

  async function saveGraph(api, graph, tableId, summary) {
    const values = { Type: WORKFLOW, Table: tableId, Actif: graph.active, Version: graph.version, Resume: summary, Config: JSON.stringify(graph) };
    const row = workflowRow(await load(api), tableId);
    if (stateOf(row).state === 'unreadable') throw problemError({ code: 'unreadable-graph', table: tableId });
    await put(api, WORKFLOW, row && row.id, values);
  }

  async function appendLog(api, entry) {
    await put(api, LOG, null, {
      Type: LOG,
      Date: Math.floor((entry.date || Date.now()) / 1000),
      Table: entry.table,
      Evenement: entry.event,
      Ligne: entry.row,
      Resultat: entry.result,
      Detail: entry.detail || '',
    });
  }

  // Une page du journal d'une table de vue, de la plus récente à la plus ancienne. beforeId : ne prend que les lignes plus anciennes que celle-ci
  // (curseur stable même si d'autres exécutions s'ajoutent entre deux pages). more : il reste des entrées plus anciennes.
  async function logsPage(api, tableId, count, beforeId) {
    const all = (await load(api))
      .filter((r) => r.Type === LOG && r.Table === tableId && (beforeId === null || beforeId === undefined || r.id < beforeId))
      .sort((a, b) => b.id - a.id);
    return { rows: all.slice(0, count), more: all.length > count };
  }

  // Verrou d'exécution : une ligne par table de vue. Plusieurs lignes possibles si deux onglets l'ont créée en même temps : la plus ancienne fait foi.
  async function readLock(api, tableId) {
    const row = (await load(api)).filter((r) => r.Type === LOCK && r.Table === tableId).sort((a, b) => a.id - b.id)[0];
    return row ? { id: row.id, owner: row.Config || '', date: row.Date } : null;
  }

  async function writeLock(api, tableId, owner, date, rowId) {
    await put(api, LOCK, rowId, { Type: LOCK, Table: tableId, Config: owner, Date: date });
  }

  const api = { TABLE, WORKFLOW, LOG, LOCK, readLock, writeLock, COLUMNS, isOwnTable, missingTables, problem, ensureTables, readGraph, loadGraph, saveGraph, appendLog, logsPage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Store = api;
})(typeof window !== 'undefined' ? window : globalThis);
