// Couche Grist + interface du POC V0.5. La logique métier est dans src/engine.js.
// Le workflow est stocké dans les options du widget (grist.setOptions) ;
// les tables _Automation_* du CDC arriveront après le POC.
'use strict';

const $ = (id) => document.getElementById(id);
const Engine = window.AutomationEngine;

const FIELDS = ['trg-action', 'trg-column', 'cond-column', 'cond-operator', 'cond-value', 'act-type', 'act-table', 'act-column', 'act-value'];

let workflow = null;
let tableId = null;
let cache = null;
let lastRecords = [];
let suppressNext = false;

function addLog(message) {
  const li = document.createElement('li');
  li.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  $('log-list').prepend(li);
}

function parseValue(text) {
  if (text !== '' && !isNaN(Number(text))) return Number(text);
  return text;
}

function readForm() {
  const v = (id) => $(id).value.trim();
  const operator = v('cond-operator');
  const condition = v('cond-column')
    ? { column: v('cond-column'), operator, value: parseValue(v('cond-value')) }
    : null;
  const values = v('act-column') ? { [v('act-column')]: parseValue(v('act-value')) } : {};
  return {
    name: 'Workflow 1',
    active: workflow ? workflow.active : false,
    trigger: { action: v('trg-action'), column: v('trg-column') || null },
    condition,
    actions: [{ type: v('act-type'), table: v('act-table') || tableId, values }],
  };
}

function writeForm(wf) {
  if (!wf) return;
  $('trg-action').value = wf.trigger.action;
  $('trg-column').value = wf.trigger.column || '';
  $('cond-column').value = wf.condition ? wf.condition.column : '';
  $('cond-operator').value = wf.condition ? wf.condition.operator : 'eq';
  $('cond-value').value = wf.condition && wf.condition.value !== undefined ? String(wf.condition.value) : '';
  const act = wf.actions[0];
  $('act-type').value = act.type;
  $('act-table').value = act.table === tableId ? '' : act.table;
  const col = Object.keys(act.values)[0];
  $('act-column').value = col || '';
  $('act-value').value = col ? String(act.values[col]) : '';
}

function refreshState() {
  const active = Boolean(workflow && workflow.active);
  $('wf-state').textContent = active ? 'actif' : 'inactif';
  $('toggle-active').textContent = active ? 'Désactiver' : 'Activer';
  $('open-tab-warning').hidden = !active;
}

async function persist() {
  await grist.setOption('workflow', JSON.stringify(workflow));
  refreshState();
}

const gristApi = {
  applyUserActions: (actions) => grist.docApi.applyUserActions(actions),
};

async function handleEvents(events) {
  for (const ev of events) {
    const res = await Engine.runWorkflow(workflow, ev, gristApi);
    if (res.status === 'skipped' || res.status === 'condition-false') continue;
    if (res.status === 'success' && res.effects.some((fx) => fx.table === tableId)) suppressNext = true;
    addLog(`${res.event} ligne ${res.rowId} : ${res.status}${res.error ? ' — ' + res.error : ''}`);
  }
}

async function onRecords(records) {
  lastRecords = records;
  const { events, next } = Engine.diff(cache, records);
  cache = next;
  // Garde-fou anti-boucle du POC : le lot provoqué par nos propres écritures est ignoré.
  // Approximatif (voir GRD-01 du plan de tests) : à remplacer par un marquage précis.
  if (suppressNext) {
    suppressNext = false;
    return;
  }
  if (!workflow || !workflow.active || events.length === 0) return;
  await handleEvents(events);
}

$('wf-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  workflow = readForm();
  await persist();
  addLog('Workflow enregistré.');
});

$('toggle-active').addEventListener('click', async () => {
  workflow = workflow || readForm();
  workflow.active = !workflow.active;
  await persist();
  addLog(`Workflow ${workflow.active ? 'activé' : 'désactivé'}.`);
});

$('test-workflow').addEventListener('click', async () => {
  const wf = readForm();
  const rec = lastRecords[0];
  if (!rec) return addLog('Dry-run impossible : aucune ligne dans la vue.');
  const ev = wf.trigger.action === 'update'
    ? { type: 'update', rowId: rec.id, record: rec, changed: wf.trigger.column ? { [wf.trigger.column]: { from: null, to: rec[wf.trigger.column] } } : {} }
    : { type: wf.trigger.action, rowId: rec.id, record: rec };
  const res = await Engine.runWorkflow(wf, ev, gristApi, { dryRun: true });
  addLog(`DRY-RUN ligne ${rec.id} : ${res.status}${res.error ? ' — ' + res.error : ''} — ${JSON.stringify(res.effects)}`);
});

window.addEventListener('beforeunload', (e) => {
  if (workflow && workflow.active) {
    e.preventDefault();
    e.returnValue = '';
  }
});

if (typeof grist !== 'undefined') {
  grist.ready({ requiredAccess: 'full' });
  grist.onOptions((options) => {
    if (options && options.workflow && !workflow) {
      try {
        workflow = JSON.parse(options.workflow);
        writeForm(workflow);
        refreshState();
      } catch (err) {
        addLog('Configuration illisible, ignorée.');
      }
    }
  });
  grist.onRecords(onRecords, { includeColumns: 'all' });
  grist.selectedTable.getTableId().then((id) => { tableId = id; });
} else {
  addLog('API Grist indisponible : ouvrir ce fichier comme widget Grist.');
}
