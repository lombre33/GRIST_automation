// Exécuteur unique : quand le même document est ouvert dans plusieurs onglets (ou chez plusieurs personnes), un seul exécute les workflows.
// Élection par un verrou dans la table Automation (ligne Type = Lock) renouvelé toutes les quelques secondes.
// Un onglet qui voit le verrou d'un autre change de date reste en veille ; si la date ne change plus pendant `ttl` secondes (onglet fermé ou planté),
// il prend le relais. On compare des dates vues par soi-même, pas l'horloge des autres : un décalage d'horloge entre navigateurs ne gêne pas.
// Limite : les modifications faites pendant le relais (au plus `ttl` secondes) ne sont exécutées par personne.
(function (root) {
  'use strict';
  const Store = typeof module !== 'undefined' && module.exports ? require('./store.js') : root.Store;

  function create(api, tableId, owner, options) {
    const opts = Object.assign({ ttl: 20, settle: 1000, now: Date.now, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), onChange: () => {} }, options);
    let executor = false;
    let holder = '';
    let lastSeen = null;   // { owner, date, at } : dernier verrou étranger vu, et quand (heure locale)

    function settle(value, who) {
      const changed = value !== executor || who !== holder;
      executor = value;
      holder = who;
      if (changed) opts.onChange(executor, holder);
      return executor;
    }

    function observe(lock) {
      lastSeen = { owner: lock.owner, date: lock.date, at: opts.now() };
    }

    // À appeler régulièrement tant qu'une automation est active : prend, renouvelle ou cède le verrou. Retourne true si cet onglet exécute.
    async function tick() {
      const lock = await Store.readLock(api, tableId);
      const foreign = lock && lock.owner && lock.owner !== owner;
      if (foreign) {
        if (!lastSeen || lastSeen.owner !== lock.owner || lastSeen.date !== lock.date) {
          observe(lock);
          return settle(false, lock.owner);
        }
        if (opts.now() - lastSeen.at < opts.ttl * 1000) return settle(false, lock.owner);
      }
      const mine = lock && lock.owner === owner;
      await Store.writeLock(api, tableId, owner, Math.floor(opts.now() / 1000), lock && lock.id);
      if (!mine) {
        // Prise de verrou : on laisse passer les écritures concurrentes, puis la ligne la plus ancienne départage.
        await opts.sleep(opts.settle);
        const again = await Store.readLock(api, tableId);
        if (again && again.owner !== owner) {
          observe(again);
          return settle(false, again.owner);
        }
      }
      lastSeen = null;
      return settle(true, owner);
    }

    // Fermeture ou désactivation : libère le verrou pour que l'autre onglet reprenne tout de suite.
    async function release() {
      if (!executor) return;
      const lock = await Store.readLock(api, tableId);
      if (lock && lock.owner === owner) await Store.writeLock(api, tableId, '', Math.floor(opts.now() / 1000), lock.id);
      settle(false, '');
    }

    return { tick, release, isExecutor: () => executor, holder: () => holder };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Executor = api;
})(typeof window !== 'undefined' ? window : globalThis);
