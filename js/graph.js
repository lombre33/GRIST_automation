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

  // Problèmes qui empêchent d'activer : retourne une liste de { key, node } (clés de i18n `issue.*`).
  // context.currentTable (facultatif) : permet de repérer une mise à jour d'une autre table sans ligne cible.
  function validate(graph, context) {
    const currentTable = context && context.currentTable;
    const issues = [];
    const triggers = graph.nodes.filter((node) => node.type === 'trigger');
    if (!triggers.length) issues.push({ key: 'issue.noTrigger' });
    if (!graph.nodes.some((node) => node.type === 'action')) issues.push({ key: 'issue.noAction' });
    for (const node of graph.nodes) {
      if (node.type !== 'trigger' && !graph.edges.some((edge) => edge.to === node.id)) issues.push({ key: 'issue.notConnected', node: node.id });
      if (node.type === 'condition' && node.config.checks.some((check) => !check.column)) issues.push({ key: 'issue.conditionColumn', node: node.id });
      if (node.type === 'action' && !node.config.column) issues.push({ key: 'issue.actionColumn', node: node.id });
      if (node.type === 'action' && node.config.type === 'UpdateRecord') {
        const { table, matchColumn, matchValue } = node.config;
        if (!matchColumn && currentTable && table && table !== currentTable) issues.push({ key: 'issue.actionMatch', node: node.id });
        if (matchColumn && String(matchValue).trim() === '') issues.push({ key: 'issue.actionMatchValue', node: node.id });
      }
    }
    const names = new Set();
    for (const node of graph.nodes.filter((candidate) => candidate.type === 'transform')) {
      const { name, op, a, b } = node.config;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || names.has(name)) issues.push({ key: 'issue.transformName', node: node.id });
      names.add(name);
      if (String(a).trim() === '' || (!Types.UNARY.includes(op) && String(b).trim() === '')) issues.push({ key: 'issue.transformOperand', node: node.id });
    }
    if (triggers.length && !graph.nodes.some((node) => node.type === 'action' && triggers.some((t) => reaches(graph, t.id, node.id)))) {
      if (graph.nodes.some((node) => node.type === 'action')) issues.push({ key: 'issue.noPath' });
    }
    return issues;
  }

  // Version 2 -> 3 : la condition unique devient une liste de vérifications (ET), sans lien « sinon ».
  function migrate(data) {
    if (data.version !== 2) return data;
    for (const node of data.nodes) {
      if (node.type === 'condition' && node.config && !node.config.checks) {
        const { column, operator, value } = node.config;
        node.config = { join: 'and', checks: [{ column: column || '', operator: operator || 'eq', value: value === undefined ? '' : value }] };
      }
    }
    data.version = VERSION;
    return data;
  }

  // Lecture d'une configuration enregistrée : retourne un graphe valide ou null si illisible.
  function parse(text) {
    let data;
    try { data = JSON.parse(text); } catch (err) { return null; }
    if (!data || (data.version !== VERSION && data.version !== 2) || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) return null;
    if (!data.nodes.every((node) => node && Types.TYPES[node.type] && typeof node.id === 'string' && node.config)) return null;
    data = migrate(data);
    const conditionsOk = data.nodes.every((node) => node.type !== 'condition' || (Array.isArray(node.config.checks) && node.config.checks.length > 0));
    if (!conditionsOk) return null;
    const edges = data.edges.filter((edge) => nodeById(data, edge.from) && nodeById(data, edge.to) && Types.TYPES[nodeById(data, edge.from).type].branches.includes(edge.branch || 'then'));
    return { version: VERSION, active: Boolean(data.active), nodes: data.nodes, edges };
  }

  // Résumé lisible d'un graphe (champ « Resume » de la table des workflows), une ligne par chemin déclencheur -> action.
  // t : fonction de traduction (clé, paramètres) : le texte écrit dans le document suit la langue de l'interface.
  function summarize(graph, t) {
    const describe = (node) => {
      const c = node.config;
      if (node.type === 'trigger') return `${t('node.trigger')} : ${t('trigger.' + c.action)}${c.column ? ' (' + c.column + ')' : ''}`;
      if (node.type === 'transform') return `${t('node.transform')} : {${c.name}} = ${Types.UNARY.includes(c.op) ? `${t('tf.' + c.op)} (${c.a})` : `${c.a} ${t('tf.' + c.op)} ${c.b}`}`;
      if (node.type === 'condition') {
        const checks = c.checks.map((check) => `${check.column || '—'} ${t('op.' + check.operator)}${Types.needsValue(check) && check.value !== '' ? ' ' + check.value : ''}`);
        return `${t('node.condition')} : ${checks.join(` ${t(c.join === 'or' ? 'sum.or' : 'sum.and')} `)}`;
      }
      return `${t('node.action')} : ${t(c.type === 'UpdateRecord' ? 'act.update' : 'act.add')} ${c.table || '—'}.${c.column || '—'} = ${c.value}${c.type === 'UpdateRecord' && c.matchColumn ? ` (${t('sum.where')} ${c.matchColumn} = ${c.matchValue})` : ''}`;
    };
    const paths = [];
    const walk = (node, trail) => {
      const outgoing = graph.edges.filter((edge) => edge.from === node.id);
      const here = trail.concat(describe(node));
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
