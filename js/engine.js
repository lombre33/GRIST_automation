// Moteur du widget : logique pure, sans DOM ni accès à grist.*.
// Chargé comme script classique dans le navigateur (global AutomationEngine)
// et comme module CommonJS sous Node pour les tests.
(function (root) {
  'use strict';

  const OPERATORS = {
    eq: (a, b) => a === b,
    neq: (a, b) => a !== b,
    gt: (a, b) => typeof a === 'number' && typeof b === 'number' && a > b,
    lt: (a, b) => typeof a === 'number' && typeof b === 'number' && a < b,
    contains: (a, b) => typeof a === 'string' && typeof b === 'string' && a.includes(b),
    empty: (a) => a === null || a === undefined || a === '',
    notEmpty: (a) => !(a === null || a === undefined || a === ''),
  };

  function snapshot(records) {
    const map = new Map();
    for (const rec of records) {
      map.set(rec.id, Object.assign({}, rec));
    }
    return map;
  }

  function sameValue(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  // Compare le cache précédent (Map) aux enregistrements courants.
  // Retourne { events, next }. Si prev est null : premier chargement, aucun événement.
  function diff(prev, records) {
    const next = snapshot(records);
    if (prev === null) {
      return { events: [], next };
    }
    const events = [];
    for (const [id, rec] of next) {
      const old = prev.get(id);
      if (!old) {
        events.push({ type: 'create', rowId: id, record: rec });
        continue;
      }
      const changed = {};
      for (const key of Object.keys(rec)) {
        if (!sameValue(rec[key], old[key])) {
          changed[key] = { from: old[key], to: rec[key] };
        }
      }
      if (Object.keys(changed).length > 0) {
        events.push({ type: 'update', rowId: id, record: rec, changed });
      }
    }
    for (const id of prev.keys()) {
      if (!next.has(id)) {
        events.push({ type: 'delete', rowId: id });
      }
    }
    return { events, next };
  }

  function matchesTrigger(trigger, event) {
    if (!trigger || trigger.action !== event.type) return false;
    if (event.type === 'update' && trigger.column) {
      return Object.prototype.hasOwnProperty.call(event.changed, trigger.column);
    }
    return true;
  }

  function evalCondition(cond, event) {
    if (!cond) return true;
    const op = OPERATORS[cond.operator];
    if (!op) throw new Error('Opérateur inconnu : ' + cond.operator);
    if (!event.record) throw new Error('Condition impossible sans contenu de ligne');
    return op(event.record[cond.column], cond.value);
  }

  // Construit la liste des écritures sans les exécuter (utilisée par le dry-run).
  function planActions(workflow, event) {
    return workflow.actions.map((act) => {
      if (act.type === 'UpdateRecord') {
        return { type: 'UpdateRecord', table: act.table, rowId: event.rowId, values: Object.assign({}, act.values) };
      }
      if (act.type === 'AddRecord') {
        return { type: 'AddRecord', table: act.table, values: Object.assign({}, act.values) };
      }
      throw new Error('Action inconnue : ' + act.type);
    });
  }

  function toUserAction(plan) {
    return plan.type === 'UpdateRecord'
      ? ['UpdateRecord', plan.table, plan.rowId, plan.values]
      : ['AddRecord', plan.table, null, plan.values];
  }

  // Exécute un workflow pour un événement. api.applyUserActions(actions) -> Promise.
  // dryRun : retourne les effets attendus sans écrire.
  async function runWorkflow(workflow, event, api, opts) {
    const dryRun = Boolean(opts && opts.dryRun);
    const result = { workflow: workflow.name, event: event.type, rowId: event.rowId, dryRun, status: 'skipped', effects: [] };
    try {
      if (!workflow.active && !dryRun) return result;
      if (!matchesTrigger(workflow.trigger, event)) return result;
      if (!evalCondition(workflow.condition, event)) {
        result.status = 'condition-false';
        return result;
      }
      const plan = planActions(workflow, event);
      result.effects = plan;
      if (!dryRun) {
        await api.applyUserActions(plan.map(toUserAction));
      }
      result.status = 'success';
    } catch (err) {
      result.status = 'error';
      result.error = err && err.message ? err.message : String(err);
    }
    return result;
  }

  const api = { diff, matchesTrigger, evalCondition, planActions, runWorkflow, OPERATORS };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.AutomationEngine = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
