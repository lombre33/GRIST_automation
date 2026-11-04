// Types de nœuds : ce que chacun porte (champs, valeurs par défaut) et ses broches. Données pures, partagées par le graphe, le moteur et le canevas.
// kind des champs : 'choice' (liste fixe), 'column' (colonne de la table courante), 'table' (table du document),
// 'targetColumn' (colonne de la table cible du nœud), 'text' (saisie libre), 'viewTable' (la table de la vue, affichée sans se choisir).
(function (root) {
  'use strict';
  const UNARY = ['upper', 'lower', 'trim'];   // opérations d'une transformation qui n'ont qu'une valeur (A) : la valeur B y est grisée

  // placeholderKey : l'exemple grisé d'un champ libre ; fallback : le choix montré quand la configuration n'en a pas (un workflow d'une version d'avant).
  const TYPES = {
    trigger: {
      titleKey: 'node.trigger', hintKey: 'hint.trigger', inputs: 0, branches: ['then'],
      defaults: { action: 'update', column: '', targetColumn: '', targetValue: '' },
      fields: [
        { key: 'viewTable', labelKey: 'trigger.table', kind: 'viewTable' },
        { key: 'action', labelKey: 'trigger.when', kind: 'choice', choices: [['update', 'trigger.update'], ['create', 'trigger.create'], ['delete', 'trigger.delete']] },
        { key: 'column', labelKey: 'trigger.column', kind: 'column', emptyKey: 'list.anyColumn' },
        // Filtre : seulement pour une modification (une ligne créée est nouvelle, une ligne supprimée n'a plus de contenu à comparer).
        { key: 'targetColumn', labelKey: 'trigger.targetColumn', kind: 'column', emptyKey: 'list.noFilter', disabledWhen: (config) => config.action !== 'update' },
        { key: 'targetValue', labelKey: 'trigger.targetValue', kind: 'text', placeholderKey: 'ph.targetValue', disabledWhen: (config) => config.action !== 'update' || !config.targetColumn },
      ],
    },
    // Une condition porte une ou plusieurs vérifications reliées par ET ou OU, et deux sorties : « oui » (condition vraie) et « sinon ».
    condition: {
      titleKey: 'node.condition', hintKey: 'hint.condition', inputs: 1, branches: ['then', 'else'],
      defaults: { join: 'and', checks: [{ column: '', operator: 'eq', value: '' }] },
      fields: [
        { key: 'checks', kind: 'checks' },
        { key: 'join', labelKey: 'cond.join', kind: 'choice', choices: [['and', 'join.and'], ['or', 'join.or']], disabledWhen: (config) => config.checks.length < 2 },
      ],
    },
    // Une transformation calcule une valeur à partir de la ligne (ou d'une transformation précédente) et la met à disposition des nœuds suivants sous {nom}.
    transform: {
      titleKey: 'node.transform', hintKey: 'hint.transform', inputs: 1, branches: ['then'],
      defaults: { name: 'resultat', op: 'concat', a: '', b: '' },
      fields: [
        { key: 'name', labelKey: 'tf.name', kind: 'text' },
        { key: 'op', labelKey: 'tf.op', kind: 'choice', choices: [['concat', 'tf.concat'], ['add', 'tf.add'], ['sub', 'tf.sub'], ['mul', 'tf.mul'], ['div', 'tf.div'], ['upper', 'tf.upper'], ['lower', 'tf.lower'], ['trim', 'tf.trim']] },
        { key: 'a', labelKey: 'tf.a', kind: 'text', placeholderKey: 'ph.operand' },
        { key: 'b', labelKey: 'tf.b', kind: 'text', placeholderKey: 'ph.operand', disabledWhen: (config) => UNARY.includes(config.op) },
      ],
    },
    // Une recherche (type interne lookup) va chercher une cellule d'une autre table (ligne repérée par une clé) et la met à disposition des nœuds suivants sous {nom}.
    lookup: {
      titleKey: 'node.lookup', hintKey: 'hint.lookup', inputs: 1, branches: ['then'],
      defaults: { name: 'valeur', table: '', matchColumn: '', matchValue: '', column: '', onMissing: 'error' },
      fields: [
        { key: 'name', labelKey: 'tf.name', kind: 'text' },
        { key: 'table', labelKey: 'lookup.table', kind: 'table', emptyKey: 'list.currentTable' },
        { key: 'matchColumn', labelKey: 'lookup.matchColumn', kind: 'targetColumn', emptyKey: 'list.choose' },
        { key: 'matchValue', labelKey: 'lookup.matchValue', kind: 'text', placeholderKey: 'ph.matchValue' },
        { key: 'column', labelKey: 'lookup.column', kind: 'targetColumn', emptyKey: 'list.choose' },
        { key: 'onMissing', labelKey: 'lookup.onMissing', kind: 'choice', choices: [['error', 'lookup.error'], ['empty', 'lookup.empty']] },
      ],
    },
    // many : 'all' modifie toutes les lignes trouvées par la clé (par défaut d'une nouvelle action), 'one' s'arrête s'il y en a plusieurs (une action d'avant).
    action: {
      titleKey: 'node.action', hintKey: 'hint.action', inputs: 1, branches: [],
      defaults: { type: 'UpdateRecord', table: '', matchColumn: '', matchValue: '', many: 'all', column: '', value: '' },
      fields: [
        { key: 'type', labelKey: 'act.type', kind: 'choice', choices: [['UpdateRecord', 'act.update'], ['AddRecord', 'act.add']] },
        { key: 'table', labelKey: 'act.table', kind: 'table', emptyKey: 'list.currentTable' },
        { key: 'matchColumn', labelKey: 'act.matchColumn', kind: 'targetColumn', emptyKey: 'list.eventRow', disabledWhen: (config) => config.type === 'AddRecord' },
        { key: 'matchValue', labelKey: 'act.matchValue', kind: 'text', placeholderKey: 'ph.matchValue', disabledWhen: (config) => config.type === 'AddRecord' || !config.matchColumn },
        { key: 'many', labelKey: 'act.many', kind: 'choice', choices: [['one', 'act.manyStop'], ['all', 'act.manyAll']], fallback: 'one', disabledWhen: (config) => config.type === 'AddRecord' || !config.matchColumn },
        { key: 'column', labelKey: 'act.column', kind: 'targetColumn', emptyKey: 'list.choose' },
        { key: 'value', labelKey: 'act.value', kind: 'text', placeholderKey: 'ph.value' },
      ],
    },
  };
  // Opérateurs d'une vérification de condition, avec la clé de traduction de leur libellé.
  const OPERATORS = [['eq', 'op.eq'], ['neq', 'op.neq'], ['gt', 'op.gt'], ['lt', 'op.lt'], ['contains', 'op.contains'], ['empty', 'op.empty'], ['notEmpty', 'op.notEmpty'], ['checked', 'op.checked'], ['unchecked', 'op.unchecked']];
  const needsValue = (check) => !['empty', 'notEmpty', 'checked', 'unchecked'].includes(check.operator);

  const api = { TYPES, OPERATORS, UNARY, needsValue, ORDER: ['trigger', 'condition', 'lookup', 'transform', 'action'] };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NodeTypes = api;
})(typeof window !== 'undefined' ? window : globalThis);
