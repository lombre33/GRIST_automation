// Canevas nodal : fond uni, déplacement (glisser le fond) et zoom (molette), nœuds déplaçables par leur en-tête, liens courbes entre broches.
// Une condition a deux sorties, « oui » et « sinon ». Ajout d'un nœud : clic droit sur le fond ou bouton « Ajouter ». Lien : glisser d'une sortie vers une entrée, ou cliquer la sortie puis l'entrée
// (au clavier : Entrée sur la sortie puis sur l'entrée) ; un lien glissé puis lâché sur le fond ouvre le menu d'ajout, et le nœud choisi s'y pose, relié.
// Suppression : bouton du nœud, ou touche Suppr sur le nœud ou le lien sélectionné. Largeur d'un nœud : tirer son bord droit (au clavier, Maj + flèches
// gauche et droite sur son en-tête), double-clic sur ce bord pour la largeur d'origine ; elle est gardée dans le graphe (node.w).
// Le canevas ne connaît pas Grist : il lit et modifie le graphe (js/graph.js) et signale chaque changement par onChange. Les champs des nœuds sont dans js/canvas-fields.js.
// En lecture seule (la personne ne peut pas modifier le document), on déplace et on zoome le fond pour voir le graphe ; rien ne s'ajoute, ne se relie, ne se déplace ni ne se supprime.
// cv : l'état d'un canevas, que chaque fonction reçoit (voir create) ; un nœud y est une entrée { node, element, head, body, issue, state, pinIn, pinsOut, pickers, selects, inputs }.
(function (root) {
  'use strict';
  const { Graph, NodeTypes, I18n, CanvasFields } = root;
  const { make, iconButton, fillSelect, fieldRow, syncDisabled, refreshSchema } = CanvasFields;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const K_MIN = 0.4;
  const K_MAX = 1.6;
  const DRAG_THRESHOLD = 4;   // px : en deçà, un appui sur une sortie est un clic (le lien attend l'entrée), pas un glisser
  const t = (key, params) => I18n.t(key, params);

  function svg(tag, attributes, parent) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes || {})) node.setAttribute(name, value);
    if (parent) parent.append(node);
    return node;
  }

  // Suit un glisser jusqu'au relâchement, où que soit le pointeur dans la page.
  function track(onMove, onUp) {
    const up = (event) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', up);
      onUp(event);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', up);
  }

  /* ---------- Vue : déplacement et zoom ---------- */
  function applyView(cv) {
    cv.world.style.transform = `translate(${cv.view.x}px, ${cv.view.y}px) scale(${cv.view.k})`;
  }

  // Un point de la page (coordonnées du pointeur) dans le repère du graphe.
  function toWorld(cv, clientX, clientY) {
    const rect = cv.container.getBoundingClientRect();
    return { x: (clientX - rect.left - cv.view.x) / cv.view.k, y: (clientY - rect.top - cv.view.y) / cv.view.k };
  }

  function isBackground(cv, target) {
    return target === cv.container || target === cv.world || target === cv.wires;
  }

  function startPanning(cv, event) {
    const start = { x: event.clientX, y: event.clientY, viewX: cv.view.x, viewY: cv.view.y };
    cv.container.classList.add('is-panning');
    track((e) => {
      cv.view.x = start.viewX + e.clientX - start.x;
      cv.view.y = start.viewY + e.clientY - start.y;
      applyView(cv);
    }, () => cv.container.classList.remove('is-panning'));
  }

  // Zoom autour du pointeur : le point sous la souris reste en place.
  function zoom(cv, event) {
    event.preventDefault();
    const rect = cv.container.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const k = Math.min(K_MAX, Math.max(K_MIN, cv.view.k * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
    cv.view.x = px - (px - cv.view.x) * (k / cv.view.k);
    cv.view.y = py - (py - cv.view.y) * (k / cv.view.k);
    cv.view.k = k;
    applyView(cv);
  }

  /* ---------- Liens ---------- */
  function pinCenter(cv, pin) {
    const rect = pin.getBoundingClientRect();
    const origin = cv.world.getBoundingClientRect();
    return { x: (rect.left + rect.width / 2 - origin.left) / cv.view.k, y: (rect.top + rect.height / 2 - origin.top) / cv.view.k };
  }

  function curve(from, to) {
    const reach = Math.max(40, Math.abs(to.x - from.x) / 2);
    return `M ${from.x} ${from.y} C ${from.x + reach} ${from.y}, ${to.x - reach} ${to.y}, ${to.x} ${to.y}`;
  }

  // Redessine tous les liens (après un déplacement, un ajout, un changement de langue qui change la taille des nœuds) ; un tracé plus large, invisible, sert à les sélectionner.
  function drawWires(cv) {
    cv.wires.querySelectorAll('g.wire-group').forEach((group) => group.remove());
    for (const edge of cv.graph.edges) {
      const source = cv.views.get(edge.from);
      const target = cv.views.get(edge.to);
      if (!source || !target) continue;
      const path = curve(pinCenter(cv, source.pinsOut[edge.branch || 'then']), pinCenter(cv, target.pinIn));
      const group = svg('g', { class: 'wire-group' }, cv.wires);
      if (edge.branch === 'else') group.classList.add('wire-else');
      if (cv.selected && cv.selected.kind === 'edge' && cv.selected.from === edge.from && cv.selected.to === edge.to) group.classList.add('is-selected');
      svg('path', { class: 'wire', d: path }, group);
      const hit = svg('path', { class: 'wire-hit', d: path }, group);
      hit.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        select(cv, { kind: 'edge', from: edge.from, to: edge.to });
        cv.container.focus();
      });
    }
  }

  function showHints(cv) {
    cv.hint.hidden = cv.graph.nodes.length > 0;
    cv.connectHint.hidden = !cv.connecting || Boolean(cv.connecting.parked);   // lien lâché sur le fond : le menu d'ajout parle à sa place
  }

  /* ---------- Sélection et suppression ---------- */
  // next : { kind: 'node', id }, { kind: 'edge', from, to } ou null.
  function select(cv, next) {
    cv.selected = next;
    for (const [id, entry] of cv.views) entry.element.classList.toggle('is-selected', Boolean(next && next.kind === 'node' && next.id === id));
    drawWires(cv);
  }

  function removeSelected(cv) {
    if (!cv.selected || cv.readOnly) return;
    if (cv.selected.kind === 'node') removeNode(cv, cv.selected.id);
    else { Graph.disconnect(cv.graph, cv.selected.from, cv.selected.to); select(cv, null); cv.changed(); }
  }

  function removeNode(cv, id) {
    if (cv.readOnly) return;
    Graph.removeNode(cv.graph, id);
    cv.views.get(id).element.remove();
    cv.views.delete(id);
    select(cv, null);
    showHints(cv);
    cv.changed();
  }

  /* ---------- Création de liens ---------- */
  // Les entrées où ce lien peut aboutir s'éclairent : on essaie le lien sur une copie du graphe (pas de cycle, pas d'entrée sur un déclencheur…).
  function startConnecting(cv, from, branch) {
    if (cv.readOnly) return;
    cv.connecting = { from, branch };
    cv.views.get(from).element.classList.add('is-connecting');
    cv.views.get(from).pinsOut[branch].classList.add('is-source');
    for (const [id, entry] of cv.views) entry.pinIn.classList.toggle('is-target', Graph.connect(JSON.parse(JSON.stringify(cv.graph)), from, id, branch).ok);
    showHints(cv);
  }

  function stopConnecting(cv) {
    if (!cv.connecting) return;
    cv.views.get(cv.connecting.from)?.element.classList.remove('is-connecting');
    for (const entry of cv.views.values()) Object.values(entry.pinsOut).forEach((pin) => pin.classList.remove('is-source'));
    for (const entry of cv.views.values()) entry.pinIn.classList.remove('is-target');
    cv.tempWire.setAttribute('visibility', 'hidden');
    cv.connecting = null;
    showHints(cv);
  }

  function finishConnecting(cv, to) {
    if (!cv.connecting) return;
    const { from, branch } = cv.connecting;
    stopConnecting(cv);
    if (Graph.connect(cv.graph, from, to, branch).ok) { drawWires(cv); cv.changed(); }
  }

  function moveTempWire(cv, clientX, clientY) {
    const start = pinCenter(cv, cv.views.get(cv.connecting.from).pinsOut[cv.connecting.branch]);
    cv.tempWire.setAttribute('d', curve(start, toWorld(cv, clientX, clientY)));
    cv.tempWire.setAttribute('visibility', 'visible');
  }

  // Appui sur une sortie : un glisser relie à l'entrée où il est relâché, ou ouvre là le menu d'ajout s'il l'est sur le fond ; un clic laisse le lien en attente (clic ou Entrée sur l'entrée).
  function onPinOutPointerDown(cv, event, id, branch) {
    event.stopPropagation();
    event.preventDefault();
    if (cv.connecting) { stopConnecting(cv); return; }
    startConnecting(cv, id, branch);
    const origin = { x: event.clientX, y: event.clientY };
    let dragged = false;
    track((e) => {
      if (!dragged && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < DRAG_THRESHOLD) return;
      dragged = true;
      if (cv.connecting) moveTempWire(cv, e.clientX, e.clientY);
    }, (e) => {
      if (!dragged || !cv.connecting) return;
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const pin = target?.closest('.pin-in');
      if (pin) finishConnecting(cv, pin.dataset.node);
      else if (target && isBackground(cv, target)) {
        // Le lien reste tracé jusqu'au point de chute, où s'ouvre le menu d'ajout ; fermer le menu sans choisir l'abandonne.
        cv.connecting.parked = true;
        moveTempWire(cv, e.clientX, e.clientY);
        showHints(cv);
        openAddMenu(cv, e.clientX, e.clientY, cv.connecting);
      } else stopConnecting(cv);
    });
  }

  /* ---------- Nœuds ---------- */
  // L'en-tête : le titre du type, qui nomme le nœud pour un lecteur d'écran (aria-labelledby, il suit la langue), et le bouton de suppression.
  function buildHead(cv, entry) {
    const spec = NodeTypes.TYPES[entry.node.type];
    entry.head = make('div', 'node-head', entry.element);
    entry.head.tabIndex = 0;
    // Le titre porte le numéro du nœud à partir du deuxième de son type (« Action 2 », d'après son identifiant action-2) : les messages désignent ainsi le bon.
    const title = make('span', 'node-title', entry.head);
    title.id = `${entry.node.id}-title`;
    const name = make('span', '', title);
    name.dataset.i18n = spec.titleKey;
    name.textContent = t(spec.titleKey);
    const number = Number((/-(\d+)$/.exec(entry.node.id) || [])[1]);
    if (number > 1) title.append(` ${number}`);
    entry.element.setAttribute('aria-labelledby', title.id);
    const remove = iconButton('node-delete', 'node.delete', 'icon-trash', entry.head);
    remove.addEventListener('click', () => removeNode(cv, entry.node.id));
    remove.addEventListener('pointerdown', (event) => event.stopPropagation());
    entry.head.addEventListener('keydown', (event) => {
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeNode(cv, entry.node.id); }
      else if (event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !cv.readOnly) {
        event.preventDefault();
        const before = entry.node.w;
        setWidth(cv, entry, entry.element.offsetWidth + (event.key === 'ArrowRight' ? 20 : -20));   // 20 px par appui
        if (entry.node.w !== before) cv.onChange(cv.graph);
      }
    });
    entry.head.addEventListener('pointerdown', (event) => startNodeDrag(cv, event, entry));
  }

  // Le bord droit d'un nœud, sous ses broches (premier enfant, que les broches recouvrent) : le tirer règle la largeur, un double-clic la remet à l'origine.
  function buildGrip(cv, entry) {
    const grip = make('span', 'node-grip', entry.element);
    grip.setAttribute('aria-hidden', 'true');   // au clavier : Maj + flèches sur l'en-tête
    grip.dataset.i18nLabel = 'node.resize';
    grip.title = t('node.resize');
    grip.addEventListener('pointerdown', (event) => startResize(cv, event, entry));
    grip.addEventListener('dblclick', () => {
      if (cv.readOnly || entry.node.w === undefined) return;
      setWidth(cv, entry, null);
      cv.onChange(cv.graph);
    });
  }

  function buildPinIn(cv, entry) {
    if (!NodeTypes.TYPES[entry.node.type].inputs) {
      entry.pinIn = make('span', 'pin-none', entry.element);
      return;
    }
    entry.pinIn = make('button', 'pin pin-in', entry.element);
    entry.pinIn.type = 'button';
    entry.pinIn.dataset.node = entry.node.id;
    entry.pinIn.dataset.i18nLabel = 'pin.in';
    entry.pinIn.setAttribute('aria-label', t('pin.in'));
    entry.pinIn.addEventListener('click', () => finishConnecting(cv, entry.node.id));
    entry.pinIn.addEventListener('pointerdown', (event) => event.stopPropagation());
  }

  // Une sortie par branche : une seule, au bord du nœud, ou deux (« oui » / « sinon ») en pied de nœud pour une condition.
  function buildPinsOut(cv, entry) {
    const { branches } = NodeTypes.TYPES[entry.node.type];
    const outsBox = branches.length > 1 ? document.createElement('div') : null;
    if (outsBox) { outsBox.className = 'node-outs'; entry.body.after(outsBox); }
    entry.pinsOut = {};
    for (const branch of branches) {
      const host = outsBox ? make('div', 'out-row', outsBox) : entry.element;
      if (outsBox) {
        const text = make('span', 'out-label', host);
        text.dataset.i18n = 'out.' + branch;
        text.textContent = t('out.' + branch);
      }
      const pin = make('button', 'pin pin-out', host);
      pin.type = 'button';
      pin.dataset.branch = branch;
      const labelKey = branches.length > 1 ? 'pin.' + branch : 'pin.out';
      pin.dataset.i18nLabel = labelKey;
      pin.setAttribute('aria-label', t(labelKey));
      pin.addEventListener('pointerdown', (event) => onPinOutPointerDown(cv, event, entry.node.id, branch));
      pin.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (cv.connecting) stopConnecting(cv); else startConnecting(cv, entry.node.id, branch);
      });
      entry.pinsOut[branch] = pin;
    }
  }

  // Ordre dans le nœud : en-tête, champs, sorties d'une condition, état du test à blanc, entrée, sortie unique.
  function buildNode(cv, node) {
    const element = make('div', `node node-${node.type}`, cv.world);
    element.setAttribute('role', 'group');
    const entry = { node, element, pickers: {}, selects: {}, inputs: {} };
    cv.views.set(node.id, entry);
    buildGrip(cv, entry);
    buildHead(cv, entry);
    entry.body = make('div', 'node-body', element);
    entry.issue = make('div', 'node-issue', element);
    entry.issue.hidden = true;
    entry.state = make('div', 'node-state', element);
    entry.state.hidden = true;
    for (const field of NodeTypes.TYPES[node.type].fields) fieldRow(cv, entry, field);
    buildPinIn(cv, entry);
    buildPinsOut(cv, entry);
    syncDisabled(cv, entry);
    placeNode(entry);
    element.addEventListener('focusin', () => bringToFront(cv, element));
    return entry;
  }

  function bringToFront(cv, element) {
    for (const entry of cv.views.values()) entry.element.classList.remove('is-top');
    element.classList.add('is-top');
  }

  function placeNode(entry) {
    entry.element.style.left = entry.node.x + 'px';
    entry.element.style.top = entry.node.y + 'px';
    const width = Graph.nodeWidth(entry.node);
    entry.element.style.width = width === null ? '' : width + 'px';
  }

  // width : largeur voulue, bornée (Graph.WIDTH), ou null pour l'origine ; les liens suivent. Tirée au pointeur (startResize), elle n'est enregistrée qu'au relâchement, si elle a changé.
  function setWidth(cv, entry, width) {
    if (width === null) delete entry.node.w;
    else entry.node.w = Graph.clampWidth(width);
    placeNode(entry);
    drawWires(cv);
  }

  function startResize(cv, event, entry) {
    if (event.button !== 0 || cv.readOnly) return;
    event.stopPropagation();
    event.preventDefault();
    select(cv, { kind: 'node', id: entry.node.id });
    bringToFront(cv, entry.element);
    const start = { x: event.clientX, width: entry.element.offsetWidth, w: entry.node.w };
    cv.container.classList.add('is-resizing');
    entry.element.classList.add('is-resizing');
    track((e) => setWidth(cv, entry, start.width + (e.clientX - start.x) / cv.view.k), () => {
      cv.container.classList.remove('is-resizing');
      entry.element.classList.remove('is-resizing');
      if (entry.node.w !== start.w) cv.onChange(cv.graph);
    });
  }

  // Glisser l'en-tête déplace le nœud ; la position n'est enregistrée qu'au relâchement, et seulement s'il a bougé.
  function startNodeDrag(cv, event, entry) {
    if (event.button !== 0) return;
    event.stopPropagation();
    select(cv, { kind: 'node', id: entry.node.id });
    bringToFront(cv, entry.element);
    if (cv.readOnly) return;
    const start = { x: event.clientX, y: event.clientY, nodeX: entry.node.x, nodeY: entry.node.y };
    let moved = false;
    track((e) => {
      moved = true;
      entry.node.x = Math.round(start.nodeX + (e.clientX - start.x) / cv.view.k);
      entry.node.y = Math.round(start.nodeY + (e.clientY - start.y) / cv.view.k);
      placeNode(entry);
      drawWires(cv);
    }, () => { if (moved) cv.onChange(cv.graph); });
  }

  // link : le lien d'un fil lâché sur le fond ({ from, branch }) ; l'entrée du nœud se pose alors en (x, y), au bout du fil, et le fil la rejoint.
  function addNode(cv, type, x, y, link) {
    const node = Graph.addNode(cv.graph, type, x, y);
    const entry = buildNode(cv, node);
    if (link) {
      const pin = pinCenter(cv, entry.pinIn);
      node.x = Math.round(node.x + x - pin.x);
      node.y = Math.round(node.y + y - pin.y);
      placeNode(entry);
      Graph.connect(cv.graph, link.from, node.id, link.branch);
    }
    refreshSchema(cv);
    select(cv, { kind: 'node', id: node.id });
    bringToFront(cv, entry.element);
    showHints(cv);
    drawWires(cv);
    cv.changed();
    return node;
  }

  /* ---------- Menu d'ajout ---------- */
  function closeMenu(cv) {
    if (!cv.menu) return;
    cv.menu.remove();
    cv.menu = null;
  }

  // (clientX, clientY) : endroit où poser le nœud ; sans arguments, au centre du canevas. Le menu, une liste avec recherche ouverte d'emblée, reste dans
  // le canevas (vers le haut près du bas). link : le lien d'un fil lâché sur le fond ; le menu ne propose alors que les nœuds qui ont une entrée.
  function openAddMenu(cv, clientX, clientY, link) {
    if (cv.readOnly) return;
    closeMenu(cv);
    const rect = cv.container.getBoundingClientRect();
    const x = clientX === undefined ? rect.left + rect.width / 2 : clientX;
    const y = clientY === undefined ? rect.top + rect.height / 2 : clientY;
    const menu = make('div', 'add-menu', cv.container);
    cv.menu = menu;
    menu.style.left = Math.max(0, Math.min(x - rect.left, rect.width - menu.offsetWidth)) + 'px';
    menu.style.top = (y - rect.top) + 'px';
    const list = make('select', '', menu);
    const types = NodeTypes.ORDER.filter((type) => !link || NodeTypes.TYPES[type].inputs > 0);
    fillSelect(list, types.map((type) => [type, t('menu.item', { name: t(NodeTypes.TYPES[type].titleKey), hint: t(NodeTypes.TYPES[type].hintKey) })]));
    const picker = root.SearchSelect.attach(list, { menu: true, within: cv.container, onClose: () => {
      if (cv.menu === menu) closeMenu(cv);
      if (link && cv.connecting === link) stopConnecting(cv);
    } });
    list.addEventListener('change', () => {
      const point = toWorld(cv, x, y);
      if (link) addNode(cv, list.value, point.x, point.y, link);
      else addNode(cv, list.value, point.x - 20, point.y - 12);
    });
    picker.open();
  }

  /* ---------- Fond : déplacement, zoom, clavier ---------- */
  function listen(cv) {
    const { container } = cv;
    container.addEventListener('pointerdown', (event) => {
      if (!isBackground(cv, event.target) || event.button !== 0) return;
      closeMenu(cv);
      stopConnecting(cv);
      select(cv, null);
      container.focus();
      startPanning(cv, event);
    });
    container.addEventListener('wheel', (event) => zoom(cv, event), { passive: false });
    container.addEventListener('contextmenu', (event) => {
      if (!isBackground(cv, event.target) || cv.readOnly) return;
      event.preventDefault();
      openAddMenu(cv, event.clientX, event.clientY);
    });
    container.addEventListener('pointermove', (event) => { if (cv.connecting && !cv.connecting.parked) moveTempWire(cv, event.clientX, event.clientY); });
    document.addEventListener('keydown', (event) => {
      if (event.defaultPrevented) return;
      const typing = event.target.closest && event.target.closest('input, select, textarea, .ss-panel');
      if (event.key === 'Escape') { stopConnecting(cv); closeMenu(cv); }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && !typing && cv.selected && container.contains(document.activeElement)) { event.preventDefault(); removeSelected(cv); }
    });
    document.addEventListener('langchange', () => drawWires(cv));
  }

  /* ---------- Test à blanc : état de chaque nœud ---------- */
  // trace : { id du nœud: 'passed' | 'blocked' | 'else' | 'action' } (js/engine.js) ; le moindre changement du graphe l'efface.
  function showTrace(cv, trace) {
    clearTrace(cv);
    for (const [id, status] of Object.entries(trace)) {
      const entry = cv.views.get(id);
      if (!entry) continue;
      entry.element.classList.add('trace-' + status);
      entry.state.hidden = false;
      entry.state.dataset.i18n = 'trace.' + status;
      entry.state.textContent = t('trace.' + status);
    }
  }

  function clearTrace(cv) {
    for (const entry of cv.views.values()) {
      entry.element.classList.remove('trace-passed', 'trace-blocked', 'trace-else', 'trace-action');
      entry.state.hidden = true;
    }
  }

  /* ---------- Création et chargement ---------- */
  function load(cv, next) {
    for (const entry of cv.views.values()) entry.element.remove();
    cv.views.clear();
    cv.graph = next;
    for (const node of cv.graph.nodes) buildNode(cv, node);
    showHints(cv);
    refreshSchema(cv).then(() => drawWires(cv));
    drawWires(cv);
  }

  // L'état d'un canevas, partagé par toutes les fonctions de ce fichier et de js/canvas-fields.js.
  function newState(container, graph, schema, onChange, readOnly) {
    const world = make('div', 'world', container);
    const wires = svg('svg', { class: 'wires', 'aria-hidden': 'true' }, world);
    const hint = make('p', 'canvas-hint', container);
    hint.dataset.i18n = 'canvas.empty';
    const connectHint = make('p', 'canvas-hint canvas-connect-hint', container);
    connectHint.dataset.i18n = 'canvas.connecting';
    connectHint.hidden = true;
    const tempWire = svg('path', { class: 'wire wire-temp' }, wires);
    tempWire.setAttribute('visibility', 'hidden');
    const cv = {
      container, world, wires, hint, connectHint, tempWire, graph, schema, onChange, readOnly,
      view: { x: 40, y: 40, k: 1 },
      views: new Map(),   // id du nœud -> son entrée
      selected: null,     // { kind: 'node', id } ou { kind: 'edge', from, to }
      connecting: null,   // { from, branch, parked } pendant la création d'un lien ; parked : lâché sur le fond, le menu d'ajout est ouvert
      menu: null,
    };
    cv.changed = () => { clearTrace(cv); cv.onChange(cv.graph); drawWires(cv); };   // un champ montré ou caché déplace les sorties du bas
    return cv;
  }

  // container : élément qui accueille le canevas ; graph : graphe édité ; schema : { currentTable(), tables(), columns(table) -> Promise<string[]> } ;
  // onChange(graph) à chaque modification ; options.readOnly : voir en tête de fichier.
  function create(container, graph, schema, onChange, options) {
    const readOnly = Boolean(options && options.readOnly);
    const cv = newState(container, graph, schema, onChange, readOnly);
    container.classList.toggle('is-readonly', readOnly);
    listen(cv);
    graph.nodes.forEach((node) => buildNode(cv, node));
    container.tabIndex = 0;
    applyView(cv);
    showHints(cv);
    drawWires(cv);
    return {
      load: (next) => load(cv, next),
      refreshSchema: () => refreshSchema(cv),
      openAddMenu: (clientX, clientY) => openAddMenu(cv, clientX, clientY),
      showTrace: (trace) => showTrace(cv, trace),
      setActive: (on) => container.classList.toggle('is-active', on),
      // issues : [{ node, text }], ce qui manque à chaque nœud ; un nœud absent de la liste n'a plus rien de signalé.
      showIssues: (issues) => {
        cv.views.forEach((entry, id) => {
          const texts = issues.filter((issue) => issue.node === id).map((issue) => issue.text);
          entry.element.classList.toggle('has-issue', texts.length > 0);
          entry.issue.hidden = !texts.length;
          entry.issue.textContent = texts.join('\n');
        });
        drawWires(cv);   // le message change la hauteur du nœud, donc la place des sorties du bas
      },
      nodeLabel: (id) => (cv.views.has(id) ? cv.views.get(id).element.querySelector('.node-title').textContent : id),
      getGraph: () => cv.graph,
      select: (next) => select(cv, next),
    };
  }

  root.Canvas = { create };
})(window);
