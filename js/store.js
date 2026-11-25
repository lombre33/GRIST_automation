// Stockage dans le document Grist : une seule table, `Automation_Store`, qui contient à la fois les workflows (Type = Workflow, un graphe par table de vue)
// le journal des exécutions (Type = Log) et le verrou d'exécution de chaque table de vue (Type = Lock, voir js/executor.js). Une seule table à autoriser, à auditer et à masquer.
// api : { listTables(), fetchTable(nom), applyUserActions(actions) } (grist.docApi dans le widget, un faux document dans les tests).
// La colonne « Author » est une colonne à formule déclenchée `user.Email` : Grist y met l'email de la personne qui crée la ligne.
// Attention : c'est celle dont le navigateur exécute le widget, pas forcément celle qui a modifié la ligne d'origine.
// Règles du guide des apps de GFS (1.1) : règle 3, un graphe que cette version ne sait pas lire n'est jamais réécrit ;
// règle 4, jamais d'écriture dans une colonne absente, et l'identifiant réel de la table relu après sa création ; point 15, une table ou une colonne « introuvable » :
// les noms sont relus et l'écriture refaite une fois, sinon l'app dit de recharger la page et n'écrit plus rien.
// Les problèmes de table sont des objets { code, ... } (code : name-taken, renamed, missing-columns, unreadable-graph, names-changed) que le widget traduit (js/main.js).
//
// Deux jeux de noms (consigne 028 de GFS : tout en anglais, sous le préfixe `Automation_`). Un document neuf prend la table `Automation_Store` et les colonnes anglaises ;
// un document d'avant la 0.15.6 garde la table `Automation` et ses colonnes françaises (Actif, Resume, Evenement, Ligne, Resultat, Auteur). L'app lit les deux jeux, sans date de fin,
// n'écrit que sous les noms que le document porte (jamais les deux jeux dans un même document), ne crée jamais la table anglaise quand l'ancienne existe et ne renomme rien.
// Dans le code, une colonne se désigne toujours par son nom anglais ; `ids` dit sous quel nom le document la porte.
(function (root) {
  'use strict';
  const Graph = typeof module !== 'undefined' && module.exports ? require('./graph.js') : root.Graph;

  const TABLE = 'Automation_Store';
  const LEGACY_TABLE = 'Automation';
  const WORKFLOW = 'Workflow';
  const LOG = 'Log';
  const LOCK = 'Lock';

  const LEGACY_COLUMNS = { Active: 'Actif', Summary: 'Resume', Event: 'Evenement', Row: 'Ligne', Result: 'Resultat', Author: 'Auteur' };
  const author = { id: 'Author', type: 'Text', isFormula: false, formula: 'user.Email', recalcWhen: 0 };
  const COLUMNS = [
    { id: 'Type', type: 'Text' },
    { id: 'Table', type: 'Text' },
    { id: 'Date', type: 'DateTime:UTC' },
    { id: 'Active', type: 'Bool' },
    { id: 'Version', type: 'Int' },
    { id: 'Summary', type: 'Text' },
    { id: 'Config', type: 'Text' },
    { id: 'Event', type: 'Text' },
    { id: 'Row', type: 'Int' },
    { id: 'Result', type: 'Text' },
    { id: 'Detail', type: 'Text' },
    author,
  ];

  // Colonnes sans lesquelles une ligne n'a pas de sens : si l'une manque, rien n'est écrit. Les autres ne sont écrites que si elles existent encore.
  const REQUIRED = {
    [WORKFLOW]: ['Type', 'Table', 'Config'],
    [LOG]: ['Type', 'Table', 'Date', 'Event', 'Result'],
    [LOCK]: ['Type', 'Table', 'Config', 'Date'],
  };
  const ESSENTIAL = [...new Set(Object.values(REQUIRED).flat())];

  const isOwnTable = (name) => name === LEGACY_TABLE || name.startsWith(LEGACY_TABLE + '_');
  const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
  const problemError = (problem) => Object.assign(new Error('Automation : ' + problem.code), problem);
  // Ce que Grist répond à une écriture ou une lecture d'une table ou d'une colonne qui n'existe pas (ou plus) : « [Sandbox] KeyError 'Resume' » pour une action,
  // « Table not found "Automation" » pour une lecture. Une ligne absente (« non-existent record ») ou un refus de droits n'en font pas partie.
  const isNotFound = (err) => /KeyError|not found|invalid (table|column)|no such (table|column)|unknown (table|column)/i.test(String((err && err.message) || ''));

  // Le nom de la colonne dans une table, quand on ne sait pas lire ses colonnes : celui du jeu de la table.
  const defaultId = (table, key) => (table === LEGACY_TABLE && LEGACY_COLUMNS[key]) || key;

  // api -> { table, ids } lus la dernière fois : la table retenue, et pour chaque colonne le nom sous lequel le document la porte (null : fetchTable n'en a renvoyé aucune, on ne peut pas juger).
  // Vidé quand une écriture ou une lecture échoue, ou que la table vient d'être créée. stalled : les apps dont les noms ont changé sous leurs pieds, qui n'écrivent plus (rechargement de la page).
  const layouts = new WeakMap();
  const stalled = new WeakSet();
  const isUserColumn = (name) => name !== 'id' && name !== 'manualSort' && !name.startsWith('gristHelper_');

  // Pour chaque colonne que l'app connaît : son nom anglais si la table l'a, sinon son ancien nom (une colonne à la fois, jamais deux jeux dans une même table).
  function idsOf(names) {
    if (!names) return null;
    const ids = new Map();
    for (const { id: key } of COLUMNS) {
      const id = [key, LEGACY_COLUMNS[key]].find((candidate) => candidate && names.has(candidate));
      if (id) ids.set(key, id);
    }
    return ids;
  }

  const sameIds = (a, b) => (a === null || b === null ? a === b : a.size === b.size && [...a].every(([key, id]) => b.get(key) === id));

  // fetchTable rend une table colonne par colonne ({ id: [...], Type: [...] }) : on la lit ligne par ligne, avec les noms anglais quel que soit le jeu du document.
  // Les colonnes que l'app ne connaît pas sont ignorées.
  function rows(columns, layout) {
    return (columns.id || []).map((id, i) => {
      const row = { id };
      for (const { id: key } of COLUMNS) {
        const source = layout.ids ? layout.ids.get(key) : defaultId(layout.table, key);
        if (source && columns[source]) row[key] = columns[source][i];
      }
      return row;
    });
  }

  const rowCount = async (api, table) => ((await api.fetchTable(table)).id || []).length;

  // La table du widget dans le document : `Automation_Store`, ou `Automation` quand le document l'a de ses débuts (null : ni l'une ni l'autre). Quand il porte les deux, celle qui a des lignes ;
  // la nouvelle si les deux en ont ou si aucune a de ligne : la règle de lecture de GFS (`arrivee`, `aussi`).
  async function chooseTable(api, names) {
    const list = names || await api.listTables();
    const fresh = list.includes(TABLE);
    const old = list.includes(LEGACY_TABLE);
    if (fresh && old) return (await rowCount(api, TABLE)) === 0 && (await rowCount(api, LEGACY_TABLE)) > 0 ? LEGACY_TABLE : TABLE;
    if (fresh) return TABLE;
    return old ? LEGACY_TABLE : null;
  }

  // Les noms ont changé sous les pieds de l'app (une table ou une colonne renommée ou retirée depuis la dernière lecture) et la relecture n'y a rien changé : plus rien n'est lu ni écrit.
  function stall(api, cause) {
    stalled.add(api);
    layouts.delete(api);
    return problemError({ code: 'names-changed', cause: cause ? String(cause.message || cause) : '' });
  }

  // Toutes les lignes de la table, en retenant ses colonnes au passage : { layout, rows }. table : la table à lire, si l'appelant l'a déjà choisie.
  // Quand Grist répond « introuvable », les noms sont relus et la lecture refaite une fois (guide de GFS, 1.1, point 15) ; si elle échoue encore, l'app dit de recharger la page.
  async function load(api, table) {
    if (stalled.has(api)) throw stall(api);
    let target = table || (layouts.get(api) || {}).table || await chooseTable(api);
    for (let attempt = 0; ; attempt += 1) {
      if (!target) throw stall(api);
      try {
        const columns = await api.fetchTable(target);
        const names = Object.keys(columns).filter(isUserColumn);
        const layout = { table: target, ids: idsOf(names.length ? new Set(names) : null) };
        layouts.set(api, layout);
        return { layout, rows: rows(columns, layout) };
      } catch (err) {
        layouts.delete(api);
        if (!isNotFound(err)) throw err;
        if (attempt === 1) throw stall(api, err);
        const again = await chooseTable(api);
        if (again === target) throw err;   // les noms n'ont pas changé : ce qui manque n'est pas un nom
        target = again;
      }
    }
  }

  async function missingTables(api) {
    const names = await api.listTables();
    return names.includes(TABLE) || names.includes(LEGACY_TABLE) ? [] : [TABLE];
  }

  // Ce qui empêche d'utiliser la table du document ou d'en créer une (null : rien). Une simple absence n'est pas un problème.
  async function problem(api) {
    const names = await api.listTables();
    const table = await chooseTable(api, names);
    if (table) {
      const { layout } = await load(api, table);
      const absent = layout.ids ? ESSENTIAL.filter((key) => !layout.ids.has(key)) : [];
      return absent.length ? { code: 'missing-columns', table, columns: absent.map((key) => defaultId(table, key)) } : null;
    }
    const taken = names.find((name) => sameName(name, TABLE));
    return taken ? { code: 'name-taken', table: taken } : null;
  }

  // Crée la table si le document n'a ni l'une ni l'autre : jamais la table anglaise quand `Automation` existe. Si Grist refuse la formule d'auteur, on la crée sans (la colonne Author reste vide).
  // Un nom déjà pris à la casse près est refusé avant de créer (Grist donnerait un autre identifiant à la nôtre) ;
  // après la création, l'identifiant réel est relu : si Grist en a choisi un autre, on ne s'en sert pas et on le dit.
  async function ensureTables(api) {
    const before = await api.listTables();
    if (before.includes(TABLE) || before.includes(LEGACY_TABLE)) return false;
    const taken = before.find((name) => sameName(name, TABLE));
    if (taken) throw problemError({ code: 'name-taken', table: taken });
    try {
      await api.applyUserActions([['AddTable', TABLE, COLUMNS]]);
    } catch (err) {
      await api.applyUserActions([['AddTable', TABLE, COLUMNS.map(({ id, type }) => ({ id, type }))]]);
    }
    layouts.delete(api);
    stalled.delete(api);
    const created = (await api.listTables()).filter((name) => !before.includes(name));
    if (!created.includes(TABLE)) throw problemError({ code: 'renamed', table: created[0] || '—' });
    return true;
  }

  // Écrit une ligne sans jamais toucher une colonne absente, sous les noms que le document porte. Un échec d'écriture fait relire la table et ses colonnes à la prochaine fois ;
  // une table ou une colonne « introuvable » fait relire les noms et recommencer une fois, si les noms ont changé (sinon l'erreur de Grist est rendue telle quelle).
  async function put(api, kind, rowId, values) {
    if (stalled.has(api)) throw stall(api);
    let layout = layouts.get(api) || (await load(api)).layout;
    for (let attempt = 0; ; attempt += 1) {
      const absent = layout.ids ? REQUIRED[kind].filter((key) => !layout.ids.has(key)) : [];
      if (absent.length) throw problemError({ code: 'missing-columns', table: layout.table, columns: absent.map((key) => defaultId(layout.table, key)) });
      const present = {};
      for (const [key, value] of Object.entries(values)) {
        const id = layout.ids ? layout.ids.get(key) : defaultId(layout.table, key);
        if (id) present[id] = value;
      }
      try {
        await api.applyUserActions([rowId ? ['UpdateRecord', layout.table, rowId, present] : ['AddRecord', layout.table, null, present]]);
        return;
      } catch (err) {
        layouts.delete(api);
        if (!isNotFound(err)) throw err;
        if (attempt === 1) throw stall(api, err);
        const fresh = (await load(api)).layout;
        if (fresh.table === layout.table && sameIds(fresh.ids, layout.ids)) throw err;   // les noms n'ont pas changé : ce qui manque n'est pas un nom
        layout = fresh;
      }
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
    return stateOf(workflowRow((await load(api)).rows, tableId));
  }

  async function loadGraph(api, tableId) {
    return (await readGraph(api, tableId)).graph;
  }

  // Le contenu enregistré du workflow d'une table de vue, tel quel (null : pas de ligne Workflow, ou une Config vide) : le diagnostic (js/diagnostic.js) en dit la nature
  // quand cette version ne sait pas le lire, sans le recopier.
  async function configText(api, tableId) {
    const row = workflowRow((await load(api)).rows, tableId);
    return row && !blank(row.Config) ? String(row.Config) : null;
  }

  async function saveGraph(api, graph, tableId, summary) {
    const values = { Type: WORKFLOW, Table: tableId, Active: graph.active, Version: graph.version, Summary: summary, Config: JSON.stringify(graph) };
    const row = workflowRow((await load(api)).rows, tableId);
    if (stateOf(row).state === 'unreadable') throw problemError({ code: 'unreadable-graph', table: tableId });
    await put(api, WORKFLOW, row && row.id, values);
  }

  async function appendLog(api, entry) {
    await put(api, LOG, null, {
      Type: LOG,
      Date: Math.floor((entry.date || Date.now()) / 1000),
      Table: entry.table,
      Event: entry.event,
      Row: entry.row,
      Result: entry.result,
      Detail: entry.detail || '',
    });
  }

  // Une page du journal d'une table de vue, de la plus récente à la plus ancienne. beforeId : ne prend que les lignes plus anciennes que celle-ci
  // (curseur stable même si d'autres exécutions s'ajoutent entre deux pages). more : il reste des entrées plus anciennes.
  async function logsPage(api, tableId, count, beforeId) {
    const all = (await load(api)).rows
      .filter((r) => r.Type === LOG && r.Table === tableId && (beforeId === null || beforeId === undefined || r.id < beforeId))
      .sort((a, b) => b.id - a.id);
    return { rows: all.slice(0, count), more: all.length > count };
  }

  // Verrou d'exécution : une ligne par table de vue. Plusieurs lignes possibles si deux onglets l'ont créée en même temps : la plus ancienne fait foi.
  async function readLock(api, tableId) {
    const row = (await load(api)).rows.filter((r) => r.Type === LOCK && r.Table === tableId).sort((a, b) => a.id - b.id)[0];
    return row ? { id: row.id, owner: row.Config || '', date: row.Date } : null;
  }

  async function writeLock(api, tableId, owner, date, rowId) {
    await put(api, LOCK, rowId, { Type: LOCK, Table: tableId, Config: owner, Date: date });
  }

  const api = { TABLE, LEGACY_TABLE, LEGACY_COLUMNS, WORKFLOW, LOG, LOCK, readLock, writeLock, COLUMNS, isOwnTable, missingTables, problem, ensureTables, readGraph, loadGraph, saveGraph, configText, appendLog, logsPage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Store = api;
})(typeof window !== 'undefined' ? window : globalThis);
