// Réponses aux appels `fermer` et `rester` de GFS (consignes 010 et 016 ; contrats de GFS 5.4, point 3). Quand la personne ouvre une autre app ou le fichier d'une autre app, GFS demande à l'app active si elle peut
// partir et ne détruit son cadre qu'après un oui : l'app enregistre d'abord ce qui attend, laisse finir ce qui s'écrit, et ne pose sa question que si elle ne peut pas décider seule.
// Si la personne revient avant que le cadre soit détruit, GFS le dit à l'app (`rester`) : elle reprend ce que `fermer` avait arrêté.
// Logique pure, sans DOM ni Grist : les choses de la page lui sont données (deps), comme à js/executor.js. js/gfs.js la branche sur GfsLink.onClose et GfsLink.onStay du kit (le kit pose l'enveloppe et l'id de la réponse).
//   deps.flush()   : enregistre tout de suite ce qui attend et rend quand l'écriture est finie (une promesse)
//   deps.unsaved() : des modifications du graphe ne sont pas écrites (l'écriture a échoué, ou n'est pas encore faite)
//   deps.busy()    : une promesse de ce qui est en cours (exécutions et écritures dans le document), ou null quand rien ne l'est
//   deps.ask()     : la question « Enregistrer, Abandonner, Annuler » : 'save', 'discard' ou 'cancel' (Échap vaut 'cancel')
//   deps.release() : libère le verrou d'exécution et arrête son battement, pour que l'onglet qui attend reprenne tout de suite
//   deps.resume()  : reprend ce que release a arrêté (le battement, puis le verrou par l'élection habituelle) ; vrai quand l'app est de nouveau comme avant `fermer`, faux quand elle n'a pas pu
//   deps.wait(ms)  : une promesse qui se résout après ms millisecondes
(function (root) {
  'use strict';

  const ROUNDS = 10;        // tours d'attente au plus : si les écritures ne s'arrêtent pas, GFS propose lui-même « Fermer quand même » après 10 secondes
  const RELEASE_MS = 3000;  // le verrou se libère au mieux : il expire de lui-même (js/executor.js), il ne doit pas retenir l'app
  const RESUME_MS = 10000;  // la reprise se rend au mieux aussi : une élection que Grist ne finit pas ne retient ni GFS ni la fermeture d'après (le battement continue d'essayer)

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

  // Rend les deux réponses : `close` (vrai quand l'app peut partir : tout est écrit, ou la personne a abandonné ; faux quand elle reste) et `stay` (vrai quand l'app a repris ce que `fermer` avait arrêté).
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

    // Le verrou que la dernière fermeture rend (fini ou non) : la réponse n'attend que RELEASE_MS, mais la reprise attend, elle, que ce verrou soit rendu, pour ne pas le reprendre puis se le faire rendre par la fin de la fermeture.
    let releasing = Promise.resolve();

    async function closeNow() {
      for (;;) {
        await settle();
        if (!deps.unsaved()) break;
        const answer = await deps.ask();
        if (answer === 'discard') break;
        if (answer !== 'save') return false;
      }
      releasing = Promise.resolve(deps.release()).catch(() => {});
      await Promise.race([releasing, deps.wait(RELEASE_MS)]);
      return true;
    }

    // Reprendre est sans danger quand rien n'a été arrêté (un non, ou rien du tout) ou quand c'est déjà fait : le battement n'est jamais doublé et l'élection est celle de tous les battements.
    // Un verrou que Grist ne rend pas ne retient pas la reprise au-delà de RELEASE_MS.
    async function resumeNow() {
      await Promise.race([releasing, deps.wait(RELEASE_MS)]);
      return Promise.race([Promise.resolve(deps.resume()).then((resumed) => resumed === true), deps.wait(RESUME_MS).then(() => false)]);
    }

    // `fermer` et `rester` passent l'un après l'autre, dans l'ordre où GFS les envoie : un `rester` qui arrive pendant que `fermer` finit (la personne a pris « Fermer quand même » puis est revenue) attend la fin de la fermeture,
    // qui rend le verrou, avant de le reprendre ; un `fermer` qui arrive pendant une reprise attend la reprise.
    let tail = Promise.resolve();
    const ignore = () => {};
    function enqueue(job) {
      const run = tail.then(job);
      tail = run.then(ignore, ignore);
      return run;
    }

    // Deux `fermer` à la fois (la personne a redemandé avant la réponse) partagent une seule fermeture, donc une seule question ; de même deux `rester`. Une demande de l'autre sorte arrivée entre les deux les sépare.
    let closing = null;
    let staying = null;
    function close() {
      if (closing) return closing;
      staying = null;
      const run = enqueue(closeNow);
      const done = () => { if (closing === run) closing = null; };
      run.then(done, done);
      closing = run;
      return run;
    }
    function stay() {
      if (staying) return staying;
      closing = null;
      const run = enqueue(resumeNow);
      const done = () => { if (staying === run) staying = null; };
      run.then(done, done);
      staying = run;
      return run;
    }

    return { close, stay };
  }

  // Ce que la page installe (js/main.js) quand elle sait répondre : { close, stay }, tel que `create` le rend. Sans lui (la page n'a pas démarré, l'accès complet n'est pas accordé), rien n'attend :
  // l'app peut partir, et elle n'a rien à reprendre.
  let handlers = null;
  const api = {
    tracker,
    create,
    install(installed) { handlers = installed; },
    answer: async (request) => (handlers ? (await handlers.close(request)) === true : true),
    answerStay: async (request) => (handlers ? (await handlers.stay(request)) === true : false),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Closing = api;
})(typeof window !== 'undefined' ? window : globalThis);
