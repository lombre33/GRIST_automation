'use strict';
// GFS : règles 3 (préserver l'inconnu) et 4 (données) du guide des apps de Grist Factory Suite, section 1.1.
const test = require('node:test');
const assert = require('node:assert');
const S = require('../js/store.js');
const G = require('../js/graph.js');
const { createFakeDoc } = require('./fakes/fakeGrist.js');

const ALL = S.COLUMNS.map((c) => c.id);
const without = (...absent) => ALL.filter((id) => !absent.includes(id));

function graph() {
  const g = G.create();
  const trigger = G.addNode(g, 'trigger', 0, 0);
  const act = G.addNode(g, 'action', 100, 0);
  trigger.config.column = 'Statut';
  act.config.column = 'Motif';
  G.connect(g, trigger.id, act.id);
  return g;
}

const rejects = (promise, expected) => assert.rejects(promise, (err) => {
  assert.deepStrictEqual(Object.fromEntries(Object.entries(expected).map(([key]) => [key, err[key]])), expected);
  return true;
});

/* ---------- Règle 4 : relire l'identifiant réel, ne jamais écrire une colonne absente ---------- */

test('GFS-01 un nom déjà pris à la casse près : la table n\'est pas créée, le problème est nommé', async () => {
  const doc = createFakeDoc({ automation_store: ['Nom'] });
  assert.deepStrictEqual(await S.problem(doc), { code: 'name-taken', table: 'automation_store' });
  await rejects(S.ensureTables(doc), { code: 'name-taken', table: 'automation_store' });
  assert.deepStrictEqual([...doc.tables.keys()], ['automation_store'], 'rien n\'est ajouté au document');
});

test('GFS-02 l\'identifiant réel est relu après AddTable : si Grist en a choisi un autre, on ne s\'en sert pas', async () => {
  const doc = createFakeDoc({ Contacts: ['Nom'] }, { renameTables: { Automation_Store: 'Automation_Store_9' } });
  await rejects(S.ensureTables(doc), { code: 'renamed', table: 'Automation_Store_9' });
  assert.deepStrictEqual(await S.missingTables(doc), [S.TABLE], 'la table attendue n\'est pas considérée comme créée');
  assert.ok(doc.tables.has('Automation_Store_9'), 'la table créée par Grist n\'est pas supprimée : c\'est à la personne de décider');
});

test('GFS-03 une table créée normalement n\'a aucun problème', async () => {
  const doc = createFakeDoc({ Contacts: ['Nom'] });
  assert.strictEqual(await S.problem(doc), null, 'l\'absence n\'est pas un problème');
  await S.ensureTables(doc);
  assert.strictEqual(await S.problem(doc), null);
});

test('GFS-04 colonnes indispensables absentes : signalées dans l\'ordre, et rien n\'est écrit', async () => {
  const doc = createFakeDoc({ [S.TABLE]: without('Config', 'Result') });
  assert.deepStrictEqual(await S.problem(doc), { code: 'missing-columns', table: S.TABLE, columns: ['Config', 'Result'] });
  await rejects(S.saveGraph(doc, graph(), 'Contacts', ''), { code: 'missing-columns', table: S.TABLE, columns: ['Config'] });
  await rejects(S.appendLog(doc, { table: 'Contacts', event: 'update', row: 1, result: 'success' }), { code: 'missing-columns', table: S.TABLE, columns: ['Result'] });
  await rejects(S.writeLock(doc, 'Contacts', 'A', 1, null), { code: 'missing-columns', table: S.TABLE, columns: ['Config'] });
  assert.deepStrictEqual(doc.tables.get(S.TABLE).rows, []);
});

test('GFS-05 une colonne facultative absente est laissée de côté, jamais écrite', async () => {
  const doc = createFakeDoc({ [S.TABLE]: without('Detail', 'Row', 'Active', 'Summary') });
  await S.appendLog(doc, { table: 'Contacts', event: 'update', row: 7, result: 'success', detail: 'x' });
  await S.saveGraph(doc, graph(), 'Contacts', 'résumé');
  const [log, workflow] = doc.tables.get(S.TABLE).rows;
  assert.deepStrictEqual(Object.keys(log).sort(), ['Date', 'Event', 'Result', 'Table', 'Type', 'id']);
  assert.deepStrictEqual(Object.keys(workflow).sort(), ['Config', 'Table', 'Type', 'Version', 'id']);
});

