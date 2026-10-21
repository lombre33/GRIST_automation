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

  function parseValue(text) {
    return text !== '' && text !== null && text !== undefined && !isNaN(Number(text)) ? Number(text) : text;
  }

  function matchesTrigger(trigger, event) {
    if (!trigger || trigger.action !== event.type) return false;
    if (event.type === 'update' && trigger.column) {
      return Object.prototype.hasOwnProperty.call(event.changed, trigger.column);
    }
    return true;
  }

  function evalCondition(cond, event) {
    if (!cond || !cond.column) throw new Error('Condition incomplète : aucune colonne');
    const op = OPERATORS[cond.operator];
    if (!op) throw new Error('Opérateur inconnu : ' + cond.operator);
    if (!event.record) throw new Error('Condition impossible sans contenu de ligne');
    return op(event.record[cond.column], parseValue(cond.value));
  }

  // Toutes les vérifications d'un nœud condition, reliées par ET (défaut) ou OU.
  function evalChecks(config, event) {
    const checks = config && config.checks;
    if (!checks || !checks.length) throw new Error('Condition incomplète : aucune vérification');
    const run = (check) => evalCondition(check, event);
    return config.join === 'or' ? checks.some(run) : checks.every(run);
  }

  // Écriture prévue par un nœud action, sans l'exécuter (utilisée par le dry-run).
  function planAction(config, event, currentTable) {
    if (!config.column) throw new Error('Action incomplète : aucune colonne');
    const values = { [config.column]: parseValue(config.value) };
    const table = config.table || currentTable;
    if (config.type === 'UpdateRecord') return { type: 'UpdateRecord', table, rowId: event.rowId, values };
    if (config.type === 'AddRecord') return { type: 'AddRecord', table, values };
    throw new Error('Action inconnue : ' + config.type);
  }

  function toUserAction(plan) {
    return plan.type === 'UpdateRecord'
      ? ['UpdateRecord', plan.table, plan.rowId, plan.values]
      : ['AddRecord', plan.table, null, plan.values];
  }

  // Parcourt le graphe depuis un déclencheur. Une condition suit sa sortie « oui » quand elle est vraie, sa sortie « sinon » sinon.
  // trace : état de chaque nœud atteint ('passed', 'else', 'blocked', 'action'), pour l'affichage du dry-run.
  // 'blocked' : condition fausse sans lien « sinon » ; 'else' : condition fausse, la branche « sinon » est suivie.
  function walk(graph, node, event, currentTable, trace, plan, branch) {
    for (const edge of graph.edges) {
      if (edge.from !== node.id || (edge.branch || 'then') !== (branch || 'then')) continue;
      const next = graph.nodes.find((candidate) => candidate.id === edge.to);
      if (next.type === 'condition') {
        const passed = evalChecks(next.config, event);
        const hasElse = graph.edges.some((other) => other.from === next.id && other.branch === 'else');
        trace[next.id] = passed ? 'passed' : (hasElse ? 'else' : 'blocked');
        walk(graph, next, event, currentTable, trace, plan, passed ? 'then' : 'else');
      } else if (next.type === 'action') {
        plan.push(planAction(next.config, event, currentTable));
        trace[next.id] = 'action';
      } else {
        throw new Error('Nœud inattendu : ' + next.type);
      }
    }
  }

  // Exécute le graphe pour un événement. api.applyUserActions(actions) -> Promise.
  // opts.dryRun : retourne les effets attendus sans écrire. opts.currentTable : table de la vue.
  async function runWorkflow(graph, event, api, opts) {
    const options = opts || {};
    const dryRun = Boolean(options.dryRun);
    const result = { event: event.type, rowId: event.rowId, dryRun, status: 'skipped', effects: [], trace: {} };
    try {
      if (!graph.active && !dryRun) return result;
      const triggers = graph.nodes.filter((node) => node.type === 'trigger' && matchesTrigger(node.config, event));
      if (!triggers.length) return result;
      for (const trigger of triggers) {
        result.trace[trigger.id] = 'passed';
        walk(graph, trigger, event, options.currentTable, result.trace, result.effects);
      }
      if (!result.effects.length) {
        result.status = 'condition-false';
        return result;
      }
      if (!dryRun) {
        if (options.beforeApply) options.beforeApply(result.effects);
        await api.applyUserActions(result.effects.map(toUserAction));
      }
      result.status = 'success';
    } catch (err) {
      result.status = 'error';
      result.error = err && err.message ? err.message : String(err);
    }
    return result;
  }

  const api = { diff, matchesTrigger, evalCondition, evalChecks, planAction, runWorkflow, parseValue, OPERATORS };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.AutomationEngine = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
