'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/engine.js');
const { createFakeApi } = require('./fakes/fakeGrist.js');

const rows = (...r) => r;

test('DIFF-01 premier chargement : aucun événement', () => {
  const { events, next } = E.diff(null, rows({ id: 1, A: 1 }));
  assert.deepStrictEqual(events, []);
  assert.strictEqual(next.size, 1);
});

test('DIFF-02 ligne ajoutée : create', () => {
  const prev = E.diff(null, rows({ id: 1, A: 1 })).next;
  const { events } = E.diff(prev, rows({ id: 1, A: 1 }, { id: 2, A: 5 }));
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'create');
  assert.strictEqual(events[0].rowId, 2);
});

test('DIFF-03 valeur modifiée : update avec anciennes et nouvelles valeurs', () => {
  const prev = E.diff(null, rows({ id: 1, A: 1 })).next;
  const { events } = E.diff(prev, rows({ id: 1, A: 2 }));
  assert.strictEqual(events[0].type, 'update');
  assert.deepStrictEqual(events[0].changed, { A: { from: 1, to: 2 } });
});

test('DIFF-04 ligne disparue : delete avec rowId seul', () => {
  const prev = E.diff(null, rows({ id: 1, A: 1 }, { id: 2, A: 2 })).next;
  const { events } = E.diff(prev, rows({ id: 1, A: 1 }));
  assert.deepStrictEqual(events, [{ type: 'delete', rowId: 2 }]);
});

test('DIFF-06 lot identique : aucun événement', () => {
  const prev = E.diff(null, rows({ id: 1, A: [1, 2] })).next;
  assert.deepStrictEqual(E.diff(prev, rows({ id: 1, A: [1, 2] })).events, []);
});

test('DIFF-09 égalité sur types variés', () => {
  const prev = E.diff(null, rows({ id: 1, A: null, B: false, C: '' })).next;
  const { events } = E.diff(prev, rows({ id: 1, A: null, B: false, C: '' }));
  assert.strictEqual(events.length, 0);
});

const wf = (over) => Object.assign({
  name: 'wf', active: true,
  trigger: { action: 'update', column: 'Statut' },
  condition: { column: 'Statut', operator: 'eq', value: 'Clos' },
  actions: [{ type: 'AddRecord', table: 'Archive', values: { Motif: 'clos' } }],
}, over);

const updateEvent = (statut) => ({
  type: 'update', rowId: 7, record: { id: 7, Statut: statut },
  changed: { Statut: { from: 'Nouveau', to: statut } },
});

test('TRG-01 le type d\'événement filtre', () => {
  assert.strictEqual(E.matchesTrigger({ action: 'create' }, updateEvent('Clos')), false);
  assert.strictEqual(E.matchesTrigger({ action: 'update' }, updateEvent('Clos')), true);
});

test('TRG-06 workflow inactif : jamais exécuté', async () => {
  const api = createFakeApi();
  const r = await E.runWorkflow(wf({ active: false }), updateEvent('Clos'), api);
  assert.strictEqual(r.status, 'skipped');
  assert.strictEqual(api.applied.length, 0);
});

test('TRG-07 update sur une autre colonne que celle du trigger : ignoré', async () => {
  const api = createFakeApi();
  const ev = { type: 'update', rowId: 7, record: { id: 7, Statut: 'Clos' }, changed: { Nom: { from: 'a', to: 'b' } } };
  const r = await E.runWorkflow(wf(), ev, api);
  assert.strictEqual(r.status, 'skipped');
});

test('COND-01 opérateurs', () => {
  const ev = { record: { N: 5, T: 'abc', V: '' } };
  const c = (column, operator, value) => E.evalCondition({ column, operator, value }, ev);
  assert.ok(c('N', 'gt', 3));
  assert.ok(!c('N', 'lt', 3));
  assert.ok(c('T', 'contains', 'b'));
  assert.ok(c('V', 'empty'));
  assert.ok(c('T', 'notEmpty'));
  assert.ok(c('N', 'neq', 4));
});

test('COND-05 types incompatibles : faux, pas de coercition', () => {
  const ev = { record: { N: '5' } };
  assert.strictEqual(E.evalCondition({ column: 'N', operator: 'gt', value: 3 }, ev), false);
});

test('COND-04 opérateur inconnu : erreur explicite', async () => {
  const api = createFakeApi();
  const r = await E.runWorkflow(wf({ condition: { column: 'Statut', operator: 'nope', value: 1 } }), updateEvent('Clos'), api);
  assert.strictEqual(r.status, 'error');
  assert.match(r.error, /Opérateur inconnu/);
  assert.strictEqual(api.applied.length, 0);
});

test('ACT-01 condition vraie : AddRecord appliqué', async () => {
  const api = createFakeApi();
  const r = await E.runWorkflow(wf(), updateEvent('Clos'), api);
  assert.strictEqual(r.status, 'success');
  assert.deepStrictEqual(api.applied, [['AddRecord', 'Archive', null, { Motif: 'clos' }]]);
});

test('ACT-02 UpdateRecord cible la ligne de l\'événement', async () => {
  const api = createFakeApi();
  const w = wf({ actions: [{ type: 'UpdateRecord', table: 'Contacts', values: { Statut: 'Vu' } }] });
  await E.runWorkflow(w, updateEvent('Clos'), api);
  assert.deepStrictEqual(api.applied, [['UpdateRecord', 'Contacts', 7, { Statut: 'Vu' }]]);
});

test('COND-02 condition fausse : aucune écriture', async () => {
  const api = createFakeApi();
  const r = await E.runWorkflow(wf(), updateEvent('En cours'), api);
  assert.strictEqual(r.status, 'condition-false');
  assert.strictEqual(api.applied.length, 0);
});

test('ACT-06 refus de l\'API : erreur journalisée', async () => {
  const api = createFakeApi({ failWith: 'Droits insuffisants' });
  const r = await E.runWorkflow(wf(), updateEvent('Clos'), api);
  assert.strictEqual(r.status, 'error');
  assert.strictEqual(r.error, 'Droits insuffisants');
});

test('ACT-08 action inconnue : erreur', async () => {
  const api = createFakeApi();
  const r = await E.runWorkflow(wf({ actions: [{ type: 'Boom' }] }), updateEvent('Clos'), api);
  assert.strictEqual(r.status, 'error');
});

test('DRY-01/02 dry-run : effets listés, aucune écriture, même si inactif', async () => {
  const api = createFakeApi();
  const r = await E.runWorkflow(wf({ active: false }), updateEvent('Clos'), api, { dryRun: true });
  assert.strictEqual(r.status, 'success');
  assert.strictEqual(r.dryRun, true);
  assert.strictEqual(r.effects.length, 1);
  assert.strictEqual(api.applied.length, 0);
});

test('SEC-02 le moteur n\'utilise ni eval ni Function ni réseau', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/engine.js'), 'utf8');
  assert.doesNotMatch(src, /\beval\s*\(|new\s+Function|\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
});
