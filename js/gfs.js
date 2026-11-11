// Le lien avec GFS (consignes 003 et 006 ; guide des apps 1.2, points 1, 4 et 9, et règle 15). Le kit commun des apps Grist Factory, référencé en sous-module (kit/, commit 28e2b76, version 0.13.0),
// porte tout le dialogue ; ce module n'en prend que trois choses :
//  - la barre de GFS, que l'app laisse libre (js/keep-clear.js) : { bord, epaisseur, zone } en pixels du cadre, ou null ;
//  - l'ambiance que la personne a choisie dans GFS pour GFS et pour toutes ses apps, posée par le kit sur <html> (les jetons de la charte et de forme que lisent les feuilles de css/) ;
//  - l'appel `fermer` (consigne 010) : GFS ne détruit le cadre de l'app qu'après son oui ; js/closing.js enregistre ce qui attend, laisse finir ce qui s'écrit, et ne pose sa question que si l'écriture échoue.
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
