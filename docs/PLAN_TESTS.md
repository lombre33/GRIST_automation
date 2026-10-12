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
- STO-05 création automatique des tables `_Automation_*` absentes ; réutilisation si présentes.
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
- SEC-04 injection (HTML, formule Grist `=...`, valeurs très longues) dans les valeurs écrites par les actions.
- SEC-05 les droits de l'utilisateur Grist sont respectés (jamais d'élévation).

### Tests déjà écrits (état au 2026-10-12)

| Groupe | Contenu | Où |
|---|---|---|
| DIFF, TRG, COND, ACT, DRY, SEC-02 | moteur (voir plus haut), tests listés comme « partiels » ; le moteur parcourt un graphe (conditions en série = ET) | `tests/engine.test.js` |
| GRAPH-01 à 10 | ajout, liens (sortie vers entrée, pas de cycle, une entrée = un lien), suppression, validation, aller-retour JSON | `tests/graph.test.js` |
| I18N-01 à 06 | clés fr/en identiques, clés utilisées existantes, aucune clé inutilisée, pluriels, langue initiale, vocabulaire | `tests/i18n.test.js` |
| SRCH-01 à 04 | recherche par mots (ordre libre, accents, ponctuation) | `tests/search-select.test.js` |
| CTR-01 à 03 | contrastes des jetons, clair et sombre | `tests/contrast.test.js` |
| HYG-01 à 09 | aucun réseau, police, image ou style externe ; pas d'`innerHTML` ; pas d'emoji ; politique de sécurité ; pas de couleur en dur ; pas de compte personnel ; stockage limité | `tests/hygiene.test.js` |
| E2E-01 à 11 | dans Chromium avec une API Grist simulée : construction du graphe (menu d'ajout, liens au clic et au glisser), écriture, dry-run avec état des nœuds, thème et langue, fenêtres et clavier, 700×400, hors Grist, activation refusée, suppression, déplacement et zoom, sauvegarde et rechargement | `tests/e2e/smoke.mjs` (`npm run test:e2e`) |

Les E2E ne remplacent pas les scénarios IT du Grist réel (`docs/GRIST_TEST_DOC.md`).

### Groupes ajoutés par les règles UI/UX et Grist.Gouv (à compléter au fil des fonctionnalités)

- **MODAL** : largeurs, trois zones, fenêtre empilée au-dessus, voile qui ne ferme rien, retour du focus.
- **A11Y** : navigation clavier complète, noms accessibles, `aria-expanded` sur les listes, contrastes mesurés sur les éléments réels.
- **CONSENT** : création des tables `_Automation_*` demandée d'abord, redemandée à chaque action en cas de refus.
- **BOOT** : fenêtres de démarrage (réseau bloqué, chargement long, erreur) en plus du cas « hors de Grist ».

## 4. Intégration (Grist réel)

Scénarios IT-01 à IT-nn dans `docs/GRIST_TEST_DOC.md` : création / modification / suppression réelles, filtre de vue actif, deux onglets ouverts, droits restreints, table cible absente.

## 5. Quand lancer quoi

| Changement | Lancer |
|---|---|
| Micro-changement dans un module | le module concerné + `SEC` |
| Nouvelle feature | modules touchés + `GRD` + `MUL` + intégration |
| Avant chaque livraison / audit | tout |
| Bug corrigé | ajouter un test dans le module concerné, puis le module |
