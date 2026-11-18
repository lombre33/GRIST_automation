'use strict';
// MODELE : les modèles d'automatisme que l'app propose à GFS pour « Nouveau > Depuis un modèle » (consigne 020) : un catalogue (modeles/modeles.json) et une vignette par modèle.
// GFS lit et copie ce dossier chez lui ; l'app, elle, ne le charge jamais, et n'ouvre encore aucun modèle (le code vient après la réponse de GFS). Ces essais gardent
// les limites que GFS fixe à une entrée (contrats 2.2 et 5.4, point 13 ; lecteur du catalogue de GFS, js/apps/templates-catalogue.js) et vérifient que chaque recette annoncée tient dans le moteur.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Graph = require('../js/graph.js');
const E = require('../js/engine.js');
const { createFakeApi } = require('./fakes/fakeGrist.js');
const { RECETTES, blank } = require('./fakes/modeles.js');
const { webpSize } = require('./webp-size.js');

const dir = path.join(__dirname, '..', 'modeles');
const catalogue = JSON.parse(fs.readFileSync(path.join(dir, 'modeles.json'), 'utf8'));
const IDS = ['statut-vers-archive', 'valeur-a-la-creation', 'seuil-a-verifier', 'total-calcule', 'copie-depuis-une-table'];   // jamais changés ni réutilisés (consigne 020)
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const KEYS = ['description', 'etiquettes', 'id', 'nom', 'vignette'];   // ce que l'app met dans une entrée : ni `type` (GFS le fixe), ni `extensions`, ni `tables`
const LANGS = ['fr', 'en'];
const NAME_MAX = 60;
const TEXT_MAX = 140;
const THUMB_MAX = 12 * 1024;   // le poids conseillé par GFS (50 Ko au plus)
const length = (text) => [...text].length;
const strings = (value) => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []);   // toutes les valeurs texte d'une configuration
const bilingual =(value, max, name) => {
  assert.deepStrictEqual(Object.keys(value).sort(), [...LANGS].sort(), name);
  for (const lang of LANGS) {
    const text = value[lang];
    assert.strictEqual(typeof text, 'string', `${name} (${lang})`);
    assert.ok(text.length > 0 && text === text.trim() && !/\s{2}|[\r\n\t]/.test(text), `${name} (${lang}) : un texte net, d'une ligne`);
    assert.ok(length(text) <= max, `${name} (${lang}) : ${length(text)} caractères, ${max} au plus`);
  }
};

test('MODELE-01 le dossier ne tient que modeles.json et une vignette par modèle ; le catalogue est une liste de cinq modèles dans l\'ordre voulu', () => {
  assert.ok(Array.isArray(catalogue));
  assert.deepStrictEqual(catalogue.map((entry) => entry.id), IDS);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), [...IDS.map((id) => `${id}.webp`), 'modeles.json'].sort(), 'aucun fichier en trop, aucune vignette oubliée');
});

test('MODELE-02 chaque entrée : un id de GFS, unique, et les seuls champs que l\'app met dans une entrée (jamais `type`, que GFS fixe dans sa réponse)', () => {
  const seen = new Set();
  for (const entry of catalogue) {
    assert.deepStrictEqual(Object.keys(entry).sort(), KEYS, entry.id);
    assert.match(entry.id, ID, entry.id);
    assert.ok(!seen.has(entry.id), `${entry.id} : déjà pris`);
    seen.add(entry.id);
    assert.strictEqual(entry.vignette, `${entry.id}.webp`, `${entry.id} : la vignette porte le nom du modèle`);
  }
});

test('MODELE-03 nom (60), description (140) et étiquettes (60) : en français et en anglais, d\'une ligne ; la description n\'est pas le nom', () => {
  for (const entry of catalogue) {
    bilingual(entry.nom, NAME_MAX, `${entry.id} : le nom`);
    bilingual(entry.description, TEXT_MAX, `${entry.id} : la description`);
    assert.ok(Array.isArray(entry.etiquettes) && entry.etiquettes.length >= 1 && entry.etiquettes.length <= 3, `${entry.id} : une à trois étiquettes`);
    entry.etiquettes.forEach((tag, index) => bilingual(tag, NAME_MAX, `${entry.id} : l'étiquette ${index + 1}`));
    for (const lang of LANGS) {
      assert.notStrictEqual(entry.description[lang], entry.nom[lang], `${entry.id} (${lang}) : la description dit autre chose que le nom`);
      assert.ok(length(entry.description[lang]) >= 40, `${entry.id} (${lang}) : la description dit ce que fait le modèle`);
    }
    assert.notStrictEqual(entry.nom.fr, entry.nom.en, `${entry.id} : le nom est traduit`);
    assert.notStrictEqual(entry.description.fr, entry.description.en, `${entry.id} : la description est traduite`);
  }
  assert.strictEqual(new Set(catalogue.map((entry) => entry.nom.fr)).size, catalogue.length, 'deux modèles ne portent pas le même nom');
});

// Règle 13 du guide de GFS (1.1) : ne jamais écrire qu'activer ou cocher quelque chose rend l'app plus sûre. Un modèle dit ce qu'il fait, pas ce qu'il garantit.
test('MODELE-04 aucune promesse de sécurité ni de garantie dans les noms, les descriptions et les étiquettes', () => {
  const promise = /s[ée]curi|sûr|protég|protect|garanti|guarantee|sans risque|risk|safe|fiable|reliab|trust|confiance/i;
  for (const entry of catalogue) {
    const texts = [entry.nom, entry.description, ...entry.etiquettes];
    for (const text of texts) for (const lang of LANGS) assert.doesNotMatch(text[lang], promise, `${entry.id} (${lang})`);
  }
});

