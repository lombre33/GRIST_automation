'use strict';
// TUTO : la prise en main (js/tutorial.js), ce qui se vérifie sans navigateur ; la fenêtre elle-même est éprouvée de bout en bout (E2E-51 à 57).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Tutorial = require('../js/tutorial.js');
const I = require('../js/i18n.js');

const root = path.join(__dirname, '..');

// Largeur et hauteur d'une image WebP, lues dans son en-tête (avec perte : VP8, sans perte : VP8L, étendu : VP8X).
function webpSize(file) {
  const data = fs.readFileSync(file);
  assert.strictEqual(data.toString('ascii', 0, 4), 'RIFF', file);
  assert.strictEqual(data.toString('ascii', 8, 12), 'WEBP', file);
  const chunk = data.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = data.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { width: data.readUIntLE(24, 3) + 1, height: data.readUIntLE(27, 3) + 1 };
  throw new Error(`${file} : en-tête WebP inconnu (${chunk})`);
}

test('TUTO-01 la version gardée : rien, un texte qui n\'est pas une version, ou une plus ancienne la rouvre ; la même ou une plus récente, non', () => {
  assert.strictEqual(Tutorial.STORAGE_KEY, 'ab_tuto');
  assert.ok(Number.isInteger(Tutorial.VERSION) && Tutorial.VERSION >= 1);
  for (const saved of [null, undefined, '', 'vu', '1.5', '-1', '0', 'true']) assert.strictEqual(Tutorial.isUnseen(saved, 1), true, String(saved));
  for (const saved of ['1', '2', '12']) assert.strictEqual(Tutorial.isUnseen(saved, 1), false, saved);
  assert.strictEqual(Tutorial.isUnseen('1', 2), true, 'une prise en main qui a changé se remontre une fois');
  assert.strictEqual(Tutorial.isUnseen(String(Tutorial.VERSION)), false);
});

test('TUTO-02 chaque écran a sa capture en français et en anglais, en WebP de 1200 × 400 (3:1), et ses textes dans les deux langues', () => {
  assert.strictEqual(Tutorial.SCREENS.length, 6);
  const images = new Set();
  for (const screen of Tutorial.SCREENS) {
    assert.match(screen.image, /^[a-z]+$/);
    images.add(screen.image);
    for (const lang of ['fr', 'en']) {
      const file = path.join(root, 'img/tuto', `${screen.image}-${lang}.webp`);
      assert.ok(fs.existsSync(file), file);
      assert.deepStrictEqual(webpSize(file), { width: 1200, height: 400 }, file);
      assert.ok(fs.statSync(file).size < 80 * 1024, `${file} : léger (moins de 80 Ko)`);
      for (const key of [screen.name, screen.text, screen.alt]) assert.ok(I.DICT[lang][key], `${lang} ${key}`);
    }
  }
  assert.strictEqual(images.size, Tutorial.SCREENS.length, 'une capture par écran');
  const files = fs.readdirSync(path.join(root, 'img/tuto')).sort();
  assert.deepStrictEqual(files, [...images].flatMap((image) => [`${image}-en.webp`, `${image}-fr.webp`]).sort(), 'aucune capture en trop');
});

// La fenêtre tient dans 700 × 400 parce que le texte d'un écran tient en deux lignes (mesuré de bout en bout, E2E-51 et 57) : ce plafond prévient avant le navigateur.
test('TUTO-03 des textes courts : un titre d\'une ligne, un texte de deux lignes au plus', () => {
  for (const lang of ['fr', 'en']) {
    for (const screen of Tutorial.SCREENS) {
      assert.ok(I.DICT[lang][screen.name].length <= 45, `${lang} ${screen.name}`);
      assert.ok(I.DICT[lang][screen.text].length <= 175, `${lang} ${screen.text} : ${I.DICT[lang][screen.text].length} caractères`);
      assert.doesNotMatch(I.DICT[lang][screen.text], /\.\.\./, 'les points de suspension sont un seul signe');
    }
  }
});