test('GFS-06 une colonne supprimée pendant la session : Grist la dit introuvable, les colonnes sont relues et l\'écriture refaite une fois, sans elle', async () => {
  const doc = createFakeDoc();
  await S.ensureTables(doc);
  const entry = { table: 'Contacts', event: 'update', row: 1, result: 'success', detail: 'x' };
  await S.appendLog(doc, entry);
  const table = doc.tables.get(S.TABLE);
  table.columns = table.columns.filter((column) => column !== 'Detail');
  await S.appendLog(doc, entry);
  assert.strictEqual(table.rows.length, 2, 'la deuxième écriture a échoué une fois, puis passé sans la colonne disparue');
  assert.ok(!('Detail' in table.rows[1]));
  await S.appendLog(doc, entry);
  assert.strictEqual(table.rows.length, 3);
});

test('GFS-07 les colonnes inconnues sont tolérées : lues sans erreur, jamais réécrites', async () => {
  const doc = createFakeDoc({ [S.TABLE]: [...ALL, 'Notes'] });
  doc.seedRow(S.TABLE, { Type: S.WORKFLOW, Table: 'Contacts', Config: JSON.stringify(graph()), Notes: 'à moi' });
  assert.strictEqual(await S.problem(doc), null);
  await S.saveGraph(doc, { ...graph(), active: true }, 'Contacts', 'résumé');
  const row = doc.tables.get(S.TABLE).rows[0];
  assert.strictEqual(row.Notes, 'à moi');
  assert.strictEqual(row.Active, true);
});

test('GFS-08 le message d\'une écriture qui échoue pour une autre raison est transmis tel quel', async () => {
  const doc = createFakeDoc();
  await S.ensureTables(doc);
  doc.failNext = 'Permission refusée';
  await assert.rejects(S.appendLog(doc, { table: 'Contacts', event: 'update', row: 1, result: 'success' }), /Permission refusée/);
});

test('GFS-09 fetchTable ne renvoie aucune colonne (table vide) : on ne peut pas juger, on laisse passer', async () => {
  const doc = createFakeDoc();
  await S.ensureTables(doc);
  const blind = Object.assign(Object.create(doc), { fetchTable: async () => ({ id: [] }) });
  assert.strictEqual(await S.problem(blind), null);
  await S.appendLog(blind, { table: 'Contacts', event: 'update', row: 1, result: 'success' });
  assert.strictEqual(doc.tables.get(S.TABLE).rows.length, 1);
});

/* ---------- Règle 3 : préserver l'inconnu ---------- */

test('GFS-10 un graphe lisible garde ce que cette version ne connaît pas : clés de la racine, des nœuds, des config et des liens', () => {
  const g = graph();
  const text = JSON.stringify({ ...g, vue: { zoom: 2 }, nodes: g.nodes.map((node) => ({ ...node, note: 'à garder', config: { ...node.config, delai: 5 } })),
    edges: g.edges.map((edge) => ({ ...edge, etiquette: 'oui' })) });
  const read = G.parse(text);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(read)), JSON.parse(text), 'l\'enregistrement suivant réécrit tout, inconnu compris');
  assert.deepStrictEqual(G.parse(JSON.stringify({ ...g, version: 2, vue: 1 })).vue, 1, 'même en passant de la version 2 à la 3');
});

