// Couche Grist et interface du POC V0.5. La logique métier est dans js/engine.js.
// Le workflow est stocké dans les options du widget (grist.setOption) ; les tables _Automation_* du CDC arriveront après le POC.
'use strict';

const $ = (id) => document.getElementById(id);
const t = I18n.t;
const Engine = window.AutomationEngine;

let workflow = null;
let tableId = null;
let cache = null;
let lastRecords = [];
let suppressNext = false;
let tables = [];
const columnsByTable = new Map();
const pickers = {};

const gristApi = { applyUserActions: (actions) => grist.docApi.applyUserActions(actions) };

function addLog(message) {
  const li = document.createElement('li');
  li.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  $('log-list').prepend(li);
}

function parseValue(text) {
  return text !== '' && !isNaN(Number(text)) ? Number(text) : text;
}

/* ---------- Listes déroulantes ---------- */

function setOptions(select, entries, emptyKey) {
  const previous = select.value;
  select.replaceChildren();
  if (emptyKey) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.dataset.i18n = emptyKey;
    empty.textContent = t(emptyKey);
    select.append(empty);
  }
  for (const name of entries) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.append(option);
  }
  select.value = entries.includes(previous) ? previous : '';
  if (pickers[select.id]) pickers[select.id].refresh();
}

function isUserColumn(name) {
  return name !== 'id' && name !== 'manualSort' && !name.startsWith('gristHelper_');
}

async function loadColumns(table) {
  if (columnsByTable.has(table)) return columnsByTable.get(table);
  try {
    const data = await grist.docApi.fetchTable(table);
    columnsByTable.set(table, Object.keys(data).filter(isUserColumn));
  } catch (err) {
    addLog(t('log.schemaError', { table, error: err.message }));
    columnsByTable.set(table, []);
  }
  return columnsByTable.get(table);
}

async function refreshTargetColumns() {
  const target = $('act-table').value || tableId;
  setOptions($('act-column'), target ? await loadColumns(target) : [], 'list.choose');
}

async function loadSchema() {
  tables = (await grist.docApi.listTables()).filter((name) => !name.startsWith('_Automation_'));
  setOptions($('act-table'), tables, 'list.currentTable');
  const currentColumns = await loadColumns(tableId);
  setOptions($('trg-column'), currentColumns, 'list.none');
  setOptions($('cond-column'), currentColumns, 'list.none');
  await refreshTargetColumns();
  if (workflow) await writeForm(workflow);
}

/* ---------- Formulaire ---------- */

function readForm() {
  const value = (id) => $(id).value.trim();
  const condition = value('cond-column')
    ? { column: value('cond-column'), operator: value('cond-operator'), value: parseValue(value('cond-value')) }
    : null;
  const values = value('act-column') ? { [value('act-column')]: parseValue(value('act-value')) } : {};
  return {
    name: 'Workflow 1',
    active: workflow ? workflow.active : false,
    trigger: { action: value('trg-action'), column: value('trg-column') || null },
    condition,
    actions: [{ type: value('act-type'), table: value('act-table') || tableId, values }],
  };
}

function setPicker(id, value) {
  $(id).value = value;
  if (pickers[id]) pickers[id].refresh();
}

async function writeForm(wf) {
  const action = wf.actions[0];
  setPicker('trg-action', wf.trigger.action);
  setPicker('trg-column', wf.trigger.column || '');
  setPicker('cond-column', wf.condition ? wf.condition.column : '');
  setPicker('cond-operator', wf.condition ? wf.condition.operator : 'eq');
  $('cond-value').value = wf.condition && wf.condition.value !== undefined ? String(wf.condition.value) : '';
  setPicker('act-type', action.type);
  setPicker('act-table', action.table === tableId ? '' : action.table);
  await refreshTargetColumns();
  const column = Object.keys(action.values)[0];
  setPicker('act-column', column || '');
  $('act-value').value = column ? String(action.values[column]) : '';
  syncDisabledState();
}

// Un champ sans objet est grisé, jamais masqué.
function syncDisabledState() {
  const operator = $('cond-operator').value;
  $('cond-value').disabled = operator === 'empty' || operator === 'notEmpty';
  $('cond-operator').disabled = !$('cond-column').value;
  if (pickers['cond-operator']) pickers['cond-operator'].refresh();
}

function refreshState() {
  const active = Boolean(workflow && workflow.active);
  $('wf-state').textContent = t(active ? 'status.active' : 'status.inactive');
  $('toggle-active').textContent = t(active ? 'toggle.deactivate' : 'toggle.activate');
  $('open-tab-warning').hidden = !active;
}

async function persist() {
  await grist.setOption('workflow', JSON.stringify(workflow));
  refreshState();
}

/* ---------- Exécution ---------- */

async function handleEvents(events) {
  for (const event of events) {
    const result = await Engine.runWorkflow(workflow, event, gristApi);
    if (result.status === 'skipped' || result.status === 'condition-false') continue;
    if (result.status === 'success' && result.effects.some((effect) => effect.table === tableId)) suppressNext = true;
    const status = t('result.' + result.status) + (result.error ? ' — ' + result.error : '');
    addLog(t('log.event', { event: t('event.' + result.event), row: result.rowId, status }));
  }
}

