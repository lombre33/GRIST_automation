// Réponse à l'appel `fermer` de GFS (consigne 010 ; contrats de GFS 5.4, point 3). Quand la personne ouvre une autre app ou le fichier d'une autre app, GFS demande à l'app active si elle peut
// partir et ne détruit son cadre qu'après un oui : l'app enregistre d'abord ce qui attend, laisse finir ce qui s'écrit, et ne pose sa question que si elle ne peut pas décider seule.
// Logique pure, sans DOM ni Grist : les choses de la page lui sont données (deps), comme à js/executor.js. js/gfs.js la branche sur GfsLink.onClose du kit (le kit pose l'enveloppe et l'id de la réponse).
//   deps.flush()   : enregistre tout de suite ce qui attend et rend quand l'écriture est finie (une promesse)
//   deps.unsaved() : des modifications du graphe ne sont pas écrites (l'écriture a échoué, ou n'est pas encore faite)
//   deps.busy()    : une promesse de ce qui est en cours (exécutions et écritures dans le document), ou null quand rien ne l'est
//   deps.ask()     : la question « Enregistrer, Abandonner, Annuler » : 'save', 'discard' ou 'cancel' (Échap vaut 'cancel')
//   deps.release() : libère le verrou d'exécution et arrête son battement, pour que l'onglet qui attend reprenne tout de suite
//   deps.wait(ms)  : une promesse qui se résout après ms millisecondes
(function (root) {
  'use strict';

  const ROUNDS = 10;        // tours d'attente au plus : si les écritures ne s'arrêtent pas, GFS propose lui-même « Fermer quand même » après 10 secondes
  const RELEASE_MS = 3000;  // le verrou se libère au mieux : il expire de lui-même (js/executor.js), il ne doit pas retenir l'app

  // Les promesses en cours, que `fermer` attend : les écritures dans le document et les exécutions des workflows.
  function tracker() {
    const running = new Set();
    function track(promise) {
      running.add(promise);
      const done = () => running.delete(promise);
      promise.then(done, done);
      return promise;
    }
    return {
      track,
      // Une fonction dont chaque appel est suivi jusqu'à sa fin (le rappel de grist.onRecords, qui lit puis écrit).
      wrap: (fn) => (...args) => track(Promise.resolve(fn(...args))),
      idle: () => (running.size ? Promise.allSettled([...running]) : null),
    };
  }

  // Rend la réponse à `fermer` : vrai quand l'app peut partir (tout est écrit, ou la personne a abandonné), faux quand elle reste.
  function create(deps) {
    // Enregistre ce qui attend puis laisse finir ce qui est en cours, jusqu'à ce que plus rien ne soit en route.
    async function settle() {
      for (let round = 0; round < ROUNDS; round += 1) {
        await deps.flush();
        const busy = deps.busy();
        if (!busy) return;
        await busy;
      }
    }

    return async function close() {
      for (;;) {
        await settle();
        if (!deps.unsaved()) break;
        const answer = await deps.ask();
        if (answer === 'discard') break;
        if (answer !== 'save') return false;
      }
      await Promise.race([Promise.resolve(deps.release()).catch(() => {}), deps.wait(RELEASE_MS)]);
      return true;
    };
  }

  // Le gestionnaire que la page installe (js/main.js) quand elle sait répondre ; sans lui (la page n'a pas démarré, l'accès complet n'est pas accordé), rien n'attend : l'app peut partir.
  let handler = null;
  const api = {
    tracker,
    create,
    install(fn) { handler = fn; },
    answer: async (request) => (handler ? (await handler(request)) === true : true),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Closing = api;
})(typeof window !== 'undefined' ? window : globalThis);
