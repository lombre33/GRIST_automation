// Scénario de base de bout en bout (Chromium + API Grist simulée) : npm run test:e2e
// Prérequis : Playwright installé hors du dépôt (tests/e2e/harness.mjs : le site servi, l'API Grist simulée, Chromium).
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root, stubSource, serve, launch, routeApi, tutorialSeen, addNode, pick, waitSchema } from './harness.mjs';

const { server, url } = await serve();
const browser = await launch();
let failures = 0;
// host : { context, fallback, query } joue l'app dans un faux GFS (tests/e2e/gfs-host.html), un cadre isolé comme chez GFS, qui rend `context` à l'appel `contexte` (query : ce qui s'ajoute à l'adresse du cadre) ; run(page, app) reçoit alors aussi le cadre de l'app
//   (`app`), dans lequel on lit et on clique (`page` reste la page de l'hôte : souris, clavier, captures). Sans host, `app` est la page. `fallback` garde le garde-fou de 2 s de l'attente de l'ambiance.
// blocked : adresses (globs) dont la requête échoue ; tolerated : messages de la console attendus dans ce scénario.
// query : ce que Grist ajoute à l'adresse du cadre (`?access=none`, `?access=full&readonly=true`…), lu par js/main.js.
// E2E_ONLY=<expression régulière> ne joue que les scénarios dont le nom lui correspond (E2E_ONLY='E2E-3[6-9]|E2E-4').
// tutorial : la prise en main s'ouvre d'elle-même, comme dans un navigateur qui ne l'a jamais vue ; sinon, elle est déjà vue et ne gêne pas le scénario.
async function scenario(name, run, { grist = true, viewport = { width: 1100, height: 700 }, noTables = false, foreignLock = false, preloadLogs = 0, init = null, host = null, blocked = [], tolerated = [], query = '', tutorial = false } = {}) {
  if (process.env.E2E_ONLY && !new RegExp(process.env.E2E_ONLY).test(name)) return;
  const context = await browser.newContext({ viewport, locale: 'fr-FR' });
  if (!tutorial) await tutorialSeen(context);
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  if (preloadLogs) await page.addInitScript((n) => { window.__preloadLogs = n; }, preloadLogs);
  if (foreignLock) await page.addInitScript(() => { window.__foreignLock = true; });
  if (noTables) await page.addInitScript(() => { window.__noTables = true; });
  if (init) await page.addInitScript((values) => Object.assign(window, values), init);
  if (host) await page.addInitScript((value) => { window.__context = value; }, host.context ?? {});
  if (host && host.query) await page.addInitScript((value) => { window.__frameQuery = value; }, host.query);
  if (host && !host.fallback) {
    // Le garde-fou de 2 s de js/theme.js est coupé : si l'ambiance ne levait pas l'attente, la page resterait cachée et l'essai échouerait, au lieu de passer grâce au garde-fou.
    await page.addInitScript(() => {
      const set = window.setTimeout.bind(window);
      window.setTimeout = (fn, ms, ...args) => (ms === 2000 ? 0 : set(fn, ms, ...args));
    });
  }
  for (const glob of blocked) await page.route(glob, (route) => route.abort());
  await routeApi(page, grist);
  try {
    await page.goto(host ? `${url}tests/e2e/gfs-host.html` : url + query);
    let app = page;
    if (host) {
      app = await (await page.waitForSelector('#app')).contentFrame();
      await app.waitForSelector('#add-node');
    }
    await run(page, app);
    assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p) && !tolerated.some((t) => t.test(p))), [], 'erreurs console ou violations de la politique de sécurité');
    console.log('ok   ', name);
  } catch (err) {
    failures += 1;
    console.log('FAIL ', name, '\n', err.message);
    await shot(page, `echec-${name.slice(0, 6)}`).catch(() => {});
  }
  await context.close();
}

// E2E_SHOTS=<dossier> : range des captures d'écran des scénarios dans un GFS simulé, à regarder à la main (rien n'est écrit sans cette variable).
async function shot(page, name) {
  if (!process.env.E2E_SHOTS) return;
  fs.mkdirSync(process.env.E2E_SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(process.env.E2E_SHOTS, `${name}.png`) });
}

// Le nœud action-1 ajoute une ligne dans Archive, colonne Motif = value.
async function archiveAction(page, value) {
  await pick(page, 'action-1-type', 'ajouter');
  await pick(page, 'action-1-table', 'archive');
  await pick(page, 'action-1-column', 'motif');
  await page.fill('#action-1-value', value);
}

// Fait passer les lignes de la vue par ces états, l'un après l'autre.
async function push(page, ...records) {
  for (const record of records) await page.evaluate((r) => window.__stub.pushRecords([r]), record);
}

// Active le workflow puis fait passer la ligne 1 de « Nouveau » à « Clos » ; attend les deux lignes du journal (activation, exécution).
async function activateAndClose(page) {
  await page.click('#toggle-active');
  await push(page, { id: 1, Nom: 'A', Statut: 'Nouveau' }, { id: 1, Nom: 'A', Statut: 'Clos' });
  await page.waitForFunction(() => window.__stub.docTables.Automation.rows.filter((r) => r.Type === 'Log').length === 2);
}

// La ligne illisible de la table Automation est toujours seule et intacte, et les réglages de la vue n'ont rien reçu.
async function assertUntouched(target, message) {
  const rows = await target.evaluate(() => window.__stub.docTables.Automation.rows);
  assert.deepEqual(rows.map((row) => [row.Type, row.Config]), [['Workflow', newerGraph]], message);
  assert.equal(await target.evaluate(() => window.__stub.options.workflow), undefined, 'rien dans les réglages de la vue non plus');
}

// Déclencheur -> condition -> action, entièrement configurés (premier lien au clic puis clic, second au glisser).
async function buildFlow(page) {
  await addNode(page, 'Déclencheur', 40, 120);
  await addNode(page, 'Condition', 330, 120);
  await addNode(page, 'Action', 620, 120);
  await waitSchema(page);
  await pick(page, 'trigger-1-column', 'statut');
  await pick(page, 'condition-1-column', 'statut');
  await page.fill('#condition-1-value', 'Clos');
  await archiveAction(page, 'clos');
  await page.locator('.node-trigger .pin-out').click();
  await page.locator('.node-condition .pin-in').click();
  const out = await page.locator('.node-condition .pin-out[data-branch=then]').boundingBox();
  const inn = await page.locator('.node-action .pin-in').boundingBox();
  await page.mouse.move(out.x + 7, out.y + 7);
  await page.mouse.down();
  await page.mouse.move(inn.x + 7, inn.y + 7, { steps: 5 });
  await page.mouse.up();
}

await scenario('E2E-01 scénario de base : trois nœuds reliés, activation, écriture dans Archive', async (page) => {
  assert.equal(await page.locator('.canvas-hint').first().isVisible(), true, 'invite sur un fond vide');
  await buildFlow(page);
  assert.equal(await page.locator('.wire-group').count(), 2);
  await page.click('#toggle-active');
  assert.equal(await page.locator('#open-tab-warning').isVisible(), true, 'bandeau « onglet ouvert requis »');
  await page.evaluate(() => window.__stub.pushRecords([{ id: 1, Nom: 'A', Statut: 'Nouveau' }]));
  await page.evaluate(() => window.__stub.pushRecords([{ id: 1, Nom: 'A', Statut: 'Clos' }]));
  await page.waitForFunction(() => window.__stub.applied.length > 0);
  assert.deepEqual(await page.evaluate(() => window.__stub.applied), [['AddRecord', 'Archive', null, { Motif: 'clos' }]]);
  await page.click('#toggle-logs');
  assert.match(await page.locator('#log-list li').first().innerText(), /modification ligne 1 : réussi/);
});

await scenario('E2E-02 dry-run : état de chaque nœud, aucune écriture', async (page) => {
  await buildFlow(page);
  await page.evaluate(() => window.__stub.pushRecords([{ id: 1, Nom: 'A', Statut: 'Clos' }]));
  await page.click('#test-workflow');
  assert.equal(await page.locator('.node-trigger .node-state').innerText(), 'Passé');
  assert.equal(await page.locator('.node-condition .node-state').innerText(), 'Passé');
  assert.equal(await page.locator('.node-action .node-state').innerText(), 'Action prévue');
  assert.deepEqual(await page.evaluate(() => window.__stub.applied), []);
  await page.fill('#condition-1-value', 'Autre');
  await page.click('#test-workflow');
  assert.equal(await page.locator('.node-condition .node-state').innerText(), 'Bloqué par la condition');
  assert.equal(await page.locator('.node-action .node-state').isHidden(), true);
});

await scenario('E2E-03 thème clair/sombre et langue fr/en depuis les Réglages', async (page) => {
  await page.click('#open-settings');
  const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.getByRole('button', { name: 'Sombre' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), light);
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  assert.equal(await page.locator('h1').innerText(), 'Grist Automation Builder');
  assert.equal(await page.locator('#toggle-active').innerText(), 'Turn on');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
});

await scenario('E2E-04 fenêtre : focus piégé, Échap ferme, focus rendu à l\'ouvreur', async (page) => {
  await page.click('#open-settings');
  assert.equal(await page.locator('[role=dialog]').count(), 1);
  for (let i = 0; i < 8; i += 1) await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.closest('[role=dialog]') !== null), true, 'le focus reste dans la fenêtre');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[role=dialog]').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'open-settings');
});

await scenario('E2E-05 liste avec recherche dans un nœud : Échap ferme la liste seule', async (page) => {
  await addNode(page, 'Condition', 100, 120);
  await waitSchema(page);
  const host = page.locator('#condition-1-column').locator('xpath=..');
  await host.locator('.ss-button').click();
  await host.locator('input').fill('nom');
  assert.equal(await host.locator('.ss-options li[role=option]').count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await host.locator('.ss-panel').isHidden(), true);
  assert.equal(await page.locator('.node-condition').count(), 1, 'le nœud reste');
});

await scenario('E2E-06 tient dans 700×400 : en-tête complet, pas de défilement', async (page) => {
  const fits = await page.evaluate(() => [...document.querySelectorAll('.app-header button')].every((b) => b.getBoundingClientRect().right <= window.innerWidth));
  assert.equal(fits, true, 'tous les boutons de l\'en-tête sont visibles');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth && document.documentElement.scrollHeight <= document.documentElement.clientHeight), true);
}, { viewport: { width: 700, height: 400 } });

await scenario('E2E-07 hors de Grist : une fenêtre dit quoi faire', async (page) => {
  await page.waitForSelector('[role=dialog]');
  assert.match(await page.locator('.modal-title').innerText(), /depuis Grist/);
  assert.match(await page.locator('.modal input').inputValue(), /^http:\/\/localhost:\d+\/$/);
}, { grist: false });

await scenario('E2E-08 activation refusée tant que le graphe est incomplet', async (page) => {
  await addNode(page, 'Déclencheur', 60, 120);
  await page.click('#toggle-active');
  assert.equal(await page.locator('#open-tab-warning').isHidden(), true);
  assert.match(await page.locator('#log-list li').first().innerText(), /Activation impossible : Ajoutez un nœud Action/);
});

await scenario('E2E-09 suppression : lien sélectionné + Suppr, bouton du nœud', async (page) => {
  await buildFlow(page);
  await page.locator('.wire-hit').first().dispatchEvent('pointerdown');
  await page.keyboard.press('Delete');
  assert.equal(await page.locator('.wire-group').count(), 1);
  await page.locator('.node-condition .node-delete').click();
  assert.equal(await page.locator('.node-condition').count(), 0);
  assert.equal(await page.locator('.wire-group').count(), 0, 'les liens du nœud partent avec lui');
});

await scenario('E2E-10 déplacement du fond, zoom à la molette, déplacement d\'un nœud', async (page) => {
  await addNode(page, 'Action', 200, 200);
  const transform = () => page.locator('.world').evaluate((w) => w.style.transform);
  const before = await transform();
  await page.mouse.move(700, 500);
  await page.mouse.down();
  await page.mouse.move(760, 540, { steps: 4 });
  await page.mouse.up();
  const panned = await transform();
  assert.notEqual(panned, before);
  await page.mouse.move(500, 400);
  await page.mouse.wheel(0, -200);
  assert.notEqual(await transform(), panned);
  const head = await page.locator('.node-action .node-head').boundingBox();
  const start = await page.locator('.node-action').boundingBox();
  await page.mouse.move(head.x + 30, head.y + 8);
  await page.mouse.down();
  await page.mouse.move(head.x + 130, head.y + 58, { steps: 4 });
  await page.mouse.up();
  const end = await page.locator('.node-action').boundingBox();
  assert.ok(end.x > start.x + 50 && end.y > start.y + 25);
});

