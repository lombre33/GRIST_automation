'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../js/engine.js');
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

// Graphe de test : déclencheur -> condition -> action (chaque morceau peut être remplacé).
function chain(over) {
  const o = Object.assign({ active: true, trigger: { action: 'update', column: 'Statut' }, condition: { column: 'Statut', operator: 'eq', value: 'Clos' },
    actions: [{ type: 'AddRecord', table: 'Archive', column: 'Motif', value: 'clos' }] }, over);
  const nodes = [{ id: 't', type: 'trigger', config: o.trigger }];
  const edges = [];
  let last = 't';
  if (o.condition) {
    nodes.push({ id: 'c', type: 'condition', config: o.condition.checks ? o.condition : { join: 'and', checks: [o.condition] } });
    edges.push({ from: last, to: 'c' });
    last = 'c';
  }
  o.actions.forEach((config, i) => {
    nodes.push({ id: 'a' + i, type: 'action', config });
    edges.push({ from: last, to: 'a' + i });
  });
  return { version: 3, active: o.active, nodes, edges };
}
const opts = { currentTable: 'Contacts' };

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
  const r = await E.runWorkflow(chain({ active: false }), updateEvent('Clos'), api, opts);
  assert.strictEqual(r.status, 'skipped');
  assert.strictEqual(api.applied.length, 0);
});

test('TRG-07 update sur une autre colonne que celle du trigger : ignoré', async () => {
  const api = createFakeApi();
  const ev = { type: 'update', rowId: 7, record: { id: 7, Statut: 'Clos' }, changed: { Nom: { from: 'a', to: 'b' } } };
  const r = await E.runWorkflow(chain(), ev, api, opts);
  assert.strictEqual(r.status, 'skipped');
});

test('COND-01 opérateurs', () => {
  const ev = { record: { N: 5, T: 'abc', V: '' } };
  const c = (column, operator, value) => E.evalCondition({ column, operator, value }, ev);
  assert.ok(c('N', 'gt', 3));
  assert.ok(!c('N', 'lt', 3));
  assert.ok(c('N', 'gt', '3'), 'la valeur saisie en texte est lue comme un nombre');
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
  const r = await E.runWorkflow(chain({ condition: { column: 'Statut', operator: 'nope', value: 1 } }), updateEvent('Clos'), api, opts);
  assert.strictEqual(r.status, 'error');
  assert.match(r.error, /Opérateur inconnu/);
  assert.strictEqual(api.applied.length, 0);
});

test('COND-07 condition sans colonne : erreur explicite', async () => {
  const r = await E.runWorkflow(chain({ condition: { column: '', operator: 'eq', value: '' } }), updateEvent('Clos'), createFakeApi(), opts);
  assert.strictEqual(r.status, 'error');
  assert.match(r.error, /incomplète/);
});

test('ACT-01 condition vraie : AddRecord appliqué', async () => {
  const api = createFakeApi();
  const r = await E.runWorkflow(chain(), updateEvent('Clos'), api, opts);
  assert.strictEqual(r.status, 'success');
  assert.deepStrictEqual(api.applied, [['AddRecord', 'Archive', null, { Motif: 'clos' }]]);
});

test('ACT-02 UpdateRecord cible la ligne de l\'événement, table courante par défaut', async () => {
  const api = createFakeApi();
  const w = chain({ actions: [{ type: 'UpdateRecord', table: '', column: 'Statut', value: 'Vu' }] });
  await E.runWorkflow(w, updateEvent('Clos'), api, opts);
  assert.deepStrictEqual(api.applied, [['UpdateRecord', 'Contacts', 7, { Statut: 'Vu' }]]);
});

