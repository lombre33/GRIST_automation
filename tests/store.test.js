'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../js/store.js');
const G = require('../js/graph.js');
const I = require('../js/i18n.js');
const { createFakeDoc } = require('./fakes/fakeGrist.js');

const t = (key, params) => I.translate(key, params, 'fr');

function flow() {
  const g = G.create();
  const trigger = G.addNode(g, 'trigger', 0, 0);
  const cond = G.addNode(g, 'condition', 0, 0);
  const act = G.addNode(g, 'action', 0, 0);
  trigger.config.column = 'Statut';
  cond.config.checks[0].column = 'Statut';
  cond.config.checks[0].value = 'Clos';
  act.config.column = 'Motif';
  act.config.table = 'Archive';
  act.config.value = 'clos';
  G.connect(g, trigger.id, cond.id);
  G.connect(g, cond.id, act.id);
  return g;
}

test('STORE-01 table absente détectée, puis créée une seule fois (une seule table)', async () => {
  const doc = createFakeDoc({ Contacts: ['Nom'] });
  assert.deepStrictEqual(await S.missingTables(doc), [S.TABLE]);
  assert.strictEqual(await S.ensureTables(doc), true);
  assert.deepStrictEqual(await S.missingTables(doc), []);
  assert.strictEqual(await S.ensureTables(doc), false);
});

test('STORE-02 la table n\'est créée que seule, et rien d\'autre n\'est ajouté au document', async () => {
  const doc = createFakeDoc({ Contacts: ['Nom'] });
  await S.ensureTables(doc);
  assert.deepStrictEqual([...doc.tables.keys()], ['Contacts', S.TABLE]);
  const existing = createFakeDoc({ [S.TABLE]: ['Type', 'Config'] });
  assert.strictEqual(await S.ensureTables(existing), false);
  assert.deepStrictEqual(existing.tables.get(S.TABLE).columns, ['Type', 'Config']);
});

test('STORE-03 la colonne Auteur est une formule déclenchée user.Email', async () => {
  const doc = createFakeDoc();
  await S.ensureTables(doc);
  const column = doc.tables.get(S.TABLE).spec.find((c) => c.id === 'Auteur');
  assert.strictEqual(column.formula, 'user.Email');
  assert.strictEqual(column.isFormula, false);
});

test('STORE-04 si Grist refuse la formule d\'auteur, les tables sont créées sans', async () => {
  const doc = createFakeDoc({}, { rejectFormulaColumns: true });
  await S.ensureTables(doc);
  assert.deepStrictEqual(await S.missingTables(doc), []);
  assert.ok(doc.tables.get(S.TABLE).spec.every((c) => !c.formula));
});

test('STORE-05 enregistrer un graphe : une ligne par table de vue, mise à jour ensuite', async () => {
  const doc = createFakeDoc();
  await S.ensureTables(doc);
  const g = flow();
  await S.saveGraph(doc, g, 'Contacts', 'résumé');
  await S.saveGraph(doc, { ...g, active: true }, 'Contacts', 'résumé 2');
  await S.saveGraph(doc, g, 'Services', 'autre');
  const rows = doc.tables.get(S.TABLE).rows;
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].Type, S.WORKFLOW);
  assert.strictEqual(rows[0].Actif, true);
  assert.strictEqual(rows[0].Resume, 'résumé 2');
});

test('STORE-06 relire le graphe de la bonne table, aller-retour sans perte', async () => {
  const doc = createFakeDoc();
  await S.ensureTables(doc);
  const g = flow();
  g.active = true;
  await S.saveGraph(doc, g, 'Contacts', '');
  assert.deepStrictEqual(await S.loadGraph(doc, 'Contacts'), g);
  assert.strictEqual(await S.loadGraph(doc, 'Services'), null);
});

test('STORE-07 configuration illisible dans la table : ignorée sans erreur', async () => {
  const doc = createFakeDoc();
  await S.ensureTables(doc);
  await doc.applyUserActions([['AddRecord', S.TABLE, null, { Type: S.WORKFLOW, Table: 'Contacts', Config: '{pas du json' }]]);
  assert.strictEqual(await S.loadGraph(doc, 'Contacts'), null);
});

test('STORE-08 journal : une ligne par exécution, les dernières entrées de la table', async () => {
  const doc = createFakeDoc();
  await S.ensureTables(doc);
  for (let i = 1; i <= 5; i += 1) {
    await S.appendLog(doc, { date: i * 1000, table: i === 4 ? 'Services' : 'Contacts', event: 'update', row: i, result: 'success', detail: 'd' + i });
  }
  const last = await S.recentLogs(doc, 'Contacts', 3);
  assert.deepStrictEqual(last.map((r) => r.Ligne), [2, 3, 5]);
  assert.strictEqual(last[0].Date, 2);
  assert.ok(last.every((r) => r.Type === S.LOG));
});

test('STORE-11 workflows et journal cohabitent : chacun ne lit que ses lignes', async () => {
  const doc = createFakeDoc();
  await S.ensureTables(doc);
  const g = flow();
  await S.appendLog(doc, { date: 1000, table: 'Contacts', event: 'update', row: 1, result: 'success' });
  await S.saveGraph(doc, g, 'Contacts', 'r');
  await S.appendLog(doc, { date: 2000, table: 'Contacts', event: 'update', row: 2, result: 'error', detail: 'x' });
  assert.deepStrictEqual(await S.loadGraph(doc, 'Contacts'), g);
  assert.strictEqual((await S.recentLogs(doc, 'Contacts', 10)).length, 2);
  assert.strictEqual(doc.tables.get(S.TABLE).rows.length, 3);
});

test('STORE-09 les tables du widget sont reconnues pour être masquées', () => {
  assert.ok(S.isOwnTable('Automation'));
  assert.ok(S.isOwnTable('Automation_Logs'), 'les anciennes tables de la 0.6.0 restent masquées');
  assert.ok(!S.isOwnTable('Automations_clients'));
  assert.ok(!S.isOwnTable('Contacts'));
});

test('STORE-10 résumé lisible : un chemin par ligne, dans la langue de l\'interface', () => {
  const g = flow();
  const extra = G.addNode(g, 'action', 0, 0);
  extra.config.column = 'Source';
  extra.config.value = 'auto';
  G.connect(g, 'trigger-1', extra.id);
  const lines = G.summarize(g, t).split('\n');
  assert.strictEqual(lines.length, 2);
  assert.match(lines[0], /Déclencheur : modifiée \(Statut\) → Condition : Statut est égal à Clos → Action : Ajouter une ligne|Mettre à jour la ligne/);
  assert.match(G.summarize(g, (k, p) => I.translate(k, p, 'en')), /Trigger : modified \(Statut\)/);
});
