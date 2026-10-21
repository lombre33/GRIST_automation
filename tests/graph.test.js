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
