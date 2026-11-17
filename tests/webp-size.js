'use strict';
// Largeur et hauteur d'une image WebP, lues dans son en-tête (avec perte : VP8, sans perte : VP8L, étendu : VP8X). Partagé par les essais des captures (tutorial.test.js, vitrine.test.js).
const assert = require('node:assert');
const fs = require('node:fs');

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

module.exports = { webpSize };
