'use strict';
// HYG : règles de la charte et du guide Grist.Gouv vérifiées par lecture statique du code livré.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const list = (dir, ext) => fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(ext)).map((f) => path.join(dir, f));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const jsFiles = list('js', '.js');
const cssFiles = list('css', '.css');
const everything = [...jsFiles, ...cssFiles, 'index.html'];
const offenders = (files, pattern) => files.filter((f) => pattern.test(read(f)));

test('HYG-01 aucun appel réseau, eval ni Function dans le code du widget', () => {
  assert.deepStrictEqual(offenders(jsFiles, /\beval\s*\(|new\s+Function|\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/), []);
});

test('HYG-02 aucune police, feuille de style ni image d\'un autre site', () => {
  assert.deepStrictEqual(offenders(cssFiles, /@import|url\(\s*["']?https?:/), []);
  const external = [...read('index.html').matchAll(/<(link|img|script)[^>]+(?:href|src)="(https?:[^"]+)"/g)].map((m) => m[2]);
  assert.deepStrictEqual(external, ['https://docs.getgrist.com/grist-plugin-api.js']);
});

test('HYG-03 la police de l\'interface commence par system-ui', () => {
  assert.match(read('css/tokens.css'), /--font-ui:\s*system-ui/);
});

test('HYG-04 pas de prompt() ni confirm() natifs, pas d\'innerHTML ni d\'attribut style', () => {
  assert.deepStrictEqual(offenders(jsFiles, /\b(prompt|confirm)\s*\(|innerHTML|outerHTML|insertAdjacentHTML|document\.write/), []);
  assert.doesNotMatch(read('index.html'), /\sstyle="/);
  assert.deepStrictEqual(offenders(jsFiles, /setAttribute\(\s*['"]style['"]|cssText/), []);
});

test('HYG-05 pas d\'emoji ni de police d\'icônes dans l\'interface', () => {
  assert.deepStrictEqual(offenders(everything, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u), []);
  assert.deepStrictEqual(offenders(everything, /font-?awesome|material-icons/i), []);
});

test('HYG-06 la politique de sécurité n\'autorise que le widget et l\'API Grist', () => {
  const csp = read('index.html').match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /default-src 'none'/);
  assert.doesNotMatch(csp, /unsafe-|connect-src/);
  assert.deepStrictEqual([...csp.matchAll(/https:\/\/[^\s;]+/g)].map((m) => m[0]), ['https://docs.getgrist.com/grist-plugin-api.js']);
});

test('HYG-07 aucune couleur en dur hors des jetons (le blanc du texte d\'un bouton plein excepté)', () => {
  const hardCoded = cssFiles
    .filter((f) => !f.endsWith('tokens.css'))
    .filter((f) => /#(?!fff\b)[0-9a-fA-F]{3,6}\b|rgba?\(/.test(read(f).replace(/url\("data:[^"]*"\)/g, '')));
  assert.deepStrictEqual(hardCoded, []);
});

test('HYG-08 le compte personnel n\'apparaît nulle part dans l\'interface', () => {
  assert.deepStrictEqual(offenders(everything, /lombre33/i), []);
});

test('HYG-09 le widget ne stocke que la langue et le thème dans le navigateur', () => {
  const keys = new Set();
  for (const f of jsFiles) for (const m of read(f).matchAll(/(?:getItem|setItem)\(\s*(?:STORAGE_KEY|'([^']+)')/g)) keys.add(m[1] || 'STORAGE_KEY');
  assert.deepStrictEqual([...keys].sort(), ['STORAGE_KEY']);
  assert.deepStrictEqual(offenders(jsFiles, /sessionStorage|indexedDB|document\.cookie/), []);
});
