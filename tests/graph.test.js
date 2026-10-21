'use strict';
const test = require('node:test');
const assert = require('node:assert');
const G = require('../js/graph.js');

function sample() {
  const g = G.create();
  const t = G.addNode(g, 'trigger', 0, 0);
  const c = G.addNode(g, 'condition', 200, 0);
  const a = G.addNode(g, 'action', 400, 0);
  return { g, t, c, a };
}

test('GRAPH-01 ajout : identifiants uniques, configuration par défaut copiée', () => {
  const g = G.create();
  const first = G.addNode(g, 'action', 10.4, 20.6);
  const second = G.addNode(g, 'action', 0, 0);
  assert.notStrictEqual(first.id, second.id);
  assert.deepStrictEqual([first.x, first.y], [10, 21]);
  first.config.column = 'X';
  assert.strictEqual(second.config.column, '');
  assert.throws(() => G.addNode(g, 'nope', 0, 0));
});

test('GRAPH-02 liens : sortie vers entrée uniquement', () => {
  const { g, t, c, a } = sample();
  assert.ok(G.connect(g, t.id, c.id).ok);
  assert.strictEqual(G.connect(g, a.id, c.id).reason, 'no-output');
  assert.strictEqual(G.connect(g, c.id, t.id).reason, 'no-input');
  assert.strictEqual(G.connect(g, c.id, c.id).reason, 'self');
  assert.strictEqual(G.connect(g, 'x', c.id).reason, 'unknown');
});

test('GRAPH-03 pas de cycle entre conditions', () => {
  const { g, c } = sample();
  const c2 = G.addNode(g, 'condition', 0, 0);
  assert.ok(G.connect(g, c.id, c2.id).ok);
  assert.strictEqual(G.connect(g, c2.id, c.id).reason, 'cycle');
});

test('GRAPH-04 une entrée n\'a qu\'un lien : le nouveau remplace l\'ancien', () => {
  const { g, t, c, a } = sample();
  G.connect(g, t.id, a.id);
  G.connect(g, c.id, a.id);
  assert.deepStrictEqual(g.edges, [{ from: c.id, to: a.id }]);
});

test('GRAPH-05 une sortie peut alimenter plusieurs nœuds', () => {
  const { g, t, c, a } = sample();
  G.connect(g, t.id, c.id);
  G.connect(g, t.id, a.id);
  assert.strictEqual(g.edges.length, 2);
});

test('GRAPH-06 suppression d\'un nœud : ses liens partent avec lui', () => {
  const { g, t, c, a } = sample();
  G.connect(g, t.id, c.id);
  G.connect(g, c.id, a.id);
  G.removeNode(g, c.id);
  assert.deepStrictEqual(g.edges, []);
  assert.strictEqual(g.nodes.length, 2);
});

test('GRAPH-07 validation : graphe vide, nœuds isolés, colonnes manquantes', () => {
  assert.deepStrictEqual(G.validate(G.create()).map((i) => i.key), ['issue.noTrigger', 'issue.noAction']);
  const { g, t, c, a } = sample();
  const keys = () => G.validate(g).map((i) => i.key);
  assert.ok(keys().includes('issue.notConnected'));
  G.connect(g, t.id, c.id);
  G.connect(g, c.id, a.id);
  assert.deepStrictEqual(keys().sort(), ['issue.actionColumn', 'issue.conditionColumn']);
  c.config.checks[0].column = 'Statut';
  a.config.column = 'Motif';
  assert.deepStrictEqual(keys(), []);
  c.config.checks.push({ column: '', operator: 'eq', value: '' });
  assert.deepStrictEqual(keys(), ['issue.conditionColumn'], 'une vérification sans colonne suffit à refuser');
});

test('GRAPH-08 action jointe à aucun déclencheur : chemin manquant', () => {
  const { g, t, c, a } = sample();
  const other = G.addNode(g, 'condition', 0, 0);
  G.connect(g, t.id, c.id);
  G.connect(g, other.id, a.id);
  assert.ok(G.validate(g).some((i) => i.key === 'issue.noPath'));
});

test('GRAPH-09 aller-retour JSON ; configuration illisible refusée', () => {
  const { g, t, c } = sample();
  G.connect(g, t.id, c.id);
  g.active = true;
  assert.deepStrictEqual(G.parse(JSON.stringify(g)), g);
  assert.strictEqual(G.parse('pas du json'), null);
  assert.strictEqual(G.parse(JSON.stringify({ version: 1, nodes: [], edges: [] })), null);
  assert.strictEqual(G.parse(JSON.stringify({ version: 2, nodes: [{ id: 'x', type: 'boom', config: {} }], edges: [] })), null);
});

test('GRAPH-10 les liens vers des nœuds disparus sont ignorés à la lecture', () => {
  const { g, t } = sample();
  const data = JSON.parse(JSON.stringify(g));
  data.edges.push({ from: t.id, to: 'fantome' });
  assert.deepStrictEqual(G.parse(JSON.stringify(data)).edges, []);
});

