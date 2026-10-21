'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Executor = require('../js/executor.js');
const Store = require('../js/store.js');
const { createFakeDoc } = require('./fakes/fakeGrist.js');

async function setup() {
  const doc = createFakeDoc();
  await Store.ensureTables(doc);
  return doc;
}
const instance = (doc, owner, clock, extra) => Executor.create(doc, 'Contacts', owner, Object.assign({ now: () => clock.t, settle: 0, sleep: async () => {} }, extra));

test('MUL-01 deux onglets : un seul exécute, l\'autre sait qui', async () => {
  const doc = await setup();
  const clock = { t: 1000000 };
  const a = instance(doc, 'A', clock);
  const b = instance(doc, 'B', clock);
  assert.strictEqual(await a.tick(), true);
  assert.strictEqual(await b.tick(), false);
  assert.strictEqual(b.holder(), 'A');
  assert.strictEqual(a.isExecutor(), true);
});

test('MUL-02 l\'exécutant disparaît : l\'autre prend le relais après le délai, pas avant', async () => {
  const doc = await setup();
  const clock = { t: 1000000 };
  const a = instance(doc, 'A', clock);
  const b = instance(doc, 'B', clock);
  await a.tick();
  await b.tick();
  clock.t += 19000;
  assert.strictEqual(await b.tick(), false, 'verrou encore frais');
  clock.t += 2000;
  assert.strictEqual(await b.tick(), true);
  assert.strictEqual(b.holder(), 'B');
});

test('MUL-03 l\'exécutant renouvelle son verrou : l\'autre ne le prend jamais', async () => {
  const doc = await setup();
  const clock = { t: 1000000 };
  const a = instance(doc, 'A', clock);
  const b = instance(doc, 'B', clock);
  await a.tick();
  for (let i = 0; i < 10; i += 1) {
    clock.t += 6000;
    await a.tick();
    assert.strictEqual(await b.tick(), false);
  }
});

test('MUL-04 verrou libéré à la fermeture : reprise immédiate, sans attendre le délai', async () => {
  const doc = await setup();
  const clock = { t: 1000000 };
  const a = instance(doc, 'A', clock);
  const b = instance(doc, 'B', clock);
  await a.tick();
  await b.tick();
  await a.release();
  assert.strictEqual(a.isExecutor(), false);
  assert.strictEqual(await b.tick(), true);
});

test('MUL-05 prises simultanées : exactement un exécutant', async () => {
  const doc = await setup();
  const clock = { t: 1000000 };
  const ticks = await Promise.all(['A', 'B', 'C'].map((owner) => instance(doc, owner, clock).tick()));
  assert.strictEqual(ticks.filter(Boolean).length, 1);
});

test('MUL-06 décalage d\'horloge entre navigateurs : sans effet (on compare des dates vues par soi-même)', async () => {
  const doc = await setup();
  const clockA = { t: 1000000 };
  const clockB = { t: 1000000 + 3600 * 1000 };
  const a = instance(doc, 'A', clockA);
  const b = instance(doc, 'B', clockB);
  await a.tick();
  assert.strictEqual(await b.tick(), false);
  for (let i = 0; i < 5; i += 1) {
    clockA.t += 6000;
    clockB.t += 6000;
    await a.tick();
    assert.strictEqual(await b.tick(), false);
  }
});

test('MUL-07 un verrou par table de vue : deux tables ne se gênent pas', async () => {
  const doc = await setup();
  const clock = { t: 1000000 };
  const onContacts = instance(doc, 'A', clock);
  const onServices = Executor.create(doc, 'Services', 'B', { now: () => clock.t, settle: 0, sleep: async () => {} });
  assert.strictEqual(await onContacts.tick(), true);
  assert.strictEqual(await onServices.tick(), true);
});

test('MUL-08 le rappel de changement n\'est appelé que lorsque l\'état change', async () => {
  const doc = await setup();
  const clock = { t: 1000000 };
  const seen = [];
  const a = instance(doc, 'A', clock, { onChange: (executor) => seen.push(executor) });
  await a.tick();
  clock.t += 6000;
  await a.tick();
  await a.release();
  assert.deepStrictEqual(seen, [true, false]);
});

test('MUL-09 le verrou n\'est pas pris pour un workflow ou un journal : chaque type de ligne reste lu à part', async () => {
  const doc = await setup();
  const clock = { t: 1000000 };
  await Store.appendLog(doc, { table: 'Contacts', event: 'update', row: 1, result: 'success' });
  await instance(doc, 'A', clock).tick();
  assert.strictEqual(await Store.loadGraph(doc, 'Contacts'), null);
  assert.strictEqual((await Store.logsPage(doc, 'Contacts', 10)).rows.length, 1);
});