// Le graphe de la table Automation (sans identifiant de ligne), une fois que son dernier état y est écrit.
const savedRows = async (page, done) => {
  await page.waitForFunction(done);
  return page.evaluate(() => window.__stub.docTables.Automation.rows.map(({ id, ...row }) => row));
};
const workflowSaved = (test) => `(() => { const row = window.__stub.docTables.Automation.rows.find((r) => r.Type === 'Workflow'); return Boolean(row) && (${test})(JSON.parse(row.Config)); })()`;

await scenario('E2E-11 sauvegarde automatique et rechargement du graphe', async (page) => {
  await buildFlow(page);
  const saved = await savedRows(page, workflowSaved('(graph) => graph.edges.length === 2'));
  const copy = await page.context().newPage();
  await copy.addInitScript((rows) => { window.__preloadRows = rows; }, saved);
  await routeApi(copy);
  await copy.goto(url);
  await copy.waitForSelector('.node-action');
  assert.equal(await copy.locator('.node').count(), 3);
  assert.equal(await copy.locator('.wire-group').count(), 2);
  await copy.waitForFunction(() => document.querySelector('#action-1-column') && document.querySelector('#action-1-column').value === 'Motif');
  assert.equal(await copy.locator('#action-1-value').inputValue(), 'clos');
});

await scenario('E2E-12 tables du document : accord demandé au démarrage, graphe et journal enregistrés', async (page) => {
  await page.waitForSelector('[role=dialog]');
  assert.match(await page.locator('.modal-title').innerText(), /Créer la table du widget/);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Créer la table', 'le focus est sur l\'action');
  await page.getByRole('button', { name: 'Créer la table' }).click();
  assert.deepEqual(await page.evaluate(() => Object.keys(window.__stub.docTables)), ['Automation']);
  await buildFlow(page);
  await page.waitForFunction(() => window.__stub.docTables.Automation.rows.some((r) => r.Type === 'Workflow') && JSON.parse(window.__stub.docTables.Automation.rows.find((r) => r.Type === 'Workflow').Config).edges.length === 2);
  const row = await page.evaluate(() => window.__stub.docTables.Automation.rows.find((r) => r.Type === 'Workflow'));
  assert.equal(row.Type, 'Workflow');
  assert.equal(row.Table, 'Contacts');
  assert.match(row.Resume, /Déclencheur : modifiée \(Statut\) → Condition : Statut est égal à Clos → Action/);
  await activateAndClose(page);
  const log = await page.evaluate(() => window.__stub.docTables.Automation.rows.find((r) => r.Type === 'Log' && r.Evenement === 'update'));
  const toggle = await page.evaluate(() => window.__stub.docTables.Automation.rows.find((r) => r.Type === 'Log' && r.Evenement === 'activate'));
  assert.equal(toggle.Table, 'Contacts', 'l\'activation est tracée dans le journal');
  assert.deepEqual([log.Table, log.Evenement, log.Ligne, log.Resultat], ['Contacts', 'update', 1, 'success']);
}, { noTables: true });

await scenario('E2E-13 accord refusé : le widget marche sans tables, la question revient à l\'activation', async (page) => {
  await page.waitForSelector('[role=dialog]');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[role=dialog]').count(), 0);
  assert.deepEqual(await page.evaluate(() => Object.keys(window.__stub.docTables)), []);
  await buildFlow(page);
  await page.click('#toggle-active');
  await page.waitForSelector('[role=dialog]');
  await page.getByRole('button', { name: 'Ne pas créer' }).click();
  assert.equal(await page.locator('#open-tab-warning').isVisible(), true, 'activé malgré le refus');
  await page.click('#toggle-logs');
  assert.match(await page.locator('#log-list').innerText(), /Non enregistré : la table du widget/);
  assert.deepEqual(await page.evaluate(() => Object.keys(window.__stub.docTables)), []);
}, { noTables: true });

await scenario('E2E-14 le graphe du document est relu au démarrage, avec le journal', async (page) => {
  await buildFlow(page);
  await activateAndClose(page);
  await page.waitForTimeout(400);
  const tables = await page.evaluate(() => JSON.stringify(window.__stub.docTables));
  const copy = await page.context().newPage();
  await copy.addInitScript((saved) => { window.__restore = JSON.parse(saved); }, tables);
  await routeApi(copy, true, stubSource.replace('window.__stub = {', 'Object.assign(docTables, window.__restore || {}); window.__stub = {'));
  await copy.goto(url);
  await copy.waitForSelector('.node-action');
  assert.equal(await copy.locator('.node').count(), 3);
  assert.equal(await copy.locator('#toggle-active').innerText(), 'Désactiver', 'état actif relu');
  await copy.click('#toggle-logs');
  assert.match(await copy.locator('#log-list').innerText(), /modification ligne 1 : réussi/);
});

async function buildSelfUpdate(page) {
  await addNode(page, 'Déclencheur', 40, 120);
  await addNode(page, 'Action', 400, 120);
  await waitSchema(page);
  await pick(page, 'trigger-1-column', 'statut');
  await pick(page, 'action-1-column', 'statut');
  await page.fill('#action-1-value', 'Clos');
  await page.locator('.node-trigger .pin-out').click();
  await page.locator('.node-action .pin-in').click();
}

await scenario('E2E-15 anti-boucle précis : notre propre écriture ne redéclenche pas, la modification d\'une personne oui', async (page) => {
  await buildSelfUpdate(page);
  await page.click('#toggle-active');
  const pushStatus = (value) => page.evaluate((v) => window.__stub.pushRecords([{ id: 1, Nom: 'A', Statut: v }]), value);
  await pushStatus('Nouveau');
  await pushStatus('En cours');
  await page.waitForFunction(() => window.__stub.applied.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__stub.applied[0]), ['UpdateRecord', 'Contacts', 1, { Statut: 'Clos' }]);
  await pushStatus('Clos');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__stub.applied.length), 1, 'l\'écho de notre écriture est ignoré');
  await pushStatus('Nouveau');
  await page.waitForFunction(() => window.__stub.applied.length === 2);
}, { });

await scenario('E2E-16 exécution unique : l\'onglet prend le verrou, le libère à la désactivation', async (page) => {
  await buildFlow(page);
  await page.click('#toggle-active');
  const lock = () => page.evaluate(() => window.__stub.docTables.Automation.rows.find((r) => r.Type === 'Lock'));
  await page.waitForFunction(() => window.__stub.docTables.Automation.rows.some((r) => r.Type === 'Lock' && r.Config));
  assert.equal(await page.locator('#open-tab-warning').innerText().then((x) => /un autre onglet/.test(x)), false);
  await page.click('#toggle-active');
  await page.waitForFunction(() => window.__stub.docTables.Automation.rows.some((r) => r.Type === 'Lock' && r.Config === ''));
  assert.equal((await lock()).Config, '');
});

await scenario('E2E-17 un autre onglet exécute déjà : celui-ci reste en veille et n\'écrit rien', async (page) => {
  await buildFlow(page);
  await page.click('#toggle-active');
  await page.waitForFunction(() => /un autre onglet/.test(document.getElementById('open-tab-warning').textContent), null, { timeout: 8000 });
  await page.evaluate(() => window.__stub.pushRecords([{ id: 1, Nom: 'A', Statut: 'Nouveau' }]));
  await page.evaluate(() => window.__stub.pushRecords([{ id: 1, Nom: 'A', Statut: 'Clos' }]));
  await page.waitForTimeout(500);
  assert.deepEqual(await page.evaluate(() => window.__stub.applied), []);
}, { foreignLock: true });

await scenario('E2E-18 condition à deux vérifications (OU) et branche « sinon »', async (page) => {
  await buildFlow(page);
  await page.click('.node-condition .check-add');
  await pick(page, 'condition-1-column-2', 'montant');
  await pick(page, 'condition-1-operator-2', 'supérieur');
  await page.fill('#condition-1-value-2', '100');
  assert.equal(await page.locator('#condition-1-join').isDisabled(), false, 'le champ « Combiner » s\'active avec deux vérifications');
  await pick(page, 'condition-1-join', 'une au moins');
  await addNode(page, 'Action', 620, 390);
  await pick(page, 'action-2-type', 'ajouter');
  await pick(page, 'action-2-table', 'archive');
  await pick(page, 'action-2-column', 'motif');
  await page.fill('#action-2-value', 'autre');
  await page.locator('.node-condition .pin-out[data-branch=else]').click();
  await page.locator('#action-2-value').locator('xpath=ancestor::div[contains(@class,"node")]').locator('.pin-in').click();
  assert.equal(await page.locator('.wire-else').count(), 1);
  await page.click('#toggle-active');
  await push(page, { id: 1, Nom: 'A', Statut: 'Nouveau', Montant: 10 }, { id: 1, Nom: 'A', Statut: 'Ouvert', Montant: 500 });
  await page.waitForFunction(() => window.__stub.applied.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__stub.applied[0]), ['AddRecord', 'Archive', null, { Motif: 'clos' }], 'OU : le montant suffit');
  await push(page, { id: 1, Nom: 'A', Statut: 'En cours', Montant: 5 });
  await page.waitForFunction(() => window.__stub.applied.length === 2);
  assert.deepEqual(await page.evaluate(() => window.__stub.applied[1]), ['AddRecord', 'Archive', null, { Motif: 'autre' }], 'faux : branche « sinon »');
  await page.click('#test-workflow');
  assert.match(await page.locator('.node-condition .node-state').innerText(), /sinon/);
});

await scenario('E2E-19 nœud Transformation : concaténation utilisée dans l\'action avec {nom}', async (page) => {
  await addNode(page, 'Déclencheur', 40, 120);
  await addNode(page, 'Transformation', 330, 120);
  await addNode(page, 'Action', 620, 120);
  await waitSchema(page);
  await pick(page, 'trigger-1-column', 'statut');
  assert.equal(await page.locator('#transform-1-b').isDisabled(), false);
  await page.fill('#transform-1-name', 'titre');
  await page.fill('#transform-1-a', '{Nom} / ');
  await page.fill('#transform-1-b', '{Statut}');
  await pick(page, 'transform-1-op', 'majuscules');
  assert.equal(await page.locator('#transform-1-b').isDisabled(), true, 'valeur B grisée pour une opération à une valeur');
  await pick(page, 'transform-1-op', 'accolé');
  await archiveAction(page, 'Fiche {titre}');
  await page.locator('.node-trigger .pin-out').click();
  await page.locator('.node-transform .pin-in').click();
  await page.locator('.node-transform .pin-out').click();
  await page.locator('.node-action .pin-in').click();
  await page.click('#toggle-active');
  await page.evaluate(() => window.__stub.pushRecords([{ id: 1, Nom: 'Ada', Statut: 'Nouveau' }]));
  await page.evaluate(() => window.__stub.pushRecords([{ id: 1, Nom: 'Ada', Statut: 'Clos' }]));
  await page.waitForFunction(() => window.__stub.applied.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__stub.applied[0]), ['AddRecord', 'Archive', null, { Motif: 'Fiche Ada / Clos' }]);
});

await scenario('E2E-20 transformation incomplète : activation refusée avec la raison', async (page) => {
  await addNode(page, 'Déclencheur', 40, 120);
  await addNode(page, 'Transformation', 330, 120);
  await addNode(page, 'Action', 620, 120);
  await waitSchema(page);
  await pick(page, 'action-1-column', 'motif');
  await page.locator('.node-trigger .pin-out').click();
  await page.locator('.node-transform .pin-in').click();
  await page.locator('.node-transform .pin-out').click();
  await page.locator('.node-action .pin-in').click();
  await page.click('#toggle-active');
  assert.match(await page.locator('#log-list').innerText(), /il manque une valeur/);
});

