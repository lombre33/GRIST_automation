# Grist Automation Builder

Widget Grist d'automatisation sans code : quand une ligne est créée, modifiée ou supprimée, des conditions sont vérifiées et des actions écrivent dans le document. Tout s'exécute dans le navigateur, sans serveur ni appel externe. Édité par Grist Factory, licence GNU GPL v3.0.

> **Pré-alpha publique.** Le widget fonctionne seul dans une vue « Personnalisé » de Grist. Essayez-le d'abord sur une copie de votre document : une action mal réglée écrit dans vos tables. Les retours sont bienvenus (onglet Issues du dépôt).

## À quoi sert ce widget

On dessine un graphe de nœuds reliés, pour la table de la vue :

- **Déclencheur** : une ligne est créée, modifiée ou supprimée ; pour une modification, on peut surveiller une colonne, ou une seule ligne repérée par une clé.
- **Condition** : une ou plusieurs vérifications (colonne, opérateur, valeur) reliées par ET ou par OU, avec une sortie « Oui » et une sortie « Sinon ». Plusieurs conditions à la suite valent un ET. Un texte ou une case à cocher se compare au texte tapé (un code `01000`, `true` ou `false` pour une case), un nombre au nombre tapé.
- **Lecture** : va chercher une cellule d'une autre table (ligne repérée par une clé) et la rend disponible sous `{nom}`, par exemple le seuil d'un service pour le comparer à un montant.
- **Transformation** : calcule une valeur (accoler deux textes, + − × ÷, majuscules, minuscules, espaces retirés) et la rend disponible sous `{nom}`.
- **Action** : ajoute une ligne, ou met à jour une ligne, dans la table de la vue ou dans une autre (la ligne est alors repérée par une colonne clé). Les valeurs acceptent `{Colonne}` et les `{nom}` des nœuds précédents.

Exemple : « quand le Statut d'un projet passe à Clos, ajouter une ligne dans Archive avec le nom du projet ».

Sur le canevas : clic droit sur le fond (ou « Ajouter ») pour un nœud ; un lien se tire de la sortie d'un nœud jusqu'à l'entrée d'un autre, et, lâché sur le fond, il ouvre le menu d'ajout : le nœud choisi s'y pose, déjà relié. La largeur d'un nœud se règle en tirant son bord droit (au clavier, Maj + flèches gauche et droite sur son titre ; double-clic sur le bord pour la largeur d'origine) ; elle est gardée avec le workflow. La molette zoome, un glisser du fond déplace la vue.

« Tester » simule le graphe sur la ligne sélectionnée dans Grist (sinon la première de la vue), sans rien écrire, et montre l'état de chaque nœud. « Activer » refuse tant que le graphe est incomplet et dit pourquoi dans le journal. Interface en français et en anglais, thèmes clair et sombre, pensée pour un panneau de 700 × 400 px.

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

