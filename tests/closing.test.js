'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Closing = require('../js/closing.js');

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const turn = () => new Promise((resolve) => setImmediate(resolve));

// Une page pour `fermer` : ce qu'elle a en attente (state) et, dans l'ordre, ce que `fermer` lui a fait faire (log).
// over.flush(state, log) : ce que fait l'enregistrement ; over.release : la libération du verrou ; over.wait : le délai.
function page(over = {}) {
  const log = [];
  const state = { unsaved: false, busy: null, answers: [], ...over.state };
  const deps = {
    flush: async () => { log.push('flush'); if (over.flush) await over.flush(state, log); },
    unsaved: () => state.unsaved,
    busy: () => state.busy,
    ask: async () => { log.push('ask'); return state.answers.shift(); },
    release: async () => { log.push('release'); if (over.release) await over.release(); },
    wait: over.wait || (() => new Promise(() => {})),
  };
  return { state, log, close: Closing.create(deps) };
}

test('CLOSE-01 rien n\'attend : vrai tout de suite, sans question, et le verrou est libéré', async () => {
  const p = page();
  assert.strictEqual(await p.close({ raison: 'app' }), true);
  assert.deepStrictEqual(p.log, ['flush', 'release']);
});

test('CLOSE-02 une écriture attend : elle est faite, et la réponse ne vient pas avant sa fin, sans question', async () => {
  const writing = deferred();
  const p = page({ state: { unsaved: true }, flush: async (state) => { await writing.promise; state.unsaved = false; } });
  let answer;
  const asked = p.close().then((value) => { answer = value; });
  await turn();
  assert.strictEqual(answer, undefined, 'tant que l\'écriture n\'est pas finie, pas de réponse');
  assert.deepStrictEqual(p.log, ['flush']);
  writing.resolve();
  await asked;
  assert.strictEqual(answer, true);
  assert.deepStrictEqual(p.log, ['flush', 'release'], 'enregistré avant de libérer le verrou, et aucune question');
});

test('CLOSE-03 une exécution ou une écriture en cours est attendue avant de répondre', async () => {
  const running = deferred();
  const p = page({ state: { busy: null } });
  p.state.busy = running.promise.then(() => { p.state.busy = null; });
  let answer;
  const asked = p.close().then((value) => { answer = value; });
  await turn();
  assert.strictEqual(answer, undefined);
  running.resolve();
  await asked;
  assert.strictEqual(answer, true);
  assert.deepStrictEqual(p.log, ['flush', 'flush', 'release'], 'rien de nouveau à enregistrer une fois l\'exécution finie : on le vérifie');
});

test('CLOSE-04 l\'écriture échoue : la question, et Annuler (ou Échap) garde l\'app, verrou intact', async () => {
  const p = page({ state: { unsaved: true, answers: ['cancel'] } });
  assert.strictEqual(await p.close(), false);
  assert.deepStrictEqual(p.log, ['flush', 'ask']);
  const escaped = page({ state: { unsaved: true, answers: [undefined] } });
  assert.strictEqual(await escaped.close(), false, 'une réponse inattendue ne ferme jamais');
});

test('CLOSE-05 Abandonner : l\'app part sans réécrire, le verrou est libéré', async () => {
  const p = page({ state: { unsaved: true, answers: ['discard'] } });
  assert.strictEqual(await p.close(), true);
  assert.deepStrictEqual(p.log, ['flush', 'ask', 'release']);
});

test('CLOSE-06 Enregistrer : l\'écriture est refaite, l\'app part quand elle réussit, la question revient si elle échoue encore', async () => {
  let attempts = 0;
  const p = page({ state: { unsaved: true, answers: ['save', 'save'] }, flush: async (state) => { attempts += 1; if (attempts === 3) state.unsaved = false; } });
  assert.strictEqual(await p.close(), true);
  assert.deepStrictEqual(p.log, ['flush', 'ask', 'flush', 'ask', 'flush', 'release']);
  const again = page({ state: { unsaved: true, answers: ['save', 'cancel'] } });
  assert.strictEqual(await again.close(), false, 'après un second échec, Annuler garde l\'app');
});

test('CLOSE-07 le verrou ne retient pas l\'app : sa libération échoue ou traîne, la réponse vient quand même', async () => {
  const failing = page({ release: async () => { throw new Error('écriture refusée'); } });
  assert.strictEqual(await failing.close(), true);
  const hanging = page({ release: () => new Promise(() => {}), wait: () => Promise.resolve() });
  assert.strictEqual(await hanging.close(), true);
});

test('CLOSE-08 des écritures qui ne s\'arrêtent jamais n\'attendent pas sans fin : après dix tours, la réponse vient', async () => {
  let flushes = 0;
  const p = page({ flush: async () => { flushes += 1; } });
  p.state.busy = Promise.resolve();
  assert.strictEqual(await p.close(), true);
  assert.strictEqual(flushes, 10);
});

test('CLOSE-09 le suivi des promesses en cours : rien quand tout est fini, une attente tant que l\'une dure, un échec compte comme fini', async () => {
  const tracker = Closing.tracker();
  assert.strictEqual(tracker.idle(), null);
  const slow = deferred();
  assert.strictEqual(tracker.track(slow.promise), slow.promise, 'la promesse suivie est rendue telle quelle');
  const failing = tracker.wrap(async () => { throw new Error('refusé'); });
  await assert.rejects(failing(), /refusé/, 'l\'échec arrive à l\'appelant comme avant');
  let finished = false;
  tracker.idle().then(() => { finished = true; });
  await turn();
  assert.strictEqual(finished, false);
  slow.resolve();
  await turn();
  assert.strictEqual(finished, true);
  assert.strictEqual(tracker.idle(), null);
});

test('CLOSE-10 la réponse à GFS : seul « vrai » ferme, une erreur part chez GFS, et sans gestionnaire l\'app peut partir', async () => {
  const fresh = () => { delete require.cache[require.resolve('../js/closing.js')]; return require('../js/closing.js'); };
  const bare = fresh();
  assert.strictEqual(await bare.answer({ raison: 'app' }), true, 'la page n\'a rien installé : rien n\'attend');
  bare.install(async () => 'oui');
  assert.strictEqual(await bare.answer({ raison: 'app' }), false, 'ni « oui » ni autre chose que vrai ne ferme');
  bare.install(async ({ raison }) => raison === 'lien');
  assert.strictEqual(await bare.answer({ raison: 'lien' }), true);
  assert.strictEqual(await bare.answer({ raison: 'app' }), false);
  bare.install(async () => { throw new Error('la table a disparu'); });
  await assert.rejects(bare.answer({ raison: 'app' }), /la table a disparu/);
});