async function onRecords(records) {
  lastRecords = records;
  const { events, next } = Engine.diff(cache, records);
  cache = next;
  // Garde-fou anti-boucle du POC : le lot provoqué par nos propres écritures est ignoré.
  // Approximatif (GRD-01 du plan de tests) : à remplacer par un marquage précis.
  if (suppressNext) {
    suppressNext = false;
    return;
  }
  if (!workflow || !workflow.active || events.length === 0) return;
  await handleEvents(events);
}

async function dryRun() {
  const record = lastRecords[0];
  if (!record) return addLog(t('log.dryNoRow'));
  const wf = readForm();
  const column = wf.trigger.column;
  const event = wf.trigger.action === 'update'
    ? { type: 'update', rowId: record.id, record, changed: column ? { [column]: { from: null, to: record[column] } } : {} }
    : { type: wf.trigger.action, rowId: record.id, record };
  const result = await Engine.runWorkflow(wf, event, gristApi, { dryRun: true });
  const status = t('result.' + result.status) + (result.error ? ' — ' + result.error : '');
  addLog(t('log.dryRun', { row: record.id, status, n: result.effects.length }) + ' ' + JSON.stringify(result.effects));
}

/* ---------- Réglages et crédits ---------- */

function segmented(values, current, labelOf, onPick) {
  const group = document.createElement('div');
  group.className = 'segmented';
  for (const value of values) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = labelOf(value);
    button.setAttribute('aria-pressed', String(value === current));
    button.addEventListener('click', () => {
      onPick(value);
      group.querySelectorAll('button').forEach((other, index) => other.setAttribute('aria-pressed', String(values[index] === value)));
    });
    group.append(button);
  }
  return group;
}

function definition(term, content) {
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  dd.append(content);
  return [dt, dd];
}

function openSettings() {
  const body = document.createElement('div');
  const list = document.createElement('dl');
  list.append(
    ...definition(t('settings.language'), segmented(I18n.LANGS, I18n.lang, (code) => code.toUpperCase(), (code) => I18n.set(code))),
    ...definition(t('settings.theme'), segmented(Theme.MODES, Theme.mode, (mode) => t('theme.' + mode), (mode) => Theme.set(mode))),
  );
  const credits = document.createElement('dl');
  const site = document.createElement('a');
  site.href = 'https://grist-factory.fr';
  site.target = '_blank';
  site.rel = 'noopener noreferrer';
  site.textContent = 'grist-factory.fr';
  const heading = document.createElement('h2');
  heading.textContent = t('credits.title');
  credits.append(
    ...definition(t('credits.author'), document.createTextNode('Grist Factory')),
    ...definition(t('credits.site'), site),
    ...definition(t('credits.license'), document.createTextNode('GNU GPL v3.0')),
    ...definition(t('credits.version'), document.createTextNode(window.APP_VERSION)),
  );
  body.append(list, heading, credits);
  Modal.create({ title: t('settings.title'), width: 'form', body });
}

/* ---------- Démarrage ---------- */

// Adresse du dossier de la page, sans nom de fichier, paramètres ni ancre.
function widgetAddress() {
  return location.origin + location.pathname.replace(/[^/]*$/, '');
}

function showOutsideGrist() {
  const body = document.createElement('div');
  const intro = document.createElement('p');
  intro.textContent = t('firstContact.body');
  const how = document.createElement('p');
  how.textContent = t('firstContact.how');
  const label = document.createElement('label');
  label.textContent = t('firstContact.address');
  const field = document.createElement('input');
  field.type = 'text';
  field.readOnly = true;
  field.value = widgetAddress();
  field.setAttribute('aria-label', t('firstContact.address'));
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = t('modal.copy');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(field.value); copy.textContent = t('modal.copied'); } catch (err) { field.select(); }
  });
  const row = document.createElement('div');
  row.className = 'copy-row';
  row.append(field, copy);
  body.append(intro, how, label, row);
  Modal.create({ title: t('firstContact.title'), width: 'form', body });
}

function start() {
  I18n.apply();
  for (const id of ['trg-action', 'trg-column', 'cond-column', 'cond-operator', 'act-type', 'act-table', 'act-column']) {
    pickers[id] = SearchSelect.attach($(id));
  }
  refreshState();
  $('open-settings').addEventListener('click', openSettings);
  document.addEventListener('langchange', refreshState);

  if (typeof grist === 'undefined') return showOutsideGrist();

  $('wf-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    workflow = readForm();
    await persist();
    addLog(t('log.saved'));
  });
  $('toggle-active').addEventListener('click', async () => {
    workflow = workflow || readForm();
    workflow.active = !workflow.active;
    await persist();
    addLog(t(workflow.active ? 'log.activated' : 'log.deactivated'));
  });
  $('test-workflow').addEventListener('click', dryRun);
  $('cond-column').addEventListener('change', syncDisabledState);
  $('cond-operator').addEventListener('change', syncDisabledState);
  $('act-table').addEventListener('change', refreshTargetColumns);
  window.addEventListener('beforeunload', (event) => {
    if (workflow && workflow.active) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  grist.ready({ requiredAccess: 'full' });
  grist.onOptions((options) => {
    if (!options || !options.workflow || workflow) return;
    try {
      workflow = JSON.parse(options.workflow);
    } catch (err) {
      return addLog(t('log.badConfig'));
    }
    refreshState();
    if (tableId) writeForm(workflow);
  });
  grist.onRecords(onRecords, { includeColumns: 'all' });
  grist.selectedTable.getTableId().then((id) => {
    tableId = id;
    return loadSchema();
  });
}

start();