test('ACT-05 plusieurs actions : toutes appliquées dans l\'ordre, en un seul lot', async () => {
  const api = createFakeApi();
  const w = chain({ actions: [{ type: 'AddRecord', table: 'Archive', column: 'Motif', value: 'a' }, { type: 'AddRecord', table: 'Archive', column: 'Motif', value: 'b' }] });
  await E.runWorkflow(w, updateEvent('Clos'), api, opts);
  assert.deepStrictEqual(api.applied.map((a) => a[3].Motif), ['a', 'b']);
});

test('COND-02 condition fausse : aucune écriture', async () => {
  const api = createFakeApi();
  const r = await E.runWorkflow(chain(), updateEvent('En cours'), api, opts);
  assert.strictEqual(r.status, 'condition-false');
  assert.strictEqual(api.applied.length, 0);
});

test('COND-08 conditions en série : toutes doivent être vraies (ET)', async () => {
  const g = chain();
  g.nodes.push({ id: 'c2', type: 'condition', config: { join: 'and', checks: [{ column: 'Montant', operator: 'gt', value: '100' }] } });
  g.edges = [{ from: 't', to: 'c' }, { from: 'c', to: 'c2' }, { from: 'c2', to: 'a0' }];
  const api = createFakeApi();
  const small = await E.runWorkflow(g, { ...updateEvent('Clos'), record: { id: 7, Statut: 'Clos', Montant: 50 } }, api, opts);
  assert.strictEqual(small.status, 'condition-false');
  assert.strictEqual(small.trace.c2, 'blocked');
  const big = await E.runWorkflow(g, { ...updateEvent('Clos'), record: { id: 7, Statut: 'Clos', Montant: 500 } }, api, opts);
  assert.strictEqual(big.status, 'success');
});

test('ACT-06 refus de l\'API : erreur journalisée', async () => {
  const api = createFakeApi({ failWith: 'Droits insuffisants' });
  const r = await E.runWorkflow(chain(), updateEvent('Clos'), api, opts);
  assert.strictEqual(r.status, 'error');
  assert.strictEqual(r.error, 'Droits insuffisants');
});

test('ACT-08 action inconnue ou incomplète : erreur', async () => {
  const api = createFakeApi();
  assert.strictEqual((await E.runWorkflow(chain({ actions: [{ type: 'Boom', column: 'x' }] }), updateEvent('Clos'), api, opts)).status, 'error');
  assert.strictEqual((await E.runWorkflow(chain({ actions: [{ type: 'AddRecord', column: '' }] }), updateEvent('Clos'), api, opts)).status, 'error');
});

test('DRY-01/02 dry-run : effets listés, trace par nœud, aucune écriture, même si inactif', async () => {
  const api = createFakeApi();
  const r = await E.runWorkflow(chain({ active: false }), updateEvent('Clos'), api, { ...opts, dryRun: true });
  assert.strictEqual(r.status, 'success');
  assert.strictEqual(r.dryRun, true);
  assert.strictEqual(r.effects.length, 1);
  assert.deepStrictEqual(r.trace, { t: 'passed', c: 'passed', a0: 'action' });
  assert.strictEqual(api.applied.length, 0);
});

