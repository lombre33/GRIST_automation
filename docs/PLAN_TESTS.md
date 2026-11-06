# Plan de tests — Widget Grist "Automation Builder"

Document vivant. Chaque test a un identifiant stable (`MODULE-nn`) pour pouvoir lancer soit la batterie complète (grosse feature), soit uniquement un module (micro-changement).

## 1. Principes

- **Logique pure séparée de Grist.** Le moteur (diff, conditions, transformations, actions, garde-fous) vit dans des modules sans accès au DOM ni à `grist.*`, testables sous Node sans navigateur. L'interface et la Plugin API ne sont que de fines couches autour.
- **Zéro dépendance de test** : runner natif `node:test` + `node:assert` (cohérent avec la contrainte d'audit DINUM).
- **Simulateur de Grist** (`tests/fakes/fakeGrist.js`) : implémente `onRecords`, `docApi.fetchTable`, `applyUserActions`, l'email utilisateur, avec injection d'erreurs et de latence. Il permet de tester les scénarios multi-utilisateurs sans vrai Grist.
- **Deux niveaux** : unitaires (Node, rapides, à chaque modification) et intégration (document Grist réel, voir `docs/GRIST_TEST_DOC.md`, avant livraison d'une feature).
- **Règle d'exhaustivité** : toute règle du CDC doit être couverte par au moins un test ; toute anomalie corrigée ajoute un test de non-régression.

## 2. Lancer les tests

| Besoin | Commande (cible) |
|---|---|
| Tout | `npm test` |
| Un module | `npm test -- --test-name-pattern="^DIFF-"` |
| Un test | `npm test -- --test-name-pattern="^DIFF-03"` |
| Intégration | `npm run test:integration` (nécessite le Grist de test) |

## 3. Périmètre des tests unitaires

### DIFF — Détection des événements (création / modification / suppression)
- DIFF-01 première réception des lignes : initialise le cache, aucun événement émis.
- DIFF-02 ligne ajoutée : événement `create`.
- DIFF-03 valeur modifiée : événement `update` avec anciennes et nouvelles valeurs.
- DIFF-04 ligne disparue : événement `delete` avec `rowId` seul (pas de contenu, limite CDC §4.2).
- DIFF-05 plusieurs changements dans un même lot : un événement par ligne, ordre stable.
- DIFF-06 lot identique : aucun événement.
- DIFF-07 ligne masquée par un filtre de vue : ne doit pas produire de `delete` (comparaison avec la table complète).
- DIFF-08 colonne ajoutée ou supprimée dans la table : pas de faux `update` en masse.
- DIFF-09 types variés (nombre, texte, booléen, date, liste, référence, vide) : égalité correcte.
- DIFF-10 volumétrie (10 000 lignes) : temps de diff mesuré, sans régression.

### TRG — Déclencheurs
- TRG-01 action Création / Modification / Suppression : filtrage correct.
- TRG-02 cible « nouvelle ligne » vs « ligne spécifique par clé/valeur ».
- TRG-03 cible spécifique ignorée (et refusée à la validation) pour une Création.
- TRG-04 clé absente ou en doublon : erreur claire.
- TRG-05 plusieurs workflows sur le même événement : tous évalués, dans l'ordre de définition.
- TRG-06 workflow inactif : jamais exécuté.

### COND — Conditions
- COND-01 opérateurs de comparaison (=, ≠, <, >, contient, vide, non vide) sur chaque type.
- COND-02 AND / OR, imbrication, groupes.
- COND-03 lecture cross-table (lookup) : valeur trouvée, absente, multiple.
- COND-04 colonne ou table inexistante : erreur explicite, workflow arrêté.
- COND-05 comparaison de types incompatibles : comportement défini et testé (pas de coercition silencieuse).
- COND-06 absence de `eval` / `Function` : l'évaluation passe par des opérateurs nommés (test de lecture statique du code).

### TRF — Transformations
- TRF-01 concaténation (avec valeurs vides, nombres, dates).
- TRF-02 calcul simple (+ − × ÷), division par zéro, flottants, arrondi.
- TRF-03 formatage (majuscules, trim, dates).
- TRF-04 chaînage de plusieurs transformations.
- TRF-05 entrée manquante : erreur explicite.
- TRF-06 aucune exécution de code arbitraire depuis la configuration.

### ACT — Actions
- ACT-01 AddRecord table courante / autre table.
- ACT-02 UpdateRecord table courante / autre table (ligne ciblée par clé).
- ACT-03 ligne ciblée introuvable : erreur, arrêt.
- ACT-04 colonne cible invalide ou type incompatible : erreur remontée sans écriture partielle.
- ACT-05 plusieurs actions : ordre respecté, arrêt à la première erreur.
- ACT-06 droits Grist insuffisants (refus de l'API) : erreur journalisée, pas de relance en boucle.
- ACT-07 écritures regroupées en un seul `applyUserActions` quand c'est possible.

### GRD — Garde-fous
- GRD-01 les écritures du widget sont marquées et ne retriggent pas leur propre workflow.
- GRD-02 limite de tours en chaîne (seuil configurable) : au-delà, arrêt et log d'erreur.
- GRD-03 boucle A→B→A entre deux workflows détectée.
- GRD-04 erreur d'exécution : le workflow s'arrête, les suivants indépendants continuent.
- GRD-05 indicateur « onglet ouvert requis » présent quand au moins un workflow est actif.

### MUL — Multi-utilisateurs (voir CDC et risque 1)
- MUL-01 deux instances voient le même changement : une seule exécute (mécanisme de verrou ou d'élection à définir).
- MUL-02 l'exécutant se ferme : une autre instance reprend sans doublon ni perte.
- MUL-03 deux événements simultanés sur des lignes différentes.
- MUL-04 verrou périmé (onglet planté) : expiration correcte.
- MUL-05 rejeu après reconnexion : pas d'exécution en double d'un événement déjà traité.

### DRY — Mode test (dry-run)
- DRY-01 aucune écriture réelle (le fake enregistre zéro action).
- DRY-02 le résultat liste chaque node avec son état (passé / bloqué / erreur) et les effets attendus.
- DRY-03 dry-run sur une ligne choisie, avec données réelles lues.
- DRY-04 le dry-run n'est pas compté comme exécution réelle dans l'historique, mais est identifié comme tel.

### STO — Stockage des workflows
- STO-01 sérialisation / désérialisation `JSON` natif, aller-retour sans perte.
- STO-02 champ `version` présent ; migration d'une ancienne version vers la courante.
- STO-03 `resume_humain` généré et cohérent avec la configuration.
- STO-04 JSON corrompu ou inconnu : le workflow est désactivé et signalé, le reste du widget fonctionne.
- STO-05 création automatique des tables `Automation` absente ; réutilisation si présentes.
- STO-06 tables supprimées ou colonnes modifiées à la main : détection et message clair.
- STO-07 modification simultanée du même workflow par deux utilisateurs.

### LOG — Historique et traçabilité
- LOG-01 chaque exécution écrit : horodatage, workflow, événement, résultat, auteur.
- LOG-02 email utilisateur obtenu ; comportement défini s'il est indisponible.
- LOG-03 création / modification / activation d'un workflow tracées.
- LOG-04 les logs n'embarquent pas de données sensibles au-delà de ce qui est nécessaire.
- LOG-05 volume : purge ou pagination à l'affichage.

### VAL — Validation de configuration
- VAL-01 workflow sans trigger, sans action, graphe déconnecté ou avec cycle : refusé avec message.
- VAL-02 référence à une colonne ou table qui n'existe plus.
- VAL-03 champs obligatoires de chaque type de node.

### UI — Interface (logique testable sans navigateur, le reste en manuel)
- UI-01 modèle du graphe : ajout, suppression, connexion, déconnexion de nodes.
- UI-02 export du graphe visuel vers la configuration du moteur, et inversement.
- UI-03 pas de `innerHTML` avec des données utilisateur (échappement systématique) : test de lecture statique + test d'injection `<script>` dans une valeur de cellule.
- UI-04 (manuel) parcours de création complet, toggle, dry-run, historique.
- UI-05 (manuel) popup avant fermeture selon navigateur (Chrome, Firefox, Edge).

### SEC — Sécurité et auditabilité
- SEC-01 aucun appel réseau sortant (`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, images externes) : analyse statique du code livré.
- SEC-02 aucun `eval`, `new Function`, `setTimeout` avec chaîne.
- SEC-03 liste des dépendances tierces figée et comparée à la liste justifiée.
- SEC-04 injection (HTML, formule Grist `=...`, valeurs très longues) dans les valeurs écrites par les actions : écrite (consigne 009 de GFS), valeur seule, dans un texte, reprise par deux transformations ; un texte qui n'est pas un nombre dans une opération est une erreur lisible. `{Autre}` dans une valeur reçue n'est jamais substitué.
- SEC-05 les droits de l'utilisateur Grist sont respectés (jamais d'élévation) : à jouer dans un vrai Grist (`docs/TESTS_GRIST_REEL.md`).
- SEC-06 la valeur reçue qui repère une ligne ne choisit que la ligne : la table lue et écrite est celle du graphe, jamais une table que la valeur nomme.
- SEC-07 une condition compare, elle n'évalue pas : « contient » ne lit pas son texte comme une expression régulière.
- SEC-08 un texte qui se lit « Infinity » ou « 1e999 » reste un texte, un calcul qui sort des nombres est une erreur (JSON écrirait une cellule vide).

### CLOSE — Réponse à l'appel `fermer` de GFS (consigne 010)
- CLOSE-01 rien n'attend : oui tout de suite, sans question ; le verrou d'exécution est libéré.
- CLOSE-02 une écriture attend : elle est enregistrée, la réponse ne vient pas avant sa fin, sans question.
- CLOSE-03 une exécution ou une écriture dans le document en cours est attendue avant de répondre.
- CLOSE-04 l'écriture échoue : la question « Enregistrer, Abandonner, Annuler » ; Annuler (ou Échap) garde l'app, le verrou reste pris.
- CLOSE-05 Abandonner : l'app part sans réécrire, le verrou est libéré.
- CLOSE-06 Enregistrer : l'écriture est refaite, l'app part quand elle réussit ; si elle échoue encore, la question revient.
- CLOSE-07 le verrou ne retient pas l'app : sa libération échoue ou traîne, la réponse vient quand même (3 s au plus).
- CLOSE-08 des écritures qui ne s'arrêtent jamais n'attendent pas sans fin (dix tours au plus ; GFS propose lui-même « Fermer quand même » après 10 s).
- CLOSE-09 le suivi des promesses en cours (`Closing.tracker`) : rien quand tout est fini, une attente tant que l'une dure, un échec compte comme fini.
- CLOSE-10 la réponse donnée à GFS : seul « vrai » ferme, une erreur part chez GFS (qui demande à la personne), sans gestionnaire l'app peut partir.
- (E2E-63 à 68, dans un faux GFS : le tableau ci-dessous ; le vrai GFS : `docs/TESTS_GRIST_REEL.md`, LIEN-12 à LIEN-19.)

### Tests déjà écrits (état au 2026-10-12)

| Groupe | Contenu | Où |
|---|---|---|
| CLOSE-01 à 10 | `fermer` de GFS (consigne 010, 0.15.1) : rien n'attend (oui tout de suite), une écriture ou une exécution en cours attendue avant le oui, l'écriture qui échoue (question, Annuler, Échap, Abandonner, Enregistrer qui réessaie), verrou rendu sans retenir l'app, attente bornée, suivi des promesses, réponse stricte | `tests/closing.test.js` |
| E2E-63 à 68 | l'app dans un faux GFS (cadre isolé) à qui GFS demande `fermer` : rien n'attend (oui pour chaque raison, sans fenêtre), lecture seule (oui, rien d'écrit), une modification en attente (écrite avant le oui, sans question, écriture plus longue que la réponse), écriture refusée (la question, Annuler et Échap gardent l'app, Enregistrer réessaie), Abandonner, un workflow actif pendant une exécution (effet et journal écrits avant le oui, verrou rendu) | `tests/e2e/smoke.mjs` |
| DIFF, TRG, COND, ACT, DRY, SEC-02 | moteur (voir plus haut), tests listés comme « partiels » ; le moteur parcourt un graphe (conditions en série = ET) | `tests/engine.test.js` |
| SEC-04, 06 à 08, E2E-62 | une ligne reçue par un lien public est du texte non fiable (consigne 009 de GFS, 0.15.1) : écrite telle quelle, jamais évaluée ni substituée deux fois, une clé qui ne vise que la table du graphe, des comparaisons sans expression régulière, « Infinity » qui reste un texte ; dans Chromium, un texte en HTML se lit dans le journal et le test à blanc sans qu'aucune balise naisse | `tests/engine.test.js`, `tests/e2e/smoke.mjs` |
| GRAPH-01 à 10 | ajout, liens (sortie vers entrée, pas de cycle, une entrée = un lien), suppression, validation, aller-retour JSON | `tests/graph.test.js` |
| I18N-01 à 08 | clés fr/en identiques et dans le même ordre (`js/i18n-texts.js`), clés utilisées existantes, aucune clé inutilisée, pluriels, langue initiale, vocabulaire ; textes écrits en dur dans `index.html` égaux à ceux du français (depuis la 0.13.0) | `tests/i18n.test.js` |
| SRCH-01 à 04 | recherche par mots (ordre libre, accents, ponctuation) | `tests/search-select.test.js` |
| CTR-01 à 03 | contrastes des jetons, clair et sombre | `tests/contrast.test.js` |
| HYG-01 à 09 | aucun réseau, police, image ou style externe ; pas d'`innerHTML` ; pas d'emoji ; politique de sécurité (images du site du widget et `data:` seulement, depuis la 0.14.0) ; pas de couleur en dur (le blanc d'un bouton plein compris, depuis la 0.12.0) ; pas de compte personnel ; stockage limité à la langue, au thème et à la prise en main vue (`localStorage`, `ab_tuto` depuis la 0.14.0) et à l'identifiant d'onglet du verrou (`sessionStorage`, depuis la 0.13.0), dits dans le README | `tests/hygiene.test.js` |
| HYG-18 | chaque script et feuille de l'app demandé avec `?v=<version>` (la même dans `js/version.js` et `package.json`), chaque fichier demandé existe, chaque script de `js/` est chargé | `tests/hygiene.test.js` |
| STORE-01 à 10 | table `Automation` du document : colonnes, création avec repli sans formule, graphe par table (upsert), journal, cohabitation des deux types de lignes | `tests/store.test.js` |
| LKP-01 à 06, TRG-08 à 10 | nœud Lecture (seuil, absent, doublon, colonne inconnue, table courante), valeurs `{Colonne}` et `{var}` dans les conditions, déclencheur à ligne précise | `tests/engine.test.js` |
| STORE-08, 12 | pages du journal, curseur stable | `tests/store.test.js` |
| ACT-09 à 15 | mise à jour par clé : trouvée, introuvable, doublon, type, colonne inconnue, autre table sans clé, dry-run, même table | `tests/engine.test.js` |
| TRF-01 à 06, VAL-04 à 06, DRY-05 | nœud Transformation (concaténation, calculs, formatage, chaîne, erreurs, code non exécuté), valeurs `{Colonne}` | `tests/engine.test.js` |
| COND-09 à 11, ELSE-01 à 04 | vérifications multiples (ET, OU, erreur), branche « sinon » (vrai, faux, sans lien, chaînes de conditions) | `tests/engine.test.js` |
| GRAPH-11 à 22 | vérifications non partagées, deux sorties, lien « sinon » réservé à la condition, migration v2 vers v3, lecture | `tests/graph.test.js` |
| GRD-01 à 10 (echo) | écho des écritures du widget reconnu et consommé, modification mixte, expiration, filet « trop d'exécutions » | `tests/echo.test.js` |
| MUL-01 à 09 | exécutant unique : prise, renouvellement, relais après délai, libération, prises simultanées, décalage d'horloge, un verrou par table | `tests/executor.test.js` |
| MUL-10 à 13 | identifiant d'onglet gardé le temps d'un rechargement (`Executor.tabIdentity`) : l'onglet rechargé reprend son verrou sans attendre, un onglet dupliqué n'en hérite pas, une clé par table, contenu inattendu ou stockage refusé, retour du cache de navigation | `tests/executor.test.js` |
| GFS-01 à 13 | règles 3 et 4 du guide des apps de GFS : nom de table pris à la casse près, identifiant réel relu après `AddTable`, colonnes indispensables et facultatives, colonne supprimée en cours de route, colonnes inconnues tolérées ; graphe lisible qui garde l'inconnu, contenu illisible jamais réécrit (couvrent STO-04 et STO-06) | `tests/gfs.test.js` |
| HYG-10, 11 | règle 12 : aucun `z-index` en dur (jetons `--z-*`), un seul bleu d'accent (pas de vert de succès) | `tests/hygiene.test.js` |
| BAR-01 à 06 | barre de GFS (consigne 003) : rectangles qui se recouvrent, déplacement le plus court qui sort de la zone aux quatre bords (journal, menus), marge laissée à une fenêtre ; zones mesurées par GFS à 700 × 400 | `tests/keep-clear.test.js` |
| HYG-13 à 17 | règle 15 : feuilles sur des jetons définis (aucun jeton de mise en page de GFS), fond de la page `--bg` avec `--wash` ; kit en sous-module au commit cité par `js/gfs.js` ; modules du kit chargés sans réseau, `eval` ni HTML ; liste justifiée des couleurs propres à l'app | `tests/hygiene.test.js` |
| COND-12, ACT-16 | comparaisons au texte tapé (0.15.0) : une case vaut true ou false, un texte de chiffres égale ce qui est tapé, un zéro en tête compte (01000 n'est pas 1000), dans les conditions, les colonnes clés, la Lecture et la ligne précise ; « supérieur » et « inférieur » toujours sans coercition (COND-05) ; le journal ne change pas | `tests/engine.test.js` |
| GRAPH-23 | largeur d'un nœud (`w`, 0.15.0) : bornée de 200 à 600 px, ignorée si illisible, gardée par la relecture, sans effet sur la validation | `tests/graph.test.js` |
| E2E-58 à 60 | retouches de la 0.15.0 : aucun réglage de la vue écrit quand la table `Automation` garde le graphe, même à l'activation (pas de bouton « Enregistrer » de Grist), le graphe dans les réglages sans la table (E2E-11 et 35 relisent désormais la table) ; fil lâché sur le fond (menu d'ajout sans Déclencheur, nœud relié l'entrée au bout du fil, branche « Sinon » gardée, Échap et clic ailleurs, menu entier près du bord) ; largeur des nœuds (bord tiré, liens qui suivent, bornes, Maj + flèches, double-clic, rechargement, lecture seule) | `tests/e2e/smoke.mjs` |
| TUTO-01 à 03 | prise en main (0.14.0) : version vue (`ab_tuto` : rien, un texte ou une plus ancienne la rouvre, la même ou une plus récente non), une capture WebP de 1200 × 400 par écran et par langue et aucune en trop, textes dans les deux langues et assez courts pour deux lignes | `tests/tutorial.test.js` |
| E2E-51 à 57 | prise en main (0.14.0) : ouverture d'elle-même après la question de la table, six écrans de même hauteur dans 700×400, boutons et focus, points au clavier, contrastes clair et sombre, Échap qui la retient, rechargement sans elle, Réglages > Aide par-dessus les Réglages ; jamais d'elle-même en lecture seule, sur la carte de l'accès, hors de Grist, dans le cadre de GFS (sans stockage) ni par-dessus une fenêtre ouverte pendant le démarrage ; anglais et sombre, capture qui ne vient pas | `tests/e2e/smoke.mjs` |
| E2E-45 à 50 | le widget seul dans Grist (0.13.0) : thème que Grist pose sans erreur de politique de sécurité (élément `<template id="grist-theme">`, `color-scheme` de l'app), accès complet pas encore accordé (`?access=none`), lecture seule (`?readonly=true` : rien d'écrit ni d'exécuté au bout du battement, canevas non modifiable, « Tester » gardé ; aucune question de table), onglet rechargé qui reprend tout de suite, onglet neuf qui attend l'exécutant en place | `tests/e2e/smoke.mjs` |
| E2E-36 à 44 | l'app dans un faux GFS (cadre isolé, `tests/e2e/gfs-host.html`) : seule demande du contexte, ambiance Pop du kit en clair et en sombre puis `null`, barre aux quatre bords à 700 × 400 (barre d'outils, journal, menu d'ajout, fenêtre des réglages, liste d'un nœud dans un canevas dézoomé), barre qui change en route, fenêtre dans un cadre de 700 × 300, kit absent | `tests/e2e/smoke.mjs` |
| E2E-27 à 35 | règles 3, 4 et 12 dans Chromium : contenu illisible (réglages de la vue, table, modification pendant le démarrage, graphe actif ailleurs) conservé et verrouillé à l'écran, nom de table pris, colonnes absentes, couleur du test à blanc, ordre des couches | `tests/e2e/smoke.mjs` |
| E2E-01 à 26 | dans Chromium avec une API Grist simulée : construction du graphe (menu d'ajout, liens au clic et au glisser), écriture, dry-run avec état des nœuds, thème et langue, fenêtres et clavier, 700×400, hors Grist, activation refusée, suppression, déplacement et zoom, sauvegarde et rechargement, accord de création des tables, refus, relecture du graphe et du journal | `tests/e2e/smoke.mjs` (`npm run test:e2e`) |

Les E2E ne remplacent pas les scénarios IT du Grist réel (`docs/GRIST_TEST_DOC.md`).

### Groupes ajoutés par les règles UI/UX et Grist.Gouv (à compléter au fil des fonctionnalités)

- **MODAL** : largeurs, trois zones, fenêtre empilée au-dessus, voile qui ne ferme rien, retour du focus.
- **A11Y** : navigation clavier complète, noms accessibles, `aria-expanded` sur les listes, contrastes mesurés sur les éléments réels.
- **CONSENT** : création des table `Automation` demandée d'abord, redemandée à chaque action en cas de refus.
- **BOOT** : fenêtres de démarrage (réseau bloqué, chargement long, erreur) en plus du cas « hors de Grist ».

## 4. Intégration (Grist réel)

Liste de scénarios manuels dans `docs/TESTS_GRIST_REEL.md`, jouée par Antoine sur son Grist et enrichie à chaque fonctionnalité (voir sa règle de maintenance). Le document de test est décrit dans `docs/GRIST_TEST_DOC.md`.

## 5. Quand lancer quoi

| Changement | Lancer |
|---|---|
| Micro-changement dans un module | le module concerné + `SEC` |
| Nouvelle feature | modules touchés + `GRD` + `MUL` + intégration |
| Avant chaque livraison / audit | tout |
| Bug corrigé | ajouter un test dans le module concerné, puis le module |
| Fonctionnalité livrée | Ajouter ses scénarios dans `docs/TESTS_GRIST_REEL.md`, et renvoyer vers les nouveaux ou modifiés dans le message de livraison |
