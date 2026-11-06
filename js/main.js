// Couche Grist du widget : branche le canevas (js/canvas.js), le graphe (js/graph.js) et le moteur (js/engine.js) sur l'API Grist.
// Le graphe est gardé dans la table Automation du document, créée avec l'accord de la personne ; sans elle (refus, table inutilisable), dans les options
// du widget (grist.setOption), que Grist garde comme une modification de la vue à enregistrer. Le graphe d'options déjà enregistrées se relit toujours.
// Ce que Grist accorde se lit dans l'adresse du cadre : sans l'accès complet, le widget le dit et attend (Grist recharge le cadre quand il est accordé) ;
// en lecture seule, le workflow se voit et se teste, rien ne s'écrit ni ne s'exécute dans cet onglet.
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
const echo = Echo.create();
let executor = null;           // élection de l'exécutant entre onglets ; null tant que la table Automation n'existe pas
let tab = null;                // l'identifiant de cet onglet pour le verrou (Executor.tabIdentity), connu avec la table de la vue
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => byte.toString(16).padStart(2, '0')).join('');
let heartbeat = null;
const HEARTBEAT_MS = 6000;
let tables = [];
let tablesAvailable = false;   // la table Automation existe dans le document
const columnsByTable = new Map();

// Grist dit dans l'adresse du cadre le niveau d'accès accordé au widget (access : none, read table ou full) et si la personne peut modifier le document (readonly).
// Sans ces paramètres (une version de Grist qui ne les donne pas), on fait comme avant : accès complet, modification permise.
const frameParams = new URLSearchParams(location.search);
const accessGranted = !frameParams.has('access') || frameParams.get('access') === 'full';
const readOnly = frameParams.get('readonly') === 'true';

// Les écritures dans le document et les exécutions en cours sont suivies : GFS qui demande à l'app de partir (`fermer`, js/closing.js) attend leur fin avant de répondre.
const busy = Closing.tracker();
const gristApi = { fetchTable: (name) => grist.docApi.fetchTable(name), applyUserActions: (actions) => busy.track(grist.docApi.applyUserActions(actions)) };
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
    const columns = await grist.docApi.fetchTable(table);
    columnsByTable.set(table, Object.keys(columns).filter(isUserColumn));
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

/* ---------- Contenu enregistré illisible (règle 3 de GFS) ---------- */

let locked = false;   // le workflow enregistré vient d'une version plus récente ou est abîmé : on le laisse tel quel, rien n'est écrit à sa place

// Les boutons qui modifieraient le graphe ou son exécution : grisés, jamais masqués, quand le workflow est conservé tel quel, et en lecture seule
// (« Tester » reste alors : il n'écrit rien).
function syncButtons() {
  $('add-node').disabled = locked || readOnly;
  $('toggle-active').disabled = locked || readOnly;
  $('test-workflow').disabled = locked;
}

// L'explication prend la place du canevas (vide).
function setLocked(value) {
  locked = value;
  $('locked').hidden = !value;
  $('canvas').inert = value;
  syncButtons();
}

// Ce que le canevas montre et ce qui s'exécute : rien. Un graphe déjà lu ailleurs (les réglages de la vue) ne doit pas continuer de tourner à la place de l'illisible.
function lockWorkflow() {
  if (locked) return;
  graph = Graph.create();
  canvas.load(graph);
  refreshState();
  setLocked(true);
  addLog(t('log.badConfig'));
}

// Message du journal pour une erreur ou un problème de la table du document (les codes viennent de js/store.js).
function storeMessage(err) {
  if (err.code === 'name-taken') return t('log.tableNameTaken', { table: err.table });
  if (err.code === 'renamed') return t('log.tableRenamed', { table: err.table });
  if (err.code === 'missing-columns') return t('log.tableColumns', { columns: err.columns.join(', ') });
  if (err.code === 'unreadable-graph') return t('log.badConfig');
  return t('log.storeError', { error: err.message });
}

/* ---------- Sauvegarde ---------- */