- **lire les tables du document**, pas seulement celle de la vue : la liste des tables et de leurs colonnes, pour les menus des nœuds ; les lignes d'une autre table pour une Lecture ou pour repérer la ligne qu'une Action met à jour ;
- **écrire dans les tables que vos Actions visent** (ajout ou mise à jour d'une ligne, `applyUserActions`), y compris une autre table que celle de la vue ;
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
- **Le kit commun des apps Grist Factory** (`lombre33/grist-factory-kit`), en sous-module `kit/` (version 0.9.0, commit `eaa2ae2`) : il ne sert que dans Grist Factory Suite (plus bas) ; seule dans Grist, l'app ne l'utilise pas, et s'ouvre même s'il manque. Cloner avec `git clone --recursive`, ou, après un clone simple, `git submodule update --init`. GitHub Pages publie le sous-module avec le site.

## Fonctionnement et limites de la pré-alpha

- **L'automation tourne dans un navigateur.** Si aucune vue du widget n'est ouverte (une vue réduite compte comme ouverte), rien ne s'exécute, et les modifications faites entre-temps ne sont pas rattrapées à la réouverture.
- **Un seul onglet exécute** les workflows d'une table, même si le document est ouvert dans plusieurs onglets ou chez plusieurs personnes : un verrou dans la table `Automation`, renouvelé toutes les 6 secondes. Si l'onglet exécutant disparaît sans libérer le verrou (fermeture brutale, panne), un autre prend le relais au bout de 20 secondes ; les modifications faites pendant ce relais ne sont exécutées par personne. Un onglet simplement rechargé reprend tout de suite.
- **Pas de boucle** : les écritures du widget ne redéclenchent pas le workflow, et une ligne qui déclencherait trop d'exécutions rapprochées est arrêtée, avec la raison dans le journal.
- **Le déclencheur voit les lignes de la vue** : un filtre de la vue peut faire paraître une ligne créée ou supprimée quand elle entre ou sort du filtre. Un workflow actif réagit à toute ligne que la vue reçoit, d'où qu'elle vienne (formulaire public, autre personne, API), avec les droits de la personne dont l'onglet exécute ; la valeur d'une ligne n'est jamais lue comme du code (`SECURITY.md`).
- **Les colonnes sont lues table entière** (`fetchTable`) : sur de très grandes tables, l'ouverture et les Lectures sont plus lentes.
- **Un contenu que cette version ne sait pas lire** (graphe d'une version plus récente, contenu abîmé) n'est jamais écrasé : le widget l'affiche comme « Workflow conservé tel quel » et n'exécute rien à sa place. Une table `Automation` sans les colonnes attendues, ou dont le nom est déjà pris à la casse près, n'est pas utilisée : le journal dit pourquoi.
- **Navigateurs** : testé sous Chromium, avec une API Grist simulée et dans un vrai Grist (`docs/TESTS_GRIST_REEL.md` liste les essais à refaire à la main).

## Dans Grist Factory Suite (GFS)

Quand GFS ouvre l'app dans l'un de ses cadres (`?gfs=<n>` dans l'adresse), l'app parle à GFS par le lien du kit commun et en prend trois choses ; seule, dans Grist, rien de cela ne joue.

- **La barre de GFS** se pose par-dessus le cadre, au bord que la personne choisit. L'app laisse libre la zone que GFS donne (`js/keep-clear.js`) : la barre d'outils se partage autour d'elle quand la barre est en haut ; le journal, le menu d'ajout, les listes et les bulles qui la recouvriraient s'en écartent du juste nécessaire ; une fenêtre se place dans le reste du cadre.
- **L'ambiance** que la personne a choisie dans GFS : le kit pose les jetons de couleur et de forme sur `<html>` (`js/gfs.js`), les feuilles de `css/` les lisent, jamais une couleur écrite en dur. Le rouge de l'échec et l'ambre de l'avertissement restent ceux de l'app (HYG-17).
- **La fermeture** : avant de détruire le cadre de l'app (la personne ouvre une autre app, un autre fichier, un import, un lien), GFS lui demande si elle peut partir (`fermer`) et ne le détruit qu'après son oui (`js/closing.js`). Ce qui peut attendre, c'est le graphe modifié (écrit 300 ms après la dernière modification) et les écritures en cours dans le document, celles d'un workflow actif comprises : l'app les enregistre, les laisse finir, rend le verrou d'exécution à l'onglet suivant, puis répond oui sans question. Elle ne pose sa question (« Enregistrer, Abandonner, Annuler ») que si l'écriture échoue ; Annuler et Échap la gardent ouverte. En lecture seule, ou quand rien n'attend, le oui est immédiat. Un workflow actif n'empêche pas de partir : il passe la main à un autre onglet.

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
| `js/gfs.js`, `js/keep-clear.js`, `kit/` | lien avec GFS : l'ambiance (par le kit), la zone de la barre à laisser libre et le branchement de `fermer` |
| `js/closing.js` | réponse à `fermer` : enregistrer ce qui attend, laisser finir les écritures, rendre le verrou, ne poser la question que si l'écriture échoue (sans DOM ni Grist) |
| `css/` | jetons de la charte, styles, canevas, fenêtres, prise en main |

Périmètre : `docs/CDC_Widget_Grist_Automation_Builder.md`. Règles d'interface et de développement : `docs/REGLES_UI_UX_ET_DEV.md`. Sécurité : `SECURITY.md`.

## Tests

```
npm test            # unitaires et vérifications statiques, sans dépendance (Node)
npm run test:e2e    # scénarios dans Chromium avec une API Grist simulée, dont l'app dans un faux GFS (tests/e2e/gfs-host.html)
npm run tutorial:shots   # refait les captures de la prise en main (img/tuto/), à relire avant de pousser
```

`test:e2e` et `tutorial:shots` demandent Playwright, installé hors du dépôt (variable `PLAYWRIGHT_PATH` si besoin) ; ce qu'ils partagent (le site servi, l'API simulée, les gestes sur le canevas) est dans `tests/e2e/harness.mjs`. Les captures sont à refaire quand l'interface qu'elles montrent change. `E2E_ONLY='E2E-4[5-9]'` n'en joue qu'une partie ; `E2E_SHOTS=<dossier>` range des captures d'écran des scénarios dans GFS. Les tests qui lisent le kit (HYG-14 à 17, E2E-36 à 44, E2E-63 à 68) demandent le sous-module récupéré. Plan des tests : `docs/PLAN_TESTS.md` ; essais dans un vrai Grist : `docs/TESTS_GRIST_REEL.md`.

## Licence

GNU GPL v3.0 (`LICENSE`). Grist Factory, [grist-factory.fr](https://grist-factory.fr).
