// Moteur du widget : logique pure, sans DOM ni accès à grist.*.
// Chargé comme script classique dans le navigateur (global AutomationEngine)
// et comme module CommonJS sous Node pour les tests.
(function (root) {
  'use strict';

  const looselyEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b) || (typeof a !== 'object' && typeof b !== 'object' && a !== null && b !== null && a !== undefined && b !== undefined && String(a) === String(b));

  // Une valeur de colonne (a) se compare comme elle est rangée : un texte ou une case au texte tapé (text), un nombre ou une liste à la valeur
  // saisie, lue comme un nombre si elle en a l'air (value). Ainsi un texte « 01000 » vaut 01000 tapé (qui se lirait sinon 1000), une case vaut
  // true ou false. Sert aux conditions, à la ligne précise du déclencheur et aux colonnes clés ; « supérieur » et « inférieur » restent sans coercition (COND-05).
  const matches = (a, value, text) => (typeof a === 'string' || typeof a === 'boolean' ? String(a) === text : looselyEqual(a, value));

  const OPERATORS = {
    eq: (a, b, text) => matches(a, b, text),
    neq: (a, b, text) => !matches(a, b, text),
    gt: (a, b) => typeof a === 'number' && typeof b === 'number' && a > b,
    lt: (a, b) => typeof a === 'number' && typeof b === 'number' && a < b,
    contains: (a, b, text) => typeof a === 'string' && a.includes(text),
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

  // Un texte qui se lit comme un nombre fini devient ce nombre ; « Infinity » ou « 1e999 » restent des textes (un nombre infini serait écrit vide : JSON n'en a pas).
  function parseValue(text) {
    return text !== '' && text !== null && text !== undefined && Number.isFinite(Number(text)) ? Number(text) : text;
  }

  // Cible optionnelle (modification seulement) : la ligne modifiée doit avoir targetValue dans la colonne targetColumn.
  function matchesTrigger(trigger, event) {
    if (!trigger || trigger.action !== event.type) return false;
    if (trigger.targetColumn && (event.type !== 'update' || !event.record || !matches(event.record[trigger.targetColumn], parseValue(trigger.targetValue), display(trigger.targetValue)))) return false;
    if (event.type === 'update' && trigger.column) {
      return Object.prototype.hasOwnProperty.call(event.changed, trigger.column);
    }
    return true;
  }

  function evalCondition(cond, event, vars) {
    if (!cond || !cond.column) throw new Error('Condition incomplète : aucune colonne');
    const op = OPERATORS[cond.operator];
    if (!op) throw new Error('Opérateur inconnu : ' + cond.operator);
    if (!event.record) throw new Error('Condition impossible sans contenu de ligne');
    return op(event.record[cond.column], resolveTemplate(cond.value, event, vars || {}), resolveTemplate(cond.value, event, vars || {}, true));
  }

  // Valeurs {Colonne} d'un texte : colonnes de la ligne ou variables des nœuds Transformation (qui priment). {{ et }} donnent des accolades littérales.
  // Un texte réduit à une seule valeur garde son type d'origine ; sinon le texte assemblé passe par parseValue, comme une valeur saisie.
  // asText : le texte tel qu'il s'affiche, sans lecture comme un nombre (comparaisons, colonnes clés).
  const display = (value) => (value === null || value === undefined ? '' : Array.isArray(value) ? value.join(', ') : String(value));

  function resolveTemplate(text, event, vars, asText) {
    const source = display(text);
    const lookup = (name) => {
      if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
      if (!event.record) throw new Error('Valeur {' + name + '} indisponible : pas de contenu de ligne');
      if (!Object.prototype.hasOwnProperty.call(event.record, name)) throw new Error('Valeur inconnue : {' + name + '}');
      return event.record[name];
    };
    const whole = /^\{([^{}]+)\}$/.exec(source);
    if (whole) return asText ? display(lookup(whole[1])) : lookup(whole[1]);
    const assembled = source.replace(/\{\{|\}\}|\{([^{}]+)\}/g, (match, name) => (match === '{{' ? '{' : match === '}}' ? '}' : display(lookup(name))));
    return asText ? assembled : parseValue(assembled);
  }

  function toNumber(value) {
    const number = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
    if (!Number.isFinite(number)) throw new Error('Valeur non numérique : « ' + display(value) + ' »');
    return number;
  }

  // 0.1 + 0.2 donne 0.3 ; un résultat trop grand pour un nombre (1e308 × 10) est une erreur, pas une cellule vide.
  const round = (number) => {
    if (!Number.isFinite(number)) throw new Error('Résultat hors limites');
    return Number(number.toFixed(10));
  };

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
  function evalChecks(config, event, vars) {
    const checks = config && config.checks;
    if (!checks || !checks.length) throw new Error('Condition incomplète : aucune vérification');
    const run = (check) => evalCondition(check, event, vars);
    return config.join === 'or' ? checks.some(run) : checks.every(run);
  }

  // Écriture prévue par un nœud action, sans l'exécuter (utilisée par le dry-run).
  function planAction(config, event, currentTable, vars) {
    if (!config.column) throw new Error('Action incomplète : aucune colonne');
    const values = { [config.column]: resolveTemplate(config.value, event, vars || {}) };
    const table = config.table || currentTable;
    if (config.type === 'UpdateRecord' && config.matchColumn) {
      // Ligne repérée par une colonne clé : l'identifiant est cherché dans la table avant l'écriture (resolveTargets).
      const match = { column: config.matchColumn, value: resolveTemplate(config.matchValue, event, vars || {}) };
      // Le texte tel que tapé sert à la recherche (un texte « 01000 ») sans s'ajouter à ce que le journal montre de l'écriture prévue.
      Object.defineProperty(match, 'text', { value: resolveTemplate(config.matchValue, event, vars || {}, true) });
      return { type: 'UpdateRecord', table, rowId: null, values, match };
    }
    if (config.type === 'UpdateRecord') {
      if (table !== currentTable) throw new Error('Mise à jour d\'une autre table : indiquez la colonne qui repère la ligne');
      return { type: 'UpdateRecord', table, rowId: event.rowId, values };
    }
    if (config.type === 'AddRecord') return { type: 'AddRecord', table, values };
    throw new Error('Action inconnue : ' + config.type);
  }


  // Lecture d'une table (une seule fois par exécution) et recherche de l'unique ligne dont `column` vaut `value`.
  async function readTable(ctx, table) {
    if (!ctx.api.fetchTable) throw new Error('Lecture de la table impossible');
    if (!ctx.tables.has(table)) ctx.tables.set(table, await ctx.api.fetchTable(table));
    return ctx.tables.get(table);
  }

  function findRows(data, table, column, value, text) {
    if (!Object.prototype.hasOwnProperty.call(data, column)) throw new Error('Colonne inconnue dans ' + table + ' : ' + column);
    return (data.id || []).map((id, index) => index).filter((index) => matches(data[column][index], value, text));
  }

  function findOne(data, table, column, value, text) {
    const found = findRows(data, table, column, value, text);
    if (found.length === 0) throw new Error('Ligne introuvable dans ' + table + ' : ' + column + ' = ' + display(value));
    if (found.length > 1) throw new Error('Plusieurs lignes dans ' + table + ' pour ' + column + ' = ' + display(value));
    return found[0];
  }

  // Cherche l'identifiant des lignes repérées par une clé (lecture seule, aussi en test à blanc).
  async function resolveTargets(effects, ctx) {
    for (const effect of effects) {
      if (!effect.match) continue;
      const columns = await readTable(ctx, effect.table);
      effect.rowId = columns.id[findOne(columns, effect.table, effect.match.column, effect.match.value, effect.match.text)];
    }
  }

  // Valeur lue par un nœud Lecture : une cellule d'une autre table, repérée par une clé.
  async function applyLookup(config, event, vars, currentTable, ctx) {
    const table = config.table || currentTable;
    const columns = await readTable(ctx, table);
    const key = resolveTemplate(config.matchValue, event, vars);
    const text = resolveTemplate(config.matchValue, event, vars, true);
    const found = findRows(columns, table, config.matchColumn, key, text);
    if (found.length === 0 && config.onMissing === 'empty') return '';
    const index = findOne(columns, table, config.matchColumn, key, text);
    if (!Object.prototype.hasOwnProperty.call(columns, config.column)) throw new Error('Colonne inconnue dans ' + table + ' : ' + config.column);
    return columns[config.column][index];
  }

  function toUserAction(plan) {
    return plan.type === 'UpdateRecord'
      ? ['UpdateRecord', plan.table, plan.rowId, plan.values]
      : ['AddRecord', plan.table, null, plan.values];
  }

  // Parcourt le graphe depuis un déclencheur. Une condition suit sa sortie « oui » quand elle est vraie, sa sortie « sinon » sinon.
  // trace : état de chaque nœud atteint ('passed', 'else', 'blocked', 'action'), pour l'affichage du dry-run.
  // 'blocked' : condition fausse sans lien « sinon » ; 'else' : condition fausse, la branche « sinon » est suivie.
  // ctx : { api, tables, currentTable, trace, plan } ; vars : variables des nœuds Lecture et Transformation en amont.
  async function walk(graph, node, event, ctx, branch, vars) {
    for (const edge of graph.edges) {
      if (edge.from !== node.id || (edge.branch || 'then') !== (branch || 'then')) continue;
      const next = graph.nodes.find((candidate) => candidate.id === edge.to);
      if (next.type === 'condition') {
        const passed = evalChecks(next.config, event, vars);
        const hasElse = graph.edges.some((other) => other.from === next.id && other.branch === 'else');
        ctx.trace[next.id] = passed ? 'passed' : (hasElse ? 'else' : 'blocked');
        await walk(graph, next, event, ctx, passed ? 'then' : 'else', vars);
      } else if (next.type === 'transform') {
        ctx.trace[next.id] = 'passed';
        await walk(graph, next, event, ctx, 'then', Object.assign({}, vars, { [next.config.name]: applyTransform(next.config, event, vars) }));
      } else if (next.type === 'lookup') {
        ctx.trace[next.id] = 'passed';
        await walk(graph, next, event, ctx, 'then', Object.assign({}, vars, { [next.config.name]: await applyLookup(next.config, event, vars, ctx.currentTable, ctx) }));
      } else if (next.type === 'action') {
        ctx.plan.push(planAction(next.config, event, ctx.currentTable, vars));
        ctx.trace[next.id] = 'action';
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
      const ctx = { api, tables: new Map(), currentTable: options.currentTable, trace: result.trace, plan: result.effects };
      for (const trigger of triggers) {
        result.trace[trigger.id] = 'passed';
        await walk(graph, trigger, event, ctx, 'then', {});
      }
      if (!result.effects.length) {
        result.status = 'condition-false';
        return result;
      }
      await resolveTargets(result.effects, ctx);
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