let saveTimer = null;
let savePending = false;
let startupDone = false;   // le contenu déjà enregistré a été examiné : avant, on ne sait pas encore s'il faut le laisser intact
// Ce que GFS qui demande à l'app de partir (`fermer`, js/closing.js) veut savoir : editGen compte les modifications du graphe, savedGen la dernière dont l'écriture a réussi
// (les modifications ne sont pas écrites tant que savedGen est en retard), lastSaveError le dernier message d'échec. Les écritures du graphe se font une à la fois (writing).
let editGen = 0;
let savedGen = 0;
let lastSaveError = '';
let writing = Promise.resolve();

// Une écriture du graphe. Réussie quand le document l'a reçue, ou, sans table Automation, quand les réglages de la vue l'ont reçue.
async function persist() {
  if (!startupDone) {
    saveTimer = setTimeout(save, 300);
    return;
  }
  const generation = editGen;
  let stored = false;
  let failed = false;
  if (!locked) {
    try {
      if (tablesAvailable) {
        await Store.saveGraph(docApi, graph, tableId, Graph.summarize(graph, t));
        stored = true;
      }
    } catch (err) {
      failed = true;
      lastSaveError = storeMessage(err);
      addLog(lastSaveError);
      if (err.code === 'unreadable-graph') setLocked(true);   // un autre onglet vient d'y mettre un contenu que cette version ne lit pas
    }
  }
  // Les réglages de la vue ne prennent le graphe que s'il n'a pas pu aller dans la table : Grist y voit une modification de la vue à enregistrer
  // (son bouton « Enregistrer », en haut de la vue), que la personne devrait sinon presser à chaque changement.
  let kept = stored;
  if (!locked && !stored) {
    try {
      await Promise.race([grist.setOption('workflow', JSON.stringify(graph)), new Promise((resolve) => setTimeout(resolve, 2000))]);
      kept = !failed;   // si la table existe mais n'a rien reçu, le graphe du document, que la relecture préfère, reste l'ancien : ce n'est pas enregistré
    } catch (err) {
      lastSaveError = storeMessage(err);
    }
  }
  if (kept) {
    savedGen = Math.max(savedGen, generation);
    lastSaveError = '';
  }
  savePending = false;
}

// Une constante plutôt qu'une fonction déclarée : rien d'autre dans la page ne peut la remplacer avant que la minuterie ne l'appelle.
const save = () => {
  const run = writing.then(persist).catch((err) => { lastSaveError = storeMessage(err); addLog(lastSaveError); });
  writing = run;
  return run;
};

// Le graphe est toujours gardé dans les options du widget ; il l'est aussi dans le document quand la table existe.
function scheduleSave() {
  if (locked || readOnly) return;
  clearTimeout(saveTimer);
  savePending = true;
  editGen += 1;
  saveTimer = setTimeout(save, 300);
}

// Enregistre tout de suite ce qui attend, sans la minuterie, et rend quand l'écriture est finie ; vrai quand tout est écrit (pour `fermer`, js/closing.js).
async function flushSave() {
  // Avant la fin du démarrage rien ne s'écrit (persist attend) : on lui laisse le temps de finir, mais seulement s'il y a quelque chose à écrire.
  if (editGen > savedGen) for (let waited = 0; !startupDone && waited < 5000; waited += 100) await new Promise((resolve) => setTimeout(resolve, 100));
  clearTimeout(saveTimer);
  saveTimer = null;
  if (editGen > savedGen && !locked && !readOnly) await save();
  else await writing;
  return editGen <= savedGen;
}

// Dit dans le journal pourquoi la table du document ne peut pas servir (nom déjà pris, colonnes absentes) ; true s'il y a un problème.
async function storeProblem() {
  const problem = await Store.problem(docApi);
  if (problem) addLog(storeMessage(problem));
  return Boolean(problem);
}

// Demande l'accord de créer la table ; true si elle existe à la fin. Un refus ne se retient pas : la question revient à l'activation (et aux enregistrements qui en ont besoin).
async function ensureStore() {
  if (tablesAvailable) return true;
  if (readOnly) return false;   // créer la table demande de pouvoir modifier le document : la question n'aurait pas de sens
  if (await storeProblem()) return false;
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
    addLog(storeMessage(err));
  }
  return tablesAvailable;
}