test('SEC-02 le moteur n\'utilise ni eval ni Function ni réseau', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../js/engine.js'), 'utf8');
  assert.doesNotMatch(src, /\beval\s*\(|new\s+Function|\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
});

// Condition à plusieurs vérifications, avec ou sans branche « sinon » : t -> c -(oui)-> yes ; c -(sinon)-> no.
function branched(condition, withElse) {
  const g = chain({ condition, actions: [{ type: 'AddRecord', table: 'Archive', column: 'Motif', value: 'oui' }] });
  if (withElse) {
    g.nodes.push({ id: 'n', type: 'action', config: { type: 'AddRecord', table: 'Archive', column: 'Motif', value: 'non' } });
    g.edges.push({ from: 'c', to: 'n', branch: 'else' });
  }
  return g;
}
const event = (record) => ({ type: 'update', rowId: 7, record: { id: 7, ...record }, changed: { Statut: { from: 'x', to: record.Statut } } });
const both = (join) => ({ join, checks: [{ column: 'Statut', operator: 'eq', value: 'Clos' }, { column: 'Montant', operator: 'gt', value: '100' }] });

test('COND-09 ET : toutes les vérifications doivent être vraies', async () => {
  const run = (record) => E.runWorkflow(branched(both('and')), event(record), createFakeApi(), opts);
  assert.strictEqual((await run({ Statut: 'Clos', Montant: 500 })).status, 'success');
  assert.strictEqual((await run({ Statut: 'Clos', Montant: 5 })).status, 'condition-false');
  assert.strictEqual((await run({ Statut: 'Ouvert', Montant: 500 })).status, 'condition-false');
});

test('COND-10 OU : une seule vérification vraie suffit', async () => {
  const run = (record) => E.runWorkflow(branched(both('or')), event(record), createFakeApi(), opts);
  assert.strictEqual((await run({ Statut: 'Clos', Montant: 5 })).status, 'success');
  assert.strictEqual((await run({ Statut: 'Ouvert', Montant: 500 })).status, 'success');
  assert.strictEqual((await run({ Statut: 'Ouvert', Montant: 5 })).status, 'condition-false');
});

test('COND-11 une vérification sans colonne dans une condition à plusieurs : erreur explicite en ET', async () => {
  const bad = { join: 'and', checks: [{ column: 'Statut', operator: 'eq', value: 'Clos' }, { column: '', operator: 'eq', value: '' }] };
  const result = await E.runWorkflow(branched(bad), event({ Statut: 'Clos' }), createFakeApi(), opts);
  assert.strictEqual(result.status, 'error');
  assert.match(result.error, /aucune colonne/);
});

test('ELSE-01 condition vraie : la branche « oui » seule s\'exécute', async () => {
  const api = createFakeApi();
  const result = await E.runWorkflow(branched(both('and'), true), event({ Statut: 'Clos', Montant: 500 }), api, opts);
  assert.deepStrictEqual(api.applied, [['AddRecord', 'Archive', null, { Motif: 'oui' }]]);
  assert.strictEqual(result.trace.c, 'passed');
  assert.strictEqual(result.trace.n, undefined);
});

test('ELSE-02 condition fausse : la branche « sinon » s\'exécute à la place', async () => {
  const api = createFakeApi();
  const result = await E.runWorkflow(branched(both('and'), true), event({ Statut: 'Ouvert', Montant: 500 }), api, opts);
  assert.deepStrictEqual(api.applied, [['AddRecord', 'Archive', null, { Motif: 'non' }]]);
  assert.strictEqual(result.status, 'success');
  assert.strictEqual(result.trace.c, 'else');
  assert.strictEqual(result.trace.n, 'action');
  assert.strictEqual(result.trace.a0, undefined);
});

test('ELSE-03 condition fausse sans lien « sinon » : bloquée, rien n\'est écrit', async () => {
  const api = createFakeApi();
  const result = await E.runWorkflow(branched(both('and'), false), event({ Statut: 'Ouvert', Montant: 500 }), api, opts);
  assert.strictEqual(result.status, 'condition-false');
  assert.strictEqual(result.trace.c, 'blocked');
  assert.deepStrictEqual(api.applied, []);
});

test('ELSE-04 conditions en chaîne : chaque condition a son propre « sinon »', async () => {
  const g = branched(both('and'), true);
  g.nodes.push({ id: 'c2', type: 'condition', config: { join: 'and', checks: [{ column: 'Nom', operator: 'notEmpty', value: '' }] } });
  g.nodes.push({ id: 'z', type: 'action', config: { type: 'AddRecord', table: 'Archive', column: 'Motif', value: 'z' } });
  g.edges.push({ from: 'c', to: 'c2' }, { from: 'c2', to: 'z', branch: 'else' });
  const apply = async (record) => { const api = createFakeApi(); await E.runWorkflow(g, event(record), api, opts); return api.applied.map((a) => a[3].Motif); };
  assert.deepStrictEqual(await apply({ Statut: 'Clos', Montant: 500, Nom: '' }), ['oui', 'z'], 'c vrai, c2 faux : « oui » de c et « sinon » de c2');
  assert.deepStrictEqual(await apply({ Statut: 'Ouvert', Montant: 500, Nom: '' }), ['non'], 'c faux : seul son « sinon », c2 n\'est pas atteinte');
});

// Graphe t -> transform(s) -> action, pour les tests de transformation et de valeurs {Colonne}.
function withTransforms(transforms, actionValue) {
  const nodes = [{ id: 't', type: 'trigger', config: { action: 'update', column: '' } }];
  const edges = [];
  let last = 't';
  transforms.forEach((config, i) => {
    nodes.push({ id: 'f' + i, type: 'transform', config });
    edges.push({ from: last, to: 'f' + i });
    last = 'f' + i;
  });
  nodes.push({ id: 'a', type: 'action', config: { type: 'AddRecord', table: 'Archive', column: 'Motif', value: actionValue } });
  edges.push({ from: last, to: 'a' });
  return { version: 3, active: true, nodes, edges };
}
const tf = (op, a, b, name) => ({ name: name || 'r', op, a, b: b === undefined ? '' : b });
const written = async (graph, record) => {
  const api = createFakeApi();
  const result = await E.runWorkflow(graph, event(record), api, opts);
  return { result, value: api.applied.length ? api.applied[0][3].Motif : undefined };
};

test('TRF-01 concaténation de colonnes et de texte, valeurs vides et nombres', async () => {
  const g = withTransforms([tf('concat', '{Nom} - ', '{Statut}')], '{r}');
  assert.strictEqual((await written(g, { Nom: 'Ada', Statut: 'Clos' })).value, 'Ada - Clos');
  assert.strictEqual((await written(g, { Nom: 'Ada', Statut: null })).value, 'Ada - ');
  assert.strictEqual((await written(g, { Nom: 12, Statut: 3 })).value, '12 - 3');
});

test('TRF-02 calcul : + − × ÷, flottants arrondis, division par zéro', async () => {
  const calc = async (op, a, b) => (await written(withTransforms([tf(op, a, b)], '{r}'), { Montant: 10 })).value;
  assert.strictEqual(await calc('add', '{Montant}', '5'), 15);
  assert.strictEqual(await calc('sub', '{Montant}', '2.5'), 7.5);
  assert.strictEqual(await calc('mul', '{Montant}', '3'), 30);
  assert.strictEqual(await calc('div', '{Montant}', '4'), 2.5);
  assert.strictEqual(await calc('add', '0.1', '0.2'), 0.3);
  const zero = await written(withTransforms([tf('div', '{Montant}', '0')], '{r}'), { Montant: 10 });
  assert.strictEqual(zero.result.status, 'error');
  assert.match(zero.result.error, /Division par zéro/);
  assert.strictEqual(zero.value, undefined, 'rien n\'est écrit');
});

test('TRF-03 formatage : majuscules, minuscules, espaces', async () => {
  const fmt = async (op, a) => (await written(withTransforms([tf(op, a)], '{r}'), { Nom: '  Ada Lovelace ' })).value;
  assert.strictEqual(await fmt('upper', '{Nom}'), '  ADA LOVELACE ');
  assert.strictEqual(await fmt('lower', '{Nom}'), '  ada lovelace ');
  assert.strictEqual(await fmt('trim', '{Nom}'), 'Ada Lovelace');
});

test('TRF-04 transformations en chaîne : la seconde utilise le résultat de la première', async () => {
  const g = withTransforms([tf('trim', '{Nom}', '', 'propre'), tf('upper', '{propre}', '', 'cri')], 'Bonjour {cri} !');
  assert.strictEqual((await written(g, { Nom: ' ada ' })).value, 'Bonjour ADA !');
});

test('TRF-05 valeur manquante ou non numérique : erreur explicite, aucune écriture', async () => {
  const unknown = await written(withTransforms([tf('concat', '{Inconnue}', 'x')], '{r}'), { Nom: 'a' });
  assert.strictEqual(unknown.result.status, 'error');
  assert.match(unknown.result.error, /Valeur inconnue : \{Inconnue\}/);
  const text = await written(withTransforms([tf('add', '{Nom}', '1')], '{r}'), { Nom: 'abc' });
  assert.match(text.result.error, /non numérique/);
  const empty = await written(withTransforms([tf('add', '{Nom}', '1')], '{r}'), { Nom: '' });
  assert.match(empty.result.error, /non numérique/, 'pas de coercition silencieuse d\'une cellule vide');
  assert.strictEqual(unknown.value, undefined);
});

test('TRF-06 aucune exécution de code : une formule en texte reste un texte', async () => {
  const g = withTransforms([tf('concat', '=1+1', '{Nom}')], '{r}');
  assert.strictEqual((await written(g, { Nom: '<script>alert(1)</script>' })).value, '=1+1<script>alert(1)</script>');
  assert.ok(!/\beval\b|new Function/.test(require('fs').readFileSync(require('path').join(__dirname, '../js/engine.js'), 'utf8').replace(/\/\/.*$/gm, '')));
});

test('VAL-04 valeurs {Colonne} dans l\'action : type conservé pour une valeur seule, texte sinon, accolades échappées', async () => {
  const value = async (template, record) => (await written(withTransforms([], template), record)).value;
  assert.strictEqual(await value('{Montant}', { Montant: 42 }), 42);
  assert.strictEqual(await value('{Montant} €', { Montant: 42 }), '42 €');
  assert.strictEqual(await value('{{Montant}}', { Montant: 42 }), '{Montant}');
  assert.deepStrictEqual(await value('{Tags}', { Tags: ['a', 'b'] }), ['a', 'b'], 'liste conservée telle quelle');
  assert.strictEqual(await value('x {Tags}', { Tags: ['a', 'b'] }), 'x a, b');
  assert.strictEqual(await value('7', {}), 7, 'sans accolades : comportement inchangé');
});

test('VAL-05 variable de transformation prioritaire sur une colonne du même nom', async () => {
  const g = withTransforms([tf('upper', '{Nom}', '', 'Nom')], '{Nom}');
  assert.strictEqual((await written(g, { Nom: 'ada' })).value, 'ADA');
});

test('VAL-06 suppression : {Colonne} impossible sans contenu de ligne, erreur claire', async () => {
  const api = createFakeApi();
  const g = withTransforms([], '{Nom}');
  g.nodes[0].config = { action: 'delete', column: '' };
  const result = await E.runWorkflow(g, { type: 'delete', rowId: 3 }, api, opts);
  assert.strictEqual(result.status, 'error');
  assert.match(result.error, /pas de contenu de ligne/);
});

test('DRY-05 le dry-run montre les valeurs déjà calculées, état « Passé » pour la transformation', async () => {
  const g = withTransforms([tf('concat', '{Nom}', '!')], '{r}');
  const api = createFakeApi();
  const result = await E.runWorkflow(g, event({ Nom: 'Ada' }), api, { ...opts, dryRun: true });
  assert.deepStrictEqual(result.effects[0].values, { Motif: 'Ada!' });
  assert.strictEqual(result.trace.f0, 'passed');
  assert.deepStrictEqual(api.applied, []);
});

// Action « mettre à jour » ciblant une ligne par une clé : t -> a.
function keyed(config) {
  const g = chain({ condition: null, actions: [Object.assign({ type: 'UpdateRecord', table: 'Archive', column: 'Source', value: 'vu', matchColumn: 'Motif', matchValue: '{Nom}' }, config)] });
  return g;
}
const archive = { Archive: { id: [10, 11, 12], Motif: ['a', 'b', 'b'], Source: ['x', 'y', 'z'], Ref: [5, 6, 7] } };
const keyEvent = (record) => ({ type: 'update', rowId: 7, record: { id: 7, ...record }, changed: { Statut: { from: 'x', to: 'y' } } });
const runKeyed = (config, record, api) => E.runWorkflow(keyed(config), keyEvent(record), api || createFakeApi({ tables: archive }), opts);

test('ACT-09 mise à jour d\'une autre table : la ligne est repérée par la colonne clé, pas par le numéro de la ligne de l\'événement', async () => {
  const api = createFakeApi({ tables: archive });
  const result = await runKeyed({}, { Nom: 'a' }, api);
  assert.strictEqual(result.status, 'success');
  assert.deepStrictEqual(api.applied, [['UpdateRecord', 'Archive', 10, { Source: 'vu' }]]);
});

test('ACT-10 clé introuvable ou en doublon : erreur claire, rien n\'est écrit', async () => {
  const none = createFakeApi({ tables: archive });
  const missing = await runKeyed({}, { Nom: 'zzz' }, none);
  assert.strictEqual(missing.status, 'error');
  assert.match(missing.error, /Ligne introuvable dans Archive : Motif = zzz/);
  const many = createFakeApi({ tables: archive });
  const twice = await runKeyed({}, { Nom: 'b' }, many);
  assert.match(twice.error, /Plusieurs lignes dans Archive/);
  assert.deepStrictEqual([none.applied, many.applied], [[], []]);
});

test('ACT-11 clé numérique ou texte : comparaison sans tenir compte du type (5 et « 5 »)', async () => {
  const api = createFakeApi({ tables: archive });
  await runKeyed({ matchColumn: 'Ref', matchValue: '{Num}' }, { Num: '6' }, api);
  assert.deepStrictEqual(api.applied, [['UpdateRecord', 'Archive', 11, { Source: 'vu' }]]);
});

test('ACT-12 colonne clé inconnue ou lecture impossible : erreur explicite', async () => {
  const unknown = await runKeyed({ matchColumn: 'Nope' }, { Nom: 'a' });
  assert.match(unknown.error, /Colonne inconnue dans Archive : Nope/);
  const unreadable = await runKeyed({}, { Nom: 'a' }, { applyUserActions: async () => {} });
  assert.match(unreadable.error, /Lecture de la table impossible/);
});

test('ACT-13 autre table sans colonne clé : refusé au lieu d\'écrire sur la mauvaise ligne', async () => {
  const api = createFakeApi({ tables: archive });
  const result = await runKeyed({ matchColumn: '', matchValue: '' }, { Nom: 'a' }, api);
  assert.strictEqual(result.status, 'error');
  assert.match(result.error, /colonne qui repère la ligne/);
  assert.deepStrictEqual(api.applied, []);
});

test('ACT-14 dry-run : la ligne trouvée est annoncée, rien n\'est écrit', async () => {
  const api = createFakeApi({ tables: archive });
  const result = await E.runWorkflow(keyed({}), keyEvent({ Nom: 'a' }), api, { ...opts, dryRun: true });
  assert.strictEqual(result.effects[0].rowId, 10);
  assert.deepStrictEqual(api.applied, []);
});

test('ACT-15 autre ligne de la table courante repérée par clé : permis', async () => {
  const api = createFakeApi({ tables: { Contacts: { id: [1, 2], Cle: ['k1', 'k2'] } } });
  const result = await E.runWorkflow(keyed({ table: '', matchColumn: 'Cle', matchValue: 'k2', column: 'Statut' }), keyEvent({ Nom: 'a' }), api, opts);
  assert.strictEqual(result.status, 'success');
  assert.deepStrictEqual(api.applied, [['UpdateRecord', 'Contacts', 2, { Statut: 'vu' }]]);
});
