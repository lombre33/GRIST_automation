// Types de nœuds : ce que chacun porte (champs, valeurs par défaut) et ses broches. Données pures, partagées par le graphe, le moteur et le canevas.
// kind des champs : 'choice' (liste fixe), 'column' (colonne de la table courante), 'table' (table du document),
// 'targetColumn' (colonne de la table cible du nœud), 'text' (saisie libre).
(function (root) {
  'use strict';

  const TYPES = {
    trigger: {
      titleKey: 'node.trigger',
      inputs: 0,
      branches: ['then'],
      defaults: { action: 'update', column: '' },
      fields: [
        { key: 'action', labelKey: 'trigger.when', kind: 'choice', choices: [['update', 'trigger.update'], ['create', 'trigger.create'], ['delete', 'trigger.delete']] },
        { key: 'column', labelKey: 'trigger.column', kind: 'column', emptyKey: 'list.none' },
      ],
    },
    // Une condition porte une ou plusieurs vérifications reliées par ET ou OU, et deux sorties : « oui » (condition vraie) et « sinon ».
    condition: {
      titleKey: 'node.condition',
      inputs: 1,
      branches: ['then', 'else'],
      defaults: { join: 'and', checks: [{ column: '', operator: 'eq', value: '' }] },
      fields: [
        { key: 'checks', kind: 'checks' },
        { key: 'join', labelKey: 'cond.join', kind: 'choice', choices: [['and', 'join.and'], ['or', 'join.or']], disabledWhen: (config) => config.checks.length < 2 },
      ],
    },
    action: {
      titleKey: 'node.action',
      inputs: 1,
      branches: [],
      defaults: { type: 'UpdateRecord', table: '', column: '', value: '' },
      fields: [
        { key: 'type', labelKey: 'act.type', kind: 'choice', choices: [['UpdateRecord', 'act.update'], ['AddRecord', 'act.add']] },
        { key: 'table', labelKey: 'act.table', kind: 'table', emptyKey: 'list.currentTable' },
        { key: 'column', labelKey: 'act.column', kind: 'targetColumn', emptyKey: 'list.choose' },
        { key: 'value', labelKey: 'act.value', kind: 'text' },
      ],
    },
  };

  // Opérateurs d'une vérification de condition, avec la clé de traduction de leur libellé.
  const OPERATORS = [['eq', 'op.eq'], ['neq', 'op.neq'], ['gt', 'op.gt'], ['lt', 'op.lt'], ['contains', 'op.contains'], ['empty', 'op.empty'], ['notEmpty', 'op.notEmpty']];
  const needsValue = (check) => check.operator !== 'empty' && check.operator !== 'notEmpty';

  const api = { TYPES, OPERATORS, needsValue, ORDER: ['trigger', 'condition', 'action'] };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NodeTypes = api;
})(typeof window !== 'undefined' ? window : globalThis);
