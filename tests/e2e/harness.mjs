// Ce que partagent les scénarios de bout en bout (smoke.mjs) et les captures de la prise en main (tutorial-shots.mjs) :
// le site servi comme par GitHub Pages, l'API Grist simulée (grist-stub.js), Chromium, et les gestes de base sur le canevas.
// Prérequis : Playwright installé hors du dépôt (aucune dépendance n'est ajoutée au widget) ; PLAYWRIGHT_PATH donne son dossier s'il n'est pas à côté.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const API = 'https://docs.getgrist.com/grist-plugin-api.js';
// Le vrai grist-plugin-api.js évalue chacun de ses modules par eval() : le simulateur fait de même, pour que la politique de sécurité de la page soit éprouvée comme en vrai.
export const stubSource = `eval(${JSON.stringify(fs.readFileSync(path.join(root, 'tests/e2e/grist-stub.js'), 'utf8'))});`;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };

// Le dépôt servi en local, adresse sans paramètres ; un dossier ou un fichier absent répond 404.
export async function serve() {
  const server = http.createServer((req, res) => {
    const asked = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(root, asked === '/' ? 'index.html' : asked);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    // Comme GitHub Pages : le cadre isolé de GFS (origine opaque) ne charge un module que si le site l'autorise.
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'access-control-allow-origin': '*' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  return { server, url: `http://localhost:${server.address().port}/` };
}

export async function launch() {
  const { chromium } = await import(process.env.PLAYWRIGHT_PATH ? `${process.env.PLAYWRIGHT_PATH}/index.mjs` : 'playwright');
  return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
}

// La page reçoit le simulateur à la place de l'API Grist (body : un simulateur modifié, au besoin), ou rien du tout quand grist est faux (le widget ouvert hors de Grist).
export function routeApi(page, grist = true, body = stubSource) {
  return page.route(API, (route) => (grist ? route.fulfill({ contentType: 'text/javascript', body }) : route.abort()));
}

// La prise en main s'ouvre d'elle-même la première fois (js/tutorial.js) : un navigateur qui l'a déjà vue garde sa version sous cette clé.
export const tutorial = createRequire(import.meta.url)(path.join(root, 'js/tutorial.js'));
export function tutorialSeen(context) {
  return context.addInitScript(([key, version]) => {
    try { localStorage.setItem(key, version); } catch (err) { /* cadre sans stockage : elle ne s'ouvre pas d'elle-même */ }
  }, [tutorial.STORAGE_KEY, String(tutorial.VERSION)]);
}

// Ajoute un nœud par le clic droit sur le fond, à (x, y) dans la fenêtre.
export async function addNode(page, label, x, y) {
  await page.mouse.click(x, y, { button: 'right' });
  await page.keyboard.type(label);
  await page.keyboard.press('Enter');
}

// Choisit dans la liste avec recherche du <select> d'identifiant id l'option que la recherche trouve en premier.
export async function pick(page, id, search) {
  const host = page.locator(`#${id}`).locator('xpath=..');
  await host.locator('.ss-button').click();
  await host.locator('input').fill(search);
  await page.keyboard.press('Enter');
}

// Attend que les listes de colonnes soient remplies depuis le document simulé (column : une colonne de Contacts, Statut par défaut).
export async function waitSchema(page, column = 'Statut') {
  await page.waitForFunction((name) => document.querySelector(`.node select option[value="${name}"], .node select option[value="Archive"]`), column);
}