test('GRAPH-11 les vérifications d\'une condition ne sont pas partagées entre deux nœuds', () => {
  const g = G.create();
  const first = G.addNode(g, 'condition', 0, 0);
  const second = G.addNode(g, 'condition', 0, 0);
  first.config.checks.push({ column: 'X', operator: 'eq', value: '' });
  assert.strictEqual(second.config.checks.length, 1);
});

test('GRAPH-12 deux sorties de condition : « oui » et « sinon », une entrée = un lien', () => {
  const g = G.create();
  const c = G.addNode(g, 'condition', 0, 0);
  const a = G.addNode(g, 'action', 0, 0);
  const b = G.addNode(g, 'action', 0, 0);
  assert.deepStrictEqual(G.connect(g, c.id, a.id), { ok: true });
  assert.deepStrictEqual(G.connect(g, c.id, b.id, 'else'), { ok: true });
  assert.deepStrictEqual(g.edges, [{ from: c.id, to: a.id }, { from: c.id, to: b.id, branch: 'else' }]);
  G.connect(g, c.id, b.id);
  assert.deepStrictEqual(g.edges.map((e) => e.branch), [undefined, undefined], 'relier à nouveau remplace le lien de cette entrée');
});

test('GRAPH-13 seule la condition a une sortie « sinon »', () => {
  const g = G.create();
  const t = G.addNode(g, 'trigger', 0, 0);
  const a = G.addNode(g, 'action', 0, 0);
  const c = G.addNode(g, 'condition', 0, 0);
  assert.strictEqual(G.connect(g, t.id, a.id, 'else').ok, false);
  assert.strictEqual(G.connect(g, a.id, c.id).ok, false, 'une action n\'a pas de sortie');
});

test('GRAPH-14 migration d\'un graphe version 2 : la condition devient une vérification ET', () => {
  const old = { version: 2, active: true, nodes: [
    { id: 'trigger-1', type: 'trigger', x: 0, y: 0, config: { action: 'update', column: 'Statut' } },
    { id: 'condition-1', type: 'condition', x: 0, y: 0, config: { column: 'Statut', operator: 'eq', value: 'Clos' } },
    { id: 'action-1', type: 'action', x: 0, y: 0, config: { type: 'AddRecord', table: 'Archive', column: 'Motif', value: 'x' } },
  ], edges: [{ from: 'trigger-1', to: 'condition-1' }, { from: 'condition-1', to: 'action-1' }] };
  const g = G.parse(JSON.stringify(old));
  assert.strictEqual(g.version, G.VERSION);
  assert.strictEqual(g.active, true);
  assert.deepStrictEqual(g.nodes[1].config, { join: 'and', checks: [{ column: 'Statut', operator: 'eq', value: 'Clos' }] });
  assert.strictEqual(g.edges.length, 2);
  assert.strictEqual(G.parse(JSON.stringify(g)).version, G.VERSION, 'le résultat migré se relit tel quel');
});

test('GRAPH-15 lecture : condition sans vérification ou lien « sinon » sur un nœud sans cette sortie refusés/écartés', () => {
  const g = G.create();
  const c = G.addNode(g, 'condition', 0, 0);
  const t = G.addNode(g, 'trigger', 0, 0);
  const a = G.addNode(g, 'action', 0, 0);
  const text = JSON.parse(JSON.stringify(g));
  text.edges.push({ from: t.id, to: a.id, branch: 'else' }, { from: c.id, to: a.id, branch: 'else' });
  const parsed = G.parse(JSON.stringify(text));
  assert.deepStrictEqual(parsed.edges, [{ from: c.id, to: a.id, branch: 'else' }]);
  text.nodes[0].config.checks = [];
  assert.strictEqual(G.parse(JSON.stringify(text)), null);
});

test('GRAPH-16 validation d\'une transformation : nom valide et unique, valeurs présentes', () => {
  const g = G.create();
  const t = G.addNode(g, 'trigger', 0, 0);
  const f = G.addNode(g, 'transform', 0, 0);
  const a = G.addNode(g, 'action', 0, 0);
  G.connect(g, t.id, f.id);
  G.connect(g, f.id, a.id);
  a.config.column = 'Motif';
  const keys = () => G.validate(g).map((i) => i.key);
  assert.deepStrictEqual(keys(), ['issue.transformOperand'], 'valeur A manquante');
  f.config.a = '{Nom}';
  assert.deepStrictEqual(keys(), ['issue.transformOperand'], 'valeur B manquante pour une opération à deux valeurs');
  f.config.op = 'upper';
  assert.deepStrictEqual(keys(), []);
  f.config.name = '1abc';
  assert.deepStrictEqual(keys(), ['issue.transformName']);
  f.config.name = 'ok';
  const second = G.addNode(g, 'transform', 0, 0);
  second.config.name = 'ok';
  second.config.a = 'x';
  second.config.op = 'trim';
  G.connect(g, f.id, second.id);
  assert.ok(keys().includes('issue.transformName'), 'nom en double');
});