test('MODELE-05 chaque vignette : WebP de 240 × 320 (3 sur 4) et de 12 Ko au plus', () => {
  for (const entry of catalogue) {
    const file = path.join(dir, entry.vignette);
    assert.deepStrictEqual(webpSize(file), { width: 240, height: 320 }, entry.vignette);
    assert.ok(fs.statSync(file).size <= THUMB_MAX, `${entry.vignette} : ${fs.statSync(file).size} octets, ${THUMB_MAX} au plus`);
  }
});

test('MODELE-06 une recette éprouvée par modèle : mêmes id, dans le même ordre', () => {
  assert.deepStrictEqual(Object.keys(RECETTES), IDS);
});

test('MODELE-07 les cinq recettes couvrent chaque sorte de nœud et les deux actions', () => {
  const nodes = Object.values(RECETTES).flatMap((recipe) => recipe.graph.nodes);
  assert.deepStrictEqual([...new Set(nodes.map((node) => node.type))].sort(), ['action', 'condition', 'lookup', 'transform', 'trigger']);
  assert.deepStrictEqual([...new Set(nodes.filter((node) => node.type === 'action').map((node) => node.config.type))].sort(), ['AddRecord', 'UpdateRecord']);
  assert.deepStrictEqual([...new Set(nodes.filter((node) => node.type === 'trigger').map((node) => node.config.action))].sort(), ['create', 'update']);
});

test('MODELE-08 chaque recette, remplie : un graphe que l\'éditeur relit et ne trouve incomplet nulle part', () => {
  for (const [id, recipe] of Object.entries(RECETTES)) {
    const parsed = Graph.parse(JSON.stringify(recipe.graph));
    assert.ok(parsed, `${id} : le graphe s'enregistre et se relit`);
    assert.deepStrictEqual(parsed.nodes, recipe.graph.nodes, id);
    assert.deepStrictEqual(Graph.validate(parsed, { currentTable: 'Commandes' }), [], id);
  }
});

test('MODELE-09 chaque recette, remplie, fait ce que son nom dit : l\'événement écrit l\'effet attendu, un autre événement n\'écrit rien', async () => {
  for (const [id, recipe] of Object.entries(RECETTES)) {
    const graph = { ...recipe.graph, active: true };
    const api = createFakeApi({ tables: recipe.tables });
    const result = await E.runWorkflow(graph, recipe.event, api, { currentTable: 'Commandes' });
    assert.strictEqual(result.status, 'success', `${id} : ${result.error || ''}`);
    assert.deepStrictEqual(api.applied, recipe.effects, id);
    const quiet = createFakeApi({ tables: recipe.tables });
    const idle = await E.runWorkflow(graph, recipe.quiet, quiet, { currentTable: 'Commandes' });
    assert.notStrictEqual(idle.status, 'success', id);
    assert.deepStrictEqual(quiet.applied, [], id);
  }
});

// Ce que l'éditeur refuse à l'activation (`Graph.validate`) est une colonne ou une valeur qui manque ; une colonne surveillée vide (toute colonne) ou une valeur d'action vide n'est pas refusée.
test('MODELE-10 chaque recette, ouverte comme un modèle (sans table, colonne ni valeur) : se relit, mais l\'éditeur refuse de l\'activer et ne garde rien du document d\'exemple', async () => {
  const INCOMPLETE = ['issue.conditionColumn', 'issue.actionColumn', 'issue.transformOperand', 'issue.lookupIncomplete'];
  for (const [id, recipe] of Object.entries(RECETTES)) {
    const model = blank(recipe.graph);
    assert.ok(Graph.parse(JSON.stringify(model)), `${id} : le modèle se relit`);
    const issues = Graph.validate(model, { currentTable: 'Commandes' });
    assert.ok(issues.length > 0, `${id} : un modèle vide n'est pas activable`);
    for (const issue of issues) assert.ok(INCOMPLETE.includes(issue.key), `${id} : ${issue.key} ne dit pas « à compléter »`);
    // Aucun nom de table, de colonne ni de valeur du document d'exemple ne reste : seuls les noms que les nœuds se donnent entre eux ({total}, {libelle}).
    for (const leaf of model.nodes.flatMap((node) => strings(node.config))) assert.doesNotMatch(leaf, /Commandes|Archive|Catalogue|Statut|Ref|Montant|Quantite|Prix|Total|Controle|Code|Libelle|Clos|Nouveau|vérifier|1000/, `${id} : « ${leaf} » est un choix de la personne`);
    // Un modèle laissé tel quel ne fait rien tourner : activé de force, l'événement ne s'écrit nulle part (le moteur refuse une action sans colonne).
    const api = createFakeApi({ tables: recipe.tables });
    const result = await E.runWorkflow({ ...model, active: true }, recipe.event, api, { currentTable: 'Commandes' });
    assert.strictEqual(api.applied.length, 0, `${id} : rien n'est écrit`);
    assert.notStrictEqual(result.status, 'success', id);
  }
});
