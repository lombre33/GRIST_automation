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
  // Comme GitHub Pages : le cadre isolé de GFS (origine opaque) ne charge un module que si le site l'autorise.
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'access-control-allow-origin': '*' });
  res.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, resolve));
const url = `http://localhost:${server.address().port}/`;
// Le vrai grist-plugin-api.js évalue chacun de ses modules par eval() : le simulateur fait de même, pour que la politique de sécurité de la page soit éprouvée comme en vrai.
const stubSource = `eval(${JSON.stringify(fs.readFileSync(path.join(root, 'tests/e2e/grist-stub.js'), 'utf8'))});`;
const API = 'https://docs.getgrist.com/grist-plugin-api.js';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
let failures = 0;
// host : { context, fallback } joue l'app dans un faux GFS (tests/e2e/gfs-host.html), un cadre isolé comme chez GFS, qui rend `context` à l'appel `contexte` ; run(page, app) reçoit alors aussi le cadre de l'app
//   (`app`), dans lequel on lit et on clique (`page` reste la page de l'hôte : souris, clavier, captures). Sans host, `app` est la page. `fallback` garde le garde-fou de 2 s de l'attente de l'ambiance.
// blocked : adresses (globs) dont la requête échoue ; tolerated : messages de la console attendus dans ce scénario.
// E2E_ONLY=<expression régulière> ne joue que les scénarios dont le nom lui correspond (E2E_ONLY='E2E-3[6-9]|E2E-4').
async function scenario(name, run, { grist = true, viewport = { width: 1100, height: 700 }, noTables = false, foreignLock = false, preloadLogs = 0, init = null, host = null, blocked = [], tolerated = [] } = {}) {
  if (process.env.E2E_ONLY && !new RegExp(process.env.E2E_ONLY).test(name)) return;
  const context = await browser.newContext({ viewport, locale: 'fr-FR' });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  if (preloadLogs) await page.addInitScript((n) => { window.__preloadLogs = n; }, preloadLogs);
  if (foreignLock) await page.addInitScript(() => { window.__foreignLock = true; });
  if (noTables) await page.addInitScript(() => { window.__noTables = true; });
  if (init) await page.addInitScript((values) => Object.assign(window, values), init);
  if (host) await page.addInitScript((value) => { window.__context = value; }, host.context ?? {});
  if (host && !host.fallback) {
    // Le garde-fou de 2 s de js/theme.js est coupé : si l'ambiance ne levait pas l'attente, la page resterait cachée et l'essai échouerait, au lieu de passer grâce au garde-fou.
    await page.addInitScript(() => {
      const set = window.setTimeout.bind(window);
      window.setTimeout = (fn, ms, ...args) => (ms === 2000 ? 0 : set(fn, ms, ...args));
    });
  }
  for (const glob of blocked) await page.route(glob, (route) => route.abort());
  await page.route(API, (route) => (grist
    ? route.fulfill({ contentType: 'text/javascript', body: stubSource })
    : route.abort()));
  try {
    await page.goto(host ? `${url}tests/e2e/gfs-host.html` : url);
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
  await page.waitForFunction(() => window.__stub.docTables.Automation.rows.filter((r) => r.Type === 'Log').length === 2);
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
  await page.click('#toggle-active');
  await page.evaluate(() => window.__stub.pushRecords([{ id: 1, Nom: 'A', Statut: 'Nouveau' }]));
  await page.evaluate(() => window.__stub.pushRecords([{ id: 1, Nom: 'A', Statut: 'Clos' }]));
  await page.waitForFunction(() => window.__stub.docTables.Automation.rows.filter((r) => r.Type === 'Log').length === 2);
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
  await addNode(page, 'Action', 620, 390);
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
  const push = (record) => page.evaluate((r) => window.__stub.pushRecords([r]), record);
  await push({ id: 1, Nom: 'a', Statut: 'Nouveau' });
  await push({ id: 1, Nom: 'b', Statut: 'Clos' });
  await page.waitForFunction(() => window.__stub.applied.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__stub.applied[0]), ['UpdateRecord', 'Archive', 2, { Source: 'vu' }]);
  await push({ id: 1, Nom: 'zzz', Statut: 'Nouveau' });
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
  await pick(page, 'action-1-type', 'ajouter');
  await pick(page, 'action-1-table', 'archive');
  await pick(page, 'action-1-column', 'motif');
  await page.fill('#action-1-value', 'dépassé {seuil}');
  for (const [from, to] of [['trigger', 'lookup'], ['lookup', 'condition'], ['condition', 'action']]) {
    await page.locator(`.node-${from} .pin-out[data-branch=then]`).click();
    await page.locator(`.node-${to} .pin-in`).click();
  }
  await page.click('#toggle-active');
  const push = (record) => page.evaluate((r) => window.__stub.pushRecords([r]), record);
  await push({ id: 1, Nom: 'a', Statut: 'Nouveau', Montant: 20 });
  await push({ id: 1, Nom: 'a', Statut: 'Clos', Montant: 20 });
  await page.waitForFunction(() => window.__stub.applied.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__stub.applied[0]), ['AddRecord', 'Archive', null, { Motif: 'dépassé 10' }]);
  await push({ id: 1, Nom: 'b', Statut: 'Nouveau', Montant: 20 });
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
  await pick(page, 'action-1-type', 'ajouter');
  await pick(page, 'action-1-table', 'archive');
  await pick(page, 'action-1-column', 'motif');
  await page.fill('#action-1-value', 'vu');
  await page.locator('.node-trigger .pin-out').click();
  await page.locator('.node-action .pin-in').click();
  await pick(page, 'trigger-1-action', 'créée');
  assert.equal(await page.locator('#trigger-1-targetColumn').isDisabled(), true, 'ligne précise grisée pour une création');
  await page.click('#toggle-active');
  assert.match(await page.locator('#log-list').innerText(), /ne s'applique qu'à une modification/);
  await pick(page, 'trigger-1-action', 'modifiée');
  await page.click('#toggle-active');
  const push = (records) => page.evaluate((r) => window.__stub.pushRecords(r), records);
  await push([{ id: 1, Nom: 'Ada', Statut: 'a' }, { id: 2, Nom: 'Bob', Statut: 'a' }]);
  await push([{ id: 1, Nom: 'Ada', Statut: 'b' }, { id: 2, Nom: 'Bob', Statut: 'b' }]);
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
  const rows = await page.evaluate(() => window.__stub.docTables.Automation.rows);
  assert.deepEqual(rows.map((row) => [row.Type, row.Config]), [['Workflow', newerGraph]], 'même contenu, aucune ligne ajoutée (ni verrou)');
  assert.equal(await page.evaluate(() => window.__stub.options.workflow), undefined, 'rien dans les réglages de la vue non plus');
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
  const rows = await page.evaluate(() => window.__stub.docTables.Automation.rows);
  assert.deepEqual(rows.map((row) => [row.Type, row.Config]), [['Workflow', newerGraph]], 'la ligne illisible est intacte');
  assert.equal(await page.evaluate(() => window.__stub.options.workflow), undefined, 'les réglages de la vue non plus ne sont pas écrasés');
}, { init: { __fetchDelay: 400, __preloadRows: [{ Type: 'Workflow', Table: 'Contacts', Actif: true, Version: 4, Config: newerGraph }] } });