await scenario('E2E-21 mise à jour d\'une ligne d\'une autre table repérée par une clé', async (page) => {
  await addNode(page, 'Déclencheur', 40, 120);
  await addNode(page, 'Action', 400, 60);
  await waitSchema(page);
  await pick(page, 'trigger-1-column', 'statut');
  await pick(page, 'action-1-table', 'archive');
  assert.equal(await page.locator('#action-1-matchValue').isDisabled(), true, 'valeur clé grisée tant que la colonne clé est vide');
  await pick(page, 'action-1-matchColumn', 'motif');
  assert.equal(await page.locator('#action-1-matchValue').isDisabled(), false);
  await page.fill('#action-1-matchValue', '{Nom}');
  await pick(page, 'action-1-column', 'source');
  await page.fill('#action-1-value', 'vu');
  await page.locator('.node-trigger .pin-out').click();
  await page.locator('.node-action .pin-in').click();
  await page.click('#toggle-active');
  await push(page, { id: 1, Nom: 'a', Statut: 'Nouveau' }, { id: 1, Nom: 'b', Statut: 'Clos' });
  await page.waitForFunction(() => window.__stub.applied.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__stub.applied[0]), ['UpdateRecord', 'Archive', 2, { Source: 'vu' }]);
  await push(page, { id: 1, Nom: 'zzz', Statut: 'Nouveau' });
  await page.click('#toggle-logs');
  await page.waitForFunction(() => /Ligne introuvable dans Archive/.test(document.getElementById('log-list').innerText));
  assert.equal(await page.evaluate(() => window.__stub.applied.length), 1);
});

await scenario('E2E-22 mise à jour d\'une autre table sans clé : activation refusée', async (page) => {
  await addNode(page, 'Déclencheur', 40, 120);
  await addNode(page, 'Action', 400, 60);
  await waitSchema(page);
  await pick(page, 'action-1-table', 'archive');
  await pick(page, 'action-1-column', 'source');
  await page.locator('.node-trigger .pin-out').click();
  await page.locator('.node-action .pin-in').click();
  await page.click('#toggle-active');
  assert.match(await page.locator('#log-list').innerText(), /colonne qui repère la ligne/);
});

await scenario('E2E-23 nœud Lecture : un seuil lu dans une autre table sert dans la condition', async (page) => {
  await addNode(page, 'Déclencheur', 20, 100);
  await addNode(page, 'Lecture', 290, 100);
  await addNode(page, 'Condition', 560, 100);
  await addNode(page, 'Action', 830, 100);
  await waitSchema(page);
  await pick(page, 'trigger-1-column', 'statut');
  await page.fill('#lookup-1-name', 'seuil');
  await pick(page, 'lookup-1-table', 'archive');
  await pick(page, 'lookup-1-matchColumn', 'motif');
  await page.fill('#lookup-1-matchValue', '{Nom}');
  await pick(page, 'lookup-1-column', 'source');
  await pick(page, 'condition-1-column', 'montant');
  await pick(page, 'condition-1-operator', 'supérieur');
  await page.fill('#condition-1-value', '{seuil}');
  await archiveAction(page, 'dépassé {seuil}');
  for (const [from, to] of [['trigger', 'lookup'], ['lookup', 'condition'], ['condition', 'action']]) {
    await page.locator(`.node-${from} .pin-out[data-branch=then]`).click();
    await page.locator(`.node-${to} .pin-in`).click();
  }
  await page.click('#toggle-active');
  await push(page, { id: 1, Nom: 'a', Statut: 'Nouveau', Montant: 20 }, { id: 1, Nom: 'a', Statut: 'Clos', Montant: 20 });
  await page.waitForFunction(() => window.__stub.applied.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__stub.applied[0]), ['AddRecord', 'Archive', null, { Motif: 'dépassé 10' }]);
  await push(page, { id: 1, Nom: 'b', Statut: 'Nouveau', Montant: 20 });
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__stub.applied.length), 1, 'seuil de b = 500 : 20 ne le dépasse pas');
}, { viewport: { width: 1400, height: 800 } });

await scenario('E2E-24 déclencheur sur une ligne précise : les autres lignes sont ignorées', async (page) => {
  await addNode(page, 'Déclencheur', 40, 100);
  await addNode(page, 'Action', 400, 100);
  await waitSchema(page);
  await pick(page, 'trigger-1-column', 'statut');
  assert.equal(await page.locator('#trigger-1-targetValue').isDisabled(), true, 'valeur clé grisée sans colonne clé');
  await pick(page, 'trigger-1-targetColumn', 'nom');
  await page.fill('#trigger-1-targetValue', 'Ada');
  await archiveAction(page, 'vu');
  await page.locator('.node-trigger .pin-out').click();
  await page.locator('.node-action .pin-in').click();
  await pick(page, 'trigger-1-action', 'créée');
  assert.equal(await page.locator('#trigger-1-targetColumn').isDisabled(), true, 'ligne précise grisée pour une création');
  await page.click('#toggle-active');
  assert.match(await page.locator('#log-list').innerText(), /ne s'applique qu'à une modification/);
  await pick(page, 'trigger-1-action', 'modifiée');
  await page.click('#toggle-active');
  const pushView = (records) => page.evaluate((r) => window.__stub.pushRecords(r), records);   // toutes les lignes de la vue à la fois
  await pushView([{ id: 1, Nom: 'Ada', Statut: 'a' }, { id: 2, Nom: 'Bob', Statut: 'a' }]);
  await pushView([{ id: 1, Nom: 'Ada', Statut: 'b' }, { id: 2, Nom: 'Bob', Statut: 'b' }]);
  await page.waitForFunction(() => window.__stub.applied.length >= 1);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__stub.applied.length), 1, 'seule la ligne Ada déclenche');
});

await scenario('E2E-25 test à blanc sur la ligne sélectionnée dans Grist', async (page) => {
  await buildFlow(page);
  await page.evaluate(() => {
    window.__stub.pushRecords([{ id: 1, Nom: 'A', Statut: 'Nouveau' }, { id: 2, Nom: 'B', Statut: 'Clos' }]);
    window.__stub.pushRecord({ id: 2, Nom: 'B', Statut: 'Clos' });
  });
  await page.click('#test-workflow');
  await page.click('#toggle-logs');
  assert.match(await page.locator('#log-list li').first().innerText(), /Dry-run ligne 2 : réussi/, 'la ligne sélectionnée (2), pas la première');
  assert.deepEqual(await page.evaluate(() => window.__stub.applied), []);
});

await scenario('E2E-26 historique par pages : les plus récentes d\'abord, « plus anciennes » à la demande', async (page) => {
  await page.click('#toggle-logs');
  await page.waitForFunction(() => document.querySelectorAll('#log-list li').length >= 20);
  const entries = () => page.locator('#log-list li', { hasText: 'modification ligne' });
  assert.equal(await entries().count(), 20);
  assert.match(await entries().first().innerText(), /ligne 25 : réussi \(moi@exemple.fr\)/, 'la plus récente en haut');
  assert.equal(await page.locator('#logs-more').isVisible(), true);
  await page.click('#logs-more');
  await page.waitForFunction(() => document.querySelectorAll('#log-list li').length >= 25);
  assert.equal(await entries().count(), 25);
  assert.match(await entries().last().innerText(), /ligne 1 : réussi/, 'la plus ancienne en bas');
  assert.equal(await page.locator('#logs-more').isVisible(), false, 'plus rien à charger');
}, { preloadLogs: 25 });

// GFS (guide des apps, 1.1) : règle 3, un contenu que cette version ne lit pas reste intact ; règle 4, la table du document n'est créée ni utilisée de travers ; règle 12, charte.
const newerGraph = JSON.stringify({ version: 4, active: true, nodes: [{ id: 'boucle-1', type: 'boucle', x: 0, y: 0, config: {} }], edges: [], vue: { zoom: 2 } });
const readableGraph = JSON.stringify({ version: 3, active: false, nodes: [{ id: 'trigger-1', type: 'trigger', x: 40, y: 120, config: { action: 'update', column: 'Statut', targetColumn: '', targetValue: '' } }], edges: [] });

await scenario('E2E-27 workflow d\'une version plus récente dans les réglages de la vue : conservé tel quel, rien n\'est écrit', async (page) => {
  await page.waitForSelector('#locked:not([hidden])');
  assert.match(await page.locator('#locked h2').innerText(), /Workflow conservé tel quel/);
  for (const id of ['add-node', 'test-workflow', 'toggle-active']) assert.equal(await page.locator('#' + id).isDisabled(), true, `${id} est grisé, pas masqué`);
  assert.equal(await page.locator('#canvas').evaluate((element) => element.inert), true, 'le canevas ne reçoit ni clic ni focus');
  await page.click('#toggle-logs');
  assert.match(await page.locator('#log-list').innerText(), /Configuration illisible : elle est conservée telle quelle/);
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => window.__stub.options.workflow), newerGraph, 'les réglages de la vue sont intacts');
  assert.deepEqual(await page.evaluate(() => window.__stub.docTables.Automation.rows), [], 'rien n\'est écrit dans le document');
}, { init: { __preloadOptions: { workflow: newerGraph } } });

await scenario('E2E-28 workflow illisible dans la table Automation : conservé tel quel, la ligne n\'est pas touchée', async (page) => {
  await page.waitForSelector('#locked:not([hidden])');
  await page.click('#toggle-logs');
  assert.match(await page.locator('#log-list').innerText(), /Configuration illisible/);
  await page.waitForTimeout(700);
  await assertUntouched(page, 'même contenu, aucune ligne ajoutée (ni verrou)');
}, { init: { __preloadRows: [{ Type: 'Workflow', Table: 'Contacts', Actif: true, Version: 4, Config: newerGraph }] } });

await scenario('E2E-29 le graphe du document passe avant des réglages de vue illisibles', async (page) => {
  await page.waitForSelector('.node-trigger');
  assert.equal(await page.locator('#locked').isVisible(), false);
  assert.equal(await page.locator('#toggle-active').isDisabled(), false);
  assert.equal(await page.locator('#canvas').evaluate((element) => element.inert), false);
}, { init: { __preloadOptions: { workflow: newerGraph }, __preloadRows: [{ Type: 'Workflow', Table: 'Contacts', Config: readableGraph }] } });

await scenario('E2E-30 table dont le nom ne diffère que par la casse : aucune question, aucune création, la raison est dite', async (page) => {
  await page.click('#toggle-logs');
  await page.waitForFunction(() => /déjà une table « automation »/.test(document.querySelector('#log-list').innerText));
  assert.equal(await page.locator('[role=dialog]').count(), 0, 'pas de question : la création est impossible');
  await buildFlow(page);
  await page.click('#toggle-active');
  assert.equal(await page.locator('[role=dialog]').count(), 0);
  assert.match(await page.locator('#log-list').innerText(), /Non enregistré : la table du widget/);
  await page.waitForFunction(() => window.__stub.options.workflow && JSON.parse(window.__stub.options.workflow).edges.length === 2);
  assert.deepEqual(await page.evaluate(() => Object.keys(window.__stub.docTables)), ['automation'], 'rien n\'a été créé');
}, { noTables: true, init: { __preloadTables: { automation: ['Nom'] } } });