// La question de l'app quand GFS va la remplacer (`fermer`, js/closing.js) et que le graphe n'a pas pu être enregistré : 'save', 'discard' ou 'cancel'.
// Annuler et Échap gardent l'app telle qu'elle est ; GFS laisse la question à l'écran tant que la personne n'y a pas répondu.
function askBeforeLeaving() {
  return new Promise((resolve) => {
    const body = document.createElement('p');
    body.textContent = t('close.body') + (lastSaveError ? ' ' + lastSaveError : '');
    Modal.create({
      title: t('close.title'),
      body,
      buttons: [
        { label: t('close.cancel'), onClick: () => resolve('cancel') },
        { label: t('close.discard'), onClick: () => resolve('discard') },
        { label: t('close.save'), primary: true, onClick: () => resolve('save') },
      ],
      onClose: () => resolve('cancel'),
    });
  });
}

// Au démarrage : lit le graphe du document s'il y est, sinon pose la question une fois.
async function initStore() {
  const exists = (await Store.missingTables(docApi)).length === 0;
  tablesAvailable = exists && !(await storeProblem());
  if (!exists) await ensureStore();   // en lecture seule, rien n'est demandé : le workflow reste celui des options de la vue
  if (!tablesAvailable) return;
  const stored = await Store.readGraph(docApi, tableId);
  if (stored.state === 'unreadable') {
    lockWorkflow();
  } else if (stored.state === 'ok') {
    setLocked(false);   // le graphe du document passe avant celui des options, même si celui-ci était illisible
    graph = stored.graph;
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
    addLog(storeMessage(err));
  }
}

// Activation et désactivation sont tracées dans le journal du document (CDC §3.5), avec l'auteur.
async function recordToggle() {
  if (!tablesAvailable) return;
  try {
    await Store.appendLog(docApi, { table: tableId, event: graph.active ? 'activate' : 'deactivate', row: null, result: 'success' });
  } catch (err) {
    addLog(storeMessage(err));
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
    addLog(storeMessage(err));
  }
}

// Sans table Automation il n'y a pas de verrou partagé : cet onglet exécute seul (risque de doublon si le document est ouvert ailleurs).
// En lecture seule, jamais : Grist refuserait chaque écriture, et c'est l'onglet d'une personne qui peut modifier le document qui exécute.
const canExecute = () => !readOnly && (!executor || executor.isExecutor());

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

// Une constante, comme save : la minuterie du battement (startExecutor) appelle toujours celle-ci.
const electExecutor = () => {
  if (!executor) return Promise.resolve();
  electing = elect().finally(() => { electing = null; });
  return electing;
};

async function elect() {
  try {
    if (graph.active && !savePending && await deactivatedElsewhere()) return;
    if (graph.active) await executor.tick();
    else await executor.release();
  } catch (err) {
    addLog(storeMessage(err));
  }
}

// En lecture seule, pas d'élection : prendre le verrou est une écriture, que Grist refuserait toutes les 6 secondes.
function startExecutor() {
  if (!tablesAvailable || executor || readOnly) return;
  executor = Executor.create(docApi, tableId, tab.id, { onChange: onExecutorChange });
  heartbeat = setInterval(electExecutor, HEARTBEAT_MS);
}

// Pour `fermer` (js/closing.js) : le verrou d'exécution est rendu tout de suite, pour que l'onglet qui attend reprenne sans attendre son expiration, et le battement s'arrête.
async function releaseExecutor() {
  clearInterval(heartbeat);
  heartbeat = null;
  if (electing) await electing;
  if (executor) await executor.release();
}

