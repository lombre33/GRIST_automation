# Grist Automation Builder

Widget Grist (instance Grist.Gouv) d'automatisation no-code, sans backend ni appel externe : un déclencheur, des conditions, une action, exécutés dans le navigateur tant que la vue est ouverte. Édité par Grist Factory, licence GNU GPL v3.0.

Périmètre : `docs/CDC_Widget_Grist_Automation_Builder.md`. Règles d'interface et de développement : `docs/REGLES_UI_UX_ET_DEV.md`. Tests : `docs/PLAN_TESTS.md`.

## État : POC V0.5

Formulaire simple (la vue nodale viendra ensuite) : déclencheur (création, modification, suppression), condition optionnelle, action (mettre à jour la ligne ou ajouter une ligne dans la table courante ou une autre), activation, dry-run, logs à l'écran. Interface fr/en, thèmes clair et sombre, pensée pour un panneau de 700×400 px.

Le workflow est stocké dans les options du widget ; les tables `_Automation_*` du CDC viennent ensuite.

## Configuration

1. Publier le dépôt (GitHub Pages).
2. Dans Grist : ajouter une vue « Personnalisé », coller l'adresse de la page, accès « Accès complet au document ».
3. Choisir les colonnes dans les listes, enregistrer, activer. Garder la vue ouverte.

## Dépendances

Aucune : HTML, CSS et JavaScript sans framework ni build. Seul script externe : `grist-plugin-api.js` servi par docs.getgrist.com (validé par la DINUM). La politique de sécurité de `index.html` n'autorise rien d'autre.

## Organisation du code

| Fichier | Rôle |
|---|---|
| `js/engine.js` | moteur : détection des événements, conditions, actions, dry-run (sans DOM ni Grist) |
| `js/main.js` | formulaire et branchement sur l'API Grist |
| `js/i18n.js`, `js/theme.js` | textes fr/en, thèmes |
| `js/modal.js`, `js/search-select.js` | fenêtres et listes avec recherche |
| `css/` | jetons de la charte, styles, fenêtres |

## Tests

```
npm test            # unitaires et vérifications statiques, sans dépendance (Node)
npm run test:e2e    # scénario de base dans Chromium avec une API Grist simulée
```

`test:e2e` demande Playwright, installé hors du dépôt (variable `PLAYWRIGHT_PATH` si besoin).

## Limites connues du POC

- Anti-boucle approximatif, pas de gestion de plusieurs onglets ouverts (MUL-* du plan de tests).
- Pas d'email d'auteur dans les logs, pas de persistance des logs.
- `onRecords` ne voit que les lignes de la vue : un filtre actif peut simuler des créations ou suppressions (DIFF-07).
- Les colonnes sont lues avec `fetchTable`, coûteux sur de très grosses tables.