await scenario('E2E-31 table Automation sans les colonnes attendues : non utilisée, rien n\'y est écrit', async (page) => {
  await page.click('#toggle-logs');
  await page.waitForFunction(() => /n'a pas les colonnes attendues \(Config, Evenement, Resultat\)/.test(document.querySelector('#log-list').innerText));
  assert.equal(await page.locator('[role=dialog]').count(), 0);
  await buildFlow(page);
  await page.click('#toggle-active');
  await page.waitForFunction(() => window.__stub.options.workflow && JSON.parse(window.__stub.options.workflow).edges.length === 2);
  assert.equal(await page.locator('#open-tab-warning').isVisible(), true, 'activé quand même : le graphe reste dans les réglages de la vue');
  await page.waitForTimeout(500);
  assert.deepEqual(await page.evaluate(() => window.__stub.docTables.Automation.rows), [], 'aucune écriture dans la table incomplète');
}, { noTables: true, init: { __preloadTables: { Automation: ['Type', 'Table', 'Date', 'Actif', 'Version', 'Resume', 'Detail'] } } });

await scenario('E2E-32 test à blanc : l\'action est signalée par l\'accent bleu de la charte, plus en vert', async (page) => {
  await buildFlow(page);
  await page.evaluate(() => {
    window.__stub.pushRecords([{ id: 1, Nom: 'A', Statut: 'Clos' }]);
    window.__stub.pushRecord({ id: 1, Nom: 'A', Statut: 'Clos' });
  });
  await page.click('#test-workflow');
  await page.waitForSelector('.trace-action .node-state');
  const colors = await page.evaluate(() => {
    const state = getComputedStyle(document.querySelector('.trace-action .node-state'));
    return { background: state.backgroundColor, color: state.color, border: getComputedStyle(document.querySelector('.trace-action')).borderTopColor };
  });
  assert.deepEqual(colors, { background: 'rgb(47, 111, 237)', color: 'rgb(255, 255, 255)', border: 'rgb(47, 111, 237)' });
});

await scenario('E2E-33 les couches gardent leur ordre grâce aux jetons --z-*', async (page) => {
  await page.click('#toggle-logs');
  await page.click('#open-settings');
  await page.waitForSelector('.modal');
  const z = (selector) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).zIndex, selector);
  assert.deepEqual([await z('.locked'), await z('.logs'), await z('.modal')], ['20', '40', '2000'], 'voile < journal < fenêtre');
});

await scenario('E2E-34 modification faite pendant le démarrage, avant la découverte d\'un contenu illisible : il n\'est pas écrasé', async (page) => {
  await addNode(page, 'Déclencheur', 40, 120);
  await page.waitForSelector('#locked:not([hidden])');
  await page.waitForTimeout(1500);
  await assertUntouched(page, 'la ligne illisible est intacte');
}, { init: { __fetchDelay: 400, __preloadRows: [{ Type: 'Workflow', Table: 'Contacts', Actif: true, Version: 4, Config: newerGraph }] } });

await scenario('E2E-35 contenu du document illisible, graphe actif dans les réglages de la vue : rien ne s\'exécute à sa place', async (page) => {
  await buildFlow(page);
  await page.click('#toggle-active');
  // Un graphe actif ne va plus dans les réglages de la vue quand la table est là : il y est mis comme l'aurait laissé une version plus ancienne.
  const saved = (await savedRows(page, workflowSaved('(graph) => graph.active === true'))).find((row) => row.Type === 'Workflow').Config;
  const copy = await page.context().newPage();
  await copy.addInitScript((init) => Object.assign(window, init), { __preloadOptions: { workflow: saved }, __preloadRows: [{ Type: 'Workflow', Table: 'Contacts', Actif: true, Version: 4, Config: newerGraph }] });
  await routeApi(copy);
  await copy.goto(url);
  await copy.waitForSelector('#locked:not([hidden])');
  assert.equal(await copy.locator('.node').count(), 0, 'le graphe des réglages de la vue n\'est plus affiché');
  assert.equal(await copy.locator('#open-tab-warning').isVisible(), false, 'rien n\'est actif');
  await push(copy, { id: 1, Nom: 'A', Statut: 'Nouveau' }, { id: 1, Nom: 'A', Statut: 'Clos' });
  await copy.waitForTimeout(1500);
  assert.deepEqual(await copy.evaluate(() => window.__stub.applied), [], 'aucune écriture dans Archive');
  const rows = await copy.evaluate(() => window.__stub.docTables.Automation.rows);
  assert.deepEqual(rows.map((row) => [row.Type, row.Config]), [['Workflow', newerGraph]], 'ni verrou ni journal ajoutés, la ligne illisible est intacte');
});

/* ---------- App hébergée par GFS (consignes 003 et 006) ----------
   Un faux GFS (tests/e2e/gfs-host.html) ouvre l'app dans un cadre isolé comme chez GFS, lui rend le contexte et lui envoie des événements, comme le ferait GFS. */
const POP = JSON.parse(fs.readFileSync(path.join(root, 'kit/test/ambiance-exemple.json'), 'utf8'));   // l'ambiance Pop, message d'exemple du kit
const SMALL = { width: 700, height: 400 };
// La barre telle que GFS la mesure à 700 × 400 (consigne 003) : 124 × 34 à 4 px du bord et centrée, la zone en ajoute 4 autour.
const BARS = {
  haut: { bord: 'haut', epaisseur: 42, zone: { x: 284, y: 0, largeur: 132, hauteur: 42 } },
  bas: { bord: 'bas', epaisseur: 42, zone: { x: 284, y: 358, largeur: 132, hauteur: 42 } },
  gauche: { bord: 'gauche', epaisseur: 42, zone: { x: 0, y: 134, largeur: 42, hauteur: 132 } },
  droite: { bord: 'droite', epaisseur: 42, zone: { x: 658, y: 134, largeur: 42, hauteur: 132 } },
};
const send = (page, nom, data) => page.evaluate((message) => window.hote.event(message.nom, message.data), { nom, data });
// Deux images passées : la mesure de keep-clear.js (une image après le changement du DOM) est faite.
const settled = (app) => app.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
// Ce que l'app doit laisser libre : la barre d'outils, le journal, les menus et listes, les bulles, les fenêtres, l'avertissement.
const KEPT_CLEAR = '.app-header h1, .app-header button, .logs, .add-menu, .ss-panel, .canvas-connect-hint, .modal-box, .warning';
const covering = (app, zone) => app.evaluate(({ zone, selector }) => {
  const hits = [];
  for (const element of document.querySelectorAll(selector)) {
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height || getComputedStyle(element).visibility === 'hidden') continue;
    // Un recouvrement de moins d'un demi-pixel n'en est pas un (arrondis du navigateur).
    if (box.left < zone.x + zone.largeur - 0.5 && zone.x + 0.5 < box.right && box.top < zone.y + zone.hauteur - 0.5 && zone.y + 0.5 < box.bottom) hits.push(element.id || element.className || element.tagName);
  }
  return hits;
}, { zone, selector: KEPT_CLEAR });
const insideFrame = (app, selector) => app.evaluate((s) => {
  const box = document.querySelector(s).getBoundingClientRect();
  return box.left >= 0 && box.top >= 0 && box.right <= document.documentElement.clientWidth && box.bottom <= document.documentElement.clientHeight;
}, selector);
const look = (app) => app.evaluate(() => {
  const style = (selector) => getComputedStyle(document.querySelector(selector));
  return {
    page: style('body').backgroundColor, wash: style('body').backgroundImage !== 'none',
    card: style('.node').backgroundColor, cardHead: style('.node-head').backgroundColor,
    nodeBorder: style('.node').borderTopColor, nodeRadius: style('.node').borderTopLeftRadius,
    activate: style('#toggle-active').backgroundImage, activateText: style('#toggle-active').color,
  };
});

