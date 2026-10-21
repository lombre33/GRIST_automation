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
  assert.deepStrictEqual(offenders(jsFiles, /window\.(prompt|confirm)|(?<![\w.])(?<!function )(prompt|confirm)\s*\(|innerHTML|outerHTML|insertAdjacentHTML|document\.write/), []);
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
  // 'unsafe-eval' est imposé par le bundle de l'API Grist (voir index.html) ; rien d'autre n'est assoupli.
  assert.match(csp, /'unsafe-eval'/, 'sans lui, l\'API Grist ne démarre pas');
  assert.doesNotMatch(csp.replace(/'unsafe-eval'/, ''), /unsafe-|connect-src/);
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

test('HYG-10 aucun z-index en dur : les couches passent par les jetons --z-* de la charte (règle 12 de GFS)', () => {
  assert.deepStrictEqual(offenders(cssFiles, /z-index:\s*(?!\s|var\(--z-[\w-]+\))/), []);
  assert.deepStrictEqual(offenders(jsFiles, /zIndex|z-index/), []);
  const tokens = read('css/tokens.css');
  const used = new Set(cssFiles.flatMap((f) => [...read(f).matchAll(/z-index:\s*var\((--z-[\w-]+)\)/g)].map((m) => m[1])));
  assert.ok(used.size >= 5, 'les couches existantes passent bien par des jetons');
  assert.deepStrictEqual([...used].filter((name) => !new RegExp(`${name}:\\s*\\d+`).test(tokens)), [], 'chaque jeton utilisé est défini');
});

test('HYG-11 un seul bleu d\'accent : pas de vert de succès dans les jetons, le rouge et l\'ambre gardent leur sens (règle 12 de GFS)', () => {
  assert.deepStrictEqual(offenders(everything, /--good|--success|--green/), []);
  assert.deepStrictEqual(offenders(cssFiles, /\bgreen\b|\blime\b/i), []);
});
