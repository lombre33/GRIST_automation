'use strict';
// DIAG : le diagnostic que le widget donne pour demander de l'aide (js/diagnostic.js). Ce qu'il dit, et surtout ce qu'il ne dit jamais :
// le contenu d'une ligne du document, et, en mode anonymisé, un nom de table ou de colonne ni une valeur saisie.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../js/diagnostic.js');
const G = require('../js/graph.js');
const E = require('../js/engine.js');
const I = require('../js/i18n.js');
const { createFakeApi } = require('./fakes/fakeGrist.js');

const t = (key, params) => I.translate(key, params, 'fr');
// Des noms que rien d'autre ne contient : Tbl_ (table), Col_ (colonne), Var_ (valeur d'un nœud), Val_ (texte saisi dans un nœud) ; SECRET : le contenu d'une ligne du document.
const LEAK = /Tbl_|Col_|Var_|Val_|SECRET/;

// Un workflow complet : modification de Col_Statut (ligne où Col_Priorite = Val_Urgent), condition à deux vérifications, lecture dans Tbl_Taux, calcul, mise à jour de Tbl_Archive.
function workflow() {
  const graph = G.create();
  const trigger = G.addNode(graph, 'trigger', 40, 120);
  Object.assign(trigger.config, { action: 'update', column: 'Col_Statut', targetColumn: 'Col_Priorite', targetValue: 'Val_Urgent' });
  const condition = G.addNode(graph, 'condition', 330, 120);
  condition.config = { join: 'and', checks: [{ column: 'Col_Montant', operator: 'gt', value: '1000' }, { column: 'Col_Note', operator: 'notEmpty', value: '' }] };
  const lookup = G.addNode(graph, 'lookup', 620, 120);
  Object.assign(lookup.config, { name: 'Var_taux', table: 'Tbl_Taux', matchColumn: 'Col_Code', matchValue: '{Col_Service}', column: 'Col_Valeur', onMissing: 'error' });
  const transform = G.addNode(graph, 'transform', 900, 120);
  Object.assign(transform.config, { name: 'Var_total', op: 'mul', a: '{Col_Montant}', b: '{Var_taux}' });
  const action = G.addNode(graph, 'action', 1180, 120);
  Object.assign(action.config, { type: 'UpdateRecord', table: 'Tbl_Archive', matchColumn: 'Col_Reference', matchValue: '{Col_Reference}', column: 'Col_Total', value: '{Var_total} Val_EUR {Col_Statut}' });
  for (const [from, to] of [[trigger, condition], [condition, lookup], [lookup, transform], [transform, action]]) assert.ok(G.connect(graph, from.id, to.id).ok);
  graph.active = true;
  return graph;
}

const schema = () => ({
  tables: ['Tbl_Dossiers', 'Tbl_Taux', 'Tbl_Archive', 'Tbl_Autre'],
  columns: {
    Tbl_Dossiers: ['Col_Statut', 'Col_Priorite', 'Col_Montant', 'Col_Service', 'Col_Note', 'Col_Reference', 'Col_Lien', 'Col_Date', 'Col_Calcul'],
    Tbl_Taux: ['Col_Code', 'Col_Valeur'],
    Tbl_Archive: ['Col_Reference', 'Col_Total'],
  },
  types: {
    Tbl_Dossiers: {
      Col_Statut: { type: 'Choice' }, Col_Priorite: { type: 'Text' }, Col_Montant: { type: 'Numeric' }, Col_Service: { type: 'Text' }, Col_Note: { type: 'Text' }, Col_Reference: { type: 'Text' },
      Col_Lien: { type: 'Ref:Tbl_Taux' }, Col_Date: { type: 'DateTime:Europe/Paris' }, Col_Calcul: { type: 'Numeric', formula: true },
    },
    Tbl_Taux: { Col_Code: { type: 'Text' }, Col_Valeur: { type: 'Numeric' } },
    Tbl_Archive: { Col_Reference: { type: 'Text' }, Col_Total: { type: 'Numeric' } },
  },
});