// Les textes visibles dont le contraste avec leur fond est sous 4,5:1 (le fond : celui de l'élément, ou des parents composés jusqu'à un fond plein ; un dégradé, chacune de ses couleurs).
const unreadable = (app) => app.evaluate(() => {
  const parse = (value) => { const m = value.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const luminance = ({ r, g, b }) => { const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (high + 0.05) / (low + 0.05); };
  const weak = [];
  for (const element of document.querySelectorAll('body *')) {
    const text = [...element.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (!text || !box.width || !box.height || style.visibility === 'hidden') continue;
    let back = { r: 255, g: 255, b: 255, a: 1 };
    let stops = null;
    const chain = [];
    for (let n = element; n; n = n.parentElement) chain.unshift(n);
    for (const n of chain) {
      const s = getComputedStyle(n);
      const color = parse(s.backgroundColor);
      if (color && color.a > 0) back = over(color, back);
      if (n !== document.documentElement && n !== document.body && /gradient/.test(s.backgroundImage)) stops = [...s.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map((m) => over(parse(m[0]), back));
    }
    const lowest = Math.min(...(stops || [back]).map((b) => ratio(over(parse(style.color), b), b)));
    if (lowest < 4.5) weak.push(`${element.tagName.toLowerCase()} « ${text.slice(0, 24)} » ${lowest.toFixed(2)}`);
  }
  return weak;
});

await scenario('E2E-36 hébergée par GFS sans ambiance ni barre : l\'app a demandé le contexte et garde ses couleurs et sa disposition', async (page, app) => {
  // Tout ce que l'app dit à GFS : la demande du contexte, rien d'autre (SECURITY.md : aucune donnée du document ne part par ce lien).
  const said = await page.evaluate(() => window.hote.received().map((m) => `${m.type}:${m.nom}`));
  assert.deepEqual(said, ['appel:contexte']);
  assert.equal(await app.evaluate(() => document.documentElement.hasAttribute('data-gfs-pending')), false, 'l\'attente est levée');
  assert.equal(await app.evaluate(() => 'gfsBar' in document.documentElement.dataset), false, 'pas de barre');
  await addNode(page, 'Déclencheur', 40, 120);
  await app.waitForSelector('.node');
  assert.deepEqual(await look(app), {
    page: 'rgb(244, 246, 250)', wash: false, card: 'rgb(255, 255, 255)', cardHead: 'rgb(232, 240, 254)', nodeBorder: 'rgb(195, 202, 214)', nodeRadius: '8px',
    activate: 'none', activateText: 'rgb(255, 255, 255)',
  });
  assert.equal(await app.evaluate(() => getComputedStyle(document.querySelector('#toggle-active')).backgroundColor), 'rgb(47, 111, 237)', 'le bouton principal garde l\'accent bleu de la charte');
  await shot(page, 'seule-700x400');
}, { host: { context: { langue: 'fr', barre: null, ambiance: null } }, viewport: SMALL });

await scenario('E2E-37 ambiance Pop de GFS (message d\'exemple du kit) : les feuilles suivent les jetons, clair puis sombre ; null rend les couleurs de l\'app', async (page, app) => {
  await addNode(page, 'Déclencheur', 40, 120);
  await app.waitForSelector('.node');
  assert.deepEqual(await look(app), {
    page: 'rgb(234, 233, 255)', wash: true, card: 'rgb(255, 255, 255)', cardHead: 'rgb(238, 237, 255)', nodeBorder: 'rgb(197, 195, 237)', nodeRadius: '14px',
    activate: 'linear-gradient(135deg, rgb(109, 79, 214), rgb(185, 38, 125))', activateText: 'rgb(255, 255, 255)',
  }, 'Pop clair');
  await shot(page, 'pop-clair');
  assert.deepEqual(await unreadable(app), [], 'Pop clair : chaque texte garde 4,5:1');
  await app.evaluate(() => Theme.set('dark'));
  await app.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(22, 19, 42)');
  const dark = await look(app);
  assert.deepEqual([dark.page, dark.card, dark.cardHead, dark.nodeBorder], ['rgb(22, 19, 42)', 'rgb(34, 31, 57)', 'rgb(50, 44, 86)', 'rgb(83, 77, 129)'], 'Pop sombre : le fond, une carte, son bandeau, son trait');
  await shot(page, 'pop-sombre');
  assert.deepEqual(await unreadable(app), [], 'Pop sombre : chaque texte garde 4,5:1');
  await app.click('#open-settings');
  await app.waitForSelector('.modal-box');
  assert.deepEqual(await unreadable(app), [], 'Pop sombre, fenêtre des réglages : chaque texte garde 4,5:1');
  await page.keyboard.press('Escape');
  await app.waitForSelector('.modal', { state: 'detached' });
  await send(page, 'ambiance', { ambiance: null });
  await app.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(23, 27, 35)');
  assert.deepEqual(await look(app), {
    page: 'rgb(23, 27, 35)', wash: false, card: 'rgb(30, 36, 48)', cardHead: 'rgb(36, 50, 75)', nodeBorder: 'rgb(70, 81, 102)', nodeRadius: '8px', activate: 'none', activateText: 'rgb(255, 255, 255)',
  }, 'ambiance retirée : les couleurs sombres de l\'app');
  await app.evaluate(() => Theme.set('light'));
  await app.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(244, 246, 250)');
  await send(page, 'ambiance', { ambiance: POP });
  await app.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(234, 233, 255)');
}, { host: { context: { langue: 'fr', barre: null, ambiance: POP } }, viewport: SMALL });

await scenario('E2E-38 barre en haut : la barre d\'outils se partage autour de la zone, rien ne la recouvre ni ne déborde, en français et en anglais', async (page, app) => {
  assert.equal(await app.evaluate(() => document.documentElement.dataset.gfsBar), 'haut');
  for (const language of ['fr', 'en']) {
    await app.evaluate((value) => I18n.set(value), language);
    await settled(app);
    assert.deepEqual(await covering(app, BARS.haut.zone), [], `rien ne recouvre la zone (${language})`);
    assert.equal(await app.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, `pas de défilement horizontal (${language})`);
    for (const id of ['add-node', 'test-workflow', 'toggle-active', 'toggle-logs', 'open-settings']) assert.equal(await insideFrame(app, `#${id}`), true, `#${id} reste dans le cadre (${language})`);
    await shot(page, `haut-${language}`);
  }
}, { host: { context: { langue: 'fr', barre: BARS.haut, ambiance: POP } }, viewport: SMALL });

await scenario('E2E-39 barre en bas : le journal ouvert quitte la zone vers le haut et reste dans le cadre', async (page, app) => {
  await app.click('#toggle-logs');
  await app.waitForSelector('#logs:not([hidden])');
  await settled(app);
  assert.deepEqual(await covering(app, BARS.bas.zone), []);
  assert.equal(await insideFrame(app, '#logs'), true, 'le journal reste dans le cadre');
  await shot(page, 'bas-journal');
  await app.click('#toggle-logs');
  await app.waitForSelector('#logs', { state: 'hidden' });
  await settled(app);
  assert.equal(await app.evaluate(() => document.querySelector('#logs').style.translate), '', 'refermé, plus rien n\'est décalé');
}, { host: { context: { langue: 'fr', barre: BARS.bas, ambiance: POP } }, viewport: SMALL });

for (const [edge, point] of Object.entries({ haut: [300, 80], bas: [300, 340], gauche: [10, 200], droite: [690, 200] })) {
  await scenario(`E2E-40 barre ${edge === 'haut' || edge === 'bas' ? 'en ' : 'à '}${edge} : le menu d'ajout et la fenêtre des réglages se posent dans la zone libre`, async (page, app) => {
    const { zone } = BARS[edge];
    await page.mouse.click(point[0], point[1], { button: 'right' });
    await app.waitForSelector('.ss-panel');
    await settled(app);
    assert.deepEqual(await covering(app, zone), [], 'le menu d\'ajout');
    assert.equal(await insideFrame(app, '.ss-panel'), true, 'le menu reste dans le cadre');
    await shot(page, `${edge}-menu`);
    await page.keyboard.press('Escape');
    await app.click('#open-settings');
    await app.waitForSelector('.modal-box');
    await settled(app);
    assert.deepEqual(await covering(app, zone), [], 'la fenêtre des réglages');
    assert.equal(await insideFrame(app, '.modal-box'), true, 'la fenêtre reste dans le cadre');
    await shot(page, `${edge}-reglages`);
  }, { host: { context: { langue: 'fr', barre: BARS[edge], ambiance: POP } }, viewport: SMALL });
}

await scenario('E2E-41 la barre change en cours de route (haut, bas, plus rien) : l\'app suit sans se recharger', async (page, app) => {
  const header = () => app.evaluate(() => document.querySelector('.app-header').getBoundingClientRect().height);
  const alone = await header();
  await send(page, 'barre', { barre: BARS.haut });
  await app.waitForFunction(() => document.documentElement.dataset.gfsBar === 'haut');
  await send(page, 'barre', { barre: BARS.bas });
  await app.waitForFunction(() => document.documentElement.dataset.gfsBar === 'bas');
  await app.click('#toggle-logs');
  await settled(app);
  assert.deepEqual(await covering(app, BARS.bas.zone), [], 'barre en bas, journal ouvert');
  await send(page, 'barre', { barre: BARS.gauche });
  await app.waitForFunction(() => document.documentElement.dataset.gfsBar === 'gauche');
  await settled(app);
  assert.deepEqual(await covering(app, BARS.gauche.zone), [], 'barre à gauche');
  await send(page, 'barre', { barre: null });
  await app.waitForFunction(() => !('gfsBar' in document.documentElement.dataset));
  await settled(app);
  assert.equal(await header(), alone, 'la barre d\'outils reprend sa place');
  assert.equal(await app.evaluate(() => document.querySelector('#logs').style.translate), '', 'le journal aussi');
  assert.equal(await app.evaluate(() => document.documentElement.style.getPropertyValue('--gfs-zone-x')), '', 'rien ne reste posé sur <html>');
}, { host: { context: { langue: 'fr', barre: null, ambiance: null } }, viewport: SMALL });

for (const edge of ['haut', 'bas']) {
  // Un cadre bas (700 × 300) : la fenêtre des réglages, centrée, recouvrirait la zone ; elle se place dans le reste du cadre.
  const bar = { bord: edge, epaisseur: 42, zone: { x: 284, y: edge === 'haut' ? 0 : 258, largeur: 132, hauteur: 42 } };
  await scenario(`E2E-42 barre ${edge === 'haut' ? 'en haut' : 'en bas'}, cadre de 700 × 300 : la fenêtre des réglages, trop haute pour tenir à côté de la zone, se réduit et se place dans le reste du cadre`, async (page, app) => {
    await app.click('#open-settings');
    await app.waitForSelector('.modal-box');
    await settled(app);
    assert.deepEqual(await covering(app, bar.zone), [], 'la fenêtre ne recouvre pas la zone');
    assert.equal(await insideFrame(app, '.modal-box'), true, 'la fenêtre reste dans le cadre');
    assert.equal(await app.evaluate((side) => document.querySelector('.modal').style.getPropertyValue(`--gfs-pad-${side}`), edge === 'haut' ? 'top' : 'bottom'), '42px', 'le voile laisse la place de la barre de son côté');
    await shot(page, `${edge}-reglages-bas`);
    await page.keyboard.press('Escape');
    await app.waitForSelector('.modal', { state: 'detached' });
    await app.click('#open-settings');
    await app.waitForSelector('.modal-box');
    assert.equal(await app.evaluate(() => document.documentElement.clientHeight), 300);
  }, { host: { context: { langue: 'fr', barre: bar, ambiance: null } }, viewport: { width: 700, height: 300 } });
}

await scenario('E2E-43 barre à gauche, canevas dézoomé : la liste d\'un nœud placé sous la barre s\'en écarte du juste nécessaire (l\'échelle du canevas est comptée)', async (page, app) => {
  await addNode(page, 'Déclencheur', 40, 120);
  await app.waitForSelector('.node');
  for (let i = 0; i < 8; i += 1) await page.mouse.wheel(0, 100).then(() => page.mouse.move(400 + i, 320));   // dézoome vers 0,5 environ
  await settled(app);
  const scale = await app.evaluate(() => { const node = document.querySelector('.node'); return node.getBoundingClientRect().width / node.offsetWidth; });
  assert.ok(scale < 0.8, `le canevas est dézoomé (${scale})`);
  // Fait glisser le fond pour que le bouton de la liste soit sous la barre.
  const button = await app.locator('.node .ss-button').first().boundingBox();
  const from = { x: 450, y: 360 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 4 - button.x, from.y + 190 - button.y, { steps: 6 });
  await page.mouse.up();
  await app.locator('.node .ss-button').first().click();
  await app.waitForSelector('.ss-panel:not([hidden])');
  await settled(app);
  const moved = await app.evaluate(() => document.querySelector('.ss-panel:not([hidden])').style.translate);
  assert.notEqual(moved, '', 'la liste a été décalée');
  assert.deepEqual(await covering(app, BARS.gauche.zone), [], 'la liste ne recouvre plus la zone');
  const edge = await app.evaluate(() => document.querySelector('.ss-panel:not([hidden])').getBoundingClientRect().left);
  assert.ok(edge >= 41.5 && edge < 43, `elle touche la zone sans s'en éloigner de plus d'un pixel (${edge})`);
  await shot(page, 'gauche-liste-dezoome');
}, { host: { context: { langue: 'fr', barre: BARS.gauche, ambiance: null } }, viewport: SMALL });

await scenario('E2E-44 le kit manque (copie du dépôt sans ses sous-modules) : l\'app s\'ouvre quand même, avec ses couleurs, une fois le garde-fou de 2 s passé', async (page, app) => {
  assert.equal(await app.evaluate(() => document.documentElement.hasAttribute('data-gfs-pending')), false, 'l\'attente est levée');
  assert.equal((await app.evaluate(() => getComputedStyle(document.body).backgroundColor)), 'rgb(244, 246, 250)', 'les couleurs de l\'app');
  await app.click('#add-node');
  await app.waitForSelector('.ss-panel');
}, { host: { context: { langue: 'fr', barre: BARS.haut, ambiance: POP }, fallback: true }, viewport: SMALL, blocked: ['**/kit/js/gfs-link.js'], tolerated: [/gfs-link/i, /ERR_FAILED/, /Failed to fetch/i, /module/i] });

/* ---------- Le widget seul dans Grist : ce que Grist accorde et pose (pré-alpha publique) ---------- */

// Un workflow actif complet (déclencheur -> action), tel qu'enregistré dans la table Automation.
const activeFlow = JSON.stringify({ version: 3, active: true, nodes: [
  { id: 'trigger-1', type: 'trigger', x: 40, y: 120, config: { action: 'update', column: 'Statut', targetColumn: '', targetValue: '' } },
  { id: 'action-1', type: 'action', x: 330, y: 120, config: { type: 'AddRecord', table: 'Archive', matchColumn: '', matchValue: '', column: 'Motif', value: 'vu' } },
], edges: [{ from: 'trigger-1', to: 'action-1' }] });
const activeRows = [{ Type: 'Workflow', Table: 'Contacts', Actif: true, Version: 3, Config: activeFlow }];
const FR = { openTab: 'Automation active : elle ne s\'exécute que tant que cette vue reste ouverte dans votre navigateur, y compris si la vue du widget est réduite.', otherTab: 'Automation active : un autre onglet l\'exécute pour le moment, celui-ci prend le relais s\'il se ferme.' };

await scenario('E2E-45 le thème que Grist pose ne déclenche aucune erreur de politique de sécurité, et les contrôles natifs gardent le thème de l\'app', async (page) => {
  await page.waitForFunction(() => document.documentElement.dataset.gristAppearance === 'dark');
  assert.equal(await page.evaluate(() => document.getElementById('grist-theme').tagName), 'TEMPLATE', 'Grist écrit dans l\'élément inerte de la page');
  assert.equal(await page.evaluate(() => document.querySelectorAll('style').length), 0, 'aucune balise <style> créée');
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('color-scheme')), 'dark', 'Grist pose bien son mode en style en ligne');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'light', 'l\'app, en clair, garde des contrôles clairs');
  await page.click('#open-settings');
  await page.getByRole('button', { name: 'Sombre' }).click();
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'dark');
}, { init: { __gristAppearance: 'dark' } });

await scenario('E2E-46 accès complet pas encore accordé dans Grist : le widget le dit à la place du canevas, ne lit ni n\'écrit rien, et ne pose aucune question', async (page) => {
  await page.waitForSelector('#access-needed:not([hidden])');
  assert.equal(await page.locator('#access-needed h2').innerText(), 'Le widget a besoin de l\'accès complet au document');
  assert.match(await page.locator('#access-needed').innerText(), /Accepter/);
  for (const id of ['add-node', 'test-workflow', 'toggle-active']) assert.equal(await page.locator('#' + id).isDisabled(), true, id);
  assert.equal(await page.evaluate(() => document.getElementById('canvas').inert), true);
  await page.waitForTimeout(500);
  assert.deepEqual(await page.evaluate(() => window.__stub.calls), { ready: 1 }, 'grist.ready seul : Grist montre alors sa demande d\'accès');
  assert.equal(await page.locator('.modal').count(), 0, 'pas de question de table');
}, { query: '?access=none&readonly=false', noTables: true });

