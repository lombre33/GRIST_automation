// Les champs d'un nœud du canevas (js/canvas.js) : une ligne par champ que son type déclare (js/nodes.js), et la liste des vérifications d'une condition.
// Les listes qui dépendent du document (colonnes de la table de la vue, tables, colonnes de la table cible) se remplissent après coup, une fois le schéma lu :
// leur choix enregistré reste dans le graphe même si la colonne n'existe plus, la liste le montre alors vide.
// cv : l'état du canevas (Canvas.create) ; entry : ce que le canevas garde d'un nœud { node, element, body, pickers, selects, inputs, viewTable, checksBox, checkViews }.
// Chaque saisie modifie la configuration du nœud puis appelle cv.changed() : le canevas efface le test à blanc affiché et prévient js/main.js, qui enregistre.
(function (root) {
  'use strict';
  const { NodeTypes, SearchSelect, I18n } = root;
  const t = (key, params) => I18n.t(key, params);

  function make(tag, className, parent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (parent) parent.append(node);
    return node;
  }

  // Bouton à icône seule (supprimer un nœud, retirer une vérification) : son nom, pour un lecteur d'écran et en bulle, suit la langue (data-i18n-label).
  function iconButton(className, labelKey, icon, parent) {
    const button = make('button', 'icon-only ' + className, parent);
    button.type = 'button';
    button.dataset.i18nLabel = labelKey;
    button.setAttribute('aria-label', t(labelKey));
    button.title = t(labelKey);
    make('span', 'icon ' + icon, button).setAttribute('aria-hidden', 'true');
    return button;
  }

  // Remplit une liste : entries [valeur, libellé, clé de traduction du libellé ?] ; emptyKey : un premier choix vide, avec son texte.
  // Le choix d'avant est gardé s'il existe encore dans la nouvelle liste.
  function fillSelect(select, entries, emptyKey) {
    const previous = select.value;
    select.replaceChildren();
    if (emptyKey) {
      const empty = make('option', '', select);
      empty.value = '';
      empty.dataset.i18n = emptyKey;
      empty.textContent = t(emptyKey);
    }
    for (const [value, label, labelKey] of entries) {
      const option = make('option', '', select);
      option.value = value;
      option.textContent = label;
      if (labelKey) option.dataset.i18n = labelKey;
    }
    select.value = entries.some(([value]) => value === previous) ? previous : '';
  }

  // Une ligne « étiquette + contrôle » ; l'identifiant du contrôle relie l'étiquette (et sert aux tests : `${id du nœud}-${clé}`).
  function labelledRow(parent, id, labelKey) {
    const line = make('div', 'node-row', parent);
    const label = make('label', '', line);
    label.htmlFor = id;
    label.dataset.i18n = labelKey;
    label.textContent = t(labelKey);
    return line;
  }

  // placeholderKey : l'exemple grisé d'un champ libre, qui suit la langue (data-i18n-placeholder).
  function control(tag, line, id, placeholderKey) {
    const element = make(tag, '', line);
    element.id = id;
    if (tag === 'input') element.type = 'text';
    if (placeholderKey) {
      element.dataset.i18nPlaceholder = placeholderKey;
      element.placeholder = t(placeholderKey);
    }
    return element;
  }

  // Une vérification d'une condition : colonne, opérateur, valeur (sans objet pour « est vide » et « n'est pas vide »), et de quoi la retirer s'il y en a plusieurs.
  // Les identifiants de la première n'ont pas de suffixe, ceux des suivantes finissent par -2, -3…
  function checkRow(cv, entry, index) {
    const check = entry.node.config.checks[index];
    const suffix = index === 0 ? '' : `-${index + 1}`;
    const group = make('div', 'check', entry.checksBox);
    const id = (key) => `${entry.node.id}-${key}${suffix}`;
    const view = {
      column: control('select', labelledRow(group, id('column'), 'cond.column'), id('column')),
      operator: control('select', labelledRow(group, id('operator'), 'cond.operator'), id('operator')),
      value: control('input', labelledRow(group, id('value'), 'cond.value'), id('value'), 'ph.condValue'),
    };
    fillSelect(view.operator, NodeTypes.OPERATORS.map(([value, key]) => [value, t(key), key]));
    view.operator.value = check.operator;
    view.value.value = check.value || '';
    view.value.disabled = !NodeTypes.needsValue(check);
    view.pickers = { column: SearchSelect.attach(view.column), operator: SearchSelect.attach(view.operator) };
    view.column.addEventListener('change', () => { check.column = view.column.value; cv.changed(); });
    view.operator.addEventListener('change', () => { check.operator = view.operator.value; view.value.disabled = !NodeTypes.needsValue(check); cv.changed(); });
    view.value.addEventListener('input', () => { check.value = view.value.value; cv.changed(); });
    if (entry.node.config.checks.length > 1) {
      const remove = iconButton('check-remove', 'check.remove', 'icon-trash', group);
      remove.addEventListener('click', () => { entry.node.config.checks.splice(index, 1); renderChecks(cv, entry); cv.changed(); });
    }
    return view;
  }

  // Reconstruit toute la liste des vérifications (après un ajout ou un retrait, les suffixes des identifiants se décalent).
  function renderChecks(cv, entry) {
    entry.checksBox.replaceChildren();
    entry.checkViews = entry.node.config.checks.map((check, index) => checkRow(cv, entry, index));
    const add = make('button', 'check-add', entry.checksBox);
    add.type = 'button';
    add.dataset.i18n = 'check.add';
    add.textContent = t('check.add');
    add.addEventListener('click', () => {
      entry.node.config.checks.push({ column: '', operator: 'eq', value: '' });
      renderChecks(cv, entry);
      cv.changed();
    });
    syncDisabled(cv, entry);
    fillCheckColumns(cv, entry);
  }

  async function fillCheckColumns(cv, entry) {
    const names = cv.schema.currentTable() ? await cv.schema.columns(cv.schema.currentTable()) : [];
    entry.node.config.checks.forEach((check, index) => {
      const view = entry.checkViews[index];
      if (!view) return;
      fillSelect(view.column, names.map((name) => [name, name]), 'list.choose');
      view.column.value = check.column;
      view.pickers.column.refresh();
    });
  }

  // Un champ déclaré par le type du nœud : 'checks' (les vérifications), 'text' (saisie libre), 'viewTable' (la table de la vue, sans choix), ou une liste : 'choice' (fixe), 'column', 'table', 'targetColumn'
  // (remplies par refreshSchema et refreshTargetColumns).
  function fieldRow(cv, entry, spec) {
    if (spec.kind === 'checks') {
      entry.checksBox = make('div', 'checks', entry.body);
      renderChecks(cv, entry);
      return;
    }
    const config = entry.node.config;
    const inputId = `${entry.node.id}-${spec.key}`;
    const line = labelledRow(entry.body, inputId, spec.labelKey);
    if (spec.kind === 'viewTable') {
      entry.viewTable = make('output', 'node-static', line);
      entry.viewTable.id = inputId;
      entry.viewTable.textContent = cv.schema.currentTable() || '—';
      return;
    }
    if (spec.kind === 'text') {
      const input = control('input', line, inputId, spec.placeholderKey);
      input.value = config[spec.key] || '';
      input.addEventListener('input', () => { config[spec.key] = input.value; cv.changed(); });
      entry.inputs[spec.key] = input;
      return;
    }
    const select = control('select', line, inputId);
    entry.selects[spec.key] = select;
    if (spec.kind === 'choice') {
      fillSelect(select, spec.choices.map(([value, key]) => [value, t(key), key]));
      select.value = config[spec.key] === undefined && spec.fallback ? spec.fallback : config[spec.key];
    }
    entry.pickers[spec.key] = SearchSelect.attach(select);
    select.addEventListener('change', () => {
      config[spec.key] = select.value;
      if (spec.key === 'table') refreshTargetColumns(cv, entry);
      if (spec.key === 'matchColumn') suggestKey(cv, entry);
      syncDisabled(cv, entry);
      cv.changed();
    });
  }

  // Une colonne Référence vers la table de la vue garde le numéro de la ligne visée : sa valeur cherchée, si elle est vide, devient {id}.
  async function suggestKey(cv, entry) {
    const { config } = entry.node;
    const type = cv.schema.columnType ? await cv.schema.columnType(config.table || cv.schema.currentTable(), config.matchColumn) : '';
    if (type !== 'Ref:' + cv.schema.currentTable() || String(config.matchValue || '').trim() !== '') return;
    config.matchValue = '{id}';
    entry.inputs.matchValue.value = '{id}';
    cv.changed();
  }

  // Grise et cache les champs sans objet (disabledWhen du type : le filtre du déclencheur pour une création, la valeur B d'une opération à une valeur…).
  // En lecture seule, tous les contrôles du nœud sont grisés : on voit la configuration, on ne la change pas.
  function syncDisabled(cv, entry) {
    for (const spec of NodeTypes.TYPES[entry.node.type].fields) {
      if (!spec.disabledWhen) continue;
      const field = entry.inputs[spec.key] || entry.selects[spec.key];
      if (!field) continue;   // champ pas encore construit (la liste des vérifications précède « Combiner »)
      field.disabled = spec.disabledWhen(entry.node.config);
      field.closest('.node-row').hidden = field.disabled;   // sans objet : ni montré ni rempli (le nœud reste court), il revient quand il sert
      if (entry.pickers[spec.key]) entry.pickers[spec.key].refresh();
    }
    if (!cv.readOnly || !entry.element) return;
    for (const field of entry.element.querySelectorAll('input, select, button')) field.disabled = true;
    for (const picker of Object.values(entry.pickers)) picker.refresh();
    for (const view of entry.checkViews || []) Object.values(view.pickers).forEach((picker) => picker.refresh());
  }

  // Colonnes de la table cible d'une action ou d'une recherche, pour les listes « Repérer par la colonne », « Colonne à lire » et « Colonne à remplir ».
  async function refreshTargetColumns(cv, entry) {
    if (entry.node.type !== 'action' && entry.node.type !== 'lookup') return;
    const table = entry.node.config.table || cv.schema.currentTable();
    const names = table ? await cv.schema.columns(table) : [];
    for (const spec of NodeTypes.TYPES[entry.node.type].fields) {
      const select = spec.kind === 'targetColumn' && entry.selects[spec.key];
      if (!select) continue;
      fillSelect(select, names.map((name) => [name, name]), spec.emptyKey);
      select.value = entry.node.config[spec.key];
      entry.pickers[spec.key].refresh();
    }
  }

  // Reconstruit les listes qui dépendent du document (colonnes de la table courante, tables, colonnes de la cible), pour tous les nœuds.
  async function refreshSchema(cv) {
    const currentColumns = cv.schema.currentTable() ? await cv.schema.columns(cv.schema.currentTable()) : [];
    for (const entry of cv.views.values()) {
      if (entry.viewTable) entry.viewTable.textContent = cv.schema.currentTable() || '—';
      if (entry.checkViews) await fillCheckColumns(cv, entry);
      for (const spec of NodeTypes.TYPES[entry.node.type].fields) {
        const select = entry.selects[spec.key];
        if (!select) continue;
        if (spec.kind === 'column') fillSelect(select, currentColumns.map((name) => [name, name]), spec.emptyKey);
        else if (spec.kind === 'table') fillSelect(select, cv.schema.tables().map((name) => [name, name]), spec.emptyKey);
        else continue;
        select.value = entry.node.config[spec.key];
        entry.pickers[spec.key].refresh();
      }
      await refreshTargetColumns(cv, entry);
    }
  }

  root.CanvasFields = { make, iconButton, fillSelect, fieldRow, syncDisabled, refreshSchema };
})(window);
