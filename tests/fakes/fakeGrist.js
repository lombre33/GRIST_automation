// Simulateur minimal de la couche d'écriture Grist pour les tests.
'use strict';

function createFakeApi(opts) {
  const options = opts || {};
  const applied = [];
  return {
    applied,
    async applyUserActions(actions) {
      if (options.failWith) throw new Error(options.failWith);
      applied.push(...actions);
    },
  };
}

module.exports = { createFakeApi };