test('GFS-11 état du graphe enregistré : rien, lisible, ou illisible (version plus récente, nœud inconnu, JSON abîmé)', async () => {
  const doc = createFakeDoc();
  await S.ensureTables(doc);
  const state = async () => (await S.readGraph(doc, 'Contacts')).state;
  assert.strictEqual(await state(), 'none');
  doc.seedRow(S.TABLE, { Type: S.WORKFLOW, Table: 'Contacts', Config: '  ' });
  assert.strictEqual(await state(), 'none', 'une cellule vide n\'est pas un contenu');
  const row = doc.tables.get(S.TABLE).rows[0];
  row.Config = JSON.stringify(graph());
  assert.strictEqual(await state(), 'ok');
  for (const unreadable of [
    JSON.stringify({ ...graph(), version: 4 }),
    JSON.stringify({ ...graph(), nodes: [...graph().nodes, { id: 'boucle-1', type: 'boucle', x: 0, y: 0, config: {} }] }),
    '{pas du json',
    '{}',
  ]) {
    row.Config = unreadable;
    assert.strictEqual(await state(), 'unreadable', unreadable);
    assert.strictEqual(await S.loadGraph(doc, 'Contacts'), null);
  }
});

test('GFS-12 un contenu que cette version ne lit pas n\'est jamais réécrit', async () => {
  const doc = createFakeDoc();
  await S.ensureTables(doc);
  const newer = JSON.stringify({ version: 4, active: true, nodes: [], edges: [], boucles: [1] });
  doc.seedRow(S.TABLE, { Type: S.WORKFLOW, Table: 'Contacts', Config: newer });
  await rejects(S.saveGraph(doc, graph(), 'Contacts', ''), { code: 'unreadable-graph', table: 'Contacts' });
  assert.strictEqual(doc.tables.get(S.TABLE).rows[0].Config, newer);
  assert.strictEqual(doc.tables.get(S.TABLE).rows.length, 1, 'ni ligne ajoutée à côté');
  await S.saveGraph(doc, graph(), 'Services', 'autre table');
  assert.strictEqual(doc.tables.get(S.TABLE).rows.length, 2, 'les autres tables de vue restent enregistrables');
});

test('GFS-13 une cellule vide est remplacée sans protestation', async () => {
  const doc = createFakeDoc();
  await S.ensureTables(doc);
  doc.seedRow(S.TABLE, { Type: S.WORKFLOW, Table: 'Contacts', Config: '' });
  await S.saveGraph(doc, graph(), 'Contacts', 'résumé');
  assert.strictEqual((await S.readGraph(doc, 'Contacts')).state, 'ok');
  assert.strictEqual(doc.tables.get(S.TABLE).rows.length, 1);
});

/* ---------- Consigne 028 : tout en anglais, sous le préfixe `Automation_` ---------- */
// Un document neuf prend la table `Automation_Store` et les colonnes anglaises ; un document d'avant la 0.15.6 garde `Automation` et ses colonnes françaises.
// L'app lit les deux jeux de noms, n'écrit que sous ceux du document, ne crée jamais la table anglaise quand l'ancienne existe, ne renomme rien.

const legacyColumns = ALL.map((id) => S.LEGACY_COLUMNS[id] || id);
const legacyDoc = () => createFakeDoc({ [S.LEGACY_TABLE]: legacyColumns });
const SIX = ['Active', 'Summary', 'Event', 'Row', 'Result', 'Author'];

// Un document dont chaque écriture est comptée (la lecture n'écrit rien).
function counting(doc) {
  const calls = { writes: [], reads: 0 };
  const spy = Object.assign(Object.create(doc), {
    applyUserActions: async (actions) => { calls.writes.push(actions); return doc.applyUserActions(actions); },
    fetchTable: async (name) => { calls.reads += 1; return doc.fetchTable(name); },
  });
  return { spy, calls };
}

// Un document dont la table ou les colonnes changent juste après la première lecture de l'app (le cas d'un onglet resté sur d'anciens noms) : changes est joué une fois par lecture, dans l'ordre.
function racing(doc, ...changes) {
  const queue = [...changes];
  return Object.assign(Object.create(doc), {
    fetchTable: async (name) => {
      const data = await doc.fetchTable(name);
      const change = queue.shift();
      if (change) change();
      return data;
    },
  });
}
const renameTable = (doc, from, to) => () => {
  doc.tables.set(to, doc.tables.get(from));
  doc.tables.delete(from);
};