function refreshState() {
  const active = graph.active;
  $('toggle-active').textContent = t(active ? 'toggle.deactivate' : 'toggle.activate');
  $('toggle-active').setAttribute('aria-pressed', String(active));
  const standby = active && executor && !executor.isExecutor() && executor.holder() !== '';
  $('open-tab-warning').hidden = !active || readOnly;   // en lecture seule, cet onglet n'exécute jamais : le bandeau de lecture seule le dit
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
  if (!graph.active || own.length === 0 || readOnly) return;
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
  // Aide : la prise en main (js/tutorial.js), qui s'ouvre par-dessus les Réglages et leur rend le focus quand elle se ferme.
  const help = document.createElement('button');
  help.type = 'button';
  help.id = 'open-tutorial';
  help.textContent = t('tuto.title');
  help.setAttribute('aria-haspopup', 'dialog');
  help.addEventListener('click', () => Tutorial.open());
  list.append(
    ...definition(t('settings.language'), segmented(I18n.LANGS, I18n.lang, (code) => code.toUpperCase(), (code) => I18n.set(code))),
    ...definition(t('settings.theme'), segmented(Theme.MODES, Theme.mode, (mode) => t('theme.' + mode), (mode) => Theme.set(mode))),
    ...definition(t('settings.help'), help),
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
    ...definition(t('credits.version'), document.createTextNode(t('credits.versionValue', { version: window.APP_VERSION }))),
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

// L'accès complet n'est pas (encore) accordé : Grist ne répond pas à la lecture de la table de la vue et refuse le reste. On le dit à la place du canevas,
// au lieu d'un widget qui a l'air de marcher et n'enregistre rien ; Grist recharge le cadre quand la personne accepte.
function showAccessNeeded() {
  $('access-needed').hidden = false;
  $('canvas').inert = true;
  for (const id of ['add-node', 'test-workflow', 'toggle-active']) $(id).disabled = true;
  startupDone = true;
}

// Lecture seule : le canevas se déplace et se zoome mais ne se modifie pas (js/canvas.js) ; « Tester » reste, il n'écrit rien.
function showReadOnly() {
  $('read-only-notice').hidden = false;
  syncButtons();
}

// L'identifiant de cet onglet, gardé le temps d'un rechargement (js/executor.js, tabIdentity) : une clé par table de vue, deux vues du widget dans la même page ne se le prennent pas.
function rememberTab(table) {
  tab = Executor.tabIdentity(() => sessionStorage, 'ab_executor_' + table, randomId);
  window.addEventListener('pagehide', () => tab.keep());
  window.addEventListener('pageshow', (event) => { if (event.persisted) tab.forget(); });
}

function start() {
  I18n.apply();
  canvas = Canvas.create($('canvas'), graph, schema, onGraphChange, { readOnly });
  I18n.apply();
  refreshState();
  $('open-settings').addEventListener('click', openSettings);
  document.addEventListener('langchange', refreshState);

  if (typeof grist === 'undefined') {
    startupDone = true;
    return showOutsideGrist();
  }

  $('add-node').addEventListener('click', () => canvas.openAddMenu());
  $('toggle-active').addEventListener('click', toggleActive);
  $('test-workflow').addEventListener('click', dryRun);
  $('toggle-logs').addEventListener('click', toggleLogs);
  $('logs-more').addEventListener('click', loadOlderLogs);
  window.addEventListener('beforeunload', (event) => {
    if (graph.active && !readOnly) {
      event.preventDefault();
      event.returnValue = '';
    }
    if (executor) executor.release();   // au mieux : sinon l'autre onglet attend l'expiration du verrou
  });

  grist.ready({ requiredAccess: 'full' });
  if (!accessGranted) return showAccessNeeded();
  if (readOnly) showReadOnly();
  grist.onOptions((options) => {
    if (loaded || locked || !options || !options.workflow) return;
    const saved = Graph.parse(options.workflow);
    if (!saved) return lockWorkflow();
    loaded = true;
    graph = saved;
    canvas.load(graph);
    refreshState();
  });
  grist.onRecords(busy.wrap(onRecords), { includeColumns: 'all' });
  grist.onRecord((record) => { cursorRecord = record; }, { includeColumns: 'all' });
  // GFS qui va remplacer l'app (`fermer`, répondu par js/gfs.js) : ce qui attend est écrit, et ce qui s'écrit est fini, avant de répondre oui (js/closing.js).
  Closing.install(Closing.create({
    flush: flushSave,
    unsaved: () => editGen > savedGen,
    busy: busy.idle,
    ask: askBeforeLeaving,
    release: releaseExecutor,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }));
  grist.selectedTable.getTableId().then(async (id) => {
    tableId = id;
    rememberTab(id);
    try {
      await initStore();
    } finally {
      startupDone = true;
    }
    // La prise en main, la première fois, pour qui peut modifier le document : après la question de la table (initStore l'attend), jamais par-dessus elle.
    if (!readOnly) Tutorial.openFirstTime();
    await loadSchema();
  }).catch((err) => {
    startupDone = true;
    throw err;
  });
}

start();
