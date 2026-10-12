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
async function scenario(name, run, { grist = true, viewport = { width: 1100, height: 700 } } = {}) {
  const context = await browser.newContext({ viewport, locale: 'fr-FR' });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
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
  const out = await page.locator('.node-condition .pin-out').boundingBox();
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

await browser.close();
server.close();
process.exit(failures ? 1 : 0);
