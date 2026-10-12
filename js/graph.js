// Modèle du graphe d'automatisation : { version, active, nodes: [{ id, type, x, y, config }], edges: [{ from, to }] }.
// Logique pure (sans DOM). Un lien va toujours d'une sortie vers une entrée ; une entrée n'a qu'un lien ; pas de cycle.
(function (root) {
  'use strict';
  const Types = typeof module !== 'undefined' && module.exports ? require('./nodes.js') : root.NodeTypes;

  const VERSION = 2;

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
    const node = { id: nextId(graph, type), type, x: Math.round(x), y: Math.round(y), config: Object.assign({}, Types.TYPES[type].defaults) };
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
  function connect(graph, from, to) {
    const source = nodeById(graph, from);
    const target = nodeById(graph, to);
    if (!source || !target) return { ok: false, reason: 'unknown' };
    if (from === to) return { ok: false, reason: 'self' };
    if (Types.TYPES[source.type].outputs < 1) return { ok: false, reason: 'no-output' };
    if (Types.TYPES[target.type].inputs < 1) return { ok: false, reason: 'no-input' };
    if (reaches(graph, to, from)) return { ok: false, reason: 'cycle' };
    graph.edges = graph.edges.filter((edge) => edge.to !== to);
    graph.edges.push({ from, to });
    return { ok: true };
  }

  function disconnect(graph, from, to) {
    graph.edges = graph.edges.filter((edge) => !(edge.from === from && edge.to === to));
  }

  // Problèmes qui empêchent d'activer : retourne une liste de { key, node } (clés de i18n `issue.*`).
  function validate(graph) {
    const issues = [];
    const triggers = graph.nodes.filter((node) => node.type === 'trigger');
    if (!triggers.length) issues.push({ key: 'issue.noTrigger' });
    if (!graph.nodes.some((node) => node.type === 'action')) issues.push({ key: 'issue.noAction' });
    for (const node of graph.nodes) {
      if (node.type !== 'trigger' && !graph.edges.some((edge) => edge.to === node.id)) issues.push({ key: 'issue.notConnected', node: node.id });
      if (node.type === 'condition' && !node.config.column) issues.push({ key: 'issue.conditionColumn', node: node.id });
      if (node.type === 'action' && !node.config.column) issues.push({ key: 'issue.actionColumn', node: node.id });
    }
    if (triggers.length && !graph.nodes.some((node) => node.type === 'action' && triggers.some((t) => reaches(graph, t.id, node.id)))) {
      if (graph.nodes.some((node) => node.type === 'action')) issues.push({ key: 'issue.noPath' });
    }
    return issues;
  }

  // Lecture d'une configuration enregistrée : retourne un graphe valide ou null si illisible.
  function parse(text) {
    let data;
    try { data = JSON.parse(text); } catch (err) { return null; }
    if (!data || data.version !== VERSION || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) return null;
    if (!data.nodes.every((node) => node && Types.TYPES[node.type] && typeof node.id === 'string' && node.config)) return null;
    return { version: VERSION, active: Boolean(data.active), nodes: data.nodes, edges: data.edges.filter((edge) => nodeById(data, edge.from) && nodeById(data, edge.to)) };
  }

  const api = { VERSION, create, nodeById, addNode, removeNode, connect, disconnect, validate, parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Graph = api;
})(typeof window !== 'undefined' ? window : globalThis);
