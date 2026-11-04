// Les captures de la prise en main (js/tutorial.js) : npm run tutorial:shots, à refaire quand l'interface qu'elles montrent change, puis à relire avant de pousser.
// Une capture par écran et par langue, prise dans le vrai widget (API Grist simulée de tests/e2e/grist-stub.js), dans le thème clair : une capture claire encadrée
// se lit aussi dans le thème sombre (charte Grist Factory, fenêtre des nouveautés). Bandeau 3:1 de 600 × 200 px CSS à l'échelle 2, enregistré en WebP de 1200 × 400 :
// img/tuto/<écran>-<langue>.webp. Le document est celui du simulateur, ses colonnes dans la langue de la capture : la table Contacts (Nom, Statut ; Name, Status)
// et la table Archive (Motif ; Reason). L'horloge de la page est fixée (le journal montre toujours la même heure) : deux passages donnent les mêmes images.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { root, serve, launch, routeApi, tutorialSeen, addNode, pick, waitSchema } from './harness.mjs';

const TEXTS = createRequire(import.meta.url)(path.join(root, 'js/i18n-texts.js'));
const OUT = path.join(root, 'img/tuto');
const BAND = { width: 600, height: 200 };   // le bandeau, en pixels CSS
const CLOCK = new Date('2026-11-04T10:30:00+01:00');

// Ce que chaque langue tape et choisit. En anglais, le simulateur reçoit les mêmes tables avec des colonnes en anglais (window.__fixedTables).
const DATA = {
  fr: { name: 'Nom', status: 'Statut', closed: 'Clos', open: 'Nouveau', person: 'Dupont', reason: 'motif', add: 'ajouter', tables: null },
  en: {
    name: 'Name', status: 'Status', closed: 'Closed', open: 'New', person: 'Smith', reason: 'reason', add: 'add',
    tables: {
      Contacts: { id: [1], manualSort: [1], Name: ['A'], Status: ['New'], Amount: [10], gristHelper_Display: [''] },
      Archive: { id: [1, 2], manualSort: [1, 2], Reason: ['a', 'b'], Source: [10, 500] },
    },
  },
};

const { server, url } = await serve();
const browser = await launch();
fs.mkdirSync(OUT, { recursive: true });

// Une capture du bandeau dont le coin haut gauche est (x, y), en WebP : Chromium l'encode lui-même, sur une page vide (sans la politique de sécurité du widget).
async function capture(page, encoder, name, lang, x, y) {
  const png = await page.screenshot({ clip: { x, y, ...BAND } });
  const webp = await encoder.evaluate(async (data) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + data;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas.toDataURL('image/webp', 0.92).split(',')[1];
  }, png.toString('base64'));
  fs.writeFileSync(path.join(OUT, `${name}-${lang}.webp`), Buffer.from(webp, 'base64'));
  console.log('img/tuto/' + `${name}-${lang}.webp`);
}

// Le centre d'un élément de la page.
async function center(page, selector) {
  const box = await page.locator(selector).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Le coin du bandeau posé sur ces éléments (leur boîte commune) : centré, ou, avec top, juste au-dessus d'eux ; jamais hors de la fenêtre.
async function around(page, selector, { top = false } = {}) {
  const boxes = await page.locator(selector).evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()));
  const left = Math.min(...boxes.map((box) => box.left));
  const right = Math.max(...boxes.map((box) => box.right));
  const upper = Math.min(...boxes.map((box) => box.top));
  const lower = Math.max(...boxes.map((box) => box.bottom));
  const viewport = page.viewportSize();
  const clamp = (value, max) => Math.round(Math.max(0, Math.min(max, value)));
  return {
    x: clamp((left + right - BAND.width) / 2, viewport.width - BAND.width),
    y: clamp(top ? upper - 16 : (upper + lower - BAND.height) / 2, viewport.height - BAND.height),
  };
}

// Le canevas recule de quelques crans de molette (un cran : 1/1,1), autour d'un point du fond.
async function zoomOut(page, steps) {
  await page.mouse.move(500, 520);
  for (let i = 0; i < steps; i += 1) await page.mouse.wheel(0, 100);
  await page.waitForTimeout(100);
}

// Un clic sur le fond, comme après une saisie, puis plus de focus du tout : ni champ cerné ni contour du canevas sur la capture, la souris dans un coin vide.
async function settle(page) {
  await page.mouse.click(500, 520);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.mouse.move(990, 550);
  await page.waitForTimeout(100);
}

