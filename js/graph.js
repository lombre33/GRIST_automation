// Modèle du graphe d'automatisation : { version, active, nodes: [{ id, type, x, y, config }], edges: [{ from, to, branch? }] }.
// Logique pure (sans DOM). Un lien va toujours d'une sortie vers une entrée ; une entrée n'a qu'un lien ; pas de cycle.
// branch : sortie d'où part le lien, 'then' (par défaut, absent du JSON) ou 'else' (sortie « sinon » d'une condition).
(function (root) {
  'use strict';
  const Types = typeof module !== 'undefined' && module.exports ? require('./nodes.js') : root.NodeTypes;

  const VERSION = 3;

  function create() {
    return { version: VERSION, active: false, nodes: [], edges: [] };
  }

  function nodeById(graph, id) {
    return graph.nodes.find((node) => node.id === id);
  }

  function nextId(graph, type) {
    let n = 1;
    while (nodeById(graph, `${type}-${n}`)) n += 1;
    return `${type}-${n}`;
  }

  function addNode(graph, type, x, y) {
    if (!Types.TYPES[type]) throw new Error('Type de nœud inconnu : ' + type);
    const node = { id: nextId(graph, type), type, x: Math.round(x), y: Math.round(y), config: JSON.parse(JSON.stringify(Types.TYPES[type].defaults)) };
    graph.nodes.push(node);
    return node;
  }

  function removeNode(graph, id) {
    graph.nodes = graph.nodes.filter((node) => node.id !== id);
    graph.edges = graph.edges.filter((edge) => edge.from !== id && edge.to !== id);
  }

  function reaches(graph, from, target) {
    const seen = new Set();
    const stack = [from];
    while (stack.length) {
      const id = stack.pop();
      if (id === target) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const edge of graph.edges) if (edge.from === id) stack.push(edge.to);
    }
    return false;
  }

  // Retourne { ok: true } ou { ok: false, reason } ; relier une entrée déjà reliée remplace son lien.
  function connect(graph, from, to, branch) {
    const side = branch || 'then';
    const source = nodeById(graph, from);
    const target = nodeById(graph, to);
    if (!source || !target) return { ok: false, reason: 'unknown' };
    if (from === to) return { ok: false, reason: 'self' };
    if (!Types.TYPES[source.type].branches.includes(side)) return { ok: false, reason: 'no-output' };
    if (Types.TYPES[target.type].inputs < 1) return { ok: false, reason: 'no-input' };
    if (reaches(graph, to, from)) return { ok: false, reason: 'cycle' };
    graph.edges = graph.edges.filter((edge) => edge.to !== to);
    graph.edges.push(side === 'then' ? { from, to } : { from, to, branch: side });
    return { ok: true };
  }

  function disconnect(graph, from, to) {
    graph.edges = graph.edges.filter((edge) => !(edge.from === from && edge.to === to));
  }

  const blank = (value) => String(value).trim() === '';
  const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;   // nom d'une valeur {nom} donnée par une transformation ou une lecture

  // Ce que chaque type de nœud vérifie dans sa propre configuration : les clés `issue.*` des problèmes trouvés (false : rien à redire sur ce point).
  // currentTable : la table de la vue, si elle est connue (une mise à jour d'une autre table doit dire quelle ligne elle vise).
  const NODE_CHECKS = {
    trigger: (config) => [
      Boolean(config.targetColumn) && config.action !== 'update' && 'issue.triggerTarget',
      Boolean(config.targetColumn) && config.action === 'update' && blank(config.targetValue) && 'issue.triggerTargetValue',
    ],
    condition: (config) => [config.checks.some((check) => !check.column) && 'issue.conditionColumn'],
    transform: (config) => [(blank(config.a) || (!Types.UNARY.includes(config.op) && blank(config.b))) && 'issue.transformOperand'],
    lookup: (config) => [(!config.matchColumn || !config.column || blank(config.matchValue)) && 'issue.lookupIncomplete'],
    action: (config, currentTable) => {
      const update = config.type === 'UpdateRecord';
      const otherTable = Boolean(currentTable && config.table && config.table !== currentTable);
      return [
        !config.column && 'issue.actionColumn',
        update && !config.matchColumn && otherTable && 'issue.actionMatch',
        update && Boolean(config.matchColumn) && blank(config.matchValue) && 'issue.actionMatchValue',
      ];
    },
  };

  // Les valeurs {nom} des transformations et des lectures : chaque nom bien formé, et pris par un seul nœud.
  function nameIssues(graph) {
    const issues = [];
    const names = new Set();
    for (const node of graph.nodes.filter((candidate) => candidate.type === 'transform' || candidate.type === 'lookup')) {
      const { name } = node.config;
      if (!NAME.test(name) || names.has(name)) issues.push({ key: 'issue.transformName', node: node.id });
      names.add(name);
    }
    return issues;
  }

  // Problèmes qui empêchent d'activer : retourne une liste de { key, node } (clés de i18n `issue.*`), ceux du graphe entier d'abord, puis nœud par nœud.
  // context.currentTable (facultatif) : permet de repérer une mise à jour d'une autre table sans ligne cible.
  function validate(graph, context) {
    const currentTable = context && context.currentTable;
    const triggers = graph.nodes.filter((node) => node.type === 'trigger');
    const actions = graph.nodes.filter((node) => node.type === 'action');
    const issues = [];
    if (!triggers.length) issues.push({ key: 'issue.noTrigger' });
    if (!actions.length) issues.push({ key: 'issue.noAction' });
    for (const node of graph.nodes) {
      if (node.type !== 'trigger' && !graph.edges.some((edge) => edge.to === node.id)) issues.push({ key: 'issue.notConnected', node: node.id });
      for (const key of NODE_CHECKS[node.type](node.config, currentTable)) if (key) issues.push({ key, node: node.id });
    }
    issues.push(...nameIssues(graph));
    const reached = actions.some((action) => triggers.some((trigger) => reaches(graph, trigger.id, action.id)));
    if (triggers.length && actions.length && !reached) issues.push({ key: 'issue.noPath' });
    return issues;
  }

  // Version 2 -> 3 : la condition unique devient une liste de vérifications (ET), sans lien « sinon ».
  function migrate(saved) {
    if (saved.version !== 2) return saved;
    for (const node of saved.nodes) {
      if (node.type === 'condition' && node.config && !node.config.checks) {
        const { column, operator, value } = node.config;
        node.config = { join: 'and', checks: [{ column: column || '', operator: operator || 'eq', value: value === undefined ? '' : value }] };
      }
    }
    saved.version = VERSION;
    return saved;
  }

  // Lecture d'une configuration enregistrée : retourne un graphe valide ou null si illisible (version ou type de nœud inconnus, JSON abîmé).
  // Ce qui est inconnu dans un graphe lisible survit à l'enregistrement (règle 3 de GFS) : clés de la racine, attributs des nœuds, de leur config et des liens.
  function parse(text) {
    let saved;
    try { saved = JSON.parse(text); } catch (err) { return null; }
    if (!saved || (saved.version !== VERSION && saved.version !== 2) || !Array.isArray(saved.nodes) || !Array.isArray(saved.edges)) return null;
    if (!saved.nodes.every((node) => node && Types.TYPES[node.type] && typeof node.id === 'string' && node.config)) return null;
    saved = migrate(saved);
    const conditionsOk = saved.nodes.every((node) => node.type !== 'condition' || (Array.isArray(node.config.checks) && node.config.checks.length > 0));
    if (!conditionsOk) return null;
    // Un lien vers un nœud absent, ou depuis une sortie que le nœud n'a pas, est laissé de côté (ce n'est pas une raison de refuser tout le graphe).
    const edges = saved.edges.filter((edge) => nodeById(saved, edge.from) && nodeById(saved, edge.to) && Types.TYPES[nodeById(saved, edge.from).type].branches.includes(edge.branch || 'then'));
    const unknown = Object.fromEntries(Object.entries(saved).filter(([key]) => !['version', 'active', 'nodes', 'edges'].includes(key)));
    return { version: VERSION, active: Boolean(saved.active), nodes: saved.nodes, edges, ...unknown };
  }

  // Une étape du résumé, par type de nœud : ce que fait le nœud, avec ses colonnes et ses valeurs (— : pas encore choisi). t : la traduction.
  const DESCRIBE = {
    trigger: (config, t) => `${t('node.trigger')} : ${t('trigger.' + config.action)}${config.column ? ' (' + config.column + ')' : ''}`
      + (config.targetColumn ? ` ${t('sum.where')} ${config.targetColumn} = ${config.targetValue}` : ''),
    lookup: (config, t) => `${t('node.lookup')} : {${config.name}} = ${config.table || '—'}.${config.column || '—'} (${t('sum.where')} ${config.matchColumn || '—'} = ${config.matchValue})`,
    transform: (config, t) => `${t('node.transform')} : {${config.name}} = `
      + (Types.UNARY.includes(config.op) ? `${t('tf.' + config.op)} (${config.a})` : `${config.a} ${t('tf.' + config.op)} ${config.b}`),
    condition: (config, t) => {
      const checks = config.checks.map((check) => `${check.column || '—'} ${t('op.' + check.operator)}${Types.needsValue(check) && check.value !== '' ? ' ' + check.value : ''}`);
      return `${t('node.condition')} : ${checks.join(` ${t(config.join === 'or' ? 'sum.or' : 'sum.and')} `)}`;
    },
    action: (config, t) => {
      const update = config.type === 'UpdateRecord';
      return `${t('node.action')} : ${t(update ? 'act.update' : 'act.add')} ${config.table || '—'}.${config.column || '—'} = ${config.value}`
        + (update && config.matchColumn ? ` (${t('sum.where')} ${config.matchColumn} = ${config.matchValue})` : '');
    },
  };

  // Résumé lisible d'un graphe (champ « Resume » de la table des workflows), une ligne par chemin déclencheur -> action.
  // t : fonction de traduction (clé, paramètres) : le texte écrit dans le document suit la langue de l'interface.
  function summarize(graph, t) {
    const paths = [];
    const walk = (node, trail) => {
      const outgoing = graph.edges.filter((edge) => edge.from === node.id);
      const here = trail.concat(DESCRIBE[node.type](node.config, t));
      if (!outgoing.length) paths.push(here.join(' → '));
      for (const edge of outgoing) walk(nodeById(graph, edge.to), edge.branch === 'else' ? here.concat(t('branch.else')) : here);
    };
    graph.nodes.filter((node) => node.type === 'trigger').forEach((node) => walk(node, []));
    return paths.join('\n');
  }

  const api = { VERSION, create, summarize, nodeById, addNode, removeNode, connect, disconnect, validate, parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Graph = api;
})(typeof window !== 'undefined' ? window : globalThis);
