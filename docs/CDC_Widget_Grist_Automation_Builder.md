# Cahier des Charges — Widget Grist "Automation Builder"

## 0. Résumé exécutif

Widget custom pour Grist (instance DINUM), distribué via GitHub Pages, permettant à chaque utilisateur d'importer dans une vue liée à une table un outil d'automatisation no-code à interface nodale (déclencheur → conditions → transformations → actions). L'exécution est **côté client, en temps réel, tant que l'utilisateur a la vue ouverte** — pas de backend, pas d'appel externe, tout repose sur la Plugin API Grist et des tables du document comme unique persistance. Le code sera **audité cybersécurité par la DINUM** avant mise à disposition en V1 : cette contrainte structure l'ensemble des choix techniques (vanilla JS, dépendances minimales, code lisible, traçabilité complète).

---

## 1. Contexte, principes directeurs et non-objectifs

### 1.1 Principes directeurs
- **Zéro backend** : le widget est un fichier statique (HTML/JS/CSS) servi depuis GitHub Pages, chargé en iframe sandboxée par Grist. Toute donnée persistée l'est dans des tables Grist du document courant.
- **Un outil par table (V1)** : chaque instance du widget, posée dans une vue liée à une table, gère les automations de *cette* table. Une vue macro cross-tables est explicitement reportée en V2.
- **Exécution "utilisateur connecté"** : pas de vrai scheduler, pas d'exécution en arrière-plan sans onglet ouvert — contrainte structurelle assumée et communiquée clairement à l'utilisateur final (indicateur UI obligatoire).
- **Sobriété technique** : vanilla JS, dépendances tierces minimales et justifiées une à une (auditabilité DINUM), pas de framework lourd (pas de responsive/animations nécessaires).
- **Progressivité** : POC V0.5 → V1 → V1.1 → V2, avec périmètre figé et validé à chaque étape.

### 1.2 Non-objectifs (explicitement hors périmètre V1)
- Pas d'exécution en arrière-plan/sans utilisateur connecté (pas de vrai "serveur d'automation").
- Pas de vue macro multi-tables (V2).
- Pas d'export/import de workflow en format texte portable (V2).
- Pas d'appels réseau externes (contrainte CORS structurelle de l'iframe, assumée, pas un choix réversible).
- Pas de couche de permission applicative propre au widget (héritage pur des droits Grist natifs en V1).
- Pas de garde-fous de volumétrie chiffrés et codés en dur (V2) — seulement anticipés architecturalement.
- Pas de récupération du contenu complet d'une ligne supprimée (limite technique documentée, cf. §4.2).

---

## 2. Parcours utilisateurs

### 2.1 Personas
- **Créateur de workflow** : utilisateur métier avec accès en édition sur la table, construit et active des automations via l'interface nodale.
- **Utilisateur impacté** : toute personne dont les actions (ajout/modif/suppression de ligne) déclenchent une automation, avec ou sans conscience de son existence.
- **Auditeur/Mainteneur** : consulte les logs et l'historique détaillé pour comprendre ce qui s'est passé et déboguer.