test('GFS-14 un document neuf : la table `Automation_Store` et les douze colonnes anglaises, aucune française ; `Author` garde sa formule déclenchée (consigne 028)', async () => {
  const doc = createFakeDoc({ Contacts: ['Nom'] });
  assert.deepStrictEqual(await S.missingTables(doc), ['Automation_Store']);
  assert.strictEqual(await S.ensureTables(doc), true);
  assert.deepStrictEqual([...doc.tables.keys()], ['Contacts', 'Automation_Store'], 'une seule table de plus, jamais `Automation`');
  const table = doc.tables.get('Automation_Store');
  assert.deepStrictEqual(table.columns, ['Type', 'Table', 'Date', 'Active', 'Version', 'Summary', 'Config', 'Event', 'Row', 'Result', 'Detail', 'Author']);
  assert.ok(Object.values(S.LEGACY_COLUMNS).every((name) => !table.columns.includes(name)), 'aucun nom français');
  const author = table.spec.find((column) => column.id === 'Author');
  assert.strictEqual(author.formula, 'user.Email');
  assert.strictEqual(author.isFormula, false, 'une formule déclenchée à la création de la ligne, pas une colonne calculée');
  assert.strictEqual(author.recalcWhen, 0);
  assert.strictEqual(await S.problem(doc), null);
});

test('GFS-15 un document aux noms d\'avant : lu sans rien y changer (aucune écriture, aucune table de plus), les colonnes lues sous leurs noms anglais', async () => {
  const doc = legacyDoc();
  const old = { id: 1, Type: S.WORKFLOW, Table: 'Contacts', Actif: true, Version: 3, Resume: 'résumé', Config: JSON.stringify(graph()) };
  doc.seedRow(S.LEGACY_TABLE, old);
  doc.seedRow(S.LEGACY_TABLE, { Type: S.LOG, Table: 'Contacts', Date: 5, Evenement: 'update', Ligne: 3, Resultat: 'success', Detail: 'd', Auteur: 'a@b.test' });
  doc.seedRow(S.LEGACY_TABLE, { Type: S.LOCK, Table: 'Contacts', Config: 'onglet-1', Date: 9 });
  const before = JSON.stringify([...doc.tables]);
  const { spy, calls } = counting(doc);
  assert.deepStrictEqual(await S.missingTables(spy), [], 'la table d\'avant compte : rien n\'est à créer');
  assert.strictEqual(await S.problem(spy), null);
  assert.strictEqual(await S.ensureTables(spy), false);
  assert.deepStrictEqual(await S.loadGraph(spy, 'Contacts'), graph());
  assert.strictEqual(await S.configText(spy, 'Contacts'), JSON.stringify(graph()));
  const page = await S.logsPage(spy, 'Contacts', 5);
  assert.deepStrictEqual(page.rows.map(({ Event, Row, Result, Author, Date, Detail }) => ({ Event, Row, Result, Author, Date, Detail })),
    [{ Event: 'update', Row: 3, Result: 'success', Author: 'a@b.test', Date: 5, Detail: 'd' }], 'noms anglais, valeurs de l\'ancienne colonne');
  assert.deepStrictEqual(await S.readLock(spy, 'Contacts'), { id: 3, owner: 'onglet-1', date: 9 });
  assert.deepStrictEqual(calls.writes, [], 'lire n\'écrit rien');
  assert.strictEqual(JSON.stringify([...doc.tables]), before, 'ni table ajoutée ni colonne renommée');
});

test('GFS-16 un document aux noms d\'avant : les écritures vont dans `Automation`, sous ses colonnes françaises ; la table anglaise n\'est jamais créée', async () => {
  const doc = legacyDoc();
  await S.saveGraph(doc, { ...graph(), active: true }, 'Contacts', 'résumé');
  await S.saveGraph(doc, { ...graph(), active: false }, 'Contacts', 'résumé 2');
  await S.appendLog(doc, { date: 5000, table: 'Contacts', event: 'update', row: 3, result: 'success', detail: 'x' });
  await S.writeLock(doc, 'Contacts', 'A', 7, null);
  assert.deepStrictEqual([...doc.tables.keys()], ['Automation'], 'jamais les deux jeux de noms dans un même document');
  const [workflow, log, lock] = doc.tables.get('Automation').rows;
  assert.deepStrictEqual([workflow.Type, workflow.Actif, workflow.Resume, workflow.Version], [S.WORKFLOW, false, 'résumé 2', 3]);
  assert.deepStrictEqual([log.Type, log.Evenement, log.Ligne, log.Resultat, log.Detail, log.Date], [S.LOG, 'update', 3, 'success', 'x', 5]);
  assert.deepStrictEqual([lock.Type, lock.Config, lock.Date], [S.LOCK, 'A', 7]);
  for (const row of [workflow, log, lock]) assert.ok(SIX.every((name) => !(name in row)), 'aucune colonne anglaise écrite');
  assert.deepStrictEqual(doc.tables.get('Automation').columns, legacyColumns, 'les colonnes ne sont pas renommées');
  assert.strictEqual(await S.ensureTables(doc), false);
  assert.deepStrictEqual([...doc.tables.keys()], ['Automation']);
});

