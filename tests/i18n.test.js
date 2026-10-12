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

test('I18N-02 chaque clé utilisée dans index.html et js/ existe', () => {
  const used = new Set();
  for (const match of read('index.html').matchAll(/data-i18n(?:-placeholder|-label)?="([^"]+)"/g)) used.add(match[1]);
  const namespaces = [...new Set(Object.keys(I.DICT.fr).map((key) => key.split('.')[0]))].join('|');
  for (const match of read('js/main.js').matchAll(new RegExp(`'((?:${namespaces})\\.\\w+)'`, 'g'))) used.add(match[1]);
  for (const match of read('js/main.js').matchAll(/t\('(result|event|theme)\.' \+/g)) {
    for (const key of Object.keys(I.DICT.fr).filter((k) => k.startsWith(match[1] + '.'))) used.add(key);
  }
  assert.ok(used.has('log.saved') && used.has('wf.save'), 'la recherche des clés doit trouver les clés connues');
  const missing = [...used].filter((key) => !(key in I.DICT.fr));
  assert.deepStrictEqual(missing, []);
});

test('I18N-03 pluriels : 0 et 1 au singulier en français, seul 1 en anglais', () => {
  const fr = (n) => I.translate('log.dryRun', { row: 1, status: 'x', n }, 'fr');
  const en = (n) => I.translate('log.dryRun', { row: 1, status: 'x', n }, 'en');
  assert.match(fr(0), /0 effet$/);
  assert.match(fr(1), /1 effet$/);
  assert.match(fr(2), /2 effets$/);
  assert.match(en(0), /0 effects$/);
  assert.match(en(1), /1 effect$/);
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
