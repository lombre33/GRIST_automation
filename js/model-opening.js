// L'ouverture d'un modèle de départ (consigne 021 ; contrats de GFS 5.4, point 13 : « Nouveau > Depuis un modèle »). GFS ouvre l'app avec `{ fichier: null, type, dossier, raison: 'modele', modele: { id } }` :
// au démarrage de l'app (l'ouverture que porte son contexte) ou, l'app étant déjà ouverte, par l'appel `ouvrir`. L'app montre alors un modèle NON enregistré, fait d'après le catalogue (js/models.js) :
// GFS n'écrit rien dans le document et l'app non plus avant un geste de la personne (son premier changement enregistre le graphe, comme pour tout graphe).
// Jamais un éditeur vide à la place d'un modèle : un `id` que l'app ne connaît pas, un autre type, un document en lecture seule ou un workflow que cette version ne sait pas lire rendent `{ ouvert: false }`
// (le kit répond `false` à tout ce qui n'est pas vrai), avec une fenêtre qui dit pourquoi, car GFS n'ajoute rien. Une table qui porte déjà un workflow : l'app demande avant de le remplacer (choix du porteur de GFS,
// 18/11, « L'app demande »), et rend `{ ouvert: false }` si la personne refuse : rien n'est ouvert ni écrit.
// Logique pure, sans DOM ni Grist : les choses de la page lui sont données (deps), comme à js/closing.js. js/gfs.js la branche sur GfsLink.onOpen et sur l'ouverture du contexte (kit 0.24.0).
//   deps.ready()            : une promesse résolue quand le démarrage est fini (le document est lu, la question de la table posée) : avant, on ne sait pas encore ce que l'éditeur montre
//   deps.status()           : { readOnly, locked, hasWork, active } : ce que l'éditeur montre à l'instant ; hasWork : un workflow que le modèle remplacerait (enregistré ou non, mais pas un modèle encore intact) ; active : il s'exécute
//   deps.ask(model, active) : la question « Remplacer ? » : vrai si la personne remplace (Annuler et Échap valent faux)
//   deps.show(model)        : charge le graphe du modèle dans l'éditeur, sans rien écrire (rend une promesse quand il lui faut d'abord finir une écriture)
//   deps.say(reason)        : dit à la personne pourquoi rien n'est ouvert : 'unknown', 'locked' ou 'readOnly'
(function (root) {
  'use strict';

  const Models = typeof module !== 'undefined' && module.exports ? require('./models.js') : root.Models;

  // `modeles.type.valeur` du manifeste de GFS (contrats 2.2) : le type que GFS donne à nos entrées en lisant le catalogue, et qu'il rend dans l'ouverture.
  const TYPE = 'automatisme';
  const REASON = 'modele';

  // Ce que l'ouverture demande : null quand ce n'est pas un modèle de départ (l'app n'a rien à y faire), sinon { id, model }, où `model` est null pour un identifiant inconnu ou un autre type.
  function read(opening) {
    if (!opening || typeof opening !== 'object' || opening.raison !== REASON) return null;
    const id = opening.modele && typeof opening.modele === 'object' ? opening.modele.id : undefined;
    return { id, model: opening.type === TYPE ? Models.find(id) : null };
  }

  // Rend `open(opening)` : vrai quand le modèle est ouvert, faux sinon (rien d'ouvert, rien d'écrit). Une ouverture à la fois : une deuxième attend la fin de la question de la première.
  function create(deps) {
    async function openNow(opening) {
      const asked = read(opening);
      if (!asked) return false;
      await deps.ready();
      if (!asked.model) {
        deps.say('unknown');
        return false;
      }
      const status = deps.status();
      if (status.locked || status.readOnly) {
        deps.say(status.locked ? 'locked' : 'readOnly');
        return false;
      }
      if (status.hasWork && (await deps.ask(asked.model, status.active)) !== true) return false;
      await deps.show(asked.model);
      return true;
    }

    let tail = Promise.resolve();
    const ignore = () => {};
    return {
      open(opening) {
        const run = tail.then(() => openNow(opening));
        tail = run.then(ignore, ignore);
        return run;
      },
    };
  }

  // Ce que la page installe (js/main.js) quand elle sait répondre. Sans lui (la page n'a pas démarré sa couche Grist : accès complet pas encore accordé, ou hors de Grist), rien n'est ouvert : `{ ouvert: false }`.
  let handlers = null;
  const api = {
    TYPE,
    read,
    create,
    install(installed) { handlers = installed; },
    answer: async (opening) => (handlers ? (await handlers.open(opening)) === true : false),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ModelOpening = api;
})(typeof window !== 'undefined' ? window : globalThis);