const record = (service, montant = 5000) => ({ id: 1, Col_Statut: 'Clos', Col_Priorite: 'Val_Urgent', Col_Montant: montant, Col_Note: 'SECRET-NOTE', Col_Service: service, Col_Reference: 'SECRET-REF' });
const update = (rec) => ({ type: 'update', rowId: rec.id, record: rec, changed: { Col_Statut: { from: 'SECRET-AVANT', to: rec.Col_Statut } } });

// Les messages que le vrai moteur et le vrai journal produisent quand une exécution échoue (js/main.js, handleEvents), avec le contenu de la ligne dans l'erreur.
async function journalFromEngine() {
  const run = async (api, rec) => {
    const result = await E.runWorkflow(workflow(), update(rec), api, { currentTable: 'Tbl_Dossiers' });
    assert.strictEqual(result.status, 'error');
    return t('log.event', { event: t('event.' + result.event), row: result.rowId, status: t('result.' + result.status) + ' — ' + result.error });
  };
  const rates = (codes, values) => ({ id: codes.map((c, i) => i + 1), Col_Code: codes, Col_Valeur: values });
  const archive = { id: [7], Col_Reference: ['SECRET-REF'], Col_Total: [0] };
  return [
    await run(createFakeApi({ tables: { Tbl_Taux: rates(['autre'], [1]), Tbl_Archive: archive } }), record('SECRET-SERVICE')),
    await run(createFakeApi({ tables: { Tbl_Taux: rates(['SECRET-SERVICE', 'SECRET-SERVICE'], [1, 2]), Tbl_Archive: archive } }), record('SECRET-SERVICE')),
    await run(createFakeApi({ tables: { Tbl_Taux: rates(['SECRET-SERVICE'], ['SECRET-PAS-UN-NOMBRE']), Tbl_Archive: archive } }), record('SECRET-SERVICE')),
    await run(createFakeApi({ tables: { Tbl_Taux: rates(['SECRET-SERVICE'], [2]), Tbl_Archive: archive }, failWith: 'Invalid column "Col_Fantome" in table "Tbl_Archive"' }), record('SECRET-SERVICE')),
  ];
}

const clock = (minutes) => new Date(Date.UTC(2026, 10, 9, 12, minutes, 0));
async function input(extra = {}) {
  const messages = await journalFromEngine();
  return {
    version: '0.15.2', language: 'fr', browser: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130', generatedAt: clock(30),
    viewTable: 'Tbl_Dossiers', graph: workflow(), t,
    journal: [
      ...messages.map((message, i) => ({ date: clock(i + 1), message })),
      { date: clock(10), message: 'Dry-run ligne 1 : réussi — 1 effet' },
      { date: clock(11), message: t('log.schemaError', { table: 'Tbl_Autre', error: 'Table not found "Tbl_Autre"' }) },
    ],
    frame: { grist: true, gfs: false, access: 'full', readOnly: false },
    state: { workflow: 'present', loadedFromStorage: true, executor: 'this-tab', automationTable: true, storeIssue: null, unsaved: false, rowsInView: 3 },
    schema: schema(),
    ...extra,
  };
}

const parse = (text) => JSON.parse(text.split('\n').slice(1, -1).join('\n'));

