# Grist Automation Builder

Widget Grist (instance Grist.Gouv) d'automatisation no-code, sans backend ni appel externe : un déclencheur, des conditions, une action, exécutés dans le navigateur tant que la vue est ouverte. Édité par Grist Factory, licence GNU GPL v3.0.

Périmètre : `docs/CDC_Widget_Grist_Automation_Builder.md`. Règles d'interface et de développement : `docs/REGLES_UI_UX_ET_DEV.md`. Tests : `docs/PLAN_TESTS.md`.

## État : POC V0.5

Vue nodale sur fond uni : on ajoute des nœuds (clic droit sur le fond, ou « Ajouter »), on les relie en glissant d'une sortie vers une entrée (ou clic sur la sortie puis sur l'entrée), on déplace le fond et on zoome à la molette.

- **Déclencheur** : ligne créée, modifiée ou supprimée (colonne surveillée, ligne précise optionnelle (modification seulement) optionnelle).
- **Condition** : une ou plusieurs vérifications (colonne, opérateur, valeur) reliées par ET ou OU, avec une sortie « Oui » et une sortie « Sinon » ; plusieurs conditions en série valent un ET.
- **Lecture** : va chercher une cellule d'une autre table (ligne repérée par une clé) et la rend disponible sous `{nom}`, par exemple pour comparer un montant au seuil du service.
- **Transformation** : calcule une valeur (concaténation, + − × ÷, majuscules, minuscules, sans espaces) et la rend disponible sous `{nom}` ; les valeurs des actions acceptent aussi `{Colonne}`.
- **Action** : ajouter une ligne, ou mettre à jour une ligne, dans la table courante ou une autre ; pour une autre table, la ligne est repérée par une colonne clé (« Ligne repérée par » = `{Colonne}` ou un texte).
- « Tester » simule sur la ligne sélectionnée dans Grist (sinon la première de la vue) sans rien écrire et affiche l'état de chaque nœud ; « Activer » refuse tant que le graphe est incomplet.