### 2.2 Parcours type
1. L'utilisateur ajoute le widget custom (URL GitHub Pages) dans une vue liée à une table.
2. Il crée un nouveau workflow : choix du trigger (action : création/modification/suppression ; portée : ligne ; nouveau ou spécifique via clé).
3. Il ajoute des conditions (sur les données du trigger et/ou lecture d'une autre donnée, cross-table en lecture), combinables en AND/OR.
4. Il ajoute éventuellement des nodes de transformation (concaténation, calcul, formatage...).
5. Il ajoute une ou plusieurs actions (ajout de ligne, mise à jour de ligne), pouvant cibler la table courante ou une autre table du même document.
6. Il teste le workflow via le mode dry-run (simulation visuelle et/ou liste des effets attendus, sans écriture réelle), consultable en lien avec l'historique détaillé.
7. Il active le workflow (toggle actif/inactif).
8. Tant que la vue est ouverte, le widget écoute les événements Grist (`onRecords`/`onRecord`) et exécute les workflows actifs correspondants.
9. En cas d'erreur d'exécution, le workflow s'arrête (pas de poursuite en erreur) et un log est écrit.
10. L'utilisateur consulte à tout moment l'historique détaillé et les logs (avec traçabilité de l'auteur de chaque déclenchement, via l'email utilisateur Grist).

---

## 3. Périmètre fonctionnel

### 3.1 Triggers
- Action : Création / Modification / Suppression.
- Portée : ligne uniquement (le trigger colonne a été écarté, toute modification étant in fine rattachable à une ligne).
- Cible : nouvelle ligne, ou ligne spécifique identifiée par une clé/valeur de colonne (non applicable si action = Création, champ désactivé/masqué dans ce cas).
- Suppression : pas de snapshot complet de la ligne supprimée (trop coûteux). Un cache léger des `rowId` connus est maintenu en mémoire côté widget pour détecter la disparition d'une ligne. Le contenu de la ligne supprimée n'est pas récupérable en V1 (limite documentée).

### 3.2 Conditions
- Multi-sources : combinaison de conditions sur les données du trigger ET/OU sur la lecture d'une autre donnée (lookup cross-table en lecture seule).
- Opérateurs logiques AND/OR entre conditions.

### 3.3 Transformations (Transform) — prévues dès la V1
- Nodes intermédiaires permettant de manipuler une donnée avant action (ex : concaténation, formatage, calcul simple) sans dépendance externe.

### 3.4 Actions
- Ajout de ligne (AddRecord) dans la table courante ou une autre table du même document.
- Mise à jour de ligne (UpdateRecord) dans la table courante ou une autre table du même document.
- Delay explicitement exclu de la V1.

### 3.5 Fonctionnement du widget
- Mode actif / inactif par workflow (toggle).
- Mode test / "tester le workflow" (dry-run) : simulation sans écriture réelle, restitution visuelle (état des nodes) et/ou sous forme de liste des effets qui auraient été produits, en lien avec l'historique détaillé.
- Garde-fou anti-récursivité : limite du nombre de tours de déclenchement en chaîne (seuil à affiner, 1 ou 2 tours envisagés).
- Indicateur UI obligatoire signalant que l'automation nécessite que l'onglet reste ouvert pour s'exécuter.
- Historique détaillé des exécutions, prévu dès la V1.
- Logs avec traçabilité : auteur (email utilisateur Grist), horodatage, workflow concerné, résultat (succès/erreur).
- Contrôle d'accès : hérité intégralement des permissions Grist natives sur la table (pas de couche de permission applicative propre au widget en V1).

### 3.6 Hors périmètre V1 (reportés)
- Export/import de workflow en format texte portable → V2.
- Vue macro multi-tables → V2.
- Couche de permission applicative propre au widget → V2.
- Garde-fous de volumétrie chiffrés → V2.

---

## 4. Volet technique

### 4.1 Architecture générale
- Widget statique (HTML/CSS/JS) hébergé sur GitHub Pages, importé comme Custom Widget dans Grist.
- Aucune dépendance backend, aucun appel réseau externe (contrainte CORS de l'iframe).
- Communication avec Grist via la Plugin API (`grist.ready`, `grist.onRecords`, `grist.onRecord`, `docApi` pour lecture/écriture cross-table).
- Vanilla JS privilégié pour la logique métier ; une librairie UI nodale légère (type Drawflow) envisagée pour l'interface graphique, à valider en fonction de sa fraîcheur/maintenance au moment du développement.

### 4.2 Gestion de la suppression (limite technique)
- La Plugin API ne notifie que l'état courant des données, pas un événement "suppression avec contenu".
- Solution retenue : cache léger des `rowId` connus en mémoire ; comparaison à chaque `onRecords` pour détecter les disparitions.
- Le contenu complet de la ligne supprimée n'est pas récupérable en V1. Une piste V2 : permettre à l'utilisateur de désigner une colonne clé dont la valeur serait mise en cache au moment de la construction du workflow.

### 4.3 Stockage des workflows
- Persistance exclusivement dans une seule table Grist dédiée, utilisée comme base de données applicative (`Automation`, avec une colonne `Type` = Workflow ou Log, décision d'Antoine du 2026-10-21 : une seule table à autoriser ; sans tiret bas initial, car Grist n'accepte pas un identifiant de table commençant par `_`).
- Configuration de chaque workflow stockée en JSON structuré (clés explicites, versionné via un champ `version`), non destiné à être lu tel quel par un humain mais accompagné d'un champ `resume_humain` en clair pour lisibilité minimale lors d'un audit.
- Historique détaillé et logs stockés dans une table dédiée, avec horodatage, auteur (email), workflow concerné, statut.

### 4.4 Sécurité et auditabilité (contrainte DINUM)
- Choix vanilla JS et dépendances minimales et justifiées (auditabilité).
- Pas de code de sérialisation custom risqué : `JSON.parse`/`JSON.stringify` natifs uniquement.
- Pas d'appel réseau sortant : réduit la surface d'attaque (pas d'exfiltration possible).
- Traçabilité complète (auteur, horodatage, email) sur toute création/modification de workflow et toute exécution.
- Contrôle d'accès hérité intégralement des permissions Grist natives.

---

## 5. Roadmap de livraison

| Version | Contenu |
|---|---|
| **V0.5 (POC)** | 1 trigger (modification), 1 condition simple, 1 action, formulaire simple sans UI nodale, log console minimal — valide la boucle événementielle Grist et l'écriture cross-table |
| **V1** | UI nodale complète (Drawflow), triggers Création/Modif/Suppression avec portée/cible, conditions multi-sources AND/OR, node Transform, actions AddRecord/UpdateRecord, toggle actif/inactif, mode test/dry-run (visuel + liste), historique détaillé, logs complets avec traçabilité auteur, garde-fou anti-récursivité, indicateur "onglet ouvert requis" — **périmètre soumis à audit cybersécurité DINUM** |
| **V1.1** | Duplication de workflow, éventuel raffinement du moteur de diff |
| **V2** | Vue macro multi-tables, export/import texte de workflow, couche de permission applicative propre, garde-fous de volumétrie chiffrés, réévaluation de la récupération de contenu de ligne supprimée |

---

## 6. Points encore ouverts / à valider avant le début du développement

1. Vérification concrète, au lancement du dev, de la fraîcheur du repo Drawflow (dernier commit/issues) — décision finale lib nodale à confirmer à ce moment.
2. Seuil exact de la limite anti-récursivité (1 ou 2 tours) — à trancher pendant le développement du POC en observant des cas concrets.
3. Comportement exact de la popup anti-fermeture selon navigateurs (Chrome/Firefox/Edge) — à tester empiriquement, le comportement `beforeunload` variant selon les navigateurs modernes.
4. Modalités précises de vérification de l'accès à l'email utilisateur via l'API Grist (à confirmer techniquement en tout début de dev, avant de figer le schéma des logs).

---

## 7. Règles transverses (ajout du 2026-10-12)

Le widget suit la charte UI/UX **Grist Factory** et le **guide de contribution Grist.Gouv** : synthèse et correspondance avec le code dans `docs/REGLES_UI_UX_ET_DEV.md`.

- **Interface** : jetons de couleur à un seul accent, thèmes clair/sombre, police système, icônes SVG en contour, bilingue fr/en dans le même lot, fenêtres sur une base commune, listes avec recherche pour choisir colonnes et tables (jamais de `<select>` natif visible), tout tient dans un panneau de 700×400.
- **Marque** : éditeur « Grist Factory », licence GPL v3, panneau Crédits.
- **Qualité (guide Grist.Gouv)** : périmètre étroit, code lisible et concis, README, tests unitaires et d'intégration, aucune dépendance inutile, aucune requête externe non documentée, aucune donnée utilisateur hors de Grist. Le code généré avec l'aide d'une IA doit être relu et compris par Antoine avant soumission.
- **Ce que ces règles changent au CDC** :
  - §4.1 : la bibliothèque nodale (Drawflow) est remplacée par un canevas maison, plus simple à auditer et sans dépendance (à confirmer à la phase de la vue nodale).
  - §3.5 : les écritures de la table `Automation` demandent d'abord l'accord de la personne et le redemandent à chaque action en cas de refus.
  - §6 point 1 (fraîcheur de Drawflow) : sans objet si le canevas maison est retenu.
  - Le chargement de `grist-plugin-api.js` depuis docs.getgrist.com est validé par la DINUM.
  - Politique de sécurité (CSP) de `index.html` : `default-src 'none'`, scripts du widget et de l'API Grist uniquement. `'unsafe-eval'` y figure **à cause du bundle `grist-plugin-api.js` lui-même**, qui évalue ses modules par `eval()` (constaté le 2026-10-12 : sans lui, `grist` n'existe pas et le widget ne demande pas l'accès au document). Le code du widget n'utilise ni `eval` ni `Function` (test HYG-01). Point à signaler à l'audit DINUM.
