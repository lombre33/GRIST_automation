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

// Une page pour `fermer` et `rester` : ce qu'elle a en attente (state) et, dans l'ordre, ce que `fermer` et `rester` lui ont fait faire (log).
// over.flush(state, log) : ce que fait l'enregistrement ; over.release : la libération du verrou ; over.resume : la reprise (vrai par défaut) ; over.wait : le délai.
function page(over = {}) {
  const log = [];
  const state = { unsaved: false, busy: null, answers: [], ...over.state };
  const deps = {
    flush: async () => { log.push('flush'); if (over.flush) await over.flush(state, log); },
    unsaved: () => state.unsaved,
    busy: () => state.busy,
    ask: async () => { log.push('ask'); return state.answers.shift(); },
    release: async () => { log.push('release'); if (over.release) await over.release(); },
    resume: async () => { log.push('resume'); return over.resume ? over.resume() : true; },
    wait: over.wait || (() => new Promise(() => {})),
  };
  const { close, stay } = Closing.create(deps);
  return { state, log, close, stay };
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
  bare.install({ close: async () => 'oui' });
  assert.strictEqual(await bare.answer({ raison: 'app' }), false, 'ni « oui » ni autre chose que vrai ne ferme');
  bare.install({ close: async ({ raison }) => raison === 'lien' });
  assert.strictEqual(await bare.answer({ raison: 'lien' }), true);
  assert.strictEqual(await bare.answer({ raison: 'app' }), false);
  bare.install({ close: async () => { throw new Error('la table a disparu'); } });
  await assert.rejects(bare.answer({ raison: 'app' }), /la table a disparu/);
});

test('CLOSE-11 « tu restes » : l\'app reprend, et ne répond vrai que si elle a repris', async () => {
  const p = page();
  assert.strictEqual(await p.stay({ raison: 'explorateur' }), true);
  assert.deepStrictEqual(p.log, ['resume']);
  for (const value of [false, undefined, null, 'oui', 1]) {
    assert.strictEqual(await page({ resume: async () => value }).stay(), false, `rendre ${String(value)} n'est pas avoir repris`);
  }
});

test('CLOSE-12 « tu restes » pendant que la fermeture finit : la reprise attend la fin de la fermeture, qui rend le verrou, puis reprend', async () => {
  const writing = deferred();
  const p = page({ state: { unsaved: true }, flush: async (state) => { await writing.promise; state.unsaved = false; } });
  const closed = p.close();
  const stayed = p.stay();
  await turn();
  assert.deepStrictEqual(p.log, ['flush'], 'la reprise n\'a pas commencé : la fermeture écrit encore');
  writing.resolve();
  assert.strictEqual(await closed, true);
  assert.strictEqual(await stayed, true);
  assert.deepStrictEqual(p.log, ['flush', 'release', 'resume'], 'le verrou est rendu avant d\'être repris, jamais l\'inverse');
});

test('CLOSE-13 « tu restes » deux fois : à la fois, une seule reprise ; l\'une après l\'autre, deux, sans danger', async () => {
  const slow = deferred();
  const p = page({ resume: () => slow.promise });
  const first = p.stay();
  const second = p.stay();
  await turn();
  assert.deepStrictEqual(p.log, ['resume'], 'une seule reprise en route');
  slow.resolve(true);
  assert.deepStrictEqual([await first, await second], [true, true]);
  assert.strictEqual(await p.stay(), true);
  assert.deepStrictEqual(p.log, ['resume', 'resume'], 'une reprise finie ne se partage plus');
});

test('CLOSE-14 deux « fermer » à la fois : une seule fermeture, donc une seule question, et la même réponse', async () => {
  const p = page({ state: { unsaved: true, answers: ['cancel'] } });
  const [first, second] = await Promise.all([p.close({ raison: 'app' }), p.close({ raison: 'lien' })]);
  assert.deepStrictEqual([first, second], [false, false]);
  assert.deepStrictEqual(p.log, ['flush', 'ask'], 'une seule question');
  assert.strictEqual(await p.close(), false);
  assert.deepStrictEqual(p.log, ['flush', 'ask', 'flush', 'ask'], 'une fermeture finie ne se partage plus : la suivante repose sa question');
});

