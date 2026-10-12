// Couche Grist du widget : branche le canevas (js/canvas.js), le graphe (js/graph.js) et le moteur (js/engine.js) sur l'API Grist.
// Le graphe est stocké dans les options du widget (grist.setOption) ; les tables _Automation_* du CDC arriveront après le POC.
'use strict';

const $ = (id) => document.getElementById(id);
const t = I18n.t;
const Engine = window.AutomationEngine;

let graph = Graph.create();
let canvas = null;
let loaded = false;
let tableId = null;
let cache = null;
let lastRecords = [];
let suppressNext = false;
let tables = [];
const columnsByTable = new Map();

const gristApi = { applyUserActions: (actions) => grist.docApi.applyUserActions(actions) };

function addLog(message) {
  const li = document.createElement('li');
  li.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  $('log-list').prepend(li);
}

/* ---------- Schéma du document (colonnes et tables proposées dans les nœuds) ---------- */

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

const schema = { currentTable: () => tableId, tables: () => tables, columns: loadColumns };

async function loadSchema() {
  tables = (await grist.docApi.listTables()).filter((name) => !name.startsWith('_Automation_'));
  await canvas.refreshSchema();
}

/* ---------- Sauvegarde ---------- */

let saveTimer = null;

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => grist.setOption('workflow', JSON.stringify(graph)), 300);
}

function refreshState() {
  const active = graph.active;
  $('toggle-active').textContent = t(active ? 'toggle.deactivate' : 'toggle.activate');
  $('toggle-active').setAttribute('aria-pressed', String(active));
  $('open-tab-warning').hidden = !active;
  canvas.setActive(active);
}

function onGraphChange() {
  scheduleSave();
}

/* ---------- Exécution ---------- */

async function handleEvents(events) {
  for (const event of events) {
    const result = await Engine.runWorkflow(graph, event, gristApi, { currentTable: tableId });
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
  if (!graph.active || events.length === 0) return;
  await handleEvents(events);
}

// Simule sur la première ligne de la vue l'événement du premier déclencheur, sans rien écrire.
async function dryRun() {
  const record = lastRecords[0];
  const trigger = graph.nodes.find((node) => node.type === 'trigger');
  if (!record) return addLog(t('log.dryNoRow'));
  if (!trigger) return addLog(t('log.cannotActivate', { issue: t('issue.noTrigger') }));
  const { action, column } = trigger.config;
  const event = action === 'update'
    ? { type: 'update', rowId: record.id, record, changed: column ? { [column]: { from: null, to: record[column] } } : {} }
    : { type: action, rowId: record.id, record };
  const result = await Engine.runWorkflow(graph, event, gristApi, { dryRun: true, currentTable: tableId });
  canvas.showTrace(result.trace);
  const status = t('result.' + result.status) + (result.error ? ' — ' + result.error : '');
  addLog(t('log.dryRun', { row: record.id, status, n: result.effects.length }) + ' ' + JSON.stringify(result.effects));
}

function toggleActive() {
  if (!graph.active) {
    const issues = Graph.validate(graph);
    if (issues.length) {
      $('logs').hidden = false;
      $('toggle-logs').setAttribute('aria-pressed', 'true');
      for (const issue of issues) addLog(t('log.cannotActivate', { issue: t(issue.key, { node: issue.node ? canvas.nodeLabel(issue.node) : '' }) }));
      return;
    }
  }
  graph.active = !graph.active;
  refreshState();
  scheduleSave();
  addLog(t(graph.active ? 'log.activated' : 'log.deactivated'));
}

function toggleLogs() {
  const logs = $('logs');
  logs.hidden = !logs.hidden;
  $('toggle-logs').setAttribute('aria-pressed', String(!logs.hidden));
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
  canvas = Canvas.create($('canvas'), graph, schema, onGraphChange);
  I18n.apply();
  refreshState();
  $('open-settings').addEventListener('click', openSettings);
  document.addEventListener('langchange', refreshState);

  if (typeof grist === 'undefined') return showOutsideGrist();

  $('add-node').addEventListener('click', () => canvas.openAddMenu());
  $('toggle-active').addEventListener('click', toggleActive);
  $('test-workflow').addEventListener('click', dryRun);
  $('toggle-logs').addEventListener('click', toggleLogs);
  window.addEventListener('beforeunload', (event) => {
    if (graph.active) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  grist.ready({ requiredAccess: 'full' });
  grist.onOptions((options) => {
    if (loaded || !options || !options.workflow) return;
    const saved = Graph.parse(options.workflow);
    if (!saved) return addLog(t('log.badConfig'));
    loaded = true;
    graph = saved;
    canvas.load(graph);
    refreshState();
  });
  grist.onRecords(onRecords, { includeColumns: 'all' });
  grist.selectedTable.getTableId().then((id) => {
    tableId = id;
    return loadSchema();
  });
}

start();
