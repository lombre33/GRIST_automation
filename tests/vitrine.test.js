'use strict';
// VITRINE : ce que GFS affiche pour l'app sur sa carte et sa fiche (consigne 018) : une description et trois captures, rangées dans vitrine/.
// GFS les lit et les copie chez lui ; l'app, elle, ne les charge jamais. Ces essais gardent les limites que GFS fixe (contrats, guide des apps 1.2) ;
// que les captures montrent bien l'app d'aujourd'hui se juge à l'œil : à refaire quand l'interface change (voir README).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { webpSize } = require('./webp-size.js');

const dir = path.join(__dirname, '..', 'vitrine');
const vitrine = JSON.parse(fs.readFileSync(path.join(dir, 'vitrine.json'), 'utf8'));
const LANGS = ['fr', 'en'];
const DESCRIPTION_MAX = 280;
const LEGEND_MAX = 60;
const IMAGE_MAX = 60 * 1024;
const length = (text) => [...text].length;
const texts = [
  { name: 'la description', text: vitrine.description, max: DESCRIPTION_MAX },
  ...vitrine.captures.map((capture) => ({ name: `la légende de ${capture.fichier}`, text: capture.legende, max: LEGEND_MAX })),
];

test('VITRINE-01 le dossier ne tient que vitrine.json et trois captures numérotées, citées dans l\'ordre', () => {
  assert.deepStrictEqual(Object.keys(vitrine).sort(), ['captures', 'description']);
  assert.deepStrictEqual(vitrine.captures.map((capture) => capture.fichier), ['1.webp', '2.webp', '3.webp']);
  for (const capture of vitrine.captures) assert.deepStrictEqual(Object.keys(capture).sort(), ['fichier', 'legende'], capture.fichier);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['1.webp', '2.webp', '3.webp', 'vitrine.json'], 'aucun fichier en trop, aucune capture oubliée');
});

test('VITRINE-02 la description et chaque légende : en français et en anglais, d\'une ligne, dans les longueurs de GFS (280 et 60 caractères)', () => {
  for (const { name, text, max } of texts) {
    assert.deepStrictEqual(Object.keys(text).sort(), [...LANGS].sort(), name);
    for (const lang of LANGS) {
      const value = text[lang];
      assert.strictEqual(typeof value, 'string', `${name} (${lang})`);
      assert.ok(value.length > 0 && value === value.trim() && !/\s{2}|[\r\n\t]/.test(value), `${name} (${lang}) : un texte net, d'une ligne`);
      assert.ok(length(value) <= max, `${name} (${lang}) : ${length(value)} caractères, ${max} au plus`);
    }
  }
  for (const lang of LANGS) assert.ok(length(vitrine.description[lang]) >= 100, `la description (${lang}) dit ce que fait l'app, en une à trois phrases`);
});

// Règle 13 du guide de GFS (1.1) : ne jamais écrire qu'activer ou cocher quelque chose rend l'app plus sûre. La vitrine dit ce que la personne fait, pas ce qu'elle garantit.
test('VITRINE-03 aucune promesse de sécurité ni de garantie dans la description ni dans les légendes', () => {
  const promise = /s[ée]curi|sûr|protég|protect|garanti|guarantee|sans risque|risk|safe|fiable|reliab|trust|confiance/i;
  for (const { name, text } of texts) for (const lang of LANGS) assert.doesNotMatch(text[lang], promise, `${name} (${lang})`);
});

test('VITRINE-04 chaque capture : WebP de 960 × 600 (16:10) et de 60 Ko au plus', () => {
  for (const capture of vitrine.captures) {
    const file = path.join(dir, capture.fichier);
    assert.deepStrictEqual(webpSize(file), { width: 960, height: 600 }, capture.fichier);
    assert.ok(fs.statSync(file).size <= IMAGE_MAX, `${capture.fichier} : ${fs.statSync(file).size} octets, ${IMAGE_MAX} au plus`);
  }
});
