// Les modèles de départ de l'app (modeles/modeles.json : ce que « Nouveau > Depuis un modèle » de GFS montre) tels que l'éditeur les ouvre quand GFS en demande un (js/model-opening.js ; consigne 021).
// Chaque modèle est un graphe complet (structure, opérateurs, sorties) mais sans les choix de la personne : colonnes, tables et valeurs restent à choisir, seuls les noms que les nœuds se donnent entre eux
// ({total}, {libelle}) sont posés. Rien n'y est inventé qui dépende d'un document : l'app ne sait pas à quelle table le modèle servira. Les cinq `id` sont ceux du catalogue, jamais changés ni réutilisés ; les noms
// sont ceux du catalogue (le widget n'a pas le droit de lire son propre fichier : sa politique de sécurité ne laisse passer aucune requête). tests/modeles.test.js compare le tout au catalogue et aux recettes
// jouées pour de vrai dans un Grist (tests/fakes/modeles.js) : une structure ou un nom qui change d'un côté et pas de l'autre échoue.
// Logique pure (sans DOM) : le graphe rendu est une copie neuve à chaque appel, que l'éditeur peut modifier sans toucher au modèle.
(function (root) {
  'use strict';

  // Positions de l'éditeur, de gauche à droite : un nœud est large de 232 px, 268 px séparent deux entrées.
  const STEP = 268;
  const node = (id, type, index, config) => ({ id, type, x: index * STEP, y: 40, config });
  const trigger = (config) => node('trigger-1', 'trigger', 0, { action: 'update', column: '', targetColumn: '', targetValue: '', ...config });
  const condition = (operator) => node('condition-1', 'condition', 1, { join: 'and', checks: [{ column: '', operator, value: '' }] });
  const transform = (config) => node('transform-1', 'transform', 1, { op: 'concat', a: '', b: '', ...config });
  const lookup = (config) => node('lookup-1', 'lookup', 1, { table: '', matchColumn: '', matchValue: '', column: '', onMissing: 'error', ...config });
  const action = (index, config) => node('action-1', 'action', index, { type: 'UpdateRecord', table: '', matchColumn: '', matchValue: '', column: '', value: '', ...config });
  // Les nœuds se suivent, chacun relié au précédent par sa sortie « oui » (la seule d'une condition qui compte ici : le modèle n'a pas de branche « sinon »).
  const chain = (nodes) => ({ version: 3, active: false, nodes, edges: nodes.slice(1).map((next, index) => ({ from: nodes[index].id, to: next.id })) });

  const MODELS = [
    {
      id: 'statut-vers-archive',
      name: { fr: 'Archiver une ligne quand son statut change', en: 'Archive a row when its status changes' },
      graph: chain([trigger(), condition('eq'), action(2, { type: 'AddRecord' })]),
    },
    {
      id: 'valeur-a-la-creation',
      name: { fr: 'Remplir une colonne à la création d\'une ligne', en: 'Fill in a column when a row is created' },
      graph: chain([trigger({ action: 'create' }), action(1)]),
    },
    {
      id: 'seuil-a-verifier',
      name: { fr: 'Marquer une ligne quand un montant dépasse un seuil', en: 'Flag a row when an amount goes over a threshold' },
      graph: chain([trigger(), condition('gt'), action(2)]),
    },
    {
      id: 'total-calcule',
      name: { fr: 'Calculer un total à partir de deux colonnes', en: 'Work out a total from two columns' },
      graph: chain([trigger(), transform({ name: 'total', op: 'mul' }), action(2, { value: '{total}' })]),
    },
    {
      id: 'copie-depuis-une-table',
      name: { fr: 'Recopier une valeur depuis une autre table', en: 'Copy a value from another table' },
      graph: chain([trigger(), lookup({ name: 'libelle' }), action(2, { value: '{libelle}' })]),
    },
  ];

  // Le modèle de cet identifiant, ou null (un identifiant inconnu, ou qui n'est pas un texte : jamais un modèle vierge à la place).
  const find = (id) => (typeof id === 'string' ? MODELS.find((model) => model.id === id) || null : null);

  // Une copie neuve du graphe du modèle, prête à être chargée dans l'éditeur ; null pour un identifiant inconnu.
  function graphOf(id) {
    const model = find(id);
    return model ? JSON.parse(JSON.stringify(model.graph)) : null;
  }

  // Le nom du modèle dans la langue demandée (le français sinon).
  function nameOf(id, lang) {
    const model = find(id);
    return model ? model.name[lang] || model.name.fr : '';
  }

  const api = { MODELS, find, graphOf, nameOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Models = api;
})(typeof window !== 'undefined' ? window : globalThis);
