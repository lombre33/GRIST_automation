# GFS-ETAT : Automation+ (Grist Automation Builder)

Mis à jour le 2026-10-22, au commit `6eb0165` (le dernier commit de code que cette page décrit).

## Consignes
- 001 · faite · `e356021` · écarts à la 1.1 relevés dans le code existant : règles 2, 3, 4 et 12 ; corrigés à `6eb0165` : 3, 4 et 12 (sauf le logo) ; restent la règle 2 et le logo ; les neuf autres sont respectées ou sans objet
  - 2 (reste) : le graphe entier est aussi gardé dans les réglages de la vue (clé `workflow`, sans préfixe, `js/main.js`) ; la table s'appelle `Automation`, sans le « _ » final du préfixe (contrats 2.3) ; rien n'est changé sans consigne : c'est le « premier pas » que la consigne 001 (point 3) laisse de côté
  - 3 (corrigé à `6eb0165`) : un graphe que cette version ne sait pas lire (version autre que 2 et 3, type de nœud inconnu, JSON abîmé) n'est plus réécrit : le widget affiche « Workflow conservé tel quel », grise Ajouter, Tester et Activer, n'écrit ni dans `Automation` ni dans les réglages de la vue, et n'exécute rien à sa place (`readGraph` et `saveGraph` de `js/store.js`, `lockWorkflow` de `js/main.js` ; tests GFS-11 à 13, E2E-27 à 29, 34 et 35) ; les clés inconnues de la racine du graphe, et les attributs inconnus des nœuds, de leur config et des liens, survivent à l'enregistrement (GFS-10) ; les colonnes inconnues et les lignes d'un autre `Type` de `Automation` sont tolérées et jamais réécrites (GFS-07) ; limite : les liens vers un nœud absent, ou issus d'une sortie que le type du nœud n'a pas, sont écartés à la relecture (GRAPH-10 et 15)
  - 4 (corrigé à `6eb0165`) : un nom de table pris à la casse près est refusé avant l'`AddTable` (GFS-01) ; l'identifiant réel est relu après, par `listTables`, et une table que Grist a nommée autrement n'est pas utilisée (GFS-02) ; `saveGraph`, `appendLog` et `writeLock` n'écrivent que dans des colonnes qui existent, refusent d'écrire quand une colonne indispensable manque (`Type`, `Table`, `Config`, `Date`, `Evenement`, `Resultat`, selon la ligne) et relisent les colonnes après un échec d'écriture (GFS-04 à 06) ; la table est vérifiée au démarrage (E2E-30 et 31) ; la création de la table reste soumise à l'accord de la personne
  - 12 (corrigé à `6eb0165`, sauf le logo) : jetons `--z-*` dans `css/tokens.css`, plus aucun `z-index` en dur (HYG-10) ; le vert `--good` est supprimé, le résultat d'un test à blanc passe à l'accent bleu (HYG-11, E2E-32) ; reste le logo discret en haut à droite (cahier 3.4), qui attend son fichier
  - pour mémoire, règle 5 respectée : `document.referrer` n'est jamais lu ; une seule fonction, `widgetAddress()` (`js/main.js`), lit l'adresse de la page, pour l'afficher quand le widget est ouvert hors de Grist
  - ligne « Automation+ » du guide, relevé à `f5e4100` : juste, sauf « Premier client du kit » (colonne « Premier pas »), périmé depuis le 16/10 : c'est Form+ (cahier 4.5), Automation+ vient après Publipostage+ ; précision : `Auteur` est une formule déclenchée (à la création de la ligne), avec repli sans formule si Grist la refuse
- 002 · faite · `e356021` · `LICENSE` ajouté, texte officiel de la GPL 3.0, SHA-256 `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`
- 003 · lue · la barre de GFS recouvre « Ajouter » (barre en haut) et le début du journal (barre en bas) ; rien ne change avant le lot qui prend le lien avec GFS du kit (guide 1.2, point 4) : `GfsLink.onBar` écartera alors la barre d'outils (haut) et le journal (bas), puis les menus et fenêtres se caleront sur la zone libre, jamais écrite en dur

## Changements qui touchent GFS
- 2026-10-21 · `6eb0165` · règles 3, 4 et 12 du guide corrigées (0.11.1), même table `Automation` et mêmes colonnes :
  - lectures en plus : `listTables` avant et après l'`AddTable` (identifiant réel), et une lecture de `Automation` au démarrage pour vérifier ses colonnes ; écritures inchangées (`AddRecord`, `UpdateRecord`, `AddTable`), mais jamais dans une colonne absente
  - réglages de la vue : toujours la seule clé `workflow`, désormais écrite après l'enregistrement dans `Automation`, jamais avant la fin du démarrage et jamais quand le contenu enregistré est illisible pour cette version
  - interface : « Workflow conservé tel quel » à la place du canevas dans ce dernier cas ; jetons `--z-*` ; le vert du test à blanc devient le bleu d'accent ; trois messages du journal en plus (nom de table pris, identifiant changé par Grist, colonnes absentes), en français et en anglais
  - ni bibliothèque, ni adresse de la CSP, ni clé de stockage du navigateur, ni table `_grist_*` de plus
- 2026-10-21 · `9b19567` · état de départ de cette page, tout ce que GFS suit (version 0.11.0, aucune étiquette) :
  - table `Automation`, créée avec l'accord de la personne ; colonnes `Type` (`Workflow`, `Log` ou `Lock`), `Table`, `Date`, `Actif`, `Version`, `Resume`, `Config`, `Evenement`, `Ligne`, `Resultat`, `Detail`, `Auteur` (formule déclenchée `user.Email`)
  - réglages de la vue : la seule clé `workflow`, écrite après un geste (modifier le graphe, l'activer, accepter la table) ; aucune table `_grist_*` lue ni écrite ; ni jeton d'accès ni `CreateViewSection`
  - accès `full` ; lit (`listTables`, `fetchTable`, `onRecords`, `onRecord`) et écrit (`AddRecord`, `UpdateRecord`) des tables de la personne selon le graphe (`*`), plus `AddTable` pour `Automation`
  - aucune bibliothèque ; seul script externe, `https://docs.getgrist.com/grist-plugin-api.js`, avec `'unsafe-eval'` à cause de lui (`SECURITY.md`)
  - stockage du navigateur : `ab_lang` et `ab_theme`, dans des `try/catch` ; actions ouvrir, choisir, insérer, fermer : aucune ; pas de `gfs.json`
- 2026-10-21 · `064edcf` · lignes `Type = Lock` dans `Automation` : verrou d'exécution entre onglets, une par table de vue, relais après 20 s (0.6.2)
- 2026-10-21 · `5a166f4` · une seule table, `Automation`, remplace `Automation_Workflows` et `Automation_Logs` : les deux anciennes ne sont plus créées ni lues, et ne sont pas migrées (0.6.1)
- 2026-10-21 · `7dae9e3` · première table dans le document, avec l'accord de la personne : `Automation_Workflows` et `Automation_Logs`, `Auteur` en formule déclenchée (0.6.0)

## Questions pour GFS
- aucune

## Demandes à GFS
- aucune
