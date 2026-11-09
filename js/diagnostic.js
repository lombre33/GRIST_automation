// Diagnostic : le texte qu'une personne copie pour demander de l'aide (forum, assistance) : la version, l'état du widget, le workflow, les tables et colonnes qu'il touche,
// ce qui ne va pas et les derniers messages du journal. Il ne contient jamais le contenu d'une ligne du document, une adresse e-mail ni ce que les exécutions ont écrit :
// une valeur que le journal cite (« Ligne introuvable dans T : C = valeur ») n'est donnée que par sa nature, <empty>, <number> ou <text>.
// Logique pure, sans DOM ni Grist : js/main.js rassemble ce que le widget sait (input, plus bas), build en tire un objet, toText l'écrit en JSON dans un bloc de code prêt à coller.
// Deux modes. « full » garde lisibles les noms et les valeurs saisies dans les nœuds. « anonymized » les remplace, partout dans le texte et de la même façon : les tables par T1, T2…,
// les colonnes par C1…, les noms de valeurs {nom} des nœuds par V1…, une valeur saisie par <text> ou <number>. La structure (types, liens, opérateurs) reste lisible.
//
// input : { version, language, browser, generatedAt, viewTable, graph, unreadable, journal, t,
//           frame: { grist, gfs, access, readOnly },
//           state: { workflow, loadedFromStorage, executor, automationTable, storeIssue, unsaved, rowsInView },
//           schema: { tables (noms du document, null si illisibles), columns: { table: [colonne] }, types: { table: { colonne: { type, formula } } } } }
(function (root) {
  'use strict';
  const NodeTypes = typeof module !== 'undefined' && module.exports ? require('./nodes.js') : root.NodeTypes;
  const Graph = typeof module !== 'undefined' && module.exports ? require('./graph.js') : root.Graph;

  const FORMAT = 'automation-builder-diagnostic/1';
  const MODES = ['anonymized', 'full'];
  const JOURNAL_MAX = 30;    // lignes du journal reprises, les plus récentes
  const MESSAGE_MAX = 400;   // caractères gardés d'un message du journal
  const COLUMNS_MAX = 60;    // au-delà, une table ne donne que les colonnes que le workflow nomme

  const TOKEN = /\{\{|\}\}|\{([^{}]+)\}/g;   // les valeurs {nom} d'un texte, et les accolades littérales {{ }} (comme le moteur, js/engine.js)
  const NUMBER = /^\s*-?\d+(?:[.,]\d+)?\s*$/;
  const SHAPES = ['<empty>', '<number>', '<text>'];   // la nature d'une valeur de ligne que le journal cite
  const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const safeWord = (word) => (/^[A-Za-z][\w-]{0,30}$/.test(word) ? word : '?');
  const attempt = (make, fallback) => { try { return make(); } catch (err) { return fallback; } };

  // Une valeur que ce module ne sait pas lire (champ d'une version plus récente) : le texte est masqué, les nombres et les cases restent.
  function generic(value) {
    if (typeof value === 'string') return value === '' ? '' : '<text>';
    if (Array.isArray(value)) return value.map(generic);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, generic(inner)]));
    return value;
  }

  // Un texte saisi, sans ses {nom} : true et false restent (le sens d'une comparaison), <number> s'il se lit comme un nombre, <text> sinon, et les blancs seuls restent.
  const literal = (text) => (text.trim() === '' || /^(?:true|false)$/i.test(text) ? text : NUMBER.test(text) ? '<number>' : '<text>');
  // Une valeur de ligne que le journal cite : jamais elle-même, seulement sa nature.
  const shape = (text) => (text.trim() === '' ? '<empty>' : NUMBER.test(text) ? '<number>' : '<text>');

  // Les noms du document et leurs pseudonymes. Complet, un nom reste lui-même ; anonymisé, il reçoit son pseudonyme à la première rencontre et le garde.
  // documentTables : les tables du document, que le journal peut citer sans que le workflow les nomme. labels : ce qu'un message peut citer entre guillemets (titres et identifiants des nœuds).
  function createNames(anonymize, documentTables, labels) {
    const kinds = { table: ['T', new Map()], column: ['C', new Map()], variable: ['V', new Map()] };
    function alias(kind, name) {
      const text = name === null || name === undefined ? '' : String(name);
      if (text === '') return text;
      const [prefix, known] = kinds[kind];
      if (!known.has(text)) known.set(text, anonymize ? prefix + (known.size + 1) : text);
      return known.get(text);
    }
    const isVariable = (name) => kinds.variable[1].has(String(name));

    // Un texte à valeurs {nom} : chaque {nom} devient son pseudonyme (la valeur d'un nœud avant la colonne de la ligne, comme le moteur), le texte saisi devient <text> ou <number>.
    function template(value) {
      const source = value === null || value === undefined ? '' : String(value);
      if (!anonymize) return source;
      let out = '';
      let last = 0;
      for (const match of source.matchAll(TOKEN)) {
        out += literal(source.slice(last, match.index));
        out += match[1] === undefined ? match[0] : '{' + alias(isVariable(match[1]) ? 'variable' : 'column', match[1]) + '}';
        last = match.index + match[0].length;
      }
      return out + literal(source.slice(last));
    }

    // Un message du journal, sur une ligne, sans jamais le contenu d'une ligne du document. Dans les deux modes, une valeur que nos propres messages citent (« Ligne introuvable dans T : C = valeur »,
    // « Valeur non numérique : « valeur » ») n'est reprise que par sa nature. Anonymisé, les autres messages (ceux de Grist) passent aussi par les pseudonymes : tout nom connu du document
    // devient le sien, et ce qui est entre guillemets (« », " " ou ' ', celui des erreurs de Grist) reste s'il nomme une table, une colonne, une valeur {nom} ou un nœud, sinon n'est repris que par sa nature.
    // Un seul passage, pour qu'un pseudonyme ne soit pas lu comme un nom (et les bornes < > empêchent de lire <text> comme le nom « text »). Une apostrophe collée à une lettre (l'ajout, d'une) n'ouvre pas de guillemet.
    function message(text) {
      let raw = String(text).replace(/\s+/g, ' ').trim();
      raw = raw.replace(/\b((?:Ligne introuvable|Plusieurs lignes) dans [^=]*? = )([\s\S]*)$/, (match, lead, value) => lead + shape(value));
      raw = raw.replace(/(Valeur non numérique : )« ([\s\S]*) »/, (match, lead, value) => `${lead}« ${shape(value)} »`);
      if (!anonymize) return raw.slice(0, MESSAGE_MAX);
      for (const table of documentTables) alias('table', table);
      const known = new Map(kinds.table[1]);
      for (const entry of [...kinds.variable[1], ...kinds.column[1]]) if (!known.has(entry[0])) known.set(entry[0], entry[1]);
      const keep = (quoted) => known.get(quoted) || (SHAPES.includes(quoted) || labels.has(quoted.replace(/\s+\d+$/, '')) ? quoted : shape(quoted));
      const names = [...known.keys()].sort((a, b) => b.length - a.length).map(escapeRegex);
      const quotes = '«\\s*([^»]*?)\\s*»|"([^"]*)"|(?<![\\p{L}\\p{N}])\'([^\']*)\'(?![\\p{L}\\p{N}])';
      const pattern = new RegExp(quotes + (names.length ? `|(?<![\\p{L}\\p{N}_<])(${names.join('|')})(?![\\p{L}\\p{N}_>])` : ''), 'gu');
      const masked = raw.replace(pattern, (match, guillemets, double, single, name) => {
        if (name !== undefined) return known.get(name);
        if (guillemets !== undefined) return `« ${keep(guillemets)} »`;
        return double !== undefined ? `"${keep(double)}"` : `'${keep(single)}'`;
      });
      return masked.slice(0, MESSAGE_MAX);
    }

    return { anonymize, table: (name) => alias('table', name), column: (name) => alias('column', name), variable: (name) => alias('variable', name), template, message };
  }

  // La valeur d'un champ de nœud, selon ce que le champ est (js/nodes.js) : un choix de la liste reste tel quel, une colonne ou une table devient son pseudonyme, un texte libre
  // passe par template, et ce que ce module ne connaît pas est masqué.
  function mapField(field, key, value, names) {
    if (key === 'name' && typeof value === 'string') return names.variable(value);
    const kind = field && field.kind;
    const text = typeof value === 'string';
    if (kind === 'choice') return field.choices.some(([choice]) => choice === value) ? value : generic(value);
    if (kind === 'column' || kind === 'targetColumn') return text ? names.column(value) : generic(value);
    if (kind === 'table') return text ? names.table(value) : generic(value);
    if (kind === 'text') return text || typeof value === 'number' ? names.template(value) : generic(value);
    if (kind === 'checks' && Array.isArray(value)) return value.map((check) => mapCheck(check, names));
    return generic(value);
  }

  function mapCheck(check, names) {
    if (!check || typeof check !== 'object') return generic(check);
    const mapped = Object.entries(check).map(([key, value]) => {
      if (key === 'column' && typeof value === 'string') return [key, names.column(value)];
      if (key === 'value' && (typeof value === 'string' || typeof value === 'number')) return [key, names.template(value)];
      if (key === 'operator' && NodeTypes.OPERATORS.some(([operator]) => operator === value)) return [key, value];
      return [key, generic(value)];
    });
    return Object.fromEntries(mapped);
  }

  function mapConfig(type, config, names) {
    if (!names.anonymize) return JSON.parse(JSON.stringify(config));
    const fields = Object.fromEntries(((NodeTypes.TYPES[type] || {}).fields || []).map((field) => [field.key, field]));
    return Object.fromEntries(Object.entries(config).map(([key, value]) => [key, mapField(fields[key], key, value, names)]));
  }

  // Le graphe sans ce qui n'aide pas à comprendre (positions et largeurs) et sans les attributs qu'une version plus récente aurait ajoutés aux nœuds.
  // Les noms de {valeurs} des nœuds Transformation et Lecture sont connus avant tout texte : un texte peut citer la valeur d'un nœud défini plus loin dans la liste.
  function mapGraph(graph, names) {
    for (const node of graph.nodes) if (node.config && typeof node.config.name === 'string') names.variable(node.config.name);
    const nodes = graph.nodes.map((node) => ({ id: node.id, type: node.type, config: mapConfig(node.type, node.config, names) }));
    const edges = graph.edges.map((edge) => (edge.branch ? { from: edge.from, to: edge.to, branch: edge.branch } : { from: edge.from, to: edge.to }));
    return { version: graph.version, active: graph.active, nodes, edges };
  }

  // Le résumé lisible du workflow (une ligne par chemin), fait sur le graphe déjà masqué : il dit la même chose que le reste. Un graphe que le résumé ne sait pas suivre n'en donne pas.
  const summary = (graph, t) => attempt(() => Graph.summarize(graph, t).split('\n'), null);

  // La table de la vue, puis celles que les nœuds nomment : celles dont le diagnostic décrit les colonnes.
  function tablesUsed(graph, viewTable) {
    const tables = [viewTable, ...(graph ? graph.nodes.map((node) => node.config && node.config.table) : [])].filter((table) => typeof table === 'string' && table !== '');
    return [...new Set(tables)];
  }

  // Ce que les champs des nœuds désignent : une table, ou une colonne d'une table (celle de la vue, ou celle du nœud, la vue par défaut).
  function references(graph, viewTable) {
    const refs = [];
    for (const node of graph.nodes) {
      const own = node.config.table || viewTable;
      for (const field of (NodeTypes.TYPES[node.type] || {}).fields || []) {
        const value = node.config[field.key];
        const named = typeof value === 'string' && value !== '';
        if (named && field.kind === 'table') refs.push({ node: node.id, field: field.key, table: value });
        if (named && field.kind === 'column') refs.push({ node: node.id, field: field.key, table: viewTable, column: value });
        if (named && field.kind === 'targetColumn') refs.push({ node: node.id, field: field.key, table: own, column: value });
        if (field.kind === 'checks' && Array.isArray(value)) for (const check of value) if (check && check.column) refs.push({ node: node.id, field: field.key, table: viewTable, column: check.column });
      }
    }
    return refs;
  }

  // Ce qui ne va pas, en codes : d'abord ce qui empêche d'activer (Graph.validate), puis les tables et colonnes que le workflow nomme et que le document n'a pas (ou plus).
  // Ces dernières ne disent rien à l'exécution : un déclencheur sur une colonne disparue ne se déclenche jamais.
  function problems(graph, input, names) {
    const code = (issue) => issue.key.replace(/^issue\./, '');
    const found = Graph.validate(graph, { currentTable: input.viewTable }).map((issue) => (issue.node ? { node: issue.node, code: code(issue) } : { code: code(issue) }));
    const schema = input.schema || {};
    if (Array.isArray(schema.tables)) {
      for (const ref of references(graph, input.viewTable)) {
        const columns = (schema.columns || {})[ref.table];
        if (!schema.tables.includes(ref.table)) {
          if (!ref.column) found.push({ node: ref.node, code: 'unknown-table', field: ref.field, name: names.table(ref.table) });
        } else if (ref.column && columns && columns.length && !columns.includes(ref.column)) {
          found.push({ node: ref.node, code: 'unknown-column', field: ref.field, table: names.table(ref.table), name: names.column(ref.column) });
        }
      }
    }
    const seen = new Set();
    return found.filter((item) => { const key = JSON.stringify(item); return !seen.has(key) && seen.add(key); });
  }

  // Le type d'une colonne : « Text », « Ref:T2 » (la table visée porte son pseudonyme), « Numeric, formula » ; null quand Grist ne l'a pas donné.
  function typeText(info, names) {
    if (!info || !info.type) return null;
    let type = String(info.type).replace(/^(Ref|RefList):(.+)$/, (match, kind, table) => `${kind}:${names.table(table)}`);
    if (names.anonymize) type = type.replace(/^DateTime:.*$/, 'DateTime');
    return info.formula ? `${type}, formula` : type;
  }

  // Les colonnes de chaque table que le workflow touche, avec leur type. Une table que le document n'a pas : null. Une table très large ne donne que les colonnes que le workflow nomme.
  // null quand le widget n'a pas pu lire les tables du document.
  function describeTables(input, names) {
    const { tables, columns = {}, types = {} } = input.schema || {};
    if (!Array.isArray(tables)) return null;
    const named = new Set(input.graph ? attempt(() => references(input.graph, input.viewTable).map((ref) => ref.column).filter(Boolean), []) : []);   // un nœud abîmé ne fait pas perdre les tables
    const result = {};
    for (const table of tablesUsed(input.graph, input.viewTable)) {
      const list = columns[table] || [];
      const shown = list.length > COLUMNS_MAX ? list.filter((column) => named.has(column)) : list;
      const described = tables.includes(table) ? Object.fromEntries(shown.map((column) => [names.column(column), typeText((types[table] || {})[column], names)])) : null;
      if (described && shown.length < list.length) described['…'] = `${list.length - shown.length} more`;
      result[names.table(table)] = described;
    }
    return result;
  }

  // Les plus récents d'abord, à égalité de date le dernier arrivé en premier.
  function describeJournal(journal, names) {
    const entries = (journal || []).map((entry, index) => ({ index, time: new Date(entry.date).getTime(), message: entry.message })).filter((entry) => Number.isFinite(entry.time));
    entries.sort((a, b) => b.time - a.time || b.index - a.index);
    return entries.slice(0, JOURNAL_MAX).map((entry) => ({ time: new Date(entry.time).toISOString(), message: names.message(entry.message === undefined ? '' : entry.message) }));
  }

  // Ce que dit, sans le recopier, un contenu enregistré que cette version ne sait pas lire : s'il est du JSON, sa version, son nombre de nœuds et les types de nœud qu'elle ne connaît pas.
  function inspectConfig(text) {
    if (text === null || text === undefined || String(text).trim() === '') return { json: false, empty: true };
    let saved;
    try { saved = JSON.parse(text); } catch (err) { return { json: false, characters: String(text).length }; }
    if (!saved || typeof saved !== 'object') return { json: true, shape: typeof saved };
    const nodes = Array.isArray(saved.nodes) ? saved.nodes : [];
    const unknown = nodes.map((node) => node && node.type).filter((type) => typeof type === 'string' && !NodeTypes.TYPES[type]);
    return { json: true, version: Number.isInteger(saved.version) ? saved.version : null, nodes: nodes.length, unknownTypes: [...new Set(unknown)].slice(0, 10).map(safeWord) };
  }

  // Un diagnostic dont une partie n'a pas pu être faite le dit à sa place (not-built) au lieu de ne rien donner : c'est justement quand quelque chose cloche qu'on le demande.
  function build(input, options) {
    const mode = options && options.mode === 'full' ? 'full' : 'anonymized';
    const frame = input.frame || {};
    const t = input.t || ((key) => key);
    const tableNames = Array.isArray((input.schema || {}).tables) ? input.schema.tables : [];
    const labels = new Set([...Object.values(NodeTypes.TYPES).map((type) => t(type.titleKey)), ...((input.graph && input.graph.nodes) || []).map((node) => node.id)]);
    const names = createNames(mode === 'anonymized', tableNames, labels);
    const viewTable = names.table(input.viewTable) || null;
    // Les tables et leurs colonnes d'abord : leurs pseudonymes se suivent dans l'ordre des colonnes du document, ceux des nœuds viennent après.
    const tables = attempt(() => describeTables(input, names), { error: 'not-built' });
    const generated = new Date(input.generatedAt).getTime();
    const diagnostic = {
      format: FORMAT,
      mode,
      generatedAt: Number.isFinite(generated) ? new Date(generated).toISOString() : null,
      widget: { version: input.version, language: input.language, browser: String(input.browser || '').slice(0, 200), grist: frame.grist, gfs: Boolean(frame.gfs), access: frame.access, readOnly: Boolean(frame.readOnly) },
      state: Object.assign({}, input.state),
      viewTable,
    };
    if (input.graph) {
      diagnostic.workflow = attempt(() => {
        const masked = mapGraph(input.graph, names);
        return { version: masked.version, active: masked.active, summary: summary(masked, t), nodes: masked.nodes, edges: masked.edges, problems: problems(input.graph, input, names) };
      }, { error: 'not-built' });
    }
    if (input.unreadable) diagnostic.unreadable = input.unreadable;
    diagnostic.tables = tables;
    diagnostic.journal = attempt(() => describeJournal(input.journal, names), { error: 'not-built' });
    return diagnostic;
  }

  // Le JSON en retrait de deux espaces, où ce qui tient sur une ligne (un lien, une vérification, la config d'un nœud court) reste sur une ligne : plus court à lire et à coller.
  // Le même JSON que JSON.stringify, seule la mise en page change ; value est déjà passé par JSON (toText), il n'a donc que des types de JSON.
  const LINE_MAX = 100;
  function flat(value) {
    if (Array.isArray(value)) return value.length ? `[${value.map(flat).join(', ')}]` : '[]';
    if (value && typeof value === 'object') {
      const entries = Object.entries(value);
      return entries.length ? `{ ${entries.map(([key, inner]) => `${JSON.stringify(key)}: ${flat(inner)}`).join(', ')} }` : '{}';
    }
    return JSON.stringify(value);
  }
  function pretty(value, indent = '') {
    const line = flat(value);
    if (indent.length + line.length <= LINE_MAX || !value || typeof value !== 'object') return line;
    const inner = indent + '  ';
    if (Array.isArray(value)) return `[\n${value.map((item) => inner + pretty(item, inner)).join(',\n')}\n${indent}]`;
    return `{\n${Object.entries(value).map(([key, item]) => `${inner}${JSON.stringify(key)}: ${pretty(item, inner)}`).join(',\n')}\n${indent}}`;
  }

  // Le texte à copier : le JSON dans un bloc de code, que le forum et les conversations montrent tel quel. La clôture est plus longue que toute suite d'accents graves du JSON.
  function toText(diagnostic) {
    const json = pretty(JSON.parse(JSON.stringify(diagnostic)));
    const fence = '`'.repeat(Math.max(3, Math.max(0, ...(json.match(/`+/g) || []).map((run) => run.length)) + 1));
    return `${fence}json\n${json}\n${fence}`;
  }

  const api = { FORMAT, MODES, build, toText, tablesUsed, inspectConfig };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Diagnostic = api;
})(typeof window !== 'undefined' ? window : globalThis);
