# Règles UI/UX et de développement appliquées au widget

Synthèse de deux sources, à relire à la source avant tout travail d'interface (elles évoluent) :
- **Charte UI/UX Grist Factory** : `planning/identite-ui-ux-grist-factory.md` dans le dépôt `lombre33/publipostageGrist` (§1 = commun à tous les widgets).
- **Guide de contribution Grist.Gouv** (DINUM / ANCT, juillet 2026) pour un hébergement sur leurs instances.

Dernière colonne : où la règle est appliquée ou vérifiée dans ce dépôt.

## 1. Charte UI/UX (extraits structurants)

| Règle | Application / test |
|---|---|
| Éditeur affiché « Grist Factory », jamais le compte GitHub personnel ; GPL v3 ; panneau Crédits dans Réglages | `js/main.js` (`openSettings`), HYG-08 |
| Un seul accent bleu, rouge et ambre sémantiques, jetons CSS, thèmes clair et sombre | `css/tokens.css`, HYG-07 |
| Contrastes 4,5:1 (texte rouge = `--danger-ink`, bouton plein = `--accent-solid`) | CTR-01 à CTR-03 |
| Thème : système / clair / sombre, `data-theme` sur `<html>`, choix en localStorage | `js/theme.js`, E2E-03 |
| Police système, jamais de police ni de feuille de style d'un autre site | HYG-02, HYG-03 |
| Icônes SVG en contour (`mask-image`), pas d'emoji, une icône = une fonction | `css/style.css`, HYG-05 |
| Bilingue fr/en, même lot ; vocabulaire (« modèle », pas de pluriel entre parenthèses, vide = « — Choisir … — ») | `js/i18n.js`, I18N-01 à I18N-05 |
| Fenêtres : base commune (3 zones, 3 largeurs, focus piégé, Échap, voile qui ne ferme rien) | `js/modal.js`, E2E-04 |
| Pas de `prompt()` / `confirm()` natifs : fenêtres du widget | HYG-04 |
| Choix d'une colonne ou d'une table : liste avec recherche, jamais de `<select>` natif visible (aussi dans les nœuds et le menu d'ajout) | `js/search-select.js`, SRCH-01 à SRCH-04, E2E-05 |
| Vue nodale : fond uni, nœuds reliés par des liens, ajout par clic droit (demande d'Antoine, inspiration Blender / Unreal) | `js/canvas.js`, E2E-01, E2E-09, E2E-10 |
| Fonction indisponible : grisée, jamais masquée | `syncDisabled` (`js/canvas.js`) |
| Panneau de référence 700×400 | E2E-06 |
| Widget qui ne démarre pas : une fenêtre qui dit quoi faire | `showOutsideGrist`, E2E-07 (les trois autres cas : à faire) |
| Tables du widget : demander d'abord, redemander à chaque action si refus | fait en 0.6.0 (fenêtre de consentement, `Modal.confirm`) |
| Non-régression : on ajoute de l'UI, on ne modifie pas l'existant sans l'accord d'Antoine | règle de travail |
| Pas de framework ni de build ; dépendances tierces au cas par cas | tout le code |

## 2. Guide de contribution Grist.Gouv

| Critère | Application |
|---|---|
| Dépôt public nommé `grist-widget-[nom-fonctionnel]` | à décider avec Antoine (proposition : `grist-widget-automation-builder`) |
| README : ce que fait le widget, configuration, dépendances | `README.md` |
| Périmètre étroit : un widget qui fait une chose bien | l'automatisation d'une table (CDC §1) |
| Tests unitaires du cœur + test d'intégration du scénario de base | `npm test` (unitaires), `npm run test:e2e` (E2E-01) |
| Code compréhensible sans IA, noms explicites, concis, sans code mort ni duplication | revue par Antoine avant soumission |
| Code généré par IA : relu, compris et testé par la personne qui soumet | **Antoine doit pouvoir expliquer chaque partie** : le code est court et commenté pour cela |
| Aucune requête vers un service externe non documenté, aucune donnée utilisateur hors de Grist | HYG-01, HYG-06, HYG-09 |
| Revue sécurité DINUM avant mise en production | CDC §4.4 |
| Annonce sur le canal Tchap Grist-Contributions (lien, 2-3 phrases, contexte) | quand le dépôt sera prêt |
| Vulnérabilité : jamais d'issue publique (VDP du gouvernement ou message privé) | `SECURITY.md` à ajouter au dépôt public |