test('DIAG-01 un bloc de code JSON prêt à coller, qui se relit, avec la version, l\'état, le workflow, les tables et le journal ; anonymisé sans autre précision', async () => {
  const text = D.toText(D.build(await input()));
  assert.match(text, /^```json\n/);
  assert.match(text, /\n```$/);
  const diagnostic = parse(text);
  assert.deepStrictEqual(Object.keys(diagnostic), ['format', 'mode', 'generatedAt', 'widget', 'state', 'viewTable', 'workflow', 'tables', 'journal']);
  assert.strictEqual(diagnostic.format, D.FORMAT);
  assert.strictEqual(diagnostic.mode, 'anonymized');
  assert.strictEqual(diagnostic.generatedAt, '2026-11-09T12:30:00.000Z');
  assert.deepStrictEqual(diagnostic.widget, { version: '0.15.2', language: 'fr', browser: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130', grist: true, gfs: false, access: 'full', readOnly: false });
  assert.deepStrictEqual(diagnostic.state, { workflow: 'present', loadedFromStorage: true, executor: 'this-tab', automationTable: true, storeIssue: null, unsaved: false, rowsInView: 3 });
  assert.deepStrictEqual(Object.keys(diagnostic.workflow), ['version', 'active', 'summary', 'nodes', 'edges', 'problems']);
  assert.strictEqual(diagnostic.workflow.version, G.VERSION);
  assert.strictEqual(diagnostic.workflow.active, true);
  assert.deepStrictEqual(D.MODES, ['anonymized', 'full']);
});

test('DIAG-02 anonymisé : aucun nom de table ou de colonne, aucune valeur saisie ni aucun contenu de ligne, dans le workflow, le résumé, les tables et le journal', async () => {
  const text = D.toText(D.build(await input(), { mode: 'anonymized' }));
  assert.doesNotMatch(text, LEAK, text);
  assert.doesNotMatch(text, /Dossiers|Taux|Archive|Autre|Fantome/, 'pas même un fragment de ces noms');
});

test('DIAG-03 anonymisé : un même nom a le même pseudonyme partout (tables, nœuds, résumé, problèmes, journal), dans l\'ordre du document', async () => {
  const diagnostic = parse(D.toText(D.build(await input())));
  assert.strictEqual(diagnostic.viewTable, 'T1');
  assert.deepStrictEqual(Object.keys(diagnostic.tables), ['T1', 'T2', 'T3'], 'la table de la vue, puis celles que les nœuds nomment');
  assert.deepStrictEqual(Object.keys(diagnostic.tables.T1), ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9'], 'les colonnes dans l\'ordre de la table');
  const node = (type) => diagnostic.workflow.nodes.find((candidate) => candidate.type === type);
  const lookup = node('lookup').config;
  assert.strictEqual(lookup.table, 'T2');
  assert.ok(lookup.matchColumn in diagnostic.tables.T2 && lookup.column in diagnostic.tables.T2, 'les colonnes lues sont celles de la table T2');
  assert.strictEqual(node('action').config.table, 'T3');
  assert.strictEqual(node('trigger').config.column, 'C1', 'la première colonne de la table de la vue');
  assert.strictEqual(node('action').config.value, '{V2}<text>{C1}', 'les {valeurs} gardent leur pseudonyme, le texte saisi n\'est plus que <text>');
  assert.strictEqual(lookup.matchValue, '{C4}');
  assert.strictEqual(node('transform').config.name, 'V2');
  assert.strictEqual(lookup.name, 'V1', 'les valeurs {nom} des nœuds : V1, V2…');
  assert.strictEqual(node('transform').config.b, '{V1}', 'la valeur d\'un nœud n\'est pas prise pour une colonne');
  const summary = diagnostic.workflow.summary.join('\n');
  assert.match(summary, /(?:Lecture|Recherche) : \{V1\} = T2\./, 'le nœud de lecture (« Recherche » depuis la 0.16.0) dit la table pseudonymisée et sa valeur {V1}');
  assert.match(summary, /Déclencheur : modifiée \(C1\)/);
  const lines = diagnostic.journal.map((entry) => entry.message);
  assert.ok(lines.some((line) => /Ligne introuvable dans T2 : C\d+ = <text>$/.test(line)), lines.join('\n'));
  assert.ok(lines.some((line) => /Plusieurs lignes dans T2 pour C\d+ = <text>$/.test(line)));
  assert.ok(lines.some((line) => /Valeur non numérique : « <text> »$/.test(line)));
  assert.ok(lines.some((line) => /Invalid column "<text>" in table "T3"$/.test(line)), 'une colonne que rien ne nomme n\'est plus qu\'une nature ; une table connue garde son pseudonyme');
  assert.ok(lines.some((line) => /Table not found "T4"/.test(line)), 'Tbl_Autre est une table du document : elle a un pseudonyme même si aucun nœud ne la nomme');
});

test('DIAG-04 complet : les noms et les textes saisis restent lisibles, mais le contenu d\'une ligne n\'y est jamais, ni dans le journal', async () => {
  const text = D.toText(D.build(await input(), { mode: 'full' }));
  const diagnostic = parse(text);
  assert.strictEqual(diagnostic.mode, 'full');
  assert.strictEqual(diagnostic.viewTable, 'Tbl_Dossiers');
  assert.deepStrictEqual(Object.keys(diagnostic.tables), ['Tbl_Dossiers', 'Tbl_Taux', 'Tbl_Archive']);
  const action = diagnostic.workflow.nodes.find((node) => node.type === 'action').config;
  assert.strictEqual(action.value, '{Var_total} Val_EUR {Col_Statut}', 'le texte saisi dans un nœud, tel quel');
  assert.match(diagnostic.workflow.summary.join('\n'), /Col_Statut/);
  assert.doesNotMatch(text, /SECRET/, 'aucune valeur d\'une ligne du document, même en mode complet');
  const lines = diagnostic.journal.map((entry) => entry.message);
  assert.ok(lines.some((line) => /Ligne introuvable dans Tbl_Taux : Col_Code = <text>$/.test(line)), lines.join('\n'));
  assert.ok(lines.some((line) => /Invalid column "Col_Fantome" in table "Tbl_Archive"$/.test(line)), 'les messages de Grist gardent leurs noms en mode complet');
  assert.deepStrictEqual(diagnostic.workflow.nodes.find((node) => node.type === 'lookup').config.table, 'Tbl_Taux');
});

test('DIAG-05 les types des colonnes : une référence nomme sa table (pseudonyme comprise), une formule le dit, le fuseau d\'une date n\'est qu\'en mode complet', async () => {
  const anonymized = parse(D.toText(D.build(await input()))).tables.T1;
  assert.deepStrictEqual(Object.values(anonymized), ['Choice', 'Text', 'Numeric', 'Text', 'Text', 'Text', 'Ref:T2', 'DateTime', 'Numeric, formula']);
  const full = parse(D.toText(D.build(await input(), { mode: 'full' }))).tables.Tbl_Dossiers;
  assert.deepStrictEqual(full, {
    Col_Statut: 'Choice', Col_Priorite: 'Text', Col_Montant: 'Numeric', Col_Service: 'Text', Col_Note: 'Text', Col_Reference: 'Text',
    Col_Lien: 'Ref:Tbl_Taux', Col_Date: 'DateTime:Europe/Paris', Col_Calcul: 'Numeric, formula',
  });
});

test('DIAG-06 ce qui ne va pas : les problèmes qui empêchent d\'activer, puis les tables et colonnes que le workflow nomme et que le document n\'a plus', async () => {
  const broken = await input();
  broken.schema.tables = broken.schema.tables.filter((name) => name !== 'Tbl_Taux');
  broken.schema.columns.Tbl_Dossiers = broken.schema.columns.Tbl_Dossiers.filter((name) => name !== 'Col_Priorite' && name !== 'Col_Note');
  const diagnostic = parse(D.toText(D.build(broken)));
  const found = diagnostic.workflow.problems;
  assert.deepStrictEqual(found.map((problem) => [problem.node, problem.code, problem.field]), [
    ['trigger-1', 'unknown-column', 'targetColumn'], ['condition-1', 'unknown-column', 'checks'], ['lookup-1', 'unknown-table', 'table'],
  ], 'dans l\'ordre des nœuds');
  assert.ok(found.slice(0, 2).every((problem) => problem.table === 'T1' && /^C\d+$/.test(problem.name)), 'les noms sont des pseudonymes');
  assert.deepStrictEqual(found[2], { node: 'lookup-1', code: 'unknown-table', field: 'table', name: 'T2' });
  assert.strictEqual(diagnostic.tables.T2, null, 'une table absente du document est dite absente (null)');

  const empty = G.create();
  const issues = parse(D.toText(D.build({ ...broken, graph: empty }))).workflow.problems;
  assert.deepStrictEqual(issues, [{ code: 'noTrigger' }, { code: 'noAction' }]);

  const twice = workflow();
  twice.nodes.find((node) => node.type === 'condition').config.checks = [{ column: 'Col_Note', operator: 'empty', value: '' }, { column: 'Col_Note', operator: 'notEmpty', value: '' }];
  assert.strictEqual(parse(D.toText(D.build({ ...broken, graph: twice }))).workflow.problems.filter((problem) => problem.code === 'unknown-column' && problem.field === 'checks').length, 1, 'le même problème n\'est dit qu\'une fois');
});

test('DIAG-07 des tables que le widget n\'a pas pu lire : la section le dit (null) au lieu d\'accuser le workflow', async () => {
  const unreadable = await input({ schema: { tables: null, columns: {}, types: {} } });
  const diagnostic = parse(D.toText(D.build(unreadable)));
  assert.strictEqual(diagnostic.tables, null);
  assert.deepStrictEqual(diagnostic.workflow.problems, [], 'sans la liste des tables du document, aucune table ni colonne n\'est dite absente');
  const noTypes = parse(D.toText(D.build(await input({ schema: { tables: ['Tbl_Dossiers'], columns: { Tbl_Dossiers: ['Col_Statut'] } } }))));
  assert.deepStrictEqual(noTypes.tables.T1, { C1: null }, 'un type que Grist n\'a pas donné : null');
});

test('DIAG-08 une table très large ne donne que les colonnes que le workflow nomme, et dit combien manquent', async () => {
  const wide = await input();
  const names = Array.from({ length: 80 }, (_, i) => `Col_Large_${i}`);
  wide.schema.columns.Tbl_Dossiers = ['Col_Statut', ...names, 'Col_Montant'];
  wide.schema.types.Tbl_Dossiers = {};
  const tables = parse(D.toText(D.build(wide))).tables;
  assert.deepStrictEqual(Object.keys(tables.T1), ['C1', 'C2', '…'], 'les colonnes nommées par le workflow, dans l\'ordre de la table');
  assert.strictEqual(tables.T1['…'], '80 more');
  assert.doesNotMatch(D.toText(D.build(wide)), LEAK);
});

test('DIAG-09 le journal : les 30 plus récentes d\'abord, à égalité la dernière arrivée en premier, les dates illisibles écartées, une ligne par message de 400 caractères au plus', async () => {
  const journal = [];
  for (let i = 0; i < 45; i += 1) journal.push({ date: clock(i), message: `ligne ${i}` });
  journal.push({ date: clock(44), message: 'même minute, arrivée après' }, { date: 'pas une date', message: 'écartée' }, { date: clock(5), message: 'x'.repeat(900) + '\n\n   suite' });
  const lines = parse(D.toText(D.build(await input({ journal })))).journal;
  assert.strictEqual(lines.length, 30);
  assert.deepStrictEqual(lines.slice(0, 3).map((line) => line.message), ['même minute, arrivée après', 'ligne 44', 'ligne 43']);
  assert.strictEqual(lines[0].time, '2026-11-09T12:44:00.000Z');
  assert.ok(lines.every((line) => !/écartée/.test(line.message)));
  const long = parse(D.toText(D.build(await input({ journal: [{ date: clock(1), message: 'x'.repeat(900) + '\n\n   suite' }] })))).journal[0].message;
  assert.strictEqual(long.length, 400);
  assert.doesNotMatch(long, /\n/);
});

test('DIAG-10 les messages de Grist en mode anonymisé : ce qui est entre guillemets (« », " " ou \' \') n\'est repris que s\'il nomme quelque chose que le workflow connaît ; les apostrophes du français ne sont pas des guillemets', async () => {
  const messages = [
    'KeyError: \'Col_Inconnue\' dans \'Tbl_Dossiers\'',
    'Impossible d\'enregistrer : l\'ajout de « SECRET-CELLULE » a échoué',
    'Column "Col_Statut" is not "SECRET-NUMERO 12"',
    'Erreur pour Col_Montant et Tbl_Taux : « 42 »',
    '« Action 1 » n\'a pas de colonne.',
  ];
  const lines = parse(D.toText(D.build(await input({ journal: messages.map((message, i) => ({ date: clock(i), message })) })))).journal.map((line) => line.message).reverse();
  assert.strictEqual(lines[0], 'KeyError: \'<text>\' dans \'T1\'');
  assert.strictEqual(lines[1], 'Impossible d\'enregistrer : l\'ajout de « <text> » a échoué', 'd\'enregistrer et l\'ajout : des apostrophes, pas des guillemets');
  assert.strictEqual(lines[2], 'Column "C1" is not "<text>"');
  assert.match(lines[3], /^Erreur pour C\d+ et T2 : « <number> »$/);
  assert.strictEqual(lines[4], '« Action 1 » n\'a pas de colonne.', 'le nom d\'un nœud n\'est pas un nom du document');
});

test('DIAG-11 un contenu enregistré que cette version ne sait pas lire : sa nature, jamais ses mots', () => {
  assert.deepStrictEqual(D.inspectConfig(''), { json: false, empty: true });
  assert.deepStrictEqual(D.inspectConfig(null), { json: false, empty: true });
  assert.deepStrictEqual(D.inspectConfig('{pas du json SECRET'), { json: false, characters: 19 });
  assert.deepStrictEqual(D.inspectConfig('42'), { json: true, shape: 'number' });
  const newer = JSON.stringify({ version: 4, nodes: [{ type: 'trigger' }, { type: 'boucle' }, { type: 'boucle' }, { type: 'SECRET type avec espaces' }, { type: 'x'.repeat(80) }, null], secret: 'SECRET' });
  assert.deepStrictEqual(D.inspectConfig(newer), { json: true, version: 4, nodes: 6, unknownTypes: ['boucle', '?', '?'] });
  assert.deepStrictEqual(D.inspectConfig('{"nodes":"x"}'), { json: true, version: null, nodes: 0, unknownTypes: [] });
  const shown = D.build({ version: '0.15.2', graph: null, unreadable: { source: 'document', ...D.inspectConfig(newer) } });
  assert.deepStrictEqual(shown.unreadable, { source: 'document', json: true, version: 4, nodes: 6, unknownTypes: ['boucle', '?', '?'] });
  assert.strictEqual('workflow' in shown, false, 'pas de workflow quand le contenu est illisible');
});

test('DIAG-12 le texte à copier : la clôture du bloc est plus longue que toute suite d\'accents graves, et le JSON se relit à l\'identique', async () => {
  const tricky = await input();
  tricky.schema.columns.Tbl_Dossiers = ['a```b', 'c`````d'];
  tricky.schema.types.Tbl_Dossiers = {};
  const diagnostic = D.build(tricky, { mode: 'full' });
  const text = D.toText(diagnostic);
  assert.match(text, /^``````json\n/, 'six accents graves : un de plus que la plus longue suite (cinq)');
  assert.match(text, /\n``````$/);
  assert.deepStrictEqual(parse(text), JSON.parse(JSON.stringify(diagnostic)));
});

test('DIAG-13 le diagnostic ne change rien à ce qu\'il lit, donne le même texte deux fois, et sait se faire avec très peu', async () => {
  const given = await input();
  const before = JSON.stringify({ graph: given.graph, schema: given.schema, journal: given.journal, state: given.state });
  const first = D.toText(D.build(given));
  const second = D.toText(D.build(given));
  assert.strictEqual(first, second);
  assert.strictEqual(JSON.stringify({ graph: given.graph, schema: given.schema, journal: given.journal, state: given.state }), before, 'ni le graphe, ni les tables, ni le journal ne sont touchés');
  const frozen = JSON.parse(before);
  const deepFreeze = (value) => { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
  for (const part of Object.values(frozen)) deepFreeze(part);
  const text = D.toText(D.build({ ...given, ...frozen, journal: frozen.journal.map((entry) => ({ ...entry, date: new Date(entry.date) })) }));
  assert.doesNotMatch(text, /not-built/, 'une entrée figée se lit sans rien y écrire');
  const minimal = D.build({});
  assert.deepStrictEqual(Object.keys(minimal), ['format', 'mode', 'generatedAt', 'widget', 'state', 'viewTable', 'tables', 'journal']);
  assert.strictEqual(minimal.viewTable, null);
  assert.strictEqual(minimal.tables, null);
  assert.deepStrictEqual(minimal.journal, []);
});

test('DIAG-14 une partie qui ne peut pas se faire le dit (not-built) au lieu d\'empêcher tout le diagnostic', async () => {
  const cyclic = workflow();
  cyclic.edges.push({ from: 'action-1', to: 'trigger-1' });   // un fichier abîmé : un lien en retour (Graph.connect le refuse, Graph.parse ne le cherche pas)
  const summary = parse(D.toText(D.build(await input({ graph: cyclic })))).workflow.summary;
  assert.strictEqual(summary, null, 'un résumé qui ne peut pas suivre le graphe n\'en donne pas');
  const broken = workflow();
  delete broken.nodes[1].config;
  const diagnostic = parse(D.toText(D.build(await input({ graph: broken }))));
  assert.deepStrictEqual(diagnostic.workflow, { error: 'not-built' });
  assert.ok(Array.isArray(diagnostic.journal) && diagnostic.journal.length, 'le reste est là');
  assert.ok(diagnostic.tables && diagnostic.tables.T1, 'les tables aussi');
});

test('DIAG-15 un champ que cette version ne connaît pas (nœud ou valeur d\'une version plus récente) est masqué, ni recopié ni perdu', async () => {
  const future = workflow();
  const action = future.nodes.find((node) => node.type === 'action');
  Object.assign(action.config, { retries: 3, note: 'SECRET-NOTE', many: ['Col_A', 'Val_B'], options: { mode: 'SECRET-MODE', depth: 2 }, type: 'UpsertRecord' });
  action.color = 'SECRET-COULEUR';
  const anonymized = parse(D.toText(D.build(await input({ graph: future }))));
  const config = anonymized.workflow.nodes.find((node) => node.type === 'action').config;
  assert.deepStrictEqual({ retries: config.retries, note: config.note, many: config.many, options: config.options, type: config.type }, { retries: 3, note: '<text>', many: ['<text>', '<text>'], options: { mode: '<text>', depth: 2 }, type: '<text>' });
  assert.ok(!('color' in anonymized.workflow.nodes.find((node) => node.type === 'action')), 'un attribut de nœud inconnu n\'est pas repris');
  assert.doesNotMatch(D.toText(D.build(await input({ graph: future }))), /SECRET|Col_A|Val_B/);
});

test('DIAG-16 le module ne lit rien dans Grist ni dans la page : il ne fait que mettre en forme ce que le widget lui donne', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/diagnostic.js'), 'utf8')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
    .replace(/\}\)\(typeof window !== 'undefined' \? window : globalThis\);/, '');
  // `grist: frame.grist` est une donnée du diagnostic (le widget dit s'il a l'API de Grist), pas un appel.
  assert.doesNotMatch(source, /(?<![.\w])grist\b(?!\s*:)|\bdocument\b|\bwindow\b|navigator|location|Storage|applyUserActions|fetchTable|listTables|\bfetch\b|\bStore\b|\bEngine\b|AutomationEngine/);
  assert.doesNotMatch(source, /\brecord\b|\beffects\b|\brows?\b|\bevent\b/, 'rien du contenu d\'une ligne n\'est lu');
});

