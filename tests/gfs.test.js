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
  const doc = createFakeDoc({ automation: ['Nom'] });
  assert.deepStrictEqual(await S.problem(doc), { code: 'name-taken', table: 'automation' });
  await rejects(S.ensureTables(doc), { code: 'name-taken', table: 'automation' });
  assert.deepStrictEqual([...doc.tables.keys()], ['automation'], 'rien n\'est ajouté au document');
});

test('GFS-02 l\'identifiant réel est relu après AddTable : si Grist en a choisi un autre, on ne s\'en sert pas', async () => {
  const doc = createFakeDoc({ Contacts: ['Nom'] }, { renameTables: { Automation: 'Automation_9' } });
  await rejects(S.ensureTables(doc), { code: 'renamed', table: 'Automation_9' });
  assert.deepStrictEqual(await S.missingTables(doc), [S.TABLE], 'la table attendue n\'est pas considérée comme créée');
  assert.ok(doc.tables.has('Automation_9'), 'la table créée par Grist n\'est pas supprimée : c\'est à la personne de décider');
});

test('GFS-03 une table créée normalement n\'a aucun problème', async () => {
  const doc = createFakeDoc({ Contacts: ['Nom'] });
  assert.strictEqual(await S.problem(doc), null, 'l\'absence n\'est pas un problème');
  await S.ensureTables(doc);
  assert.strictEqual(await S.problem(doc), null);
});

test('GFS-04 colonnes indispensables absentes : signalées dans l\'ordre, et rien n\'est écrit', async () => {
  const doc = createFakeDoc({ [S.TABLE]: without('Config', 'Resultat') });
  assert.deepStrictEqual(await S.problem(doc), { code: 'missing-columns', columns: ['Config', 'Resultat'] });
  await rejects(S.saveGraph(doc, graph(), 'Contacts', ''), { code: 'missing-columns', columns: ['Config'] });
  await rejects(S.appendLog(doc, { table: 'Contacts', event: 'update', row: 1, result: 'success' }), { code: 'missing-columns', columns: ['Resultat'] });
  await rejects(S.writeLock(doc, 'Contacts', 'A', 1, null), { code: 'missing-columns', columns: ['Config'] });
  assert.deepStrictEqual(doc.tables.get(S.TABLE).rows, []);
});

test('GFS-05 une colonne facultative absente est laissée de côté, jamais écrite', async () => {
  const doc = createFakeDoc({ [S.TABLE]: without('Detail', 'Ligne', 'Actif', 'Resume') });
  await S.appendLog(doc, { table: 'Contacts', event: 'update', row: 7, result: 'success', detail: 'x' });
  await S.saveGraph(doc, graph(), 'Contacts', 'résumé');
  const [log, workflow] = doc.tables.get(S.TABLE).rows;
  assert.deepStrictEqual(Object.keys(log).sort(), ['Date', 'Evenement', 'Resultat', 'Table', 'Type', 'id']);
  assert.deepStrictEqual(Object.keys(workflow).sort(), ['Config', 'Table', 'Type', 'Version', 'id']);
});

test('GFS-06 une colonne supprimée pendant la session : l\'écriture échoue une fois, puis les colonnes sont relues', async () => {
  const doc = createFakeDoc();
  await S.ensureTables(doc);
  const entry = { table: 'Contacts', event: 'update', row: 1, result: 'success', detail: 'x' };
  await S.appendLog(doc, entry);
  const table = doc.tables.get(S.TABLE);
  table.columns = table.columns.filter((column) => column !== 'Detail');
  await assert.rejects(S.appendLog(doc, entry), /Invalid column "Detail"/);
  await S.appendLog(doc, entry);
  assert.strictEqual(table.rows.length, 2, 'la troisième écriture passe, sans la colonne disparue');
  assert.ok(!('Detail' in table.rows[1]));
});

test('GFS-07 les colonnes inconnues sont tolérées : lues sans erreur, jamais réécrites', async () => {
  const doc = createFakeDoc({ [S.TABLE]: [...ALL, 'Notes'] });
  doc.seedRow(S.TABLE, { Type: S.WORKFLOW, Table: 'Contacts', Config: JSON.stringify(graph()), Notes: 'à moi' });
  assert.strictEqual(await S.problem(doc), null);
  await S.saveGraph(doc, { ...graph(), active: true }, 'Contacts', 'résumé');
  const row = doc.tables.get(S.TABLE).rows[0];
  assert.strictEqual(row.Notes, 'à moi');
  assert.strictEqual(row.Actif, true);
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
