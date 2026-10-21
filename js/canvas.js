// Canevas nodal : fond uni, déplacement (glisser le fond) et zoom (molette), nœuds déplaçables par leur en-tête, liens courbes entre broches.
// Une condition a deux sorties, « oui » et « sinon ». Ajout d'un nœud : clic droit sur le fond ou bouton « Ajouter ». Lien : glisser d'une sortie vers une entrée, ou cliquer la sortie puis l'entrée
// (au clavier : Entrée sur la sortie puis sur l'entrée). Suppression : bouton du nœud, ou touche Suppr sur le nœud ou le lien sélectionné.
// Le canevas ne connaît pas Grist : il lit et modifie le graphe (js/graph.js) et signale chaque changement par onChange.
(function (root) {
  'use strict';
  const { Graph, NodeTypes, SearchSelect, I18n } = root;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const K_MIN = 0.4;
  const K_MAX = 1.6;
  const DRAG_THRESHOLD = 4;

  function el(tag, className, parent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (parent) parent.append(node);
    return node;
  }

  function svg(tag, attributes, parent) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes || {})) node.setAttribute(name, value);
    if (parent) parent.append(node);
    return node;
  }

  function fillSelect(select, entries, emptyKey) {
    const previous = select.value;
    select.replaceChildren();
    if (emptyKey) {
      const empty = el('option', '', select);
      empty.value = '';
      empty.dataset.i18n = emptyKey;
      empty.textContent = I18n.t(emptyKey);
    }
    for (const [value, label, labelKey] of entries) {
      const option = el('option', '', select);
      option.value = value;
      option.textContent = label;
      if (labelKey) option.dataset.i18n = labelKey;
    }
    select.value = entries.some(([value]) => value === previous) ? previous : '';
  }

  // container : élément qui accueille le canevas ; graph : graphe édité ;
  // schema : { currentTable(), tables(), columns(table) -> Promise<string[]> } ; onChange(graph) à chaque modification.
  function create(container, graph, schema, onChange) {
    const view = { x: 40, y: 40, k: 1 };
    const world = el('div', 'world', container);
    const wires = svg('svg', { class: 'wires', 'aria-hidden': 'true' }, world);
    const hint = el('p', 'canvas-hint', container);
    hint.dataset.i18n = 'canvas.empty';
    const connectHint = el('p', 'canvas-hint canvas-connect-hint', container);
    connectHint.dataset.i18n = 'canvas.connecting';
    connectHint.hidden = true;
    const tempWire = svg('path', { class: 'wire wire-temp' }, wires);
    tempWire.setAttribute('visibility', 'hidden');

    const views = new Map(); // id du nœud -> { element, pickers, inputs, node }
    let selected = null;     // { kind: 'node', id } ou { kind: 'edge', from, to }
    let connecting = null;   // { from } pendant la création d'un lien
    let menu = null;

    const t = (key, params) => I18n.t(key, params);
    const changed = () => { clearTrace(); onChange(graph); };

    function applyView() {
      world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
    }

    function toWorld(clientX, clientY) {
      const rect = container.getBoundingClientRect();
      return { x: (clientX - rect.left - view.x) / view.k, y: (clientY - rect.top - view.y) / view.k };
    }

    /* ---------- Liens ---------- */

    function pinCenter(pin) {
      const rect = pin.getBoundingClientRect();
      const origin = world.getBoundingClientRect();
      return { x: (rect.left + rect.width / 2 - origin.left) / view.k, y: (rect.top + rect.height / 2 - origin.top) / view.k };
    }

    function curve(from, to) {
      const reach = Math.max(40, Math.abs(to.x - from.x) / 2);
      return `M ${from.x} ${from.y} C ${from.x + reach} ${from.y}, ${to.x - reach} ${to.y}, ${to.x} ${to.y}`;
    }

    function drawWires() {
      wires.querySelectorAll('g.wire-group').forEach((group) => group.remove());
      for (const edge of graph.edges) {
        const source = views.get(edge.from);
        const target = views.get(edge.to);
        if (!source || !target) continue;
        const path = curve(pinCenter(source.pinsOut[edge.branch || 'then']), pinCenter(target.pinIn));
        const group = svg('g', { class: 'wire-group' }, wires);
        if (edge.branch === 'else') group.classList.add('wire-else');
        if (selected && selected.kind === 'edge' && selected.from === edge.from && selected.to === edge.to) group.classList.add('is-selected');
        svg('path', { class: 'wire', d: path }, group);
        const hit = svg('path', { class: 'wire-hit', d: path }, group);
        hit.addEventListener('pointerdown', (event) => {
          event.stopPropagation();
          select({ kind: 'edge', from: edge.from, to: edge.to });
          container.focus();
        });
      }
    }

    function showHints() {
      hint.hidden = graph.nodes.length > 0;
      connectHint.hidden = !connecting;
    }

    /* ---------- Sélection et suppression ---------- */

    function select(next) {
      selected = next;
      for (const [id, entry] of views) entry.element.classList.toggle('is-selected', Boolean(next && next.kind === 'node' && next.id === id));
      drawWires();
    }

    function removeSelected() {
      if (!selected) return;
      if (selected.kind === 'node') removeNode(selected.id);
      else { Graph.disconnect(graph, selected.from, selected.to); select(null); changed(); }
    }

    function removeNode(id) {
      Graph.removeNode(graph, id);
      views.get(id).element.remove();
      views.delete(id);
      select(null);
      showHints();
      changed();
    }

    /* ---------- Création de liens ---------- */

    function startConnecting(from, branch) {
      connecting = { from, branch };
      views.get(from).element.classList.add('is-connecting');
      views.get(from).pinsOut[branch].classList.add('is-source');
      for (const [id, entry] of views) entry.pinIn.classList.toggle('is-target', Graph.connect(JSON.parse(JSON.stringify(graph)), from, id, branch).ok);
      showHints();
    }

    function stopConnecting() {
      if (!connecting) return;
      views.get(connecting.from)?.element.classList.remove('is-connecting');
      for (const entry of views.values()) Object.values(entry.pinsOut).forEach((pin) => pin.classList.remove('is-source'));
      for (const entry of views.values()) entry.pinIn.classList.remove('is-target');
      tempWire.setAttribute('visibility', 'hidden');
      connecting = null;
      showHints();
    }

    function finishConnecting(to) {
      if (!connecting) return;
      const { from, branch } = connecting;
      stopConnecting();
      if (Graph.connect(graph, from, to, branch).ok) { drawWires(); changed(); }
    }

    function moveTempWire(clientX, clientY) {
      const start = pinCenter(views.get(connecting.from).pinsOut[connecting.branch]);
      const point = toWorld(clientX, clientY);
      tempWire.setAttribute('d', curve(start, point));
      tempWire.setAttribute('visibility', 'visible');
    }

    function onPinOutPointerDown(event, id, branch) {
      event.stopPropagation();
      event.preventDefault();
      if (connecting) { stopConnecting(); return; }
      startConnecting(id, branch);
      const origin = { x: event.clientX, y: event.clientY };
      let dragged = false;
      const move = (e) => {
        if (!dragged && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < DRAG_THRESHOLD) return;
        dragged = true;
        if (connecting) moveTempWire(e.clientX, e.clientY);
      };
      const up = (e) => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        if (!dragged || !connecting) return; // simple clic : le lien reste en attente de l'entrée visée
        const pin = document.elementFromPoint(e.clientX, e.clientY)?.closest('.pin-in');
        if (pin) finishConnecting(pin.dataset.node); else stopConnecting();
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    }

    /* ---------- Nœuds ---------- */

    // Vérifications d'une condition : une ligne de trois champs par vérification, reliées par ET/OU (champ « Combiner » en dessous).
    function checkRow(entry, index) {
      const check = entry.node.config.checks[index];
      const suffix = index === 0 ? '' : `-${index + 1}`;
      const group = el('div', 'check', entry.checksBox);
      const view = {};
      const row = (key, labelKey) => {
        const line = el('div', 'node-row', group);
        const id = `${entry.node.id}-${key}${suffix}`;
        const label = el('label', '', line);
        label.htmlFor = id;
        label.dataset.i18n = labelKey;
        label.textContent = t(labelKey);
        return { line, id };
      };
      const column = row('column', 'cond.column');
      view.column = el('select', '', column.line);
      view.column.id = column.id;
      const operator = row('operator', 'cond.operator');
      view.operator = el('select', '', operator.line);
      view.operator.id = operator.id;
      fillSelect(view.operator, NodeTypes.OPERATORS.map(([value, key]) => [value, t(key), key]));
      view.operator.value = check.operator;
      const value = row('value', 'cond.value');
      view.value = el('input', '', value.line);
      view.value.type = 'text';
      view.value.id = value.id;
      view.value.value = check.value || '';
      view.value.disabled = !NodeTypes.needsValue(check);
      view.pickers = { column: SearchSelect.attach(view.column), operator: SearchSelect.attach(view.operator) };
      view.column.addEventListener('change', () => { check.column = view.column.value; changed(); });
      view.operator.addEventListener('change', () => { check.operator = view.operator.value; view.value.disabled = !NodeTypes.needsValue(check); changed(); });
      view.value.addEventListener('input', () => { check.value = view.value.value; changed(); });
      if (entry.node.config.checks.length > 1) {
        const remove = el('button', 'icon-only check-remove', group);
        remove.type = 'button';
        remove.dataset.i18nLabel = 'check.remove';
        remove.setAttribute('aria-label', t('check.remove'));
        remove.title = t('check.remove');
        el('span', 'icon icon-trash', remove).setAttribute('aria-hidden', 'true');
        remove.addEventListener('click', () => { entry.node.config.checks.splice(index, 1); renderChecks(entry); changed(); });
      }
      return view;
    }

    function renderChecks(entry) {
      entry.checksBox.replaceChildren();
      entry.checkViews = entry.node.config.checks.map((check, index) => checkRow(entry, index));
      const add = el('button', 'check-add', entry.checksBox);
      add.type = 'button';
      add.dataset.i18n = 'check.add';
      add.textContent = t('check.add');
      add.addEventListener('click', () => {
        entry.node.config.checks.push({ column: '', operator: 'eq', value: '' });
        renderChecks(entry);
        syncDisabled(entry);
        changed();
        fillCheckColumns(entry);
      });
      syncDisabled(entry);
      fillCheckColumns(entry);
    }

    async function fillCheckColumns(entry) {
      const names = schema.currentTable() ? await schema.columns(schema.currentTable()) : [];
      entry.node.config.checks.forEach((check, index) => {
        const view = entry.checkViews[index];
        if (!view) return;
        fillSelect(view.column, names.map((name) => [name, name]), 'list.choose');
        view.column.value = check.column;
        view.pickers.column.refresh();
      });
    }

    function fieldRow(entry, spec) {
      if (spec.kind === 'checks') {
        entry.checksBox = el('div', 'checks', entry.body);
        renderChecks(entry);
        return;
      }
      const config = entry.node.config;
      const row = el('div', 'node-row', entry.body);
      const inputId = `${entry.node.id}-${spec.key}`;
      const label = el('label', '', row);
      label.htmlFor = inputId;
      label.dataset.i18n = spec.labelKey;
      label.textContent = t(spec.labelKey);
      if (spec.kind === 'text') {
        const input = el('input', '', row);
        input.type = 'text';
        input.id = inputId;
        input.value = config[spec.key] || '';
        input.addEventListener('input', () => { config[spec.key] = input.value; changed(); });
        entry.inputs[spec.key] = input;
        return;
      }
      const select = el('select', '', row);
      select.id = inputId;
      entry.selects[spec.key] = select;
      if (spec.kind === 'choice') {
        fillSelect(select, spec.choices.map(([value, key]) => [value, t(key), key]));
        select.value = config[spec.key];
      }
      entry.pickers[spec.key] = SearchSelect.attach(select);
      select.addEventListener('change', () => {
        config[spec.key] = select.value;
        if (spec.key === 'table') refreshTargetColumns(entry);
        syncDisabled(entry);
        changed();
      });
    }

    function syncDisabled(entry) {
      for (const spec of NodeTypes.TYPES[entry.node.type].fields) {
        if (!spec.disabledWhen) continue;
        const control = entry.inputs[spec.key] || entry.selects[spec.key];
        if (!control) continue;   // champ pas encore construit (la liste des vérifications précède « Combiner »)
        control.disabled = spec.disabledWhen(entry.node.config);
        if (entry.pickers[spec.key]) entry.pickers[spec.key].refresh();
      }
    }

    // Colonnes de la table cible d'une action ou d'une lecture, pour les listes « Ligne repérée par » et « Colonne ».
    async function refreshTargetColumns(entry) {
      if (entry.node.type !== 'action' && entry.node.type !== 'lookup') return;
      const table = entry.node.config.table || schema.currentTable();
      const names = table ? await schema.columns(table) : [];
      for (const spec of NodeTypes.TYPES[entry.node.type].fields) {
        const select = spec.kind === 'targetColumn' && entry.selects[spec.key];
        if (!select) continue;
        fillSelect(select, names.map((name) => [name, name]), spec.emptyKey);
        select.value = entry.node.config[spec.key];
        entry.pickers[spec.key].refresh();
      }
    }

    // Reconstruit les listes qui dépendent du document (colonnes de la table courante, tables, colonnes de la cible).
    async function refreshSchema() {
      const currentColumns = schema.currentTable() ? await schema.columns(schema.currentTable()) : [];
      for (const entry of views.values()) {
        if (entry.checkViews) await fillCheckColumns(entry);
        for (const spec of NodeTypes.TYPES[entry.node.type].fields) {
          const select = entry.selects[spec.key];
          if (!select) continue;
          if (spec.kind === 'column') fillSelect(select, currentColumns.map((name) => [name, name]), spec.emptyKey);
          else if (spec.kind === 'table') fillSelect(select, schema.tables().map((name) => [name, name]), spec.emptyKey);
          else continue;
          select.value = entry.node.config[spec.key];
          entry.pickers[spec.key].refresh();
        }
        await refreshTargetColumns(entry);
      }
    }

    function buildNode(node) {
      const spec = NodeTypes.TYPES[node.type];
      const element = el('div', `node node-${node.type}`, world);
      element.setAttribute('role', 'group');
      const head = el('div', 'node-head', element);
      head.tabIndex = 0;
      const title = el('span', 'node-title', head);
      title.dataset.i18n = spec.titleKey;
      title.textContent = t(spec.titleKey);
      element.setAttribute('aria-label', title.textContent);
      const remove = el('button', 'icon-only node-delete', head);
      remove.type = 'button';
      remove.dataset.i18nLabel = 'node.delete';
      remove.setAttribute('aria-label', t('node.delete'));
      remove.title = t('node.delete');
      el('span', 'icon icon-trash', remove).setAttribute('aria-hidden', 'true');
      const body = el('div', 'node-body', element);
      const state = el('div', 'node-state', element);
      state.hidden = true;

      const entry = { node, element, body, state, pickers: {}, selects: {}, inputs: {} };
      views.set(node.id, entry);
      for (const field of spec.fields) fieldRow(entry, field);
      syncDisabled(entry);

      if (spec.inputs) {
        entry.pinIn = el('button', 'pin pin-in', element);
        entry.pinIn.type = 'button';
        entry.pinIn.dataset.node = node.id;
        entry.pinIn.dataset.i18nLabel = 'pin.in';
        entry.pinIn.setAttribute('aria-label', t('pin.in'));
        entry.pinIn.addEventListener('click', () => finishConnecting(node.id));
        entry.pinIn.addEventListener('pointerdown', (event) => event.stopPropagation());
      } else {
        entry.pinIn = el('span', 'pin-none', element);
      }
      // Une sortie par branche : une seule dans l'en-tête, deux (« oui » / « sinon ») en pied de nœud pour une condition.
      entry.pinsOut = {};
      const outsBox = spec.branches.length > 1 ? document.createElement('div') : null;
      if (outsBox) { outsBox.className = 'node-outs'; body.after(outsBox); }
      for (const branch of spec.branches) {
        const host = outsBox ? el('div', 'out-row', outsBox) : element;
        if (outsBox) {
          const text = el('span', 'out-label', host);
          text.dataset.i18n = 'out.' + branch;
          text.textContent = t('out.' + branch);
        }
        const pin = el('button', 'pin pin-out', host);
        pin.type = 'button';
        pin.dataset.branch = branch;
        const labelKey = spec.branches.length > 1 ? 'pin.' + branch : 'pin.out';
        pin.dataset.i18nLabel = labelKey;
        pin.setAttribute('aria-label', t(labelKey));
        pin.addEventListener('pointerdown', (event) => onPinOutPointerDown(event, node.id, branch));
        pin.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (connecting) stopConnecting(); else startConnecting(node.id, branch); }
        });
        entry.pinsOut[branch] = pin;
      }

      placeNode(entry);
      remove.addEventListener('click', () => removeNode(node.id));
      remove.addEventListener('pointerdown', (event) => event.stopPropagation());
      head.addEventListener('keydown', (event) => {
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeNode(node.id); }
      });
      element.addEventListener('focusin', () => bringToFront(element));
      head.addEventListener('pointerdown', (event) => startNodeDrag(event, entry));
      return entry;
    }

    function bringToFront(element) {
      for (const entry of views.values()) entry.element.classList.remove('is-top');
      element.classList.add('is-top');
    }

    function placeNode(entry) {
      entry.element.style.left = entry.node.x + 'px';
      entry.element.style.top = entry.node.y + 'px';
    }

    function startNodeDrag(event, entry) {
      if (event.button !== 0) return;
      event.stopPropagation();
      select({ kind: 'node', id: entry.node.id });
      bringToFront(entry.element);
      const start = { x: event.clientX, y: event.clientY, nodeX: entry.node.x, nodeY: entry.node.y };
      let moved = false;
      const move = (e) => {
        moved = true;
        entry.node.x = Math.round(start.nodeX + (e.clientX - start.x) / view.k);
        entry.node.y = Math.round(start.nodeY + (e.clientY - start.y) / view.k);
        placeNode(entry);
        drawWires();
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        if (moved) onChange(graph);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    }

    function addNode(type, x, y) {
      const node = Graph.addNode(graph, type, x, y);
      const entry = buildNode(node);
      refreshSchema();
      select({ kind: 'node', id: node.id });
      bringToFront(entry.element);
      showHints();
      drawWires();
      changed();
      return node;
    }

    /* ---------- Menu d'ajout ---------- */

    function closeMenu() {
      if (!menu) return;
      menu.remove();
      menu = null;
    }

    // (clientX, clientY) : endroit où poser le nœud ; sans arguments, au centre du canevas.
    function openAddMenu(clientX, clientY) {
      closeMenu();
      const rect = container.getBoundingClientRect();
      const x = clientX === undefined ? rect.left + rect.width / 2 : clientX;
      const y = clientY === undefined ? rect.top + rect.height / 2 : clientY;
      menu = el('div', 'add-menu', container);
      menu.style.left = (x - rect.left) + 'px';
      menu.style.top = (y - rect.top) + 'px';
      const select = el('select', '', menu);
      fillSelect(select, NodeTypes.ORDER.map((type) => [type, t(NodeTypes.TYPES[type].titleKey), NodeTypes.TYPES[type].titleKey]));
      const picker = SearchSelect.attach(select, { menu: true, onClose: closeMenu });
      select.addEventListener('change', () => {
        const point = toWorld(x, y);
        addNode(select.value, point.x - 20, point.y - 12);
      });
      picker.open();
    }

    /* ---------- Fond : déplacement, zoom, clavier ---------- */

    container.addEventListener('pointerdown', (event) => {
      if (event.target !== container && event.target !== world && event.target !== wires) return;
      if (event.button !== 0) return;
      closeMenu();
      stopConnecting();
      select(null);
      container.focus();
      const start = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
      container.classList.add('is-panning');
      const move = (e) => {
        view.x = start.viewX + e.clientX - start.x;
        view.y = start.viewY + e.clientY - start.y;
        applyView();
      };
      const up = () => {
        container.classList.remove('is-panning');
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });

    container.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const k = Math.min(K_MAX, Math.max(K_MIN, view.k * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
      view.x = px - (px - view.x) * (k / view.k);
      view.y = py - (py - view.y) * (k / view.k);
      view.k = k;
      applyView();
    }, { passive: false });

    container.addEventListener('contextmenu', (event) => {
      if (event.target !== container && event.target !== world && event.target !== wires) return;
      event.preventDefault();
      openAddMenu(event.clientX, event.clientY);
    });

    container.addEventListener('pointermove', (event) => { if (connecting) moveTempWire(event.clientX, event.clientY); });

    document.addEventListener('keydown', (event) => {
      if (event.defaultPrevented) return;
      const typing = event.target.closest && event.target.closest('input, select, textarea, .ss-panel');
      if (event.key === 'Escape') { stopConnecting(); closeMenu(); }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && !typing && selected && container.contains(document.activeElement)) { event.preventDefault(); removeSelected(); }
    });

    /* ---------- Dry-run : état de chaque nœud ---------- */

    function showTrace(trace) {
      clearTrace();
      for (const [id, status] of Object.entries(trace)) {
        const entry = views.get(id);
        if (!entry) continue;
        entry.element.classList.add('trace-' + status);
        entry.state.hidden = false;
        entry.state.dataset.i18n = 'trace.' + status;
        entry.state.textContent = t('trace.' + status);
      }
    }

    function clearTrace() {
      for (const entry of views.values()) {
        entry.element.classList.remove('trace-passed', 'trace-blocked', 'trace-else', 'trace-action');
        entry.state.hidden = true;
      }
    }

    /* ---------- Chargement ---------- */

    function load(next) {
      for (const entry of views.values()) entry.element.remove();
      views.clear();
      graph = next;
      for (const node of graph.nodes) buildNode(node);
      showHints();
      refreshSchema().then(drawWires);
      drawWires();
    }

    function setActive(on) { container.classList.toggle('is-active', on); }

    document.addEventListener('langchange', () => { drawWires(); });
    graph.nodes.forEach(buildNode);
    container.tabIndex = 0;
    applyView();
    showHints();
    drawWires();

    return { load, refreshSchema, openAddMenu, showTrace, setActive, nodeLabel: (id) => (views.get(id) ? views.get(id).element.getAttribute('aria-label') : id), getGraph: () => graph, select };
  }

  root.Canvas = { create };
})(window);