test('DIAG-17 la mise en page garde sur une ligne ce qui tient (un lien, une vérification) sans changer le JSON : toute structure se relit à l\'identique', async () => {
  const text = D.toText(D.build(await input(), { mode: 'full' }));
  const lines = text.split('\n');
  assert.ok(lines.some((line) => /^\s+\{ "from": "trigger-1", "to": "condition-1" \}/.test(line) || /"edges": \[\{ "from"/.test(line)), 'les liens tiennent sur une ligne');
  assert.ok(lines.length < 140, `le texte reste court (${lines.length} lignes)`);
  // Des structures de toute forme : vides, imbriquées, très longues, avec des caractères d'échappement, des null, des undefined et des dates.
  let seed = 7;
  const random = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const make = (depth) => {
    const kind = depth > 3 ? random(5) : random(8);
    if (kind === 0) return null;
    if (kind === 1) return random(1000) / 8;
    if (kind === 2) return 'a "citation"\nsur deux lignes, avec \\ et ` et « » ' + 'x'.repeat(random(130));
    if (kind === 3) return random(2) === 0;
    if (kind === 4) return random(3) === 0 ? undefined : '';
    if (kind === 5) return Array.from({ length: random(7) }, () => make(depth + 1));
    if (kind === 6) return Object.fromEntries(Array.from({ length: random(6) }, (_, i) => [`clé ${i} "${random(9)}"`, make(depth + 1)]));
    return new Date(Date.UTC(2026, 10, 1 + random(28)));
  };
  for (let i = 0; i < 300; i += 1) {
    const value = { format: 'x', mode: 'full', part: make(0), other: make(0) };
    const body = D.toText(value).split('\n').slice(1, -1).join('\n');
    assert.deepStrictEqual(JSON.parse(body), JSON.parse(JSON.stringify(value)), body);
  }
});