Le graphe est enregistré automatiquement dans les options du widget, et, avec l'accord de la personne, dans une seule table du document, `Automation` : une ligne `Workflow` par table surveillée (avec un résumé lisible) et une ligne `Log` par exécution. La colonne « Auteur » est une formule déclenchée `user.Email`. Sans les tables, le widget fonctionne mais ne garde ni le graphe dans le document ni le journal. Un seul onglet exécute les workflows d'une table (verrou dans la table `Automation`, relais au bout de 20 s si l'exécutant disparaît) ; les écritures du widget ne le redéclenchent pas. Un contenu enregistré que cette version ne sait pas lire (version plus récente, contenu abîmé) n'est jamais écrasé : le widget l'affiche comme « Workflow conservé tel quel », grise Ajouter, Tester et Activer, et n'exécute rien à sa place. Une table `Automation` sans les colonnes attendues, ou dont le nom est déjà pris à la casse près, n'est pas utilisée : le journal du widget dit pourquoi. Interface fr/en, thèmes clair et sombre, pensée pour un panneau de 700×400 px.

## Configuration

1. Publier le dépôt (GitHub Pages).
2. Dans Grist : ajouter une vue « Personnalisé », coller l'adresse de la page, accès « Accès complet au document ».
3. Construire le graphe, activer. Garder la vue ouverte.

## Dans Grist Factory Suite (GFS)

Quand GFS ouvre l'app dans l'un de ses cadres (`?gfs=<n>` dans l'adresse), l'app parle à GFS par le lien du kit commun des apps (`kit/`, voir plus bas) et en prend deux choses. Seule, dans Grist, rien ne change.

- **La barre de GFS** se pose par-dessus le cadre, au bord que la personne choisit. L'app laisse libre la zone que GFS donne (`js/keep-clear.js`) : la barre d'outils se partage autour d'elle quand la barre est en haut ; le journal, le menu d'ajout, les listes et les bulles qui la recouvriraient s'en écartent du juste nécessaire ; une fenêtre se place dans le reste du cadre. La zone n'est jamais écrite dans le code : c'est celle que GFS envoie, à chaque changement.
- **L'ambiance** que la personne a choisie dans GFS (Grist Factory, Pop, Papier, Brut, Néon, ou sa couleur) : le kit pose les jetons de couleur et de forme sur `<html>` (`js/gfs.js`), les feuilles de `css/` les lisent et jamais une couleur écrite en dur. Les types de nœuds et les états du test à blanc s'écrivent avec l'accent de l'ambiance ; le rouge de l'échec et l'ambre de l'avertissement restent ceux de l'app (HYG-17).

Si le kit manque (copie du dépôt sans ses sous-modules), l'app s'ouvre quand même, avec ses couleurs, au bout de 2 secondes au plus. La langue de GFS n'est pas encore suivie : les boutons FR et EN des Réglages restent actifs.

## Dépendances

Rien à installer : HTML, CSS et JavaScript sans framework ni build. Seul script externe : `grist-plugin-api.js` servi par docs.getgrist.com (validé par la DINUM). La politique de sécurité de `index.html` n'autorise rien d'autre.

Le lien avec GFS vient du kit commun des apps Grist Factory (`lombre33/grist-factory-kit`), référencé en **sous-module** `kit/` (version 0.7.0, commit `db14544`) : des modules JavaScript servis par le même site, sans appel réseau ni `eval` (HYG-14 à 16). Cloner avec `git clone --recursive`, ou, après un clone simple, `git submodule update --init`. GitHub Pages publie le sous-module avec le site.

## Organisation du code

| Fichier | Rôle |
|---|---|
| `js/nodes.js` | types de nœuds (champs, broches) |
| `js/graph.js` | modèle du graphe : liens, validation, lecture (sans DOM) |
| `js/engine.js` | moteur : détection des événements, parcours du graphe, dry-run (sans DOM ni Grist) |
| `js/canvas.js` | canevas nodal : déplacement, zoom, nœuds, liens |
| `js/main.js` | branchement sur l'API Grist, sauvegarde, exécution |
| `js/i18n.js`, `js/theme.js` | textes fr/en, thèmes |
| `js/gfs.js`, `js/keep-clear.js` | lien avec GFS : l'ambiance (par le kit) et la zone de la barre de GFS à laisser libre |
| `kit/` | kit commun des apps Grist Factory (sous-module) : lien avec GFS, pose de l'ambiance |
| `js/modal.js`, `js/search-select.js` | fenêtres et listes avec recherche |
| `css/` | jetons de la charte, styles, canevas, fenêtres |

## Tests

```
npm test            # unitaires et vérifications statiques, sans dépendance (Node)
npm run test:e2e    # scénarios dans Chromium avec une API Grist simulée, dont l'app dans un faux GFS (tests/e2e/gfs-host.html)
```

`test:e2e` demande Playwright, installé hors du dépôt (variable `PLAYWRIGHT_PATH` si besoin). `E2E_ONLY='E2E-3[6-9]|E2E-4'` n'en joue qu'une partie ; `E2E_SHOTS=<dossier>` range des captures d'écran des scénarios dans GFS, à regarder à la main. Les tests qui lisent le kit (HYG-14 à 17, E2E-36 à 44) demandent le sous-module récupéré.

## Limites connues du POC

- Un nœud Condition a une seule sortie (« vrai ») : pas encore de branche « sinon », ni de nœud Transformation.
- Anti-boucle approximatif, pas de gestion de plusieurs onglets ouverts (MUL-* du plan de tests).
- Pas d'email d'auteur dans les logs, pas de persistance des logs.
- `onRecords` ne voit que les lignes de la vue : un filtre actif peut simuler des créations ou suppressions (DIFF-07).
- Les colonnes sont lues avec `fetchTable`, coûteux sur de très grosses tables.
