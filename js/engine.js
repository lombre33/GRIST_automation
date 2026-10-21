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

  // Valeurs {Colonne} d'un texte : colonnes de la ligne ou variables des nœuds Transformation (qui priment). {{ et }} donnent des accolades littérales.
  // Un texte réduit à une seule valeur garde son type d'origine ; sinon le texte assemblé passe par parseValue, comme une valeur saisie.
  const display = (value) => (value === null || value === undefined ? '' : Array.isArray(value) ? value.join(', ') : String(value));

  function resolveTemplate(text, event, vars) {
    const source = display(text);
    const lookup = (name) => {
      if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
      if (!event.record) throw new Error('Valeur {' + name + '} indisponible : pas de contenu de ligne');
      if (!Object.prototype.hasOwnProperty.call(event.record, name)) throw new Error('Valeur inconnue : {' + name + '}');
      return event.record[name];
    };
    const whole = /^\{([^{}]+)\}$/.exec(source);
    if (whole) return lookup(whole[1]);
    return parseValue(source.replace(/\{\{|\}\}|\{([^{}]+)\}/g, (match, name) => (match === '{{' ? '{' : match === '}}' ? '}' : display(lookup(name)))));
  }

  function toNumber(value) {
    const number = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
    if (Number.isNaN(number)) throw new Error('Valeur non numérique : « ' + display(value) + ' »');
    return number;
  }

  const round = (number) => Number(number.toFixed(10));   // 0.1 + 0.2 donne 0.3

  const TRANSFORMS = {
    concat: (a, b) => display(a) + display(b),
    add: (a, b) => round(toNumber(a) + toNumber(b)),
    sub: (a, b) => round(toNumber(a) - toNumber(b)),
    mul: (a, b) => round(toNumber(a) * toNumber(b)),
    div: (a, b) => {
      if (toNumber(b) === 0) throw new Error('Division par zéro');
      return round(toNumber(a) / toNumber(b));
    },
    upper: (a) => display(a).toUpperCase(),
    lower: (a) => display(a).toLowerCase(),
    trim: (a) => display(a).trim(),
  };

  // Valeur calculée par un nœud Transformation.
  function applyTransform(config, event, vars) {
    const op = TRANSFORMS[config.op];
    if (!op) throw new Error('Transformation inconnue : ' + config.op);
    return op(resolveTemplate(config.a, event, vars), resolveTemplate(config.b, event, vars));
  }

  // Toutes les vérifications d'un nœud condition, reliées par ET (défaut) ou OU.
  function evalChecks(config, event) {
    const checks = config && config.checks;
    if (!checks || !checks.length) throw new Error('Condition incomplète : aucune vérification');
    const run = (check) => evalCondition(check, event);
    return config.join === 'or' ? checks.some(run) : checks.every(run);
  }

  // Écriture prévue par un nœud action, sans l'exécuter (utilisée par le dry-run).
  function planAction(config, event, currentTable, vars) {
    if (!config.column) throw new Error('Action incomplète : aucune colonne');
    const values = { [config.column]: resolveTemplate(config.value, event, vars || {}) };
    const table = config.table || currentTable;
    if (config.type === 'UpdateRecord' && config.matchColumn) {
      // Ligne repérée par une colonne clé : l'identifiant est cherché dans la table avant l'écriture (resolveTargets).
      const matchValue = resolveTemplate(config.matchValue, event, vars || {});
      return { type: 'UpdateRecord', table, rowId: null, values, match: { column: config.matchColumn, value: matchValue } };
    }
    if (config.type === 'UpdateRecord') {
      if (table !== currentTable) throw new Error('Mise à jour d\'une autre table : indiquez la colonne qui repère la ligne');
      return { type: 'UpdateRecord', table, rowId: event.rowId, values };
    }
    if (config.type === 'AddRecord') return { type: 'AddRecord', table, values };
    throw new Error('Action inconnue : ' + config.type);
  }

  const looselyEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b) || (typeof a !== 'object' && typeof b !== 'object' && a !== null && b !== null && a !== undefined && b !== undefined && String(a) === String(b));

  // Cherche l'identifiant des lignes repérées par une clé (lecture seule, aussi en test à blanc) : exactement une ligne attendue.
  async function resolveTargets(effects, api) {
    const tables = new Map();
    for (const effect of effects) {
      if (!effect.match) continue;
      const { column, value } = effect.match;
      if (!api.fetchTable) throw new Error('Lecture de la table impossible');
      if (!tables.has(effect.table)) tables.set(effect.table, await api.fetchTable(effect.table));
      const data = tables.get(effect.table);
      if (!Object.prototype.hasOwnProperty.call(data, column)) throw new Error('Colonne inconnue dans ' + effect.table + ' : ' + column);
      const ids = (data.id || []).filter((id, index) => looselyEqual(data[column][index], value));
      if (ids.length === 0) throw new Error('Ligne introuvable dans ' + effect.table + ' : ' + column + ' = ' + display(value));
      if (ids.length > 1) throw new Error('Plusieurs lignes dans ' + effect.table + ' pour ' + column + ' = ' + display(value));
      effect.rowId = ids[0];
    }
  }

  function toUserAction(plan) {
    return plan.type === 'UpdateRecord'
      ? ['UpdateRecord', plan.table, plan.rowId, plan.values]
      : ['AddRecord', plan.table, null, plan.values];
  }

  // Parcourt le graphe depuis un déclencheur. Une condition suit sa sortie « oui » quand elle est vraie, sa sortie « sinon » sinon.
  // trace : état de chaque nœud atteint ('passed', 'else', 'blocked', 'action'), pour l'affichage du dry-run.
  // 'blocked' : condition fausse sans lien « sinon » ; 'else' : condition fausse, la branche « sinon » est suivie.
  function walk(graph, node, event, currentTable, trace, plan, branch, vars) {
    for (const edge of graph.edges) {
      if (edge.from !== node.id || (edge.branch || 'then') !== (branch || 'then')) continue;
      const next = graph.nodes.find((candidate) => candidate.id === edge.to);
      if (next.type === 'condition') {
        const passed = evalChecks(next.config, event);
        const hasElse = graph.edges.some((other) => other.from === next.id && other.branch === 'else');
        trace[next.id] = passed ? 'passed' : (hasElse ? 'else' : 'blocked');
        walk(graph, next, event, currentTable, trace, plan, passed ? 'then' : 'else', vars);
      } else if (next.type === 'transform') {
        trace[next.id] = 'passed';
        walk(graph, next, event, currentTable, trace, plan, 'then', Object.assign({}, vars, { [next.config.name]: applyTransform(next.config, event, vars) }));
      } else if (next.type === 'action') {
        plan.push(planAction(next.config, event, currentTable, vars));
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
        walk(graph, trigger, event, options.currentTable, result.trace, result.effects, 'then', {});
      }
      if (!result.effects.length) {
        result.status = 'condition-false';
        return result;
      }
      await resolveTargets(result.effects, api);
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

  const api = { diff, matchesTrigger, evalCondition, evalChecks, resolveTemplate, applyTransform, planAction, runWorkflow, parseValue, OPERATORS };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.AutomationEngine = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
