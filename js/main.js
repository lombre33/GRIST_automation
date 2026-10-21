// Couche Grist du widget : branche le canevas (js/canvas.js), le graphe (js/graph.js) et le moteur (js/engine.js) sur l'API Grist.
// Le graphe est stocké dans les options du widget (grist.setOption) et, avec l'accord de la personne, dans la table Automation du document.
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
let cursorRecord = null;       // ligne sélectionnée dans Grist (pour « Tester »)
const instanceId = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
const echo = Echo.create();
let executor = null;           // élection de l'exécutant entre onglets ; null tant que la table Automation n'existe pas
let heartbeat = null;
const HEARTBEAT_MS = 6000;
let tables = [];
let tablesAvailable = false;   // la table Automation existe dans le document
const columnsByTable = new Map();

const gristApi = { fetchTable: (name) => grist.docApi.fetchTable(name), applyUserActions: (actions) => grist.docApi.applyUserActions(actions) };
const docApi = Object.assign({ listTables: () => grist.docApi.listTables() }, gristApi);

// append : entrée de l'historique relue du document (plus ancienne que celles déjà affichées) ; sinon la plus récente va en haut.
function addLog(message, date = new Date(), append = false) {
  const li = document.createElement('li');
  li.textContent = `[${date.toLocaleString()}] ${message}`;
  if (append) $('log-list').append(li);
  else $('log-list').prepend(li);
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
  tables = (await grist.docApi.listTables()).filter((name) => !Store.isOwnTable(name));
  await canvas.refreshSchema();
}

/* ---------- Sauvegarde ---------- */

let saveTimer = null;
let savePending = false;

// Le graphe est toujours gardé dans les options du widget ; il l'est aussi dans le document quand la table existe.
function scheduleSave() {
  clearTimeout(saveTimer);
  savePending = true;
  saveTimer = setTimeout(async () => {
    grist.setOption('workflow', JSON.stringify(graph));
    try {
      if (tablesAvailable) await Store.saveGraph(docApi, graph, tableId, Graph.summarize(graph, t));
    } catch (err) {
      addLog(t('log.storeError', { error: err.message }));
    }
    savePending = false;
  }, 300);
}

// Demande l'accord de créer la table ; true si elle existe à la fin. Un refus ne se retient pas : la question revient à l'activation (et aux enregistrements qui en ont besoin).
async function ensureStore() {
  if (tablesAvailable) return true;
  const accepted = await Modal.confirm({
    title: t('consent.title'),
    message: t('consent.body'),
    confirmLabel: t('consent.create'),
    cancelLabel: t('consent.decline'),
  });
  if (!accepted) return false;
  try {
    await Store.ensureTables(docApi);
    tablesAvailable = true;
    addLog(t('log.tablesCreated'));
    startExecutor();
    scheduleSave();
  } catch (err) {
    addLog(t('log.storeError', { error: err.message }));
  }
  return tablesAvailable;
}

// Au démarrage : lit le graphe du document s'il y est, sinon pose la question une fois.
async function initStore() {
  tablesAvailable = (await Store.missingTables(docApi)).length === 0;
  if (!tablesAvailable) await ensureStore();
  if (!tablesAvailable) return;
  const saved = await Store.loadGraph(docApi, tableId);
  if (saved) {
    graph = saved;
    loaded = true;
    canvas.load(graph);
    refreshState();
  }
  await loadOlderLogs();
  startExecutor();
  await electExecutor();
}

// Historique du document : une page à la fois, des plus récentes aux plus anciennes, ajoutée sous les lignes déjà affichées.
const LOG_PAGE = 20;
let oldestLogId = null;

async function loadOlderLogs() {
  try {
    const page = await Store.logsPage(docApi, tableId, LOG_PAGE, oldestLogId);
    for (const entry of page.rows) {
      const author = entry.Auteur ? ` (${entry.Auteur})` : '';
      const message = entry.Evenement === 'activate' || entry.Evenement === 'deactivate'
        ? t(entry.Evenement === 'activate' ? 'log.activated' : 'log.deactivated') + author
        : t('log.event', { event: t('event.' + entry.Evenement), row: entry.Ligne, status: t('result.' + entry.Resultat) + author });
      addLog(message, new Date(entry.Date * 1000), true);
      oldestLogId = entry.id;
    }
    $('logs-more').hidden = !page.more;
  } catch (err) {
    addLog(t('log.storeError', { error: err.message }));
  }
}

// Activation et désactivation sont tracées dans le journal du document (CDC §3.5), avec l'auteur.
async function recordToggle() {
  if (!tablesAvailable) return;
  try {
    await Store.appendLog(docApi, { table: tableId, event: graph.active ? 'activate' : 'deactivate', row: null, result: 'success' });
  } catch (err) {
    addLog(t('log.storeError', { error: err.message }));
  }
}

