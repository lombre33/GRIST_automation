// Types de nœuds : ce que chacun porte (champs, valeurs par défaut) et ses broches. Données pures, partagées par le graphe, le moteur et le canevas.
// kind des champs : 'choice' (liste fixe), 'column' (colonne de la table courante), 'table' (table du document),
// 'targetColumn' (colonne de la table cible du nœud), 'text' (saisie libre).
(function (root) {
  'use strict';

  const TYPES = {
    trigger: {
      titleKey: 'node.trigger',
      inputs: 0,
      outputs: 1,
      defaults: { action: 'update', column: '' },
      fields: [
        { key: 'action', labelKey: 'trigger.when', kind: 'choice', choices: [['update', 'trigger.update'], ['create', 'trigger.create'], ['delete', 'trigger.delete']] },
        { key: 'column', labelKey: 'trigger.column', kind: 'column', emptyKey: 'list.none' },
      ],
    },
    condition: {
      titleKey: 'node.condition',
      inputs: 1,
      outputs: 1,
      defaults: { column: '', operator: 'eq', value: '' },
      fields: [
        { key: 'column', labelKey: 'cond.column', kind: 'column', emptyKey: 'list.choose' },
        { key: 'operator', labelKey: 'cond.operator', kind: 'choice', choices: [['eq', 'op.eq'], ['neq', 'op.neq'], ['gt', 'op.gt'], ['lt', 'op.lt'], ['contains', 'op.contains'], ['empty', 'op.empty'], ['notEmpty', 'op.notEmpty']] },
        { key: 'value', labelKey: 'cond.value', kind: 'text', disabledWhen: (config) => config.operator === 'empty' || config.operator === 'notEmpty' },
      ],
    },
    action: {
      titleKey: 'node.action',
      inputs: 1,
      outputs: 0,
      defaults: { type: 'UpdateRecord', table: '', column: '', value: '' },
      fields: [
        { key: 'type', labelKey: 'act.type', kind: 'choice', choices: [['UpdateRecord', 'act.update'], ['AddRecord', 'act.add']] },
        { key: 'table', labelKey: 'act.table', kind: 'table', emptyKey: 'list.currentTable' },
        { key: 'column', labelKey: 'act.column', kind: 'targetColumn', emptyKey: 'list.choose' },
        { key: 'value', labelKey: 'act.value', kind: 'text' },
      ],
    },
  };

  const api = { TYPES, ORDER: ['trigger', 'condition', 'action'] };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NodeTypes = api;
})(typeof window !== 'undefined' ? window : globalThis);
