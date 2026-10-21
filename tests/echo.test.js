'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Echo = require('../js/echo.js');

const update = (rowId, changed) => ({ type: 'update', rowId, record: { id: rowId }, changed: Object.fromEntries(Object.entries(changed).map(([k, to]) => [k, { from: null, to }])) });
const write = (rowId, values) => ({ type: 'UpdateRecord', table: 'Contacts', rowId, values });

test('GRD-01 la modification venue de nos écritures ne redéclenche rien', () => {
  const echo = Echo.create();
  echo.expect([write(1, { Statut: 'Clos' })]);
  assert.deepStrictEqual(echo.filter([update(1, { Statut: 'Clos' })]), []);
});

test('GRD-02 une modification d\'une personne sur la même ligne reste détectée', () => {
  const echo = Echo.create();
  echo.expect([write(1, { Statut: 'Clos' })]);
  assert.strictEqual(echo.filter([update(1, { Statut: 'En cours' })]).length, 1, 'autre valeur : pas notre écho');
  assert.strictEqual(echo.filter([update(2, { Statut: 'Clos' })]).length, 1, 'autre ligne');
});

test('GRD-03 modification mixte : seules les colonnes qui ne viennent pas de nous sont gardées', () => {
  const echo = Echo.create();
  echo.expect([write(1, { Statut: 'Clos' })]);
  const [kept] = echo.filter([update(1, { Statut: 'Clos', Montant: 5 })]);
  assert.deepStrictEqual(Object.keys(kept.changed), ['Montant']);
});

test('GRD-04 l\'écho n\'est consommé qu\'une fois : une seconde modification identique est détectée', () => {
  const echo = Echo.create();
  echo.expect([write(1, { Statut: 'Clos' })]);
  assert.strictEqual(echo.filter([update(1, { Statut: 'Clos' })]).length, 0);
  assert.strictEqual(echo.filter([update(1, { Statut: 'Clos' })]).length, 1);
});

test('GRD-05 ligne ajoutée par le widget : création reconnue, une autre création est gardée', () => {
  const echo = Echo.create();
  echo.expect([{ type: 'AddRecord', table: 'Contacts', values: { Nom: 'auto' } }]);
  const created = (id, Nom) => ({ type: 'create', rowId: id, record: { id, Nom } });
  assert.strictEqual(echo.filter([created(9, 'Bob')]).length, 1);
  assert.strictEqual(echo.filter([created(10, 'auto')]).length, 0);
});

test('GRD-06 écriture annulée (erreur de Grist) : plus rien n\'est attendu', () => {
  const echo = Echo.create();
  const id = echo.expect([write(1, { Statut: 'Clos' })]);
  echo.cancel(id);
  assert.strictEqual(echo.filter([update(1, { Statut: 'Clos' })]).length, 1);
});

test('GRD-07 écho jamais revenu : oublié après le délai', () => {
  let now = 0;
  const echo = Echo.create(() => now);
  echo.expect([write(1, { Statut: 'Clos' })]);
  now = Echo.ECHO_TTL + 1;
  assert.strictEqual(echo.filter([update(1, { Statut: 'Clos' })]).length, 1);
});

test('GRD-08 valeur renvoyée par Grist sous une autre forme (texte/nombre) : reconnue', () => {
  const echo = Echo.create();
  echo.expect([write(1, { Montant: '5' })]);
  assert.strictEqual(echo.filter([update(1, { Montant: 5 })]).length, 0);
});

test('GRD-09 suppression : jamais filtrée', () => {
  const echo = Echo.create();
  assert.strictEqual(echo.filter([{ type: 'delete', rowId: 1 }]).length, 1);
});

test('GRD-10 filet de sécurité : au-delà de LOOP_MAX exécutions rapprochées sur une ligne, arrêt ; reprise après la fenêtre', () => {
  let now = 0;
  const echo = Echo.create(() => now);
  for (let i = 0; i < Echo.LOOP_MAX; i += 1) assert.strictEqual(echo.allowRun(1), true);
  assert.strictEqual(echo.allowRun(1), false);
  assert.strictEqual(echo.allowRun(2), true, 'une autre ligne n\'est pas touchée');
  now = Echo.LOOP_WINDOW + 1;
  assert.strictEqual(echo.allowRun(1), true);
});
