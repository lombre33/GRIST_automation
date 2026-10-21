# Grist Automation Builder

Widget Grist (instance Grist.Gouv) d'automatisation no-code, sans backend ni appel externe : un déclencheur, des conditions, une action, exécutés dans le navigateur tant que la vue est ouverte. Édité par Grist Factory, licence GNU GPL v3.0.

Périmètre : `docs/CDC_Widget_Grist_Automation_Builder.md`. Règles d'interface et de développement : `docs/REGLES_UI_UX_ET_DEV.md`. Tests : `docs/PLAN_TESTS.md`.

## État : POC V0.5

Vue nodale sur fond uni : on ajoute des nœuds (clic droit sur le fond, ou « Ajouter »), on les relie en glissant d'une sortie vers une entrée (ou clic sur la sortie puis sur l'entrée), on déplace le fond et on zoome à la molette.

- **Déclencheur** : ligne créée, modifiée ou supprimée (colonne surveillée optionnelle).
- **Condition** : une ou plusieurs vérifications (colonne, opérateur, valeur) reliées par ET ou OU, avec une sortie « Oui » et une sortie « Sinon » ; plusieurs conditions en série valent un ET.
- **Transformation** : calcule une valeur (concaténation, + − × ÷, majuscules, minuscules, sans espaces) et la rend disponible sous `{nom}` ; les valeurs des actions acceptent aussi `{Colonne}`.
- **Action** : ajouter une ligne, ou mettre à jour une ligne, dans la table courante ou une autre ; pour une autre table, la ligne est repérée par une colonne clé (« Ligne repérée par » = `{Colonne}` ou un texte).
- « Tester » simule sur la première ligne de la vue sans rien écrire et affiche l'état de chaque nœud ; « Activer » refuse tant que le graphe est incomplet.

Le graphe est enregistré automatiquement dans les options du widget, et, avec l'accord de la personne, dans une seule table du document, `Automation` : une ligne `Workflow` par table surveillée (avec un résumé lisible) et une ligne `Log` par exécution. La colonne « Auteur » est une formule déclenchée `user.Email`. Sans les tables, le widget fonctionne mais ne garde ni le graphe dans le document ni le journal. Un seul onglet exécute les workflows d'une table (verrou dans la table `Automation`, relais au bout de 20 s si l'exécutant disparaît) ; les écritures du widget ne le redéclenchent pas. Interface fr/en, thèmes clair et sombre, pensée pour un panneau de 700×400 px.

## Configuration

1. Publier le dépôt (GitHub Pages).
2. Dans Grist : ajouter une vue « Personnalisé », coller l'adresse de la page, accès « Accès complet au document ».
3. Construire le graphe, activer. Garder la vue ouverte.

## Dépendances

Aucune : HTML, CSS et JavaScript sans framework ni build. Seul script externe : `grist-plugin-api.js` servi par docs.getgrist.com (validé par la DINUM). La politique de sécurité de `index.html` n'autorise rien d'autre.

## Organisation du code

| Fichier | Rôle |
|---|---|
| `js/nodes.js` | types de nœuds (champs, broches) |
| `js/graph.js` | modèle du graphe : liens, validation, lecture (sans DOM) |
| `js/engine.js` | moteur : détection des événements, parcours du graphe, dry-run (sans DOM ni Grist) |
| `js/canvas.js` | canevas nodal : déplacement, zoom, nœuds, liens |
| `js/main.js` | branchement sur l'API Grist, sauvegarde, exécution |
| `js/i18n.js`, `js/theme.js` | textes fr/en, thèmes |
| `js/modal.js`, `js/search-select.js` | fenêtres et listes avec recherche |
| `css/` | jetons de la charte, styles, canevas, fenêtres |

## Tests

```
npm test            # unitaires et vérifications statiques, sans dépendance (Node)
npm run test:e2e    # scénario de base dans Chromium avec une API Grist simulée
```

`test:e2e` demande Playwright, installé hors du dépôt (variable `PLAYWRIGHT_PATH` si besoin).

## Limites connues du POC

- Un nœud Condition a une seule sortie (« vrai ») : pas encore de branche « sinon », ni de nœud Transformation.
- Anti-boucle approximatif, pas de gestion de plusieurs onglets ouverts (MUL-* du plan de tests).
- Pas d'email d'auteur dans les logs, pas de persistance des logs.
- `onRecords` ne voit que les lignes de la vue : un filtre actif peut simuler des créations ou suppressions (DIFF-07).
- Les colonnes sont lues avec `fetchTable`, coûteux sur de très grosses tables.
