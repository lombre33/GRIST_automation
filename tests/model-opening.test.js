'use strict';
// OPEN : l'ouverture d'un modèle de départ demandée par GFS (consigne 021 ; contrats de GFS 5.4, point 13), js/model-opening.js : un modèle non enregistré, une question avant de remplacer un workflow,
// et `false` (le kit répond `{ ouvert: false }`) pour tout le reste, jamais un éditeur vide à la place.
const test = require('node:test');
const assert = require('node:assert');
const ModelOpening = require('../js/model-opening.js');
const Models = require('../js/models.js');

const opening = (id, extra = {}) => ({ fichier: null, type: 'automatisme', dossier: '', raison: 'modele', modele: { id }, ...extra });

// Les choses de la page, avec ce qu'elles ont reçu : `calls` dans l'ordre. status : ce que l'éditeur montre ; answer : la réponse de la personne à la question.
function page({ status = {}, answer = true } = {}) {
  const calls = [];
  const state = { readOnly: false, locked: false, hasWork: false, active: false, ...status };
  const deps = {
    ready: async () => { calls.push('ready'); },
    status: () => { calls.push('status'); return { ...state }; },
    ask: async (model, active) => { calls.push(['ask', model.id, active]); return typeof answer === 'function' ? answer() : answer; },
    show: (model) => { calls.push(['show', model.id]); },
    say: (reason) => { calls.push(['say', reason]); },
  };
  return { calls, state, deps, opener: ModelOpening.create(deps) };
}
const names = (calls) => calls.map((call) => (Array.isArray(call) ? call[0] : call));

test('OPEN-01 ce que l\'ouverture demande : rien pour ce qui n\'est pas un modèle de départ, le modèle du catalogue, ou un modèle inconnu (autre identifiant, autre type)', () => {
  assert.strictEqual(ModelOpening.TYPE, 'automatisme', 'le type que GFS donne aux entrées de l\'app (modeles.type du manifeste)');
  for (const other of [null, undefined, 'modele', 12, {}, { raison: 'nouveau', type: 'automatisme' }, { raison: 'importer', modele: { id: 'total-calcule' } }, { fichier: { id: '3', type: 'automatisme' }, raison: 'ouvrir' }]) {
    assert.strictEqual(ModelOpening.read(other), null, JSON.stringify(other));
  }
  assert.strictEqual(ModelOpening.read(opening('total-calcule')).model, Models.find('total-calcule'));
  for (const unknown of [opening('inconnu'), opening(''), opening(7), { ...opening('total-calcule'), type: 'document' }, { ...opening('total-calcule'), type: '' }, { raison: 'modele', type: 'automatisme' }, { raison: 'modele', type: 'automatisme', modele: null }]) {
    assert.strictEqual(ModelOpening.read(unknown).model, null, JSON.stringify(unknown));
  }
});

test('OPEN-02 une ouverture qui n\'est pas un modèle de départ : faux, et rien n\'est lu, demandé, dit ni ouvert', async () => {
  const { calls, opener } = page();
  for (const other of [null, { raison: 'nouveau', type: 'automatisme', fichier: null }, { raison: 'importer', type: 'automatisme', importation: {} }]) assert.strictEqual(await opener.open(other), false);
  assert.deepStrictEqual(calls, []);
});

test('OPEN-03 un identifiant inconnu, un autre type, un modèle sans identifiant : la personne en est avertie et rien n\'est ouvert, jamais un éditeur vide à la place', async () => {
  for (const unknown of [opening('inconnu'), { ...opening('total-calcule'), type: 'document' }, { raison: 'modele', type: 'automatisme' }, opening(null)]) {
    const { calls, opener } = page({ status: { hasWork: true } });
    assert.strictEqual(await opener.open(unknown), false, JSON.stringify(unknown));
    assert.deepStrictEqual(calls, ['ready', ['say', 'unknown']], 'le démarrage d\'abord, puis la raison ; ni question ni ouverture');
  }
});

test('OPEN-04 rien dans l\'éditeur à remplacer : le modèle s\'ouvre tout de suite, sans question', async () => {
  for (const id of Models.MODELS.map((model) => model.id)) {
    const { calls, opener } = page();
    assert.strictEqual(await opener.open(opening(id)), true, id);
    assert.deepStrictEqual(calls, ['ready', 'status', ['show', id]], id);
  }
});