await scenario('E2E-35 contenu du document illisible, graphe actif dans les réglages de la vue : rien ne s\'exécute à sa place', async (page) => {
  await buildFlow(page);
  await page.click('#toggle-active');
  await page.waitForFunction(() => window.__stub.options.workflow && JSON.parse(window.__stub.options.workflow).active === true);
  const saved = await page.evaluate(() => window.__stub.options.workflow);
  const copy = await page.context().newPage();
  await copy.addInitScript((init) => Object.assign(window, init), { __preloadOptions: { workflow: saved }, __preloadRows: [{ Type: 'Workflow', Table: 'Contacts', Actif: true, Version: 4, Config: newerGraph }] });
  await copy.route(API, (route) => route.fulfill({ contentType: 'text/javascript', body: stubSource }));
  await copy.goto(url);
  await copy.waitForSelector('#locked:not([hidden])');
  assert.equal(await copy.locator('.node').count(), 0, 'le graphe des réglages de la vue n\'est plus affiché');
  assert.equal(await copy.locator('#open-tab-warning').isVisible(), false, 'rien n\'est actif');
  const push = (status) => copy.evaluate((value) => window.__stub.pushRecords([{ id: 1, Nom: 'A', Statut: value }]), status);
  await push('Nouveau');
  await push('Clos');
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

await browser.close();
server.close();
process.exit(failures ? 1 : 0);