async function recordRun(result) {
  if (!tablesAvailable) return;
  try {
    await Store.appendLog(docApi, {
      table: tableId,
      event: result.event,
      row: result.rowId,
      result: result.status,
      detail: result.error || JSON.stringify(result.effects),
    });
  } catch (err) {
    addLog(t('log.storeError', { error: err.message }));
  }
}

// Sans table Automation il n'y a pas de verrou partagé : cet onglet exécute seul (risque de doublon si le document est ouvert ailleurs).
const canExecute = () => !executor || executor.isExecutor();

function onExecutorChange(isExecutor) {
  if (graph.active) addLog(t(isExecutor ? 'executor.active' : 'executor.standby'));
  refreshState();
}

// Une autre personne a désactivé le workflow dans le document : cet onglet ne doit pas reprendre l'exécution à sa place.
async function deactivatedElsewhere() {
  const saved = await Store.loadGraph(docApi, tableId);
  if (!saved || saved.active) return false;
  graph.active = false;
  refreshState();
  addLog(t('log.deactivatedElsewhere'));
  await executor.release();
  return true;
}

// Les événements reçus pendant une élection attendent son résultat au lieu d'être perdus.
let electing = null;

function electExecutor() {
  if (!executor) return Promise.resolve();
  electing = elect().finally(() => { electing = null; });
  return electing;
}

async function elect() {
  try {
    if (graph.active && !savePending && await deactivatedElsewhere()) return;
    if (graph.active) await executor.tick();
    else await executor.release();
  } catch (err) {
    addLog(t('log.storeError', { error: err.message }));
  }
}

function startExecutor() {
  if (!tablesAvailable || executor) return;
  executor = Executor.create(docApi, tableId, instanceId, { onChange: onExecutorChange });
  heartbeat = setInterval(electExecutor, HEARTBEAT_MS);
}

function refreshState() {
  const active = graph.active;
  $('toggle-active').textContent = t(active ? 'toggle.deactivate' : 'toggle.activate');
  $('toggle-active').setAttribute('aria-pressed', String(active));
  const standby = active && executor && !executor.isExecutor() && executor.holder() !== '';
  $('open-tab-warning').hidden = !active;
  $('open-tab-warning').dataset.i18n = standby ? 'app.otherTab' : 'app.openTab';
  $('open-tab-warning').textContent = t(standby ? 'app.otherTab' : 'app.openTab');
  canvas.setActive(active);
}

function onGraphChange() {
  scheduleSave();
}

/* ---------- Exécution ---------- */

async function handleEvents(events) {
  for (const event of events) {
    if (!echo.allowRun(event.rowId)) {
      addLog(t('log.loopStopped', { row: event.rowId }));
      continue;
    }
    let expected = null;
    const result = await Engine.runWorkflow(graph, event, gristApi, {
      currentTable: tableId,
      beforeApply: (effects) => { expected = echo.expect(effects.filter((effect) => effect.table === tableId)); },
    });
    if (result.status === 'error' && expected !== null) echo.cancel(expected);
    if (result.status === 'skipped' || result.status === 'condition-false') continue;
    const status = t('result.' + result.status) + (result.error ? ' — ' + result.error : '');
    addLog(t('log.event', { event: t('event.' + result.event), row: result.rowId, status }));
    await recordRun(result);
  }
}

async function onRecords(records) {
  lastRecords = records;
  const { events, next } = Engine.diff(cache, records);
  cache = next;
  // Les modifications qui ne sont que l'écho de nos propres écritures ne redéclenchent rien (js/echo.js).
  const own = echo.filter(events);
  if (!graph.active || own.length === 0) return;
  if (electing) await electing;
  if (!canExecute()) return;
  await handleEvents(own);
}

// Simule sur la première ligne de la vue l'événement du premier déclencheur, sans rien écrire.
async function dryRun() {
  const record = cursorRecord || lastRecords[0];
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

async function toggleActive() {
  if (!graph.active) {
    const issues = Graph.validate(graph, { currentTable: tableId });
    if (issues.length) {
      $('logs').hidden = false;
      $('toggle-logs').setAttribute('aria-pressed', 'true');
      for (const issue of issues) addLog(t('log.cannotActivate', { issue: t(issue.key, { node: issue.node ? canvas.nodeLabel(issue.node) : '' }) }));
      return;
    }
    if (!(await ensureStore())) addLog(t('log.noTables'));
  }
  graph.active = !graph.active;
  refreshState();
  scheduleSave();
  addLog(t(graph.active ? 'log.activated' : 'log.deactivated'));
  recordToggle();
  await electExecutor();
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
  $('logs-more').addEventListener('click', loadOlderLogs);
  window.addEventListener('beforeunload', (event) => {
    if (graph.active) {
      event.preventDefault();
      event.returnValue = '';
    }
    if (executor) executor.release();   // au mieux : sinon l'autre onglet attend l'expiration du verrou
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
  grist.onRecord((record) => { cursorRecord = record; }, { includeColumns: 'all' });
  grist.selectedTable.getTableId().then(async (id) => {
    tableId = id;
    await initStore();
    await loadSchema();
  });
}

start();