await scenario('E2E-47 lecture seule : le workflow se voit, se déplace et se teste ; rien ne s\'écrit, rien ne s\'exécute, même au bout du battement de 6 s', async (page) => {
  await page.waitForSelector('.node-action');
  assert.equal(await page.locator('#read-only-notice').isVisible(), true);
  assert.equal(await page.locator('#open-tab-warning').isVisible(), false, 'cet onglet n\'exécute pas : pas de bandeau d\'exécution');
  assert.equal(await page.locator('#add-node').isDisabled(), true);
  assert.equal(await page.locator('#toggle-active').isDisabled(), true);
  assert.equal(await page.locator('#test-workflow').isDisabled(), false, 'Tester reste');
  assert.equal(await page.locator('.node input:not([disabled]), .node select:not([disabled]), .node button:not([disabled])').count(), 0, 'les champs, broches et boutons des nœuds sont grisés');
  await page.mouse.click(700, 500, { button: 'right' });
  assert.equal(await page.locator('.add-menu').count(), 0, 'pas de menu d\'ajout');
  const before = await page.locator('.node-action').boundingBox();
  const head = await page.locator('.node-action .node-head').boundingBox();
  await page.mouse.move(head.x + 20, head.y + 8);
  await page.mouse.down();
  await page.mouse.move(head.x + 120, head.y + 80, { steps: 4 });
  await page.mouse.up();
  assert.deepEqual(await page.locator('.node-action').boundingBox(), before, 'le nœud ne bouge pas');
  await page.keyboard.press('Delete');
  assert.equal(await page.locator('.node').count(), 2, 'Suppr ne supprime rien');
  await page.evaluate(() => window.__stub.pushRecords([{ id: 1, Nom: 'A', Statut: 'Nouveau' }]));
  await page.click('#test-workflow');
  assert.equal(await page.locator('.node-action .node-state').innerText(), 'Action prévue');
  await page.evaluate(() => window.__stub.pushRecords([{ id: 1, Nom: 'A', Statut: 'Clos' }]));
  await page.waitForTimeout(7000);
  assert.deepEqual(await page.evaluate(() => window.__stub.applied), [], 'rien n\'est exécuté');
  assert.deepEqual(await page.evaluate(() => window.__stub.refused), [], 'aucune écriture tentée : ni verrou, ni journal, ni options');
  await page.click('#toggle-logs');
  assert.doesNotMatch(await page.locator('#log-list').innerText(), /No write access|impossible/);
}, { query: '?access=full&readonly=true', init: { __preloadRows: activeRows } });

await scenario('E2E-48 lecture seule dans un document sans table Automation : aucune question de création', async (page) => {
  await page.waitForSelector('#read-only-notice:not([hidden])');
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.modal').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__stub.refused), []);
}, { query: '?access=full&readonly=true', noTables: true });

await scenario('E2E-49 un onglet rechargé reprend l\'exécution tout de suite : il reconnaît son verrou au lieu d\'attendre 20 s qu\'il expire', async (page) => {
  page.on('dialog', (dialog) => dialog.accept());   // « Quitter la page ? » : un workflow actif ne s'exécute que tant que la vue est ouverte
  await page.waitForFunction(() => window.__stub.docTables.Automation.rows.some((row) => row.Type === 'Lock' && row.Config));
  const rows = await page.evaluate(() => window.__stub.docTables.Automation.rows.map((row) => ({ ...row })));
  const owner = rows.find((row) => row.Type === 'Lock').Config;
  assert.match(owner, /^[0-9a-f]{16}$/);
  // Le document garde ses lignes d'un chargement à l'autre, verrou compris, comme si la page n'avait pas eu le temps de le libérer.
  await page.addInitScript((saved) => { window.__preloadRows = saved.map(({ id, ...row }) => row); }, rows);
  await page.reload();
  await page.waitForSelector('.node-action');
  await page.waitForFunction((text) => document.getElementById('open-tab-warning').textContent === text, FR.openTab, { timeout: 3000 });
  assert.equal(await page.evaluate(() => window.__stub.docTables.Automation.rows.find((row) => row.Type === 'Lock').Config), owner, 'même identifiant d\'onglet');
  await push(page, { id: 1, Nom: 'A', Statut: 'Nouveau' }, { id: 1, Nom: 'A', Statut: 'Clos' });
  await page.waitForFunction(() => window.__stub.applied.length > 0, null, { timeout: 3000 });
  assert.deepEqual(await page.evaluate(() => window.__stub.applied), [['AddRecord', 'Archive', null, { Motif: 'vu' }]]);
}, { init: { __preloadRows: activeRows } });

await scenario('E2E-50 un onglet neuf (dupliqué, ou une autre personne) n\'hérite pas du verrou : il attend l\'exécutant en place', async (page) => {
  await page.waitForSelector('.node-action');
  await page.waitForFunction((text) => document.getElementById('open-tab-warning').textContent === text, FR.otherTab, { timeout: 3000 });
  assert.deepEqual(await page.evaluate(() => window.__stub.applied), []);
}, { init: { __preloadRows: [...activeRows, { Type: 'Lock', Table: 'Contacts', Config: 'aaaaaaaaaaaaaaaa', Date: 1 }] } });

/* ---------- La prise en main (js/tutorial.js) ---------- */

// La prise en main telle qu'on la voit : l'écran affiché, ses boutons dans l'ordre (* : le principal), le focus, et de quoi vérifier qu'elle tient dans la fenêtre.
function tutorialState(target) {
  return target.evaluate(() => {
    const box = document.querySelector('.modal-box.w-media');
    if (!box) return null;
    const body = box.querySelector('.modal-body');
    const text = box.querySelector('.tuto-text');
    const image = box.querySelector('.tuto-shot img');
    const dots = [...box.querySelectorAll('[role=tab]')];
    const rect = box.getBoundingClientRect();
    const focus = document.activeElement;
    return {
      title: box.querySelector('.modal-title').textContent,
      index: dots.findIndex((dot) => dot.getAttribute('aria-selected') === 'true'),
      name: box.querySelector('.tuto-name').textContent,
      footer: [...box.querySelectorAll('.modal-footer > button')].filter((b) => !b.hidden).map((b) => b.textContent + (b.classList.contains('primary') ? '*' : '')),
      focus: focus.getAttribute('role') === 'tab' ? 'tab-' + dots.indexOf(focus) : focus.textContent,
      tabStops: dots.filter((dot) => dot.tabIndex === 0).length,
      fits: rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth && body.scrollHeight <= body.clientHeight,
      height: box.querySelector('.tuto-screen').getBoundingClientRect().height,
      lines: Math.round(text.getBoundingClientRect().height / parseFloat(getComputedStyle(text).lineHeight)),
      image: { src: image.getAttribute('src'), alt: image.alt, width: image.naturalWidth, missing: image.closest('figure').classList.contains('is-missing') },
    };
  });
}

// La prise en main, une fois l'image de l'écran affiché venue (ou refusée).
async function tutorialScreen(target) {
  await target.waitForFunction(() => { const image = document.querySelector('.tuto-shot img'); return image && image.complete; });
  return tutorialState(target);
}

// Le plus faible contraste des points de la prise en main sur le fond de la fenêtre : ce sont des commandes, 4,5:1 au moins (charte, fenêtre des nouveautés).
const dotContrast = (target) => target.evaluate(() => {
  const parse = (value) => value.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
  const luminance = (rgb) => { const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const back = luminance(parse(getComputedStyle(document.querySelector('.modal-box.w-media')).backgroundColor));
  return Math.min(...[...document.querySelectorAll('.tuto-dot')].map((dot) => {
    const front = luminance(parse(getComputedStyle(dot, '::before').backgroundColor));
    return (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05);
  }));
});

// Le démarrage est fini (la table de la vue lue, le document examiné) ; ce que la prise en main aurait fait d'elle-même est fait.
async function startupSettled(target) {
  await target.waitForFunction(() => (window.__stub.calls.getTableId || 0) > 0);
  await target.waitForTimeout(600);
}

await scenario('E2E-51 prise en main : s\'ouvre d\'elle-même une fois, après la question de la table ; souris et clavier ; tient dans 700×400 ; Réglages > Aide la rouvre', async (page) => {
  await page.waitForSelector('[role=dialog]');
  assert.equal(await page.locator('.modal-title').innerText(), 'Créer la table du widget dans ce document ?');
  assert.equal(await page.locator('.modal-box.w-media').count(), 0, 'jamais par-dessus une autre fenêtre : elle attend la réponse');
  await page.getByRole('button', { name: 'Créer la table' }).click();
  await page.waitForSelector('.modal-box.w-media');
  assert.equal(await page.locator('[role=dialog]').count(), 1);
  const names = [];
  const heights = new Set();
  for (let i = 0; i < 6; i += 1) {
    const state = await tutorialScreen(page);
    assert.equal(state.title, 'Prise en main');
    assert.equal(state.index, i);
    assert.equal(state.fits, true, `écran ${i + 1} : la fenêtre tient dans 700×400 sans défilement`);
    assert.ok(state.lines <= 2, `écran ${i + 1} : deux lignes de texte au plus (${state.lines})`);
    assert.equal(state.image.width, 1200, `écran ${i + 1} : la capture est venue`);
    assert.match(state.image.src, /^img\/tuto\/[a-z]+-fr\.webp\?v=\d+\.\d+\.\d+$/);
    assert.equal(state.tabStops, 1, 'un seul arrêt de Tab pour les points');
    assert.deepEqual(state.footer, i === 0 ? ['Fermer', 'Suivant*'] : i < 5 ? ['Fermer', 'Précédent', 'Suivant*'] : ['Précédent', 'Fermer*']);
    assert.equal(state.focus, i < 5 ? 'Suivant' : 'Fermer', 'le focus reste sur le bouton pressé, ou passe au principal quand il disparaît');
    names.push(state.name);
    heights.add(state.height);
    if (i < 5) await page.getByRole('button', { name: 'Suivant' }).click();
  }
  assert.equal(heights.size, 1, 'tous les écrans ont la même hauteur');
  assert.deepEqual(await unreadable(page), [], 'les textes se lisent (4,5:1), dans le thème clair');
  assert.ok(await dotContrast(page) >= 4.5, 'les points aussi');
  assert.deepEqual(names, ['Un workflow, du déclencheur à l\'action', 'Ajouter des nœuds', 'Relier les nœuds', 'Régler chaque nœud', 'Tester sans rien écrire', 'Activer, et garder la vue ouverte']);
  await page.getByRole('button', { name: 'Précédent' }).click();
  assert.equal((await tutorialState(page)).focus, 'Précédent');
  // Les points : les flèches, Début et Fin changent d'écran, le focus suit.
  await page.getByRole('tab', { name: 'Écran 5 sur 6 : Tester sans rien écrire' }).focus();
  await page.keyboard.press('Home');
  assert.deepEqual(await tutorialState(page).then((s) => [s.index, s.focus, s.footer]), [0, 'tab-0', ['Fermer', 'Suivant*']]);
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await tutorialState(page).then((s) => [s.index, s.focus]), [1, 'tab-1']);
  await page.keyboard.press('End');
  assert.deepEqual(await tutorialState(page).then((s) => [s.index, s.focus, s.footer]), [5, 'tab-5', ['Précédent', 'Fermer*']]);
  await page.keyboard.press('ArrowLeft');
  assert.deepEqual(await tutorialState(page).then((s) => [s.index, s.focus]), [4, 'tab-4']);
  await page.getByRole('tab', { name: 'Écran 3 sur 6 : Relier les nœuds' }).click();
  assert.equal((await tutorialState(page)).index, 2);
  // Échap la ferme et la retient : au rechargement, elle ne revient pas, même après la question de la table.
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[role=dialog]').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('ab_tuto')), '1');
  await page.reload();
  await page.waitForSelector('[role=dialog]');
  await page.getByRole('button', { name: 'Ne pas créer' }).click();
  await startupSettled(page);
  assert.equal(await page.locator('[role=dialog]').count(), 0, 'déjà vue : elle ne s\'ouvre plus d\'elle-même');
  // Réglages > Aide : par-dessus les Réglages ; Échap ne ferme qu'elle et rend le focus au bouton qui l'a ouverte.
  await page.click('#open-settings');
  assert.equal(await page.locator('#open-tutorial').innerText(), 'Prise en main');
  await page.click('#open-tutorial');
  await page.waitForSelector('.modal-box.w-media');
  assert.equal(await page.locator('[role=dialog]').count(), 2);
  assert.equal((await tutorialScreen(page)).index, 0, 'elle rouvre sur son premier écran');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[role=dialog]').count(), 1);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'open-tutorial');
}, { tutorial: true, noTables: true, viewport: SMALL });