test('GRAPH-17 une transformation se relie comme un maillon (une entrée, une sortie) et se relit', () => {
  const g = G.create();
  const t = G.addNode(g, 'trigger', 0, 0);
  const f = G.addNode(g, 'transform', 0, 0);
  const a = G.addNode(g, 'action', 0, 0);
  assert.strictEqual(G.connect(g, t.id, f.id).ok, true);
  assert.strictEqual(G.connect(g, f.id, a.id).ok, true);
  assert.strictEqual(G.connect(g, f.id, a.id, 'else').ok, false, 'pas de sortie « sinon »');
  assert.deepStrictEqual(G.parse(JSON.stringify(g)).nodes[1].config, { name: 'resultat', op: 'concat', a: '', b: '' });
});

test('GRAPH-18 mise à jour d\'une autre table : la colonne clé et sa valeur sont exigées', () => {
  const g = G.create();
  const t = G.addNode(g, 'trigger', 0, 0);
  const a = G.addNode(g, 'action', 0, 0);
  G.connect(g, t.id, a.id);
  a.config.column = 'Source';
  a.config.table = 'Archive';
  const keys = () => G.validate(g, { currentTable: 'Contacts' }).map((i) => i.key);
  assert.deepStrictEqual(keys(), ['issue.actionMatch']);
  assert.deepStrictEqual(G.validate(g).map((i) => i.key), [], 'sans table courante connue, pas de refus');
  a.config.matchColumn = 'Motif';
  assert.deepStrictEqual(keys(), ['issue.actionMatchValue']);
  a.config.matchValue = '{Nom}';
  assert.deepStrictEqual(keys(), []);
  a.config.type = 'AddRecord';
  a.config.matchColumn = '';
  assert.deepStrictEqual(keys(), [], 'une ajout n\'a pas de ligne cible');
});

test('GRAPH-19 un graphe enregistré avant la clé de ligne reste valable (champs absents)', () => {
  const g = G.create();
  const t = G.addNode(g, 'trigger', 0, 0);
  const a = G.addNode(g, 'action', 0, 0);
  G.connect(g, t.id, a.id);
  a.config.column = 'Motif';
  delete a.config.matchColumn;
  delete a.config.matchValue;
  assert.deepStrictEqual(G.validate(G.parse(JSON.stringify(g)), { currentTable: 'Contacts' }), []);
});

test('GRAPH-20 validation d\'une lecture : colonne clé, valeur clé, colonne lue, nom valide et unique (partagé avec les transformations)', () => {
  const g = G.create();
  const t = G.addNode(g, 'trigger', 0, 0);
  const l = G.addNode(g, 'lookup', 0, 0);
  const a = G.addNode(g, 'action', 0, 0);
  G.connect(g, t.id, l.id);
  G.connect(g, l.id, a.id);
  a.config.column = 'Motif';
  const keys = () => G.validate(g).map((i) => i.key);
  assert.deepStrictEqual(keys(), ['issue.lookupIncomplete']);
  Object.assign(l.config, { table: 'Services', matchColumn: 'Nom', matchValue: '{Nom}', column: 'Seuil' });
  assert.deepStrictEqual(keys(), []);
  const f = G.addNode(g, 'transform', 0, 0);
  f.config.name = l.config.name;
  f.config.a = 'x';
  f.config.op = 'trim';
  G.connect(g, l.id, f.id);
  assert.ok(keys().includes('issue.transformName'), 'même nom qu\'une lecture');
});

test('GRAPH-21 déclencheur à ligne précise : réservé à la modification, valeur clé exigée', () => {
  const g = G.create();
  const t = G.addNode(g, 'trigger', 0, 0);
  const a = G.addNode(g, 'action', 0, 0);
  G.connect(g, t.id, a.id);
  a.config.column = 'Motif';
  const keys = () => G.validate(g).map((i) => i.key);
  t.config.targetColumn = 'Cle';
  assert.deepStrictEqual(keys(), ['issue.triggerTargetValue']);
  t.config.targetValue = 'k1';
  assert.deepStrictEqual(keys(), []);
  t.config.action = 'create';
  assert.deepStrictEqual(keys(), ['issue.triggerTarget']);
  t.config.action = 'delete';
  assert.deepStrictEqual(keys(), ['issue.triggerTarget']);
});

test('GRAPH-22 résumé lisible : lecture et ligne précise', () => {
  const g = G.create();
  const t = G.addNode(g, 'trigger', 0, 0);
  const l = G.addNode(g, 'lookup', 0, 0);
  const a = G.addNode(g, 'action', 0, 0);
  Object.assign(t.config, { targetColumn: 'Cle', targetValue: 'k1' });
  Object.assign(l.config, { table: 'Services', matchColumn: 'Nom', matchValue: '{Nom}', column: 'Seuil' });
  G.connect(g, t.id, l.id);
  G.connect(g, l.id, a.id);
  const text = G.summarize(g, (k, p) => require('../js/i18n.js').translate(k, p, 'fr'));
  assert.match(text, /où Cle = k1/);
  assert.match(text, /Lecture : \{valeur\} = Services\.Seuil \(où Nom = \{Nom\}\)/);
});
