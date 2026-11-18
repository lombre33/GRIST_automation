// Le lien avec GFS (consignes 003 et 006 ; guide des apps 1.2, points 1, 4 et 9, et règle 15). Le kit commun des apps Grist Factory, référencé en sous-module (kit/, commit 7aa030c, version 0.24.0),
// porte tout le dialogue ; ce module n'en prend que cinq choses :
//  - la barre de GFS, que l'app laisse libre (js/keep-clear.js) : { bord, epaisseur, zone } en pixels du cadre, ou null ;
//  - l'ambiance que la personne a choisie dans GFS pour GFS et pour toutes ses apps, posée par le kit sur <html> (les jetons de la charte et de forme que lisent les feuilles de css/) ;
//  - l'appel `fermer` (consigne 010) : GFS ne détruit le cadre de l'app qu'après son oui ; js/closing.js enregistre ce qui attend, laisse finir ce qui s'écrit, et ne pose sa question que si l'écriture échoue ;
//  - l'appel `rester` (consigne 016) : après ce oui, la personne est revenue avant la destruction du cadre ; js/closing.js reprend ce que `fermer` avait arrêté (le battement, le verrou, les lignes reçues) ;
//  - l'ouverture d'un modèle de départ (consigne 021, « Nouveau > Depuis un modèle ») : au démarrage, celle que porte le contexte (`raison: 'modele'`, `modele: { id }`, gardé par le kit depuis la 0.24.0) ; l'app déjà ouverte, l'appel `ouvrir` ;
//    js/model-opening.js ne montre qu'un modèle de son catalogue (js/models.js), non enregistré, et rend faux pour tout le reste : le kit répond alors `{ ouvert: false }`, jamais un éditeur vide à la place.
// Seule, l'app n'a ni barre ni ambiance ni appel : le kit ne dit rien et ne pose rien. Module à part, chargé en plus des scripts de l'app : si le kit manque (une copie du dépôt sans ses sous-modules),
// ce module échoue seul, l'attente de js/theme.js se lève d'elle-même et l'app s'ouvre avec ses couleurs.
// Le mode (clair ou sombre) est celui de js/theme.js, qui pose data-theme sur <html> et garde son propre choix (ab_theme) : on donne donc son `isDark` à la pose de l'ambiance, au lieu du `Theme` du kit.
import { GfsLink } from '../kit/js/gfs-link.js';
import { createAmbiance } from '../kit/js/ambiance-pose.js';

const root = document.documentElement;

const ambiance = createAmbiance({ link: GfsLink, isDark: () => root.dataset.theme === 'dark' }).start();
if (window.KeepClear) {
  GfsLink.onBar((bar) => window.KeepClear.set(bar));   // rappelé aussi à l'arrivée du contexte
  window.KeepClear.set(GfsLink.bar());
}
ambiance.ready.then(() => { delete root.dataset.gfsPending; });
// Le kit pose l'enveloppe et l'id de la réponse : seul « vrai » ferme, une erreur part chez GFS, qui demande à la personne. Sans js/closing.js, rien n'attend.
GfsLink.onClose((request) => (window.Closing ? window.Closing.answer(request) : true));
// Vrai quand l'app a repris (`{ repris: true }`), faux sinon ; sans js/closing.js, elle n'a rien arrêté ni rien à reprendre.
GfsLink.onStay((request) => (window.Closing ? window.Closing.answerStay(request) : false));
// Vrai quand le modèle est ouvert ; faux sinon (identifiant inconnu, autre type, lecture seule, workflow illisible, ou la personne qui garde le workflow de la table). Sans js/model-opening.js, rien n'est ouvert.
GfsLink.onOpen((opening) => (window.ModelOpening ? window.ModelOpening.answer(opening) : false));
// Au démarrage, l'ouverture est celle du contexte, rendue une seule fois : le kit la garde dès que le contexte est arrivé (`ready`). Il n'y a personne à qui répondre ; une erreur se dit dans la console.
GfsLink.ready.then(() => (window.ModelOpening ? window.ModelOpening.answer(GfsLink.opening()) : false)).catch((error) => console.warn('[Automation+] modèle de départ : ouverture en échec', error));
