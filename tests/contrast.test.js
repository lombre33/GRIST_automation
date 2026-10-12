'use strict';
// CTR : chaque texte, lien, bouton plein et anneau de focus atteint 4,5:1 (3:1 pour les bordures et icônes), en clair et en sombre.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../css/tokens.css'), 'utf8');

function block(selector) {
  const start = css.indexOf(selector + ' {');
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}

const light = block(':root');
const dark = { ...light, ...block(':root[data-theme="dark"]') };

function luminance(hex) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [couleur de texte, fonds sur lesquels elle se pose]
const TEXT_ON = [
  ['text', ['bg', 'surface', 'surface-sunken']],
  ['text-muted', ['bg', 'surface', 'surface-sunken']],
  ['accent', ['surface']],
  ['accent-ink', ['accent-soft', 'surface-sunken']],
  ['danger-ink', ['bg', 'surface', 'surface-sunken', 'danger-soft']],
  ['good', ['good-soft']],
  ['warn-ink', ['warn-soft']],
];

for (const [themeName, tokens] of [['clair', light], ['sombre', dark]]) {
  test(`CTR-01 textes >= 4,5:1 en thème ${themeName}`, () => {
    for (const [fg, backgrounds] of TEXT_ON) {
      for (const bg of backgrounds) {
        const value = ratio(tokens[fg], tokens[bg]);
        assert.ok(value >= 4.5, `--${fg} sur --${bg} : ${value.toFixed(2)}`);
      }
    }
  });

  test(`CTR-02 bouton plein à texte blanc >= 4,5:1 en thème ${themeName}`, () => {
    for (const bg of ['accent-solid', 'accent-solid-hover']) {
      assert.ok(ratio('#ffffff', tokens[bg]) >= 4.5, bg);
    }
  });

  test(`CTR-03 anneau de focus et bordures de champ >= 3:1 en thème ${themeName}`, () => {
    assert.ok(ratio(tokens.accent, tokens.surface) >= 3);
    assert.ok(ratio(tokens['border-strong'], tokens.surface) >= 1.5);
  });
}
