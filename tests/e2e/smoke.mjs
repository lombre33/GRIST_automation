// Scénario de base de bout en bout (Chromium + API Grist simulée) : npm run test:e2e
// Prérequis : Playwright installé hors du dépôt (aucune dépendance n'est ajoutée au widget).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
// PLAYWRIGHT_PATH : dossier de Playwright quand il n'est pas installé à côté du dépôt.
const { chromium } = await import(process.env.PLAYWRIGHT_PATH ? `${process.env.PLAYWRIGHT_PATH}/index.mjs` : 'playwright');

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const file = path.join(root, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, resolve));
const url = `http://localhost:${server.address().port}/`;
// Le vrai grist-plugin-api.js évalue chacun de ses modules par eval() : le simulateur fait de même, pour que la politique de sécurité de la page soit éprouvée comme en vrai.
const stubSource = `eval(${JSON.stringify(fs.readFileSync(path.join(root, 'tests/e2e/grist-stub.js'), 'utf8'))});`;
const API = 'https://docs.getgrist.com/grist-plugin-api.js';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
let failures = 0;
async function scenario(name, run, { grist = true, viewport = { width: 1100, height: 700 }, noTables = false, foreignLock = false } = {}) {
  const context = await browser.newContext({ viewport, locale: 'fr-FR' });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  if (foreignLock) await page.addInitScript(() => { window.__foreignLock = true; });
  if (noTables) await page.addInitScript(() => { window.__noTables = true; });
  await page.route(API, (route) => (grist
    ? route.fulfill({ contentType: 'text/javascript', body: stubSource })
    : route.abort()));
  try {
    await page.goto(url);
    await run(page);
    assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), [], 'erreurs console ou violations de la politique de sécurité');
    console.log('ok   ', name);
  } catch (err) {
    failures += 1;
    console.log('FAIL ', name, '\n', err.message);
  }
  await context.close();
}

// Ajoute un nœud par le clic droit sur le fond, à (x, y) dans la fenêtre.
async function addNode(page, label, x, y) {
  await page.mouse.click(x, y, { button: 'right' });
  await page.keyboard.type(label);
  await page.keyboard.press('Enter');
}

async function pick(page, id, search) {
  const host = page.locator(`#${id}`).locator('xpath=..');
  await host.locator('.ss-button').click();
  await host.locator('input').fill(search);
  await page.keyboard.press('Enter');
}

// Attend que les listes de colonnes soient remplies depuis le document simulé.
async function waitSchema(page) {
  await page.waitForFunction(() => document.querySelector('.node select option[value="Statut"], .node select option[value="Archive"]'));
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
  await pick(page, 'action-1-type', 'ajouter');
  await pick(page, 'action-1-table', 'archive');
  await pick(page, 'action-1-column', 'motif');
  await page.fill('#action-1-value', 'clos');
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

await scenario('E2E-11 sauvegarde automatique et rechargement du graphe', async (page) => {
  await buildFlow(page);
  await page.waitForFunction(() => window.__stub.options.workflow && JSON.parse(window.__stub.options.workflow).edges.length === 2);
  const saved = await page.evaluate(() => window.__stub.options.workflow);
  const copy = await page.context().newPage();
  await copy.addInitScript((value) => { window.__preloadOptions = { workflow: value }; }, saved);
  await copy.route(API, (route) => route.fulfill({ contentType: 'text/javascript', body: stubSource }));
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
  await page.click('#toggle-active');
  await page.evaluate(() => window.__stub.pushRecords([{ id: 1, Nom: 'A', Statut: 'Nouveau' }]));
  await page.evaluate(() => window.__stub.pushRecords([{ id: 1, Nom: 'A', Statut: 'Clos' }]));
  await page.waitForFunction(() => window.__stub.docTables.Automation.rows.filter((r) => r.Type !== 'Lock').length === 2);
  const log = await page.evaluate(() => window.__stub.docTables.Automation.rows.find((r) => r.Type === 'Log'));
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
  await page.click('#toggle-active');
  await page.evaluate(() => window.__stub.pushRecords([{ id: 1, Nom: 'A', Statut: 'Nouveau' }]));
  await page.evaluate(() => window.__stub.pushRecords([{ id: 1, Nom: 'A', Statut: 'Clos' }]));
  await page.waitForFunction(() => window.__stub.docTables.Automation.rows.filter((r) => r.Type !== 'Lock').length === 2);
  await page.waitForTimeout(400);
  const tables = await page.evaluate(() => JSON.stringify(window.__stub.docTables));
  const copy = await page.context().newPage();
  await copy.addInitScript((saved) => { window.__restore = JSON.parse(saved); }, tables);
  await copy.route(API, (route) => route.fulfill({ contentType: 'text/javascript', body: stubSource.replace('window.__stub = {', 'Object.assign(docTables, window.__restore || {}); window.__stub = {') }));
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
  await addNode(page, 'Action', 620, 330);
  await pick(page, 'action-2-type', 'ajouter');
  await pick(page, 'action-2-table', 'archive');
  await pick(page, 'action-2-column', 'motif');
  await page.fill('#action-2-value', 'autre');
  await page.locator('.node-condition .pin-out[data-branch=else]').click();
  await page.locator('#action-2-value').locator('xpath=ancestor::div[contains(@class,"node")]').locator('.pin-in').click();
  assert.equal(await page.locator('.wire-else').count(), 1);
  await page.click('#toggle-active');
  const push = (record) => page.evaluate((r) => window.__stub.pushRecords([r]), record);
  await push({ id: 1, Nom: 'A', Statut: 'Nouveau', Montant: 10 });
  await push({ id: 1, Nom: 'A', Statut: 'Ouvert', Montant: 500 });
  await page.waitForFunction(() => window.__stub.applied.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__stub.applied[0]), ['AddRecord', 'Archive', null, { Motif: 'clos' }], 'OU : le montant suffit');
  await push({ id: 1, Nom: 'A', Statut: 'En cours', Montant: 5 });
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
  await pick(page, 'action-1-type', 'ajouter');
  await pick(page, 'action-1-table', 'archive');
  await pick(page, 'action-1-column', 'motif');
  await page.fill('#action-1-value', 'Fiche {titre}');
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

await browser.close();
server.close();
process.exit(failures ? 1 : 0);
