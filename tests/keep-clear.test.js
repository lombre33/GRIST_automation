'use strict';
// BAR : la barre de GFS (consigne 003) — la géométrie qui écarte l'app de la zone qu'elle recouvre. Le reste (le DOM) est joué dans le navigateur, E2E-36 à 41.
const test = require('node:test');
const assert = require('node:assert');
const KeepClear = require('../js/keep-clear.js');

// La barre mesurée par GFS à 700 × 400 (consigne 003) : 124 × 34 à 4 px du bord et centrée, la zone en ajoute 4 autour.
const FRAME = { largeur: 700, hauteur: 400 };
const BARS = {
  haut: { bord: 'haut', epaisseur: 42, zone: { x: 284, y: 0, largeur: 132, hauteur: 42 } },
  bas: { bord: 'bas', epaisseur: 42, zone: { x: 284, y: 358, largeur: 132, hauteur: 42 } },
  gauche: { bord: 'gauche', epaisseur: 42, zone: { x: 0, y: 134, largeur: 42, hauteur: 132 } },
  droite: { bord: 'droite', epaisseur: 42, zone: { x: 658, y: 134, largeur: 42, hauteur: 132 } },
};
const rect = (x, y, largeur, hauteur) => ({ x, y, largeur, hauteur });

test('BAR-01 deux rectangles qui se touchent seulement par un bord ne se recouvrent pas', () => {
  assert.strictEqual(KeepClear.overlaps(rect(0, 0, 10, 10), rect(10, 0, 10, 10)), false);
  assert.strictEqual(KeepClear.overlaps(rect(0, 0, 10, 10), rect(0, 10, 10, 10)), false);
  assert.strictEqual(KeepClear.overlaps(rect(0, 0, 10, 10), rect(9, 9, 10, 10)), true);
  assert.strictEqual(KeepClear.overlaps(rect(0, 0, 100, 100), rect(40, 40, 5, 5)), true, 'l\'un dans l\'autre');
});

test('BAR-02 ce qui ne touche pas la zone ne bouge pas', () => {
  for (const bar of Object.values(BARS)) assert.deepStrictEqual(KeepClear.escape(rect(100, 100, 50, 50), bar), { dx: 0, dy: 0 }, bar.bord);
});

test('BAR-03 le journal (en bas à droite) quitte la zone d\'une barre en bas, vers le haut, du juste nécessaire', () => {
  const logs = rect(330, 330, 360, 60);   // posé à partir de x 330, comme le mesure la consigne 003
  const { dx, dy } = KeepClear.escape(logs, BARS.bas);
  assert.deepStrictEqual({ dx, dy }, { dx: 0, dy: -32 });
  assert.strictEqual(logs.y + logs.hauteur + dy, BARS.bas.zone.y, 'son bas touche le haut de la zone');
});

test('BAR-04 un menu sous une barre en haut descend, à gauche ou à droite il s\'éloigne du bord', () => {
  assert.deepStrictEqual(KeepClear.escape(rect(300, 10, 190, 200), BARS.haut), { dx: 0, dy: 32 });
  assert.deepStrictEqual(KeepClear.escape(rect(30, 150, 100, 50), BARS.gauche), { dx: 12, dy: 0 });
  assert.deepStrictEqual(KeepClear.escape(rect(600, 200, 80, 40), BARS.droite), { dx: -22, dy: 0 });
});

test('BAR-05 après le déplacement, plus rien ne recouvre la zone, aux quatre bords', () => {
  for (const bar of Object.values(BARS)) {
    for (let x = 0; x < 700; x += 37) {
      for (let y = 0; y < 400; y += 29) {
        const box = rect(x, y, 120, 70);
        const { dx, dy } = KeepClear.escape(box, bar);
        assert.strictEqual(KeepClear.overlaps(rect(x + dx, y + dy, 120, 70), bar.zone), false, `${bar.bord} ${x},${y}`);
        if (!KeepClear.overlaps(box, bar.zone)) assert.deepStrictEqual({ dx, dy }, { dx: 0, dy: 0 });
      }
    }
  }
});

test('BAR-06 la marge laissée à une fenêtre est la profondeur de la zone, mesurée depuis le bord du cadre', () => {
  for (const bar of Object.values(BARS)) assert.strictEqual(KeepClear.inset(bar, FRAME), 42, bar.bord);
  assert.strictEqual(KeepClear.inset({ bord: 'bas', zone: rect(500, 700, 132, 42) }, { largeur: 1200, hauteur: 800 }), 100, 'un cadre plus haut');
});

test('BAR-07 les marges d\'un graphe qu\'on cadre dans le canevas : la profondeur de la zone du côté de la barre, rien ailleurs, rien sans barre ni quand la zone ne touche pas le canevas', () => {
  const none = { left: 0, top: 0, right: 0, bottom: 0 };
  const canvas = rect(0, 46, 700, 354);   // le canevas à 700 × 400, sous une barre d'outils de 46 px
  assert.deepStrictEqual(KeepClear.margins(BARS.gauche, canvas), { ...none, left: 42 });
  assert.deepStrictEqual(KeepClear.margins(BARS.droite, canvas), { ...none, right: 42 });
  assert.deepStrictEqual(KeepClear.margins(BARS.bas, canvas), { ...none, bottom: 42 });
  assert.deepStrictEqual(KeepClear.margins(BARS.haut, canvas), none, 'la zone d\'une barre en haut est au-dessus du canevas : rien à laisser');
  assert.deepStrictEqual(KeepClear.margins(BARS.haut, rect(0, 0, 700, 400)), { ...none, top: 42 }, 'un canevas qui commence au bord du cadre la recouvre');
  assert.deepStrictEqual(KeepClear.margins(null, canvas), none, 'sans barre (app seule, explorateur de GFS ouvert)');
  assert.deepStrictEqual(KeepClear.margins({ bord: 'gauche' }, canvas), none, 'sans zone : rien à laisser');
  assert.deepStrictEqual(KeepClear.margins(BARS.gauche, rect(0, 300, 700, 100)), none, 'une zone que le canevas ne touche pas');
  assert.deepStrictEqual(KeepClear.margins(BARS.gauche, rect(10, 46, 680, 354)), { ...none, left: 32 }, 'mesurée depuis le bord du canevas, pas depuis celui du cadre');
  assert.deepStrictEqual(KeepClear.margins(BARS.gauche, rect(60, 46, 640, 354)), none, 'un canevas qui commence après la zone');
});
