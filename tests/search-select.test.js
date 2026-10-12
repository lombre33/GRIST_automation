'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { matches } = require('../js/search-select.js');

test('SRCH-01 les mots viennent dans n\'importe quel ordre, sans tenir compte de la ponctuation', () => {
  for (const input of ['porteur 3', 'Porteur3', '3 porteur', 'PORTEUR-3', 'projets porteur_3']) {
    assert.ok(matches(input, 'Projets.Porteur_3'), input);
  }
});

test('SRCH-02 « Porteur_3 » tapé en entier ne retrouve pas Porteur_13', () => {
  assert.ok(!matches('Porteur_3', 'Projets.Porteur_13'));
  assert.ok(matches('porteur 3', 'Projets.Porteur_13'));
});

test('SRCH-03 accents et casse ne comptent pas', () => {
  assert.ok(matches('ete', 'Été'));
  assert.ok(matches('ÉTÉ', 'ete'));
});

test('SRCH-04 une saisie sans lettre ni chiffre ne filtre rien', () => {
  assert.ok(matches('  ', 'x'));
  assert.ok(matches('._-', 'x'));
});