test('GFS-17 les deux tables dans un document : celle qui a des lignes, la nouvelle si les deux en ont ou si aucune (comme GFS)', async () => {
  const both = (oldRows, newRows) => {
    const doc = createFakeDoc({ [S.LEGACY_TABLE]: legacyColumns, [S.TABLE]: ALL });
    for (let i = 0; i < oldRows; i += 1) doc.seedRow(S.LEGACY_TABLE, { Type: S.LOG, Table: 'Contacts' });
    for (let i = 0; i < newRows; i += 1) doc.seedRow(S.TABLE, { Type: S.LOG, Table: 'Contacts' });
    return doc;
  };
  const landing = async (oldRows, newRows) => {
    const doc = both(oldRows, newRows);
    assert.deepStrictEqual(await S.missingTables(doc), []);
    assert.strictEqual(await S.ensureTables(doc), false);
    await S.saveGraph(doc, graph(), 'Contacts', 'r');
    return [doc.tables.get(S.LEGACY_TABLE).rows.length - oldRows, doc.tables.get(S.TABLE).rows.length - newRows];
  };
  assert.deepStrictEqual(await landing(2, 0), [1, 0], 'seule l\'ancienne a des lignes : elle sert');
  assert.deepStrictEqual(await landing(0, 2), [0, 1], 'seule la nouvelle en a');
  assert.deepStrictEqual(await landing(2, 2), [0, 1], 'les deux en ont : la nouvelle');
  assert.deepStrictEqual(await landing(0, 0), [0, 1], 'aucune n\'en a : la nouvelle');
  assert.strictEqual(await S.problem(both(2, 0)), null);
});

test('GFS-18 une table dont une colonne porte encore son nom d\'avant : chaque colonne sous le nom que le document lui donne', async () => {
  const doc = createFakeDoc({ [S.TABLE]: ALL.map((id) => (id === 'Summary' ? 'Resume' : id === 'Event' ? 'Evenement' : id)) });
  assert.strictEqual(await S.problem(doc), null);
  await S.saveGraph(doc, { ...graph(), active: true }, 'Contacts', 'résumé');
  await S.appendLog(doc, { date: 5000, table: 'Contacts', event: 'update', row: 3, result: 'success' });
  const [workflow, log] = doc.tables.get(S.TABLE).rows;
  assert.deepStrictEqual([workflow.Active, workflow.Resume, 'Summary' in workflow], [true, 'résumé', false]);
  assert.deepStrictEqual([log.Evenement, log.Row, log.Result, 'Event' in log], ['update', 3, 'success', false]);
  const page = await S.logsPage(doc, 'Contacts', 5);
  assert.deepStrictEqual([page.rows[0].Event, page.rows[0].Row], ['update', 3]);
});

test('GFS-19 colonnes indispensables absentes d\'un document d\'avant : les noms dits sont ceux de ses colonnes (Resultat), pas ceux de la table anglaise', async () => {
  const doc = createFakeDoc({ [S.LEGACY_TABLE]: legacyColumns.filter((id) => !['Config', 'Resultat'].includes(id)) });
  assert.deepStrictEqual(await S.problem(doc), { code: 'missing-columns', table: 'Automation', columns: ['Config', 'Resultat'] });
  await rejects(S.appendLog(doc, { table: 'Contacts', event: 'update', row: 1, result: 'success' }), { code: 'missing-columns', table: 'Automation', columns: ['Resultat'] });
  assert.deepStrictEqual(doc.tables.get('Automation').rows, []);
});

