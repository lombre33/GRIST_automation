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
const stubSource = fs.readFileSync(path.join(root, 'tests/e2e/grist-stub.js'), 'utf8');
const API = 'https://docs.getgrist.com/grist-plugin-api.js';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
let failures = 0;
async function scenario(name, run, { grist = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 700, height: 400 }, locale: 'fr-FR' });
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

async function pick(page, id, search) {
  await page.locator(`#${id}`).locator('xpath=..').locator('.ss-button').click();
  await page.locator(`#${id}`).locator('xpath=..').locator('input').fill(search);
  await page.keyboard.press('Enter');
}

await scenario('E2E-01 scénario de base : configurer, activer, modifier une ligne, écriture dans Archive', async (page) => {
  await page.waitForFunction(() => document.querySelector('#act-table option[value="Archive"]'));
  await pick(page, 'trg-column', 'statut');
  await pick(page, 'cond-column', 'statut');
  await page.fill('#cond-value', 'Clos');
  await pick(page, 'act-type', 'ajouter');
  await pick(page, 'act-table', 'archive');
  await pick(page, 'act-column', 'motif');
  await page.fill('#act-value', 'clos');
  await page.click('button[type=submit]');
  await page.click('#toggle-active');
  assert.equal(await page.locator('#open-tab-warning').isVisible(), true, 'bandeau « onglet ouvert requis »');
  await page.evaluate(() => window.__stub.pushRecords([{ id: 1, Nom: 'A', Statut: 'Nouveau' }]));
  await page.evaluate(() => window.__stub.pushRecords([{ id: 1, Nom: 'A', Statut: 'Clos' }]));
  await page.waitForFunction(() => window.__stub.applied.length > 0);
  assert.deepEqual(await page.evaluate(() => window.__stub.applied), [['AddRecord', 'Archive', null, { Motif: 'clos' }]]);
  assert.match(await page.locator('#log-list li').first().innerText(), /modification ligne 1 : réussi/);
});

await scenario('E2E-02 dry-run : aucune écriture', async (page) => {
  await page.waitForFunction(() => document.querySelector('#act-table option[value="Archive"]'));
  await page.evaluate(() => window.__stub.pushRecords([{ id: 1, Nom: 'A', Statut: 'Clos' }]));
  await pick(page, 'act-type', 'ajouter');
  await pick(page, 'act-table', 'archive');
  await pick(page, 'act-column', 'motif');
  await page.fill('#act-value', 'x');
  await page.click('#test-workflow');
  assert.match(await page.locator('#log-list li').first().innerText(), /Dry-run ligne 1/);
  assert.deepEqual(await page.evaluate(() => window.__stub.applied), []);
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

await scenario('E2E-05 liste avec recherche : Échap ferme la liste seule, mots dans le désordre', async (page) => {
  await page.waitForFunction(() => document.querySelector('#act-table option[value="Archive"]'));
  const host = page.locator('#cond-column').locator('xpath=..');
  await host.locator('.ss-button').click();
  await host.locator('input').fill('nom');
  assert.equal(await host.locator('.ss-options li[role=option]').count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await host.locator('.ss-panel').isHidden(), true);
  assert.equal(await page.evaluate(() => document.activeElement.className.includes('ss-button')), true);
});

await scenario('E2E-06 tient dans 700×400 sans défilement horizontal', async (page) => {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
});

await scenario('E2E-07 hors de Grist : une fenêtre dit quoi faire', async (page) => {
  await page.waitForSelector('[role=dialog]');
  assert.match(await page.locator('.modal-title').innerText(), /depuis Grist/);
  assert.match(await page.locator('.modal input').inputValue(), /^http:\/\/localhost:\d+\/$/);
}, { grist: false });

await browser.close();
server.close();
process.exit(failures ? 1 : 0);
