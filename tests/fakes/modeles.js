// Les cinq recettes des modèles d'automatisme du catalogue (modeles/modeles.json) : le graphe rempli d'un document d'exemple (commandes, archive, catalogue ; aucun nom de personne),
// tel que l'éditeur l'enregistre, et un événement qui le fait tourner. Elles servent à deux choses : les tests (tests/modeles.test.js) vérifient que chaque recette tient
// dans le moteur, et le script qui prend les vignettes (essais-gfs/lab-modeles.mjs) les monte dans un vrai Grist, les exécute pour de bon, puis les photographie.
// Ce n'est pas le code qui ouvrira un modèle : l'app n'en charge aucun tant que GFS n'a pas répondu (consigne 020). Positions x et y : celles de l'éditeur, de gauche à droite.
'use strict';

const trigger = (config) => ({ id: 'trigger-1', type: 'trigger', x: 0, y: 40, config: { action: 'update', column: '', targetColumn: '', targetValue: '', ...config } });
const action = (config, x) => ({ id: 'action-1', type: 'action', x, y: 40, config: { type: 'UpdateRecord', table: '', matchColumn: '', matchValue: '', column: '', value: '', ...config } });
const graph = (nodes) => ({
  version: 3,
  active: false,
  nodes,
  edges: nodes.slice(1).map((node, index) => ({ from: nodes[index].id, to: node.id })),
});

// Les lignes d'exemple du document (une seule fois, partagées par les recettes qui lisent une autre table).
const CATALOGUE = { id: [1, 2, 3], Code: ['A12', 'B07', 'C33'], Libelle: ['Chaise de bureau', 'Table pliante', 'Lampe LED'] };

const RECETTES = {
  // 1. Quand une colonne prend une valeur précise, une ligne s'ajoute dans une autre table.
  'statut-vers-archive': {
    graph: graph([
      trigger({ column: 'Statut' }),
      { id: 'condition-1', type: 'condition', x: 268, y: 40, config: { join: 'and', checks: [{ column: 'Statut', operator: 'eq', value: 'Clos' }] } },
      action({ type: 'AddRecord', table: 'Archive', column: 'Motif', value: '{Ref} clôturée' }, 536),
    ]),
    event: { type: 'update', rowId: 7, record: { id: 7, Ref: 'CMD-1041', Statut: 'Clos' }, changed: { Statut: { from: 'En cours', to: 'Clos' } } },
    effects: [['AddRecord', 'Archive', null, { Motif: 'CMD-1041 clôturée' }]],
    quiet: { type: 'update', rowId: 7, record: { id: 7, Ref: 'CMD-1041', Statut: 'En cours' }, changed: { Statut: { from: 'Nouveau', to: 'En cours' } } },
  },
  // 2. Quand une ligne est créée, une colonne reçoit sa valeur de départ.
  'valeur-a-la-creation': {
    graph: graph([
      trigger({ action: 'create' }),
      action({ column: 'Statut', value: 'Nouveau' }, 268),
    ]),
    event: { type: 'create', rowId: 9, record: { id: 9, Ref: 'CMD-1046', Statut: '' } },
    effects: [['UpdateRecord', 'Commandes', 9, { Statut: 'Nouveau' }]],
    quiet: { type: 'update', rowId: 9, record: { id: 9, Ref: 'CMD-1046', Statut: '' }, changed: { Ref: { from: '', to: 'CMD-1046' } } },
  },
  // 3. Quand un nombre dépasse un seuil, la ligne est marquée.
  'seuil-a-verifier': {
    graph: graph([
      trigger({ column: 'Montant' }),
      { id: 'condition-1', type: 'condition', x: 268, y: 40, config: { join: 'and', checks: [{ column: 'Montant', operator: 'gt', value: '1000' }] } },
      action({ column: 'Controle', value: 'À vérifier' }, 536),
    ]),
    event: { type: 'update', rowId: 4, record: { id: 4, Montant: 1500, Controle: '' }, changed: { Montant: { from: 240, to: 1500 } } },
    effects: [['UpdateRecord', 'Commandes', 4, { Controle: 'À vérifier' }]],
    quiet: { type: 'update', rowId: 4, record: { id: 4, Montant: 80, Controle: '' }, changed: { Montant: { from: 240, to: 80 } } },
  },
  // 4. Quand une quantité change, le total est calculé avec le prix.
  'total-calcule': {
    graph: graph([
      trigger({ column: 'Quantite' }),
      { id: 'transform-1', type: 'transform', x: 268, y: 40, config: { name: 'total', op: 'mul', a: '{Quantite}', b: '{Prix}' } },
      action({ column: 'Total', value: '{total}' }, 536),
    ]),
    event: { type: 'update', rowId: 2, record: { id: 2, Quantite: 3, Prix: 12.5, Total: 0 }, changed: { Quantite: { from: 1, to: 3 } } },
    effects: [['UpdateRecord', 'Commandes', 2, { Total: 37.5 }]],
    quiet: { type: 'update', rowId: 2, record: { id: 2, Quantite: 3, Prix: 12.5, Total: 0 }, changed: { Prix: { from: 10, to: 12.5 } } },
  },
  // 5. Quand un code est saisi, son libellé est lu dans une autre table et recopié.
  'copie-depuis-une-table': {
    graph: graph([
      trigger({ column: 'Code' }),
      { id: 'lookup-1', type: 'lookup', x: 268, y: 40, config: { name: 'libelle', table: 'Catalogue', matchColumn: 'Code', matchValue: '{Code}', column: 'Libelle', onMissing: 'error' } },
      action({ column: 'Libelle', value: '{libelle}' }, 536),
    ]),
    event: { type: 'update', rowId: 2, record: { id: 2, Code: 'B07', Libelle: '' }, changed: { Code: { from: '', to: 'B07' } } },
    effects: [['UpdateRecord', 'Commandes', 2, { Libelle: 'Table pliante' }]],
    quiet: { type: 'update', rowId: 2, record: { id: 2, Code: 'B07', Libelle: '' }, changed: { Libelle: { from: 'x', to: '' } } },
    tables: { Catalogue: CATALOGUE },
  },
};

// Le même graphe, tel qu'un modèle s'ouvrira : sans les choix de la personne (colonnes, table, valeurs, seuil) ; la structure, les opérations, les sorties et les noms
// que les nœuds se donnent entre eux ({total}, {libelle}) restent.
const CHOICES = {
  trigger: ['column', 'targetColumn', 'targetValue'],
  lookup: ['table', 'matchColumn', 'matchValue', 'column'],
  transform: ['a', 'b'],
  action: ['table', 'matchColumn', 'matchValue', 'column', 'value'],
};
function blank(source) {
  const copy = JSON.parse(JSON.stringify(source));
  const own = new Set(copy.nodes.filter((node) => node.type === 'transform' || node.type === 'lookup').map((node) => `{${node.config.name}}`));
  const clear = (value) => (own.has(value) ? value : '');
  for (const node of copy.nodes) {
    if (node.type === 'condition') node.config.checks = node.config.checks.map((check) => ({ ...check, column: '', value: '' }));
    else for (const key of CHOICES[node.type]) node.config[key] = clear(node.config[key]);
  }
  return copy;
}

module.exports = { RECETTES, blank, CATALOGUE };