test('GFS-20 un nom qui n\'est pas le nôtre ne bloque pas : une table `automation` (casse différente) n\'empêche pas de créer `Automation_Store`', async () => {
  const doc = createFakeDoc({ automation: ['Nom'] });
  assert.strictEqual(await S.problem(doc), null);
  assert.deepStrictEqual(await S.missingTables(doc), [S.TABLE]);
  assert.strictEqual(await S.ensureTables(doc), true);
  assert.deepStrictEqual([...doc.tables.keys()], ['automation', 'Automation_Store']);
});

test('GFS-21 la table change de nom pendant la session : une lecture « introuvable » relit les noms et recommence une fois', async () => {
  const doc = legacyDoc();
  await S.saveGraph(doc, graph(), 'Contacts', 'r');
  renameTable(doc, S.LEGACY_TABLE, S.TABLE)();   // un autre onglet, une autre personne ou une restauration
  assert.deepStrictEqual(await S.loadGraph(doc, 'Contacts'), graph(), 'le graphe est relu dans la table sous son nouveau nom');
  await S.appendLog(doc, { date: 5000, table: 'Contacts', event: 'update', row: 1, result: 'success' });
  assert.strictEqual(doc.tables.get(S.TABLE).rows.length, 2, 'et la suite s\'écrit dans cette table');
});

test('GFS-22 la table change de nom entre la lecture et l\'écriture : l\'écriture « introuvable » relit les noms et recommence une fois, sans doubler', async () => {
  const doc = legacyDoc();
  await S.saveGraph(doc, graph(), 'Contacts', 'r');
  const racer = racing(doc, renameTable(doc, S.LEGACY_TABLE, S.TABLE));
  await S.saveGraph(racer, { ...graph(), active: true }, 'Contacts', 'r2');
  assert.deepStrictEqual([...doc.tables.keys()], [S.TABLE]);
  const rows = doc.tables.get(S.TABLE).rows;
  assert.strictEqual(rows.length, 1, 'la ligne du workflow est mise à jour, pas ajoutée une seconde fois');
  assert.deepStrictEqual([rows[0].Actif, rows[0].Resume], [true, 'r2'], 'sous les colonnes que la table a');
});

test('GFS-23 une colonne renommée entre la lecture et l\'écriture : les noms sont relus et l\'écriture refaite une fois', async () => {
  const doc = legacyDoc();
  const renameColumn = () => {
    const table = doc.tables.get(S.LEGACY_TABLE);
    table.columns = table.columns.map((id) => (id === 'Resume' ? 'Summary' : id));
  };
  const racer = racing(doc, renameColumn);
  await S.saveGraph(racer, graph(), 'Contacts', 'r');
  const [row] = doc.tables.get(S.LEGACY_TABLE).rows;
  assert.deepStrictEqual([row.Summary, 'Resume' in row], ['r', false], 'le résumé est écrit sous le nom que la colonne porte à présent');
});

test('GFS-24 les noms changent encore après la relecture : l\'app dit de recharger la page (names-changed) et n\'écrit ni ne lit plus rien', async () => {
  const doc = legacyDoc();
  await S.saveGraph(doc, graph(), 'Contacts', 'r');
  const { spy, calls } = counting(doc);
  // 1re lecture : la table devient `Automation_Store` ; 2e lecture (la relecture) : elle redevient `Automation` avant l'écriture.
  const racer = racing(spy, renameTable(doc, S.LEGACY_TABLE, S.TABLE), renameTable(doc, S.TABLE, S.LEGACY_TABLE));
  await assert.rejects(S.saveGraph(racer, { ...graph(), active: true }, 'Contacts', 'r2'), (err) => err.code === 'names-changed');
  const writes = calls.writes.length;
  const reads = calls.reads;
  for (const again of [() => S.readLock(racer, 'Contacts'), () => S.appendLog(racer, { table: 'Contacts', event: 'update', row: 1, result: 'success' }),
    () => S.writeLock(racer, 'Contacts', 'A', 1, null), () => S.logsPage(racer, 'Contacts', 5), () => S.saveGraph(racer, graph(), 'Contacts', '')]) {
    await assert.rejects(again(), (err) => err.code === 'names-changed');
  }
  assert.strictEqual(calls.writes.length, writes, 'plus aucune écriture');
  assert.strictEqual(calls.reads, reads, 'plus aucune lecture : la page doit être rechargée');
  assert.strictEqual(doc.tables.get(S.LEGACY_TABLE).rows.length, 1, 'rien n\'a été écrit en double');
});