async function studio(lang) {
  const t = TEXTS[lang];
  const data = DATA[lang];
  const context = await browser.newContext({ viewport: { width: 1000, height: 560 }, deviceScaleFactor: 2, locale: lang === 'fr' ? 'fr-FR' : 'en-US', timezoneId: 'Europe/Paris' });
  await tutorialSeen(context);
  await context.addInitScript(({ language, tables }) => {
    try { localStorage.setItem('ab_lang', language); localStorage.setItem('ab_theme', 'light'); } catch (err) { /* sans stockage, la langue du navigateur */ }
    if (tables) window.__fixedTables = tables;
  }, { language: lang, tables: data.tables });
  const page = await context.newPage();
  const encoder = await context.newPage();
  await page.clock.setFixedTime(CLOCK);
  await routeApi(page);
  await page.goto(url);
  await page.waitForSelector('#add-node');
  await page.bringToFront();
  const shoot = async (name, at) => capture(page, encoder, name, lang, at.x, at.y);
  const row = (status) => ({ id: 1, [data.name]: data.person, [data.status]: status });

  // Le déclencheur, puis le menu d'ajout ouvert sur le fond, à côté de lui, sa recherche vide.
  await addNode(page, t['node.trigger'], 40, 80);
  await waitSchema(page, data.status);
  await pick(page, 'trigger-1-column', data.status.toLowerCase());
  await page.mouse.click(330, 80, { button: 'right' });
  await page.waitForSelector('.add-menu .ss-panel:not([hidden])');
  await page.mouse.move(990, 550);
  await shoot('ajouter', await around(page, '.node-trigger, .add-menu .ss-panel', { top: true }));
  await page.keyboard.type(t['node.condition']);
  await page.keyboard.press('Enter');
  await pick(page, 'condition-1-column', data.status.toLowerCase());
  await page.fill('#condition-1-value', data.closed);
  await settle(page);

  // Relier : un lien tiré de la sortie du déclencheur, posé sur l'entrée de la condition, pas encore lâché.
  const from = await center(page, '.node-trigger .pin-out');
  const to = await center(page, '.node-condition .pin-in');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await shoot('relier', await around(page, '.node-trigger, .node-condition', { top: true }));
  await page.mouse.up();

  // Régler : l'action, reliée à la sortie « Oui », ajoute une ligne dans Archive, Motif = {Nom} ; le canevas recule pour la montrer entière, avec la condition.
  await addNode(page, t['node.action'], 680, 80);
  await page.locator('.node-condition .pin-out[data-branch=then]').click();
  await page.locator('.node-action .pin-in').click();
  await pick(page, 'action-1-type', data.add);
  await pick(page, 'action-1-table', 'archive');
  await pick(page, 'action-1-column', data.reason);
  await page.fill('#action-1-value', `{${data.name}}`);
  await settle(page);
  await zoomOut(page, 3);
  await page.mouse.move(990, 550);
  await shoot('regler', await around(page, '.node-condition, .node-action'));

  // Le graphe entier, plus loin encore.
  await zoomOut(page, 3);
  await page.mouse.move(990, 550);
  await shoot('graphe', await around(page, '.node'));

  // Tester sur la ligne de la vue : chaque nœud dit ce qu'il a fait.
  await page.evaluate((record) => window.__stub.pushRecords([record]), row(data.closed));
  await page.click('#test-workflow');
  await page.waitForSelector('.node-action .node-state:not([hidden])');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.mouse.move(990, 550);
  await shoot('tester', await around(page, '.node'));

  // Activer : le bandeau, le bouton « Désactiver », et le journal d'une exécution réussie, dans un panneau de la hauteur du bandeau.
  await page.click('#toggle-active');
  await page.evaluate((record) => window.__stub.pushRecords([record]), row(data.open));
  await page.evaluate((record) => window.__stub.pushRecords([record]), row(data.closed));
  await page.waitForFunction(() => window.__stub.applied.length > 0);
  await page.click('#toggle-logs');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.setViewportSize(BAND);
  await page.mouse.move(300, 120);
  await page.waitForTimeout(200);
  await shoot('activer', { x: 0, y: 0 });
  await context.close();
}

for (const lang of ['fr', 'en']) await studio(lang);
await browser.close();
server.close();
