'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../js/i18n.js');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('I18N-01 les deux langues ont exactement les mêmes clés', () => {
  assert.deepStrictEqual(Object.keys(I.DICT.fr).sort(), Object.keys(I.DICT.en).sort());
});

test('I18N-07 les deux langues sont dans le même ordre, section par section (js/i18n-texts.js se relit en miroir)', () => {
  assert.deepStrictEqual(Object.keys(I.DICT.en), Object.keys(I.DICT.fr));
});

// Les textes écrits en dur dans index.html, lisibles avant le démarrage des scripts (et par un audit qui lit la page sans l'exécuter) : ceux du français.
test('I18N-08 les textes de index.html sont ceux du français de js/i18n-texts.js', () => {
  const html = read('index.html');
  const texts = [...html.matchAll(/data-i18n="([^"]+)"[^>]*>([^<]*)</g)].filter(([, , text]) => text !== '');
  assert.ok(texts.length >= 8, `textes trouvés : ${texts.length}`);
  for (const [, key, text] of texts) assert.strictEqual(text, I.DICT.fr[key], key);
  const labels = [...html.matchAll(/data-i18n-label="([^"]+)" aria-label="([^"]+)" title="([^"]+)"/g)];
  assert.strictEqual(labels.length, 4, 'les quatre boutons à étiquette : Ajouter, Tester, journal, Réglages');
  for (const [, key, label, title] of labels) {
    assert.strictEqual(label, I.DICT.fr[key], key);
    assert.strictEqual(title, I.DICT.fr[key], key);
  }
  assert.match(html, new RegExp(`id="toggle-active"[^>]*>${I.DICT.fr['toggle.activate']}<`), 'le bouton Activer, dont js/main.js tient le texte');
});

// Clés citées dans index.html et dans le code (hors js/i18n.js et js/i18n-texts.js) : littéraux 'ns.clé' et préfixes dynamiques 'ns.' + ….
function usedKeys() {
  const namespaces = [...new Set(Object.keys(I.DICT.fr).map((key) => key.split('.')[0]))].join('|');
  const used = new Set();
  for (const match of read('index.html').matchAll(/data-i18n(?:-placeholder|-label)?="([^"]+)"/g)) used.add(match[1]);
  const sources = fs.readdirSync(path.join(root, 'js')).filter((f) => f.endsWith('.js') && f !== 'i18n.js' && f !== 'i18n-texts.js');
  for (const file of sources) {
    const code = read('js/' + file);
    for (const match of code.matchAll(new RegExp(`'((?:${namespaces})\\.\\w+)'`, 'g'))) used.add(match[1]);
    for (const match of code.matchAll(new RegExp(`'(${namespaces})\\.'\\s*\\+`, 'g'))) {
      for (const key of Object.keys(I.DICT.fr).filter((k) => k.startsWith(match[1] + '.'))) used.add(key);
    }
  }
  return used;
}

test('I18N-02 chaque clé utilisée dans index.html et js/ existe', () => {
  const used = usedKeys();
  assert.ok(used.has('add.node') && used.has('trace.passed') && used.has('trigger.update'), 'la recherche des clés doit trouver les clés connues');
  assert.deepStrictEqual([...used].filter((key) => !(key in I.DICT.fr)), []);
});

test('I18N-06 aucune clé inutilisée (pas de texte mort)', () => {
  const used = usedKeys();
  assert.deepStrictEqual(Object.keys(I.DICT.fr).filter((key) => !used.has(key)), []);
});

test('I18N-03 pluriels : 0 et 1 au singulier en français, seul 1 en anglais', () => {
  const fr = (n) => I.translate('log.dryRun', { row: 1, status: 'x', n }, 'fr');
  const en = (n) => I.translate('log.dryRun', { row: 1, status: 'x', n }, 'en');
  assert.match(fr(0), /0 écriture prévue$/);
  assert.match(fr(1), /1 écriture prévue$/);
  assert.match(fr(2), /2 écritures prévues$/);
  assert.match(en(0), /0 planned writes$/);
  assert.match(en(1), /1 planned write$/);
});

test('I18N-04 langue au premier lancement', () => {
  assert.strictEqual(I.initialLang('en', ['fr-FR']), 'en');
  assert.strictEqual(I.initialLang(null, ['de-DE', 'en-GB', 'fr']), 'en');
  assert.strictEqual(I.initialLang(null, ['fr-CA']), 'fr');
  assert.strictEqual(I.initialLang(null, ['de-DE']), 'en');
  assert.strictEqual(I.initialLang(null, []), 'fr');
});

test('I18N-05 vocabulaire français : pas de « template », de pluriel entre parenthèses ni de vide écrit « -- »', () => {
  for (const [key, text] of Object.entries(I.DICT.fr)) {
    assert.doesNotMatch(text, /template|\(s\)|\w\(e?s\)|^-- /i, key);
  }
});
