# Grist Automation Builder

Widget Grist d'automatisation sans code : quand une ligne est créée, modifiée ou supprimée, des conditions sont vérifiées et des actions écrivent dans le document. Tout s'exécute dans le navigateur, sans serveur ni appel externe. Édité par Grist Factory, licence GNU GPL v3.0.

> **Pré-alpha publique.** Le widget fonctionne seul dans une vue « Personnalisé » de Grist. Essayez-le d'abord sur une copie de votre document : une action mal réglée écrit dans vos tables. Les retours sont bienvenus (onglet Issues du dépôt).

## À quoi sert ce widget

On dessine un graphe de nœuds reliés, pour la table de la vue :

- **Déclencheur** : une ligne de la table de la vue (le nœud l'affiche, « Table surveillée ») est créée, modifiée ou supprimée ; pour une modification, on peut surveiller une colonne (une modification de cette colonne suffit à lancer la suite, sans Condition), et filtrer les lignes (« Filtrer sur la colonne », « Valeur attendue »).
- **Condition** : une ou plusieurs vérifications (colonne, opérateur, valeur) reliées par ET ou par OU, avec une sortie « Oui » et une sortie « Sinon ». Plusieurs conditions à la suite valent un ET. Une case à cocher a ses opérateurs, « est coché » et « n'est pas coché » ; un texte se compare au texte tapé (un code `01000`), un nombre au nombre tapé.
- **Recherche** (appelée Lecture jusqu'à la 0.15.0) : va chercher une cellule d'une autre table (ligne repérée par une colonne et la valeur cherchée) et la rend disponible sous `{nom}`, par exemple le seuil d'un service pour le comparer à un montant.
- **Transformation** : calcule une valeur (accoler deux textes, + − × ÷, majuscules, minuscules, espaces retirés) et la rend disponible sous `{nom}`.
- **Action** : ajoute une ligne, ou modifie des lignes, dans la table de la vue ou dans une autre. Les lignes à modifier sont « la même ligne », ou celles qu'une colonne repère (« Repérer par la colonne », « Valeur cherchée ») ; s'il y en a plusieurs, une nouvelle Action les modifie toutes (« Si plusieurs lignes », une Action d'avant la 0.16.0 s'arrête en erreur). Pour une colonne Référence vers la table de la vue, la valeur cherchée se remplit seule avec `{id}`, le numéro de la ligne qui a déclenché. Les valeurs acceptent `{Colonne}` et les `{nom}` des nœuds précédents.

Exemples : « quand le Statut d'un projet passe à Clos, ajouter une ligne dans Archive avec le nom du projet » ; « quand la case d'un projet change, mettre 2 dans la colonne B de toutes ses tâches » (un Déclencheur sur la case, une Action sur les Tâches repérées par leur colonne Référence Projet, sans Condition).

Sur le canevas : clic droit sur le fond (ou « Ajouter ») pour un nœud, le menu disant ce que fait chacun ; chaque champ a son libellé au-dessus de lui, un exemple grisé quand il est libre, et un champ sans objet (la valeur cherchée d'une Action qui ajoute une ligne) est caché ; un deuxième nœud du même type est numéroté (« Action 2 ») ; un lien se tire de la sortie d'un nœud jusqu'à l'entrée d'un autre, et, lâché sur le fond, il ouvre le menu d'ajout : le nœud choisi s'y pose, déjà relié. La largeur d'un nœud se règle en tirant son bord droit (au clavier, Maj + flèches gauche et droite sur son titre ; double-clic sur le bord pour la largeur d'origine) ; elle est gardée avec le workflow. La molette zoome, un glisser du fond déplace la vue.

« Tester » simule le graphe sur la ligne sélectionnée dans Grist (sinon la première de la vue), sans rien écrire, et montre l'état de chaque nœud. « Activer » refuse tant que le graphe est incomplet : le journal dit pourquoi, et chaque nœud concerné passe en rouge avec ce qui lui manque. Un workflow actif rendu incomplet le montre de même, et le bandeau le dit (« Automation active mais incomplète »). Une erreur arrivée journal fermé met un point rouge sur le bouton du journal, jusqu'à ce qu'on l'ouvre. Interface en français et en anglais, thèmes clair et sombre, pensée pour un panneau de 700 × 400 px.

Une **prise en main** de six écrans (de vraies captures du widget, en français et en anglais) s'ouvre d'elle-même à la première ouverture, pour une personne qui peut modifier le document ; **Réglages > Aide** la rouvre quand on veut.

## Installation et configuration dans Grist

1. Dans le document, ajoutez une vue (widget) **Personnalisé** sur la table à surveiller.
2. Choisissez « URL personnalisée » et collez l'adresse du widget : `https://lombre33.github.io/GRIST_automation/`.
3. Dans le panneau de droite de la vue, sous **Niveau d'accès**, acceptez l'**accès complet au document** (pourquoi : rubrique suivante). Tant qu'il n'est pas accordé, le widget le dit à la place du graphe et n'enregistre rien ; il se recharge seul une fois l'accès accepté.
4. À la première ouverture, le widget propose de créer sa table `Automation` (voir plus bas) : acceptez pour garder le graphe et le journal dans le document.
5. Construisez le graphe (clic droit sur le fond, ou « Ajouter »), testez, puis activez. **Gardez la vue ouverte** : l'automation ne s'exécute que tant qu'un navigateur affiche cette vue, y compris si la vue du widget est réduite (vérifié dans Grist : un widget réduit continue de tourner).

Aucune colonne n'est imposée à vos tables : les listes des nœuds proposent les colonnes et les tables du document.

## Accès au document demandé : `full`

Le widget demande `requiredAccess: 'full'` (accès complet au document), parce qu'un niveau plus faible ne suffit à aucune de ces trois choses :

- **lire les tables du document**, pas seulement celle de la vue : la liste des tables et de leurs colonnes, pour les menus des nœuds ; le type d'une colonne choisie pour repérer des lignes (dans les tables `_grist_Tables` et `_grist_Tables_column` de Grist), pour reconnaître une colonne Référence ; les lignes d'une autre table pour une Recherche ou pour repérer les lignes qu'une Action modifie ;
- **écrire dans les tables que vos Actions visent** (ajout d'une ligne, modification de lignes, `applyUserActions`), y compris une autre table que celle de la vue ;
- **tenir sa table `Automation`** : la créer (une seule fois, après votre accord), y enregistrer le workflow, le journal des exécutions et le verrou qui désigne l'onglet exécutant.

Le widget ne crée, ne renomme ni ne supprime aucune autre table ou colonne, et ne supprime aucune ligne. Il n'écrit que ce que vos Actions décrivent, et seulement quand le workflow est activé.

Une personne qui n'a que la **lecture** du document voit le workflow, le déplace et le teste, sans pouvoir le modifier ni l'exécuter : c'est l'onglet d'une personne qui peut modifier le document qui l'exécute.

## Ce que le widget garde, et où

- **Dans le document Grist** : la table `Automation`, une seule pour tout le widget (`Type` = `Workflow` : le graphe et un résumé lisible, une ligne par table de vue ; `Log` : une ligne par exécution, avec l'adresse e-mail de la personne dont le navigateur a exécuté, colonne `Auteur`, formule `user.Email` ; `Lock` : le verrou d'exécution). Sans la table `Automation` (accord refusé, table inutilisable), le widget fonctionne mais ne garde pas le journal, et garde le graphe dans les options de la vue (`grist.setOption`) : Grist y voit alors une modification de la vue, à enregistrer par son bouton « Enregistrer », en haut de la vue. Avec la table, rien n'est écrit dans les options de la vue, et ce bouton n'apparaît pas ; un graphe que des options déjà enregistrées gardent (version 0.14.0 ou plus ancienne) se relit toujours.
- **Dans le navigateur**, dans `localStorage` : deux préférences d'affichage, la langue (`ab_lang`) et le thème (`ab_theme`), et la version de la prise en main déjà vue (`ab_tuto`), pour qu'elle ne s'ouvre d'elle-même qu'une fois. Un navigateur qui ne retient rien (stockage refusé, cadre de GFS) ne l'ouvre pas de lui-même : elle reviendrait à chaque chargement. Et, dans `sessionStorage`, le temps d'un rechargement de la page, l'identifiant de l'onglet pour le verrou (`ab_executor_<table>`) : un onglet rechargé reprend ainsi l'exécution tout de suite. Rien qui vienne du document.
- **Ailleurs** : rien. Le widget n'appelle aucun service ; sa politique de sécurité (`index.html`) interdit toute requête vers un autre site que le sien, hors le script de l'API Grist (les captures de la prise en main viennent du site du widget).

## Dépendances

Aucune à installer : HTML, CSS et JavaScript, sans framework, sans bibliothèque ni étape de construction.

- **`grist-plugin-api.js`**, le script de l'API des widgets, est chargé depuis `docs.getgrist.com` : c'est l'adresse validée par la DINUM pour Grist.Gouv, et le widget, publié sur GitHub Pages, ne peut pas le prendre en relatif (GitHub Pages ne le sert pas). Ce script s'évalue par `eval()`, d'où le seul assouplissement de la politique de sécurité, `'unsafe-eval'` ; le code du widget n'utilise pas `eval` (test HYG-01).
- **Le kit commun des apps Grist Factory** (`lombre33/grist-factory-kit`), en sous-module `kit/` (version 0.7.0, commit `db14544`) : il ne sert que dans Grist Factory Suite (plus bas) ; seule dans Grist, l'app ne l'utilise pas, et s'ouvre même s'il manque. Cloner avec `git clone --recursive`, ou, après un clone simple, `git submodule update --init`. GitHub Pages publie le sous-module avec le site.

## Fonctionnement et limites de la pré-alpha

- **L'automation tourne dans un navigateur.** Si aucune vue du widget n'est ouverte (une vue réduite compte comme ouverte), rien ne s'exécute, et les modifications faites entre-temps ne sont pas rattrapées à la réouverture.
- **Un seul onglet exécute** les workflows d'une table, même si le document est ouvert dans plusieurs onglets ou chez plusieurs personnes : un verrou dans la table `Automation`, renouvelé toutes les 6 secondes. Si l'onglet exécutant disparaît sans libérer le verrou (fermeture brutale, panne), un autre prend le relais au bout de 20 secondes ; les modifications faites pendant ce relais ne sont exécutées par personne. Un onglet simplement rechargé reprend tout de suite.
- **Pas de boucle** : les écritures du widget ne redéclenchent pas le workflow, et une ligne qui déclencherait trop d'exécutions rapprochées est arrêtée, avec la raison dans le journal.
- **Le déclencheur voit les lignes de la vue** : un filtre de la vue peut faire paraître une ligne créée ou supprimée quand elle entre ou sort du filtre.
- **Les colonnes sont lues table entière** (`fetchTable`) : sur de très grandes tables, l'ouverture et les Recherches sont plus lentes.
- **Un contenu que cette version ne sait pas lire** (graphe d'une version plus récente, contenu abîmé) n'est jamais écrasé : le widget l'affiche comme « Workflow conservé tel quel » et n'exécute rien à sa place. Une table `Automation` sans les colonnes attendues, ou dont le nom est déjà pris à la casse près, n'est pas utilisée : le journal dit pourquoi.
- **Navigateurs** : testé sous Chromium, avec une API Grist simulée et dans un vrai Grist (`docs/TESTS_GRIST_REEL.md` liste les essais à refaire à la main).

## Dans Grist Factory Suite (GFS)

Quand GFS ouvre l'app dans l'un de ses cadres (`?gfs=<n>` dans l'adresse), l'app parle à GFS par le lien du kit commun et en prend deux choses ; seule, dans Grist, rien de cela ne joue.

- **La barre de GFS** se pose par-dessus le cadre, au bord que la personne choisit. L'app laisse libre la zone que GFS donne (`js/keep-clear.js`) : la barre d'outils se partage autour d'elle quand la barre est en haut ; le journal, le menu d'ajout, les listes et les bulles qui la recouvriraient s'en écartent du juste nécessaire ; une fenêtre se place dans le reste du cadre.
- **L'ambiance** que la personne a choisie dans GFS : le kit pose les jetons de couleur et de forme sur `<html>` (`js/gfs.js`), les feuilles de `css/` les lisent, jamais une couleur écrite en dur. Le rouge de l'échec et l'ambre de l'avertissement restent ceux de l'app (HYG-17).

La langue de GFS n'est pas encore suivie : les boutons FR et EN des Réglages restent actifs.

## Organisation du code

| Fichier | Rôle |
|---|---|
| `js/nodes.js` | types de nœuds (champs, broches) |
| `js/graph.js` | modèle du graphe : liens, validation, lecture, résumé (sans DOM) |
| `js/engine.js` | moteur : détection des événements, parcours du graphe, test à blanc (sans DOM ni Grist) |
| `js/store.js` | table `Automation` : workflow, journal, verrou |
| `js/executor.js`, `js/echo.js` | un seul onglet exécutant ; les écritures du widget ne le redéclenchent pas |
| `js/canvas.js`, `js/canvas-fields.js` | canevas nodal (déplacement, zoom, nœuds, liens) et champs des nœuds |
| `js/main.js` | branchement sur l'API Grist : accès, lecture seule, sauvegarde, exécution |
| `js/i18n.js`, `js/i18n-texts.js`, `js/theme.js` | langue et textes fr/en, thèmes |
| `js/modal.js`, `js/search-select.js` | fenêtres et listes avec recherche |
| `js/tutorial.js`, `img/tuto/` | prise en main : six écrans, leurs captures fr et en |
| `js/gfs.js`, `js/keep-clear.js`, `kit/` | lien avec GFS : l'ambiance (par le kit) et la zone de la barre à laisser libre |
| `css/` | jetons de la charte, styles, canevas, fenêtres, prise en main |

Périmètre : `docs/CDC_Widget_Grist_Automation_Builder.md`. Règles d'interface et de développement : `docs/REGLES_UI_UX_ET_DEV.md`. Sécurité : `SECURITY.md`.

## Tests

```
npm test            # unitaires et vérifications statiques, sans dépendance (Node)
npm run test:e2e    # scénarios dans Chromium avec une API Grist simulée, dont l'app dans un faux GFS (tests/e2e/gfs-host.html)
npm run tutorial:shots   # refait les captures de la prise en main (img/tuto/), à relire avant de pousser
```

`test:e2e` et `tutorial:shots` demandent Playwright, installé hors du dépôt (variable `PLAYWRIGHT_PATH` si besoin) ; ce qu'ils partagent (le site servi, l'API simulée, les gestes sur le canevas) est dans `tests/e2e/harness.mjs`. Les captures sont à refaire quand l'interface qu'elles montrent change. `E2E_ONLY='E2E-4[5-9]'` n'en joue qu'une partie ; `E2E_SHOTS=<dossier>` range des captures d'écran des scénarios dans GFS. Les tests qui lisent le kit (HYG-14 à 17, E2E-36 à 44) demandent le sous-module récupéré. Plan des tests : `docs/PLAN_TESTS.md` ; essais dans un vrai Grist : `docs/TESTS_GRIST_REEL.md`.

## Licence

GNU GPL v3.0 (`LICENSE`). Grist Factory, [grist-factory.fr](https://grist-factory.fr).
