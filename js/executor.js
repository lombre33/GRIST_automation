// Exécuteur unique : quand le même document est ouvert dans plusieurs onglets (ou chez plusieurs personnes), un seul exécute les workflows.
// Élection par un verrou dans la table Automation (ligne Type = Lock) renouvelé toutes les quelques secondes.
// Un onglet qui voit le verrou d'un autre change de date reste en veille ; si la date ne change plus pendant `ttl` secondes (onglet fermé ou planté),
// il prend le relais. On compare des dates vues par soi-même, pas l'horloge des autres : un décalage d'horloge entre navigateurs ne gêne pas.
// Limite : les modifications faites pendant le relais (au plus `ttl` secondes) ne sont exécutées par personne. Un onglet rechargé n'attend pas ce relais :
// il garde son identifiant (tabIdentity) et reconnaît son propre verrou.
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

  // L'identifiant d'un onglet pour le verrou, le même après un rechargement de la page : l'onglet rechargé reconnaît son verrou et reprend tout de suite,
  // au lieu d'attendre `ttl` secondes un exécutant qui n'existe plus (pendant lesquelles personne n'exécutait). Sans lui, chaque chargement tirait un nouvel identifiant.
  // storage : () => sessionStorage (propre à l'onglet, vidé à sa fermeture) ; key : la clé, une par table de vue ; fresh : () => un identifiant neuf (16 caractères hexadécimaux).
  // L'identifiant gardé est lu puis effacé : un onglet dupliqué, qui reçoit une copie de sessionStorage, n'en hérite pas. keep() le remet en place quand la page
  // se ferme ou se recharge (pagehide) ; forget() l'efface si la page revient du cache de navigation (pageshow) avec son identifiant en mémoire.
  // Un stockage refusé (cadre d'un autre site bloqué par le navigateur) ou un contenu inattendu donnent un identifiant neuf, comme avant.
  function tabIdentity(storage, key, fresh) {
    const safely = (use) => { try { return use(storage()); } catch (err) { return null; } };
    const saved = safely((store) => { const value = store.getItem(key); store.removeItem(key); return value; });
    const id = /^[0-9a-f]{16}$/.test(saved || '') ? saved : fresh();
    return {
      id,
      keep: () => { safely((store) => store.setItem(key, id)); },
      forget: () => { safely((store) => store.removeItem(key)); },
    };
  }

  const api = { create, tabIdentity };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Executor = api;
})(typeof window !== 'undefined' ? window : globalThis);