await scenario('E2E-52 prise en main en lecture seule : jamais d\'elle-même, Réglages > Aide l\'ouvre', async (page) => {
  await page.waitForSelector('#read-only-notice:not([hidden])');
  await startupSettled(page);
  assert.equal(await page.locator('[role=dialog]').count(), 0);
  await page.click('#open-settings');
  await page.click('#open-tutorial');
  assert.equal((await tutorialScreen(page)).name, 'Un workflow, du déclencheur à l\'action');
  await page.locator('.modal-box.w-media').getByRole('button', { name: 'Fermer' }).click();
  assert.equal(await page.locator('[role=dialog]').count(), 1, 'les Réglages restent');
}, { tutorial: true, query: '?access=full&readonly=true' });

await scenario('E2E-53 prise en main : jamais sur la carte de l\'accès complet', async (page) => {
  await page.waitForSelector('#access-needed:not([hidden])');
  await page.waitForTimeout(800);
  assert.equal(await page.locator('[role=dialog]').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('ab_tuto')), null, 'rien n\'est retenu : elle s\'ouvrira une fois l\'accès accordé');
}, { tutorial: true, query: '?access=none&readonly=false' });

await scenario('E2E-54 prise en main hors de Grist : seule la fenêtre qui dit quoi faire', async (page) => {
  await page.waitForSelector('[role=dialog]');
  await page.waitForTimeout(600);
  assert.equal(await page.locator('[role=dialog]').count(), 1);
  assert.equal(await page.locator('.modal-box.w-media').count(), 0);
}, { tutorial: true, grist: false });

await scenario('E2E-55 prise en main dans le cadre de GFS, qui ne retient rien : jamais d\'elle-même (elle reviendrait à chaque chargement), Réglages > Aide l\'ouvre', async (page, app) => {
  await startupSettled(app);
  assert.equal(await app.locator('[role=dialog]').count(), 0);
  assert.equal(await app.evaluate(() => { try { localStorage.getItem('x'); return 'lisible'; } catch (err) { return 'refusé'; } }), 'refusé', 'le cadre isolé de GFS n\'a pas de stockage');
  await app.click('#open-settings');
  await app.click('#open-tutorial');
  const state = await tutorialScreen(app);
  assert.equal(state.image.width, 1200, 'les captures viennent du site du widget, même dans le cadre isolé');
  assert.equal(state.fits, true);
  await page.keyboard.press('Escape');
  assert.equal(await app.locator('[role=dialog]').count(), 1);
}, { tutorial: true, host: { context: { langue: 'fr', barre: null, ambiance: null } }, viewport: SMALL });

await scenario('E2E-56 prise en main : jamais par-dessus une fenêtre ouverte pendant le démarrage', async (page) => {
  await page.click('#open-settings');
  await page.waitForFunction(() => window.__stub.calls.getTableId > 0);
  await page.waitForTimeout(1800);   // la lecture du document (__fetchDelay) est finie
  assert.equal(await page.locator('[role=dialog]').count(), 1, 'les Réglages seuls');
  assert.equal(await page.locator('.modal-box.w-media').count(), 0);
}, { tutorial: true, init: { __fetchDelay: 800 } });

await scenario('E2E-57 prise en main en anglais et en sombre : captures et textes anglais ; une capture qui ne vient pas laisse sa place', async (page) => {
  await page.click('#open-settings');
  await page.getByRole('button', { name: 'Sombre' }).click();
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.click('#open-tutorial');
  let state = await tutorialScreen(page);
  assert.deepEqual([state.title, state.name, state.footer], ['Getting started', 'A workflow, from trigger to action', ['Close', 'Next*']]);
  assert.match(state.image.src, /^img\/tuto\/graphe-en\.webp\?v=/);
  assert.match(state.image.alt, /^Three connected nodes/);
  const height = state.height;
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  state = await tutorialScreen(page);
  assert.equal(state.name, 'Connect the nodes');
  assert.equal(state.image.missing, true, 'la capture refusée disparaît');
  assert.equal(state.height, height, 'sa place reste : la fenêtre ne saute pas');
  assert.equal(state.lines <= 2 && state.fits, true);
  assert.equal(await page.getByRole('tab', { name: 'Screen 3 of 6: Connect the nodes' }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.deepEqual(await unreadable(page), [], 'les textes se lisent (4,5:1), dans le thème sombre');
  assert.ok(await dotContrast(page) >= 4.5, 'les points aussi');
}, { blocked: ['**/img/tuto/relier-en.webp*'], viewport: SMALL });

/* ---------- Retouches de la 0.15.0 ---------- */

// Grist garde les réglages écrits par grist.setOption comme une modification de la vue, à enregistrer par son bouton « Enregistrer » :
// le widget n'y écrit le graphe que s'il ne peut pas le garder dans la table Automation.
await scenario('E2E-58 graphe gardé dans la table : rien dans les réglages de la vue, même à l\'activation ; sans la table, les réglages le gardent', async (page) => {
  await buildFlow(page);
  await page.click('#toggle-active');
  await page.waitForFunction(workflowSaved('(graph) => graph.active === true && graph.edges.length === 2'));
  await page.click('#toggle-active');
  await page.waitForFunction(workflowSaved('(graph) => graph.active === false'));
  assert.deepEqual(await page.evaluate(() => window.__stub.options), {}, 'aucun réglage de la vue écrit : Grist n\'a rien à faire enregistrer');
  const refused = await page.context().newPage();
  await refused.addInitScript(() => { window.__noTables = true; });
  await routeApi(refused);
  await refused.goto(url);
  await refused.waitForSelector('[role=dialog]');
  await refused.keyboard.press('Escape');
  await buildFlow(refused);
  await refused.waitForFunction(() => window.__stub.options.workflow && JSON.parse(window.__stub.options.workflow).edges.length === 2);
  assert.deepEqual(await refused.evaluate(() => Object.keys(window.__stub.docTables)), [], 'accord refusé : aucune table, le graphe est dans les réglages de la vue');
});

// Glisse un fil depuis la sortie `from` (un sélecteur) et le lâche en (x, y).
async function dropWire(page, from, x, y) {
  const out = await page.locator(from).boundingBox();
  await page.mouse.move(out.x + out.width / 2, out.y + out.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
}
const center = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

await scenario('E2E-59 fil lâché sur le fond : menu d\'ajout à cet endroit, sans Déclencheur ; le nœud choisi est relié, son entrée au bout du fil ; Échap ou un clic ailleurs abandonnent', async (page) => {
  await addNode(page, 'Déclencheur', 40, 120);
  const drop = { x: 420, y: 200 };
  await dropWire(page, '.node-trigger .pin-out', drop.x, drop.y);
  await page.waitForSelector('.add-menu .ss-panel:not([hidden])');
  assert.deepEqual(await page.locator('.add-menu [role=option]').allInnerTexts(), ['Condition', 'Lecture', 'Transformation', 'Action'], 'seulement les nœuds qui ont une entrée');
  assert.equal(await page.locator('.wire-temp').getAttribute('visibility'), 'visible', 'le fil reste tracé jusqu\'au menu');
  assert.equal(await page.locator('.canvas-connect-hint').isVisible(), false, 'le menu parle à la place de l\'invite');
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.add-menu input')), true, 'la recherche a le focus');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.add-menu').count(), 0);
  assert.equal(await page.locator('.wire-temp').getAttribute('visibility'), 'hidden', 'Échap : le fil disparaît');
  assert.equal(await page.locator('.node').count(), 1, 'rien n\'est ajouté');

  await dropWire(page, '.node-trigger .pin-out', drop.x, drop.y);
  await page.keyboard.type('cond');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.node-condition');
  assert.equal(await page.locator('.wire-group').count(), 1, 'le nouveau nœud est relié');
  const pin = center(await page.locator('.node-condition .pin-in').boundingBox());
  assert.ok(Math.abs(pin.x - drop.x) <= 1.5 && Math.abs(pin.y - drop.y) <= 1.5, `l'entrée est au bout du fil (${pin.x}, ${pin.y})`);
  assert.equal(await page.locator('.wire-temp').getAttribute('visibility'), 'hidden');

  const elseOut = center(await page.locator('.node-condition .pin-out[data-branch=else]').boundingBox());
  await dropWire(page, '.node-condition .pin-out[data-branch=else]', elseOut.x + 120, elseOut.y + 90);
  await page.locator('.add-menu [role=option]', { hasText: 'Action' }).click();
  await page.waitForSelector('.node-action');
  assert.equal(await page.locator('.wire-group.wire-else').count(), 1, 'depuis « Sinon », le lien garde sa branche');
  const saved = await savedRows(page, workflowSaved('(graph) => graph.edges.length === 2'));
  assert.deepEqual(JSON.parse(saved.find((row) => row.Type === 'Workflow').Config).edges, [{ from: 'trigger-1', to: 'condition-1' }, { from: 'condition-1', to: 'action-1', branch: 'else' }]);

  const canvas = await page.locator('#canvas').boundingBox();
  await dropWire(page, '.node-condition .pin-out[data-branch=then]', canvas.x + canvas.width - 12, canvas.y + canvas.height - 12);
  await page.waitForSelector('.add-menu .ss-panel:not([hidden])');
  const panel = await page.locator('.add-menu .ss-panel').boundingBox();
  assert.ok(panel.x >= canvas.x && panel.x + panel.width <= canvas.x + canvas.width + 0.5 && panel.y >= canvas.y && panel.y + panel.height <= canvas.y + canvas.height + 0.5, 'près du bord, le menu reste dans le canevas');
  await page.mouse.click(300, 450);
  assert.equal(await page.locator('.add-menu').count(), 0);
  assert.equal(await page.locator('.wire-temp').getAttribute('visibility'), 'hidden', 'un clic ailleurs abandonne le fil');
  assert.equal(await page.locator('.node').count(), 3);
  await page.mouse.click(canvas.x + 30, canvas.y + canvas.height - 40, { button: 'right' });
  await page.waitForSelector('.add-menu .ss-panel:not([hidden])');
  assert.equal(await page.locator('.add-menu [role=option]').count(), 5, 'le clic droit propose toujours les cinq nœuds');
});

// Tire le bord droit d'un nœud de dx px, à mi-hauteur (loin des broches).
async function dragEdge(page, selector, dx) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + box.width - 0.5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 0.5 + dx, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
}
const widthOf = (page, selector) => page.locator(selector).evaluate((element) => element.offsetWidth);

await scenario('E2E-60 largeur d\'un nœud : son bord se tire, au clavier aussi ; gardée dans le graphe, bornée, remise à l\'origine d\'un double-clic ; pas en lecture seule', async (page) => {
  await addNode(page, 'Déclencheur', 40, 120);
  await addNode(page, 'Action', 420, 120);
  await page.locator('.node-trigger .pin-out').click();
  await page.locator('.node-action .pin-in').click();
  assert.equal(await widthOf(page, '.node-action'), 232, 'largeur d\'origine');
  const wire = await page.locator('.wire-group .wire').getAttribute('d');
  await dragEdge(page, '.node-trigger', 120);
  assert.equal(await widthOf(page, '.node-trigger'), 352);
  assert.notEqual(await page.locator('.wire-group .wire').getAttribute('d'), wire, 'le lien suit la sortie déplacée');
  const saved = await savedRows(page, workflowSaved('(graph) => graph.nodes[0].w === 352 && graph.edges.length === 1'));
  assert.equal(JSON.parse(saved.find((row) => row.Type === 'Workflow').Config).nodes[1].w, undefined, 'un nœud qu\'on n\'a pas élargi n\'a pas de largeur gardée');

  await dragEdge(page, '.node-action', -400);
  assert.equal(await widthOf(page, '.node-action'), 200, 'pas plus étroit que 200 px');
  await page.locator('.node-action .node-head').focus();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  assert.equal(await widthOf(page, '.node-action'), 240, 'Maj + flèche droite : 20 px de plus');
  await page.keyboard.press('Shift+ArrowLeft');
  assert.equal(await widthOf(page, '.node-action'), 220);
  await page.waitForFunction(workflowSaved('(graph) => graph.nodes[1].w === 220'));

  const action = await page.locator('.node-action').boundingBox();
  await page.mouse.dblclick(action.x + action.width - 0.5, action.y + action.height / 2);
  assert.equal(await widthOf(page, '.node-action'), 232, 'double-clic : largeur d\'origine');
  const reset = await savedRows(page, workflowSaved('(graph) => graph.nodes[1].w === undefined && graph.nodes[0].w === 352'));

  const copy = await page.context().newPage();
  await copy.addInitScript((rows) => { window.__preloadRows = rows; }, reset);
  await routeApi(copy);
  await copy.goto(url + '?access=full&readonly=true');
  await copy.waitForSelector('.node-trigger');
  assert.equal(await widthOf(copy, '.node-trigger'), 352, 'la largeur revient au rechargement, en lecture seule aussi');
  assert.equal(await copy.locator('.node-grip').first().isVisible(), false, 'en lecture seule, pas de bord à tirer');
  await dragEdge(copy, '.node-trigger', 80);
  assert.equal(await widthOf(copy, '.node-trigger'), 352, 'ni à la souris');
});

