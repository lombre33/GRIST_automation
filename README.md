# Grist Automation Builder

Widget Grist (instance DINUM) d'automatisation no-code, sans backend ni appel externe. Périmètre : `docs/CDC_Widget_Grist_Automation_Builder.md`. Tests : `docs/PLAN_TESTS.md`.

## État : POC V0.5

Formulaire simple (pas encore de vue nodale) : un déclencheur (création / modification / suppression), une condition optionnelle, une action (mettre à jour la ligne ou ajouter une ligne), activation, dry-run, logs à l'écran. Le workflow est stocké dans les options du widget ; les tables `_Automation_*` du CDC viennent ensuite.

## Utilisation

1. Publier le dépôt sur GitHub Pages.
2. Dans Grist : ajouter un widget « Custom », URL de la page, accès « Full document access ».
3. Remplir le formulaire, enregistrer, activer. Garder la vue ouverte.

`index.html` charge `grist-plugin-api.js` depuis docs.getgrist.com : pour la DINUM, remplacer par la copie servie par leur instance (ou vendoriser le fichier après audit).

## Tests

```
npm test
```

Moteur testé sous Node avec `node:test`, aucune dépendance.

## Limites connues du POC

- Anti-boucle approximatif, pas de gestion du multi-onglets (cf. MUL-* du plan de tests).
- Pas d'email d'auteur dans les logs, pas de persistance des logs.
- `onRecords` ne voit que les lignes de la vue : un filtre actif peut simuler des créations ou suppressions (DIFF-07).