test('CLOSE-15 fermer, rester, fermer à la suite : chacun passe derrière le précédent, dans l\'ordre où GFS les envoie', async () => {
  const writing = deferred();
  const p = page({ state: { unsaved: true }, flush: async (state) => { await writing.promise; state.unsaved = false; } });
  const first = p.close();
  const stayed = p.stay();
  const second = p.close();   // ne se joint pas à la première : une reprise est venue entre les deux
  await turn();
  writing.resolve();
  assert.deepStrictEqual(await Promise.all([first, stayed, second]), [true, true, true]);
  assert.deepStrictEqual(p.log, ['flush', 'release', 'resume', 'flush', 'release']);
  const reverse = page();
  const resumed = reverse.stay();
  const closed = reverse.close();   // un « fermer » qui arrive pendant la reprise attend la reprise
  const resumedAgain = reverse.stay();
  assert.deepStrictEqual(await Promise.all([resumed, closed, resumedAgain]), [true, true, true]);
  assert.deepStrictEqual(reverse.log, ['resume', 'flush', 'release', 'resume']);
});

test('CLOSE-16 une reprise qui ne finit pas répond faux au bout du délai sans retenir la suite ; une reprise qui échoue part en erreur sans la bloquer non plus', async () => {
  const hanging = page({ resume: () => new Promise(() => {}), wait: () => Promise.resolve() });
  assert.strictEqual(await hanging.stay(), false);
  assert.strictEqual(await hanging.close(), true, 'la fermeture d\'après passe');
  const failing = page({ resume: async () => { throw new Error('élection refusée'); } });
  await assert.rejects(failing.stay(), /élection refusée/);
  assert.strictEqual(await failing.close(), true);
  await assert.rejects(failing.stay(), /élection refusée/, 'la reprise suivante retente');
});

test('CLOSE-17 la réponse à « rester » : seul « vrai » est repris, une erreur part chez GFS, et sans gestionnaire il n\'y a rien à reprendre', async () => {
  const fresh = () => { delete require.cache[require.resolve('../js/closing.js')]; return require('../js/closing.js'); };
  const bare = fresh();
  assert.strictEqual(await bare.answerStay({ raison: 'explorateur' }), false, 'la page n\'a rien installé : rien n\'a été arrêté');
  const seen = [];
  bare.install({ close: async () => true, stay: async (request) => { seen.push(request.raison); return true; } });
  assert.strictEqual(await bare.answerStay({ raison: 'explorateur' }), true);
  assert.deepStrictEqual(seen, ['explorateur']);
  bare.install({ close: async () => true, stay: async () => 'oui' });
  assert.strictEqual(await bare.answerStay({ raison: 'app' }), false);
  bare.install({ close: async () => true, stay: async () => { throw new Error('plus de table'); } });
  await assert.rejects(bare.answerStay({ raison: 'app' }), /plus de table/);
});

test('CLOSE-18 « tu restes » pendant que le verrou se rend encore (la réponse n\'a attendu que 3 s) : la reprise attend qu\'il soit rendu ; un verrou que Grist ne rend jamais ne la retient pas', async () => {
  const releasing = deferred();
  let waits = 0;
  const slow = page({ release: () => releasing.promise, wait: () => (waits++ === 0 ? Promise.resolve() : new Promise(() => {})) });
  assert.strictEqual(await slow.close(), true, 'la réponse vient au bout du délai, le verrou n\'est pas encore rendu');
  let resumed;
  const stayed = slow.stay().then((value) => { resumed = value; });
  await turn();
  assert.strictEqual(resumed, undefined);
  assert.deepStrictEqual(slow.log, ['flush', 'release'], 'pas de reprise tant que la fermeture rend le verrou');
  releasing.resolve();
  await stayed;
  assert.strictEqual(resumed, true);
  assert.deepStrictEqual(slow.log, ['flush', 'release', 'resume'], 'rendu, puis repris : jamais l\'inverse');
  const stuck = page({ release: () => new Promise(() => {}), wait: () => Promise.resolve() });
  assert.strictEqual(await stuck.close(), true);
  assert.strictEqual(await stuck.stay(), true, 'le verrou ne revient jamais : la reprise se fait quand même, après le délai');
  assert.deepStrictEqual(stuck.log, ['flush', 'release', 'resume']);
});