await scenario('E2E-62 une ligne reçue dont les valeurs sont du HTML (un lien public) : écrite telle quelle, journal et test à blanc la montrent en texte, rien n\'entre dans la page', async (page) => {
  const hostile = '<img src=x onerror="document.title=\'pwned\'"><script>document.title=\'pwned\'</script> {Statut}';
  await buildFlow(page);
  await page.fill('#action-1-value', '{Nom}');
  await page.click('#toggle-active');
  await push(page, { id: 1, Nom: hostile, Statut: 'Nouveau' }, { id: 1, Nom: hostile, Statut: 'Clos' });
  await page.waitForFunction(() => window.__stub.docTables.Automation.rows.filter((r) => r.Type === 'Log').length === 2);
  assert.deepEqual(await page.evaluate(() => window.__stub.applied), [['AddRecord', 'Archive', null, { Motif: hostile }]], 'écrite telle quelle : ni évaluée, ni substituée une seconde fois');
  await page.click('#toggle-logs');
  await page.click('#test-workflow');
  await page.waitForFunction(() => /Dry-run ligne 1/.test(document.getElementById('log-list').innerText));
  assert.ok((await page.locator('#log-list').innerText()).includes('<img src=x onerror='), 'le texte reçu se lit dans le journal, balises comprises');
  assert.equal(await page.evaluate(() => document.querySelectorAll('img[src="x"]').length), 0, 'aucune image n\'est née du texte');
  assert.equal(await page.locator('#log-list img, #log-list script').count(), 0, 'ni balise dans le journal');
  assert.notEqual(await page.title(), 'pwned');
  const details = await page.evaluate(() => window.__stub.docTables.Automation.rows.filter((r) => r.Type === 'Log').map((r) => r.Detail));
  assert.ok(details.some((text) => text.includes(JSON.stringify(hostile).slice(1, -1))), 'le journal du document garde la valeur comme texte');
});

/* ---------- L'appel `fermer` de GFS (consigne 010), joué dans le faux GFS (tests/e2e/gfs-host.html) ---------- */

// La réponse de l'app à `fermer` (type, data et l'heure à laquelle elle est venue) ; holdClose laisse l'appel en route, pour répondre à la question de l'app, et closeAnswer en rend la réponse.
const askClose = (page, raison = 'app') => page.evaluate((reason) => window.hote.call('fermer', { raison: reason }), raison);
const holdClose = (page, raison = 'app') => page.evaluate((reason) => { window.__closing = window.hote.call('fermer', { raison: reason }); }, raison);
const closeAnswer = (page) => page.evaluate(() => window.__closing);
// Une modification du graphe : un nœud Déclencheur posé au clic droit sur le fond.
async function addTrigger(page, app) {
  await page.mouse.click(300, 300, { button: 'right' });
  await app.waitForSelector('.ss-panel');
  await page.keyboard.type('Déclencheur');
  await page.keyboard.press('Enter');
  await app.waitForSelector('.node-trigger');
}
const workflowRow = (app) => app.evaluate(() => window.__stub.docTables.Automation.rows.find((row) => row.Type === 'Workflow') || null);
const hasTrigger = (row) => Boolean(row) && JSON.parse(row.Config).nodes.some((node) => node.type === 'trigger');

await scenario('E2E-63 GFS demande de fermer et rien n\'attend : oui tout de suite, sans question, quelle que soit la raison', async (page, app) => {
  const reply = await askClose(page, 'app');
  assert.deepEqual([reply.type, reply.data], ['reponse', { ferme: true }]);
  for (const raison of ['explorateur', 'nouveau', 'importer', 'lire', 'lien', '']) assert.equal((await askClose(page, raison)).data.ferme, true, `raison « ${raison} »`);
  assert.equal(await app.locator('.modal').count(), 0, 'aucune question');
}, { host: { context: {} } });

await scenario('E2E-64 en lecture seule, GFS demande de fermer : oui tout de suite, rien n\'est écrit', async (page, app) => {
  assert.equal(await app.locator('#add-node').isDisabled(), true, 'lecture seule');
  const reply = await askClose(page);
  assert.deepEqual([reply.type, reply.data], ['reponse', { ferme: true }]);
  assert.deepEqual(await app.evaluate(() => [window.__stub.writes.length, window.__stub.refused.length]), [0, 0], 'ni écriture ni refus, pas même le verrou');
}, { host: { context: {}, query: '&access=full&readonly=true' } });

await scenario('E2E-65 une modification attend (enregistrement automatique) : GFS demande de fermer, elle est écrite, le oui vient après l\'écriture, sans question', async (page, app) => {
  await app.evaluate(() => { window.__stub.writeDelay = 1500; });
  await addTrigger(page, app);
  assert.equal(await workflowRow(app), null, 'le document est lent : rien n\'y est encore écrit');
  const reply = await askClose(page, 'app');
  assert.deepEqual([reply.type, reply.data], ['reponse', { ferme: true }]);
  assert.equal(hasTrigger(await workflowRow(app)), true, 'le graphe est dans le document au moment du oui');
  const lastWrite = await app.evaluate(() => Math.max(...window.__stub.writes.map((write) => write.at)));
  assert.ok(lastWrite <= reply.at, 'aucune écriture après le oui');
  assert.equal(await app.locator('.modal').count(), 0, 'pas de question : l\'enregistrement automatique décide seul');
}, { host: { context: {} } });

await scenario('E2E-66 l\'écriture échoue : GFS qui demande de fermer reçoit la question de l\'app, Annuler et Échap gardent l\'app, Enregistrer réessaie', async (page, app) => {
  await app.evaluate(() => { window.__stub.failWith = 'Droits insuffisants'; });
  await addTrigger(page, app);
  await holdClose(page, 'lien');
  await app.waitForSelector('.modal-box');
  assert.equal(await app.locator('.modal-title').innerText(), 'Modifications non enregistrées');
  assert.deepEqual(await app.locator('.modal-footer button').allInnerTexts(), ['Annuler', 'Abandonner', 'Enregistrer']);
  assert.match(await app.locator('.modal-body').innerText(), /Droits insuffisants/, 'la question dit pourquoi');
  assert.equal(await app.evaluate(() => document.activeElement.textContent), 'Enregistrer', 'le focus est sur Enregistrer');
  await app.locator('.modal-footer button', { hasText: 'Annuler' }).click();
  assert.equal((await closeAnswer(page)).data.ferme, false, 'Annuler : l\'app reste');
  assert.equal(await app.locator('.modal').count(), 0);
  assert.equal(await app.locator('.node-trigger').count(), 1, 'tout reste en place');

  await holdClose(page, 'app');
  await app.waitForSelector('.modal-box');
  await page.keyboard.press('Escape');
  assert.equal((await closeAnswer(page)).data.ferme, false, 'Échap : l\'app reste aussi');

  await holdClose(page, 'app');
  await app.waitForSelector('.modal-box');
  await app.locator('.modal-footer button', { hasText: 'Enregistrer' }).click();
  await app.waitForSelector('.modal-box');
  assert.equal(await workflowRow(app), null, 'le document refuse encore : Enregistrer a réessayé, la question revient');
  await app.evaluate(() => { window.__stub.failWith = ''; });
  await app.locator('.modal-footer button', { hasText: 'Enregistrer' }).click();
  const reply = await closeAnswer(page);
  assert.deepEqual([reply.type, reply.data], ['reponse', { ferme: true }]);
  assert.equal(hasTrigger(await workflowRow(app)), true, 'écrit avant le oui');
  assert.equal(await app.locator('.modal').count(), 0);
}, { host: { context: {} } });

await scenario('E2E-67 l\'écriture échoue : Abandonner laisse partir l\'app, sans rien écrire', async (page, app) => {
  await app.evaluate(() => { window.__stub.failWith = 'Droits insuffisants'; });
  await addTrigger(page, app);
  await holdClose(page, 'nouveau');
  await app.waitForSelector('.modal-box');
  await app.locator('.modal-footer button', { hasText: 'Abandonner' }).click();
  const reply = await closeAnswer(page);
  assert.deepEqual([reply.type, reply.data], ['reponse', { ferme: true }]);
  assert.equal(await workflowRow(app), null, 'rien n\'a été écrit');
}, { host: { context: {} } });

const activeGraph = JSON.stringify({ version: 3, active: true, nodes: [
  { id: 'trigger-1', type: 'trigger', x: 40, y: 120, config: { action: 'update', column: 'Statut' } },
  { id: 'action-1', type: 'action', x: 400, y: 120, config: { type: 'AddRecord', table: 'Archive', column: 'Motif', value: 'fait' } },
], edges: [{ from: 'trigger-1', to: 'action-1' }] });
await scenario('E2E-68 un workflow actif : GFS demande de fermer pendant une exécution, l\'effet et le journal sont écrits avant le oui, et le verrou est rendu', async (page, app) => {
  await app.waitForFunction(() => /exécute maintenant/.test(document.getElementById('log-list').innerText));
  await app.evaluate(() => {
    window.__stub.writeDelay = 500;
    window.__stub.pushRecords([{ id: 1, Nom: 'A', Statut: 'Nouveau' }]);
    window.__stub.pushRecords([{ id: 1, Nom: 'A', Statut: 'Clos' }]);
  });
  const reply = await askClose(page, 'app');
  assert.deepEqual([reply.type, reply.data], ['reponse', { ferme: true }]);
  const state = await app.evaluate(() => ({ applied: window.__stub.applied, rows: window.__stub.docTables.Automation.rows }));
  assert.deepEqual(state.applied, [['AddRecord', 'Archive', null, { Motif: 'fait' }]], 'l\'effet du workflow est écrit avant le oui');
  assert.equal(state.rows.filter((row) => row.Type === 'Log').length, 1, 'la ligne du journal aussi');
  assert.equal(state.rows.find((row) => row.Type === 'Lock').Config, '', 'le verrou est rendu : un autre onglet reprend sans attendre son expiration');
}, { host: { context: {} }, init: { __preloadRows: [{ Type: 'Workflow', Table: 'Contacts', Actif: true, Version: 3, Config: activeGraph }] } });

await scenario('E2E-69 une colonne indispensable de la table disparaît pendant la session : la question de l\'app dit laquelle, et Enregistrer écrit dès qu\'elle est revenue', async (page, app) => {
  const columns = await app.evaluate(() => {
    const table = window.__stub.docTables.Automation;
    const all = table.columns.slice();
    table.columns = all.filter((column) => column !== 'Config');   // comme une colonne renommée dans Grist
    return all;
  });
  await addTrigger(page, app);
  await holdClose(page, 'importer');
  await app.waitForSelector('.modal-box');
  assert.match(await app.locator('.modal-body').innerText(), /Config/, 'la question dit quelle colonne manque');
  assert.equal(await workflowRow(app), null, 'rien n\'est écrit tant qu\'elle manque');
  await app.evaluate((all) => { window.__stub.docTables.Automation.columns = all; }, columns);
  await app.locator('.modal-footer button', { hasText: 'Enregistrer' }).click();
  const reply = await closeAnswer(page);
  assert.deepEqual([reply.type, reply.data], ['reponse', { ferme: true }]);
  assert.equal(hasTrigger(await workflowRow(app)), true, 'écrit une fois la colonne revenue, avant le oui');
}, { host: { context: {} } });

await browser.close();
server.close();
process.exit(failures ? 1 : 0);