test('GFS-25 la table du widget a disparu : lire ou écrire dit de recharger la page, sans créer de table', async () => {
  const doc = legacyDoc();
  await S.saveGraph(doc, graph(), 'Contacts', 'r');
  doc.tables.delete(S.LEGACY_TABLE);
  await assert.rejects(S.loadGraph(doc, 'Contacts'), (err) => err.code === 'names-changed');
  assert.deepStrictEqual([...doc.tables.keys()], [], 'rien n\'est recréé de lui-même');
});

test('GFS-26 un refus de Grist qui n\'est pas un nom introuvable (droits, ligne retirée) n\'est pas refait : le message est rendu tel quel, après une seule tentative', async () => {
  for (const message of ['Blocked by row update access rules', '[Sandbox] AssertionError docactions.[Bulk]UpdateRecord for non-existent record #999']) {
    const doc = createFakeDoc();
    await S.ensureTables(doc);
    await S.saveGraph(doc, graph(), 'Contacts', 'r');
    const { spy, calls } = counting(doc);
    doc.failNext = message;
    await assert.rejects(S.appendLog(spy, { table: 'Contacts', event: 'update', row: 1, result: 'success' }), (err) => err.message === message && err.code === undefined);
    assert.strictEqual(calls.writes.length, 1, message);
    await S.appendLog(spy, { table: 'Contacts', event: 'update', row: 1, result: 'success' });
    assert.strictEqual(calls.writes.length, 2, 'l\'app n\'est pas figée : l\'écriture d\'après passe');
  }
});

test('GFS-27 un nom introuvable qui n\'est pas un nom de l\'app (les noms relus sont les mêmes) : l\'erreur de Grist est rendue telle quelle, sans refaire l\'écriture ni dire de recharger', async () => {
  const doc = createFakeDoc();
  await S.ensureTables(doc);
  await S.saveGraph(doc, graph(), 'Contacts', 'r');
  const { spy, calls } = counting(doc);
  doc.failNext = "[Sandbox] KeyError 'Autre'";
  await assert.rejects(S.appendLog(spy, { table: 'Contacts', event: 'update', row: 1, result: 'success' }), (err) => err.message === "[Sandbox] KeyError 'Autre'" && err.code === undefined);
  assert.strictEqual(calls.writes.length, 1);
});

test('GFS-28 une colonne qui porte les deux noms (un document abîmé à la main) : le nom anglais fait foi', async () => {
  const doc = createFakeDoc({ [S.TABLE]: [...ALL, 'Resume', 'Actif'] });
  await S.saveGraph(doc, { ...graph(), active: true }, 'Contacts', 'résumé');
  const [row] = doc.tables.get(S.TABLE).rows;
  assert.deepStrictEqual([row.Summary, row.Active, 'Resume' in row, 'Actif' in row], ['résumé', true, false, false]);
});

test('GFS-29 fetchTable ne renvoie aucune colonne (table vide) dans un document d\'avant : on ne peut pas juger, et on écrit sous les noms de sa table (français)', async () => {
  const doc = legacyDoc();
  const blind = Object.assign(Object.create(doc), { fetchTable: async () => ({ id: [] }) });
  assert.strictEqual(await S.problem(blind), null);
  await S.appendLog(blind, { table: 'Contacts', event: 'update', row: 4, result: 'success' });
  const [log] = doc.tables.get(S.LEGACY_TABLE).rows;
  assert.deepStrictEqual([log.Evenement, log.Ligne, log.Resultat, 'Event' in log], ['update', 4, 'success', false]);
});