test('OPEN-05 la table porte déjà un workflow : l\'app demande, et le dit actif ou non ; oui ouvre le modèle, non n\'ouvre rien ni n\'écrit rien', async () => {
  for (const active of [false, true]) {
    const yes = page({ status: { hasWork: true, active }, answer: true });
    assert.strictEqual(await yes.opener.open(opening('seuil-a-verifier')), true);
    assert.deepStrictEqual(yes.calls, ['ready', 'status', ['ask', 'seuil-a-verifier', active], ['show', 'seuil-a-verifier']]);
    for (const refusal of [false, () => undefined, null, 0, 'oui']) {   // seul `true` remplace : Annuler et Échap rendent faux, et une réponse qui n'en est pas une vaut non
      const no = page({ status: { hasWork: true, active }, answer: refusal });
      assert.strictEqual(await no.opener.open(opening('seuil-a-verifier')), false, `réponse ${String(refusal)}`);
      assert.deepStrictEqual(no.calls, ['ready', 'status', ['ask', 'seuil-a-verifier', active]], 'refus : rien n\'est ouvert, rien n\'est dit à la place de la personne');
    }
  }
});

test('OPEN-06 un workflow que cette version ne lit pas, ou un document en lecture seule : la raison est dite, rien n\'est demandé ni ouvert (l\'illisible passe avant la lecture seule)', async () => {
  const cases = [[{ locked: true }, 'locked'], [{ readOnly: true }, 'readOnly'], [{ locked: true, readOnly: true }, 'locked'], [{ locked: true, hasWork: true, active: true }, 'locked']];
  for (const [status, reason] of cases) {
    const { calls, opener } = page({ status });
    assert.strictEqual(await opener.open(opening('total-calcule')), false, reason);
    assert.deepStrictEqual(calls, ['ready', 'status', ['say', reason]]);
  }
});

test('OPEN-07 l\'éditeur n\'est regardé qu\'une fois le démarrage fini : ce que le document porte se sait alors', async () => {
  const { calls, state, deps } = page();
  let finish;
  const started = new Promise((resolve) => { finish = resolve; });
  const opener = ModelOpening.create({ ...deps, ready: async () => { calls.push('ready'); await started; calls.push('started'); } });
  const pending = opener.open(opening('total-calcule'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepStrictEqual(calls, ['ready'], 'tant que le démarrage dure, rien n\'est regardé ni demandé');
  state.hasWork = true;   // le workflow du document vient d'être lu
  finish();
  assert.strictEqual(await pending, true);
  assert.deepStrictEqual(names(calls), ['ready', 'started', 'status', 'ask', 'show']);
});

test('OPEN-08 deux ouvertures qui se suivent passent l\'une après l\'autre : une seule question à la fois, et la seconde voit ce que la première a ouvert', async () => {
  let release;
  const { calls, state, deps } = page({ status: { hasWork: true }, answer: () => new Promise((resolve) => { release = resolve; }) });
  const opener = ModelOpening.create({ ...deps, show: (model) => { calls.push(['show', model.id]); state.hasWork = false; } });   // un modèle intact n'est pas du travail à remplacer
  const first = opener.open(opening('total-calcule'));
  const second = opener.open(opening('seuil-a-verifier'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepStrictEqual(calls.filter((call) => Array.isArray(call)), [['ask', 'total-calcule', false]], 'la seconde attend la réponse à la première');
  release(true);
  assert.deepStrictEqual(await Promise.all([first, second]), [true, true]);
  assert.deepStrictEqual(calls.filter((call) => Array.isArray(call)), [['ask', 'total-calcule', false], ['show', 'total-calcule'], ['show', 'seuil-a-verifier']]);
});

test('OPEN-09 une erreur de la page ne bloque pas l\'ouverture suivante ; sans la page installée, tout est faux', async () => {
  let fail = true;
  const { calls, deps } = page();
  const opener = ModelOpening.create({ ...deps, show: (model) => { if (fail) throw new Error('boum'); calls.push(['show', model.id]); } });
  await assert.rejects(opener.open(opening('total-calcule')), /boum/);
  fail = false;
  assert.strictEqual(await opener.open(opening('total-calcule')), true, 'la file continue après l\'échec');
  assert.strictEqual(await ModelOpening.answer(opening('total-calcule')), false, 'sans installation (la page n\'a pas démarré sa couche Grist) : { ouvert: false }');
  ModelOpening.install({ open: async () => true });
  assert.strictEqual(await ModelOpening.answer(opening('total-calcule')), true);
  ModelOpening.install({ open: async () => 'oui' });
  assert.strictEqual(await ModelOpening.answer(opening('total-calcule')), false, 'seul `true` ouvre : le kit n\'accepte que vrai');
  ModelOpening.install(null);
});
