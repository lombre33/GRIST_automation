# GFS-ETAT : Automation+ (Grist Automation Builder)

Mis à jour le 2026-10-21, au commit `9b19567` (le dernier commit de code que cette page décrit).

## Consignes
- 001 · faite · `e356021` · écarts à la 1.1 dans le code existant : règles 2, 3, 4 et 12 ; les neuf autres sont respectées ou sans objet
  - 2 : le graphe entier est aussi gardé dans les réglages de la vue (clé `workflow`, sans préfixe, `js/main.js`) ; la table s'appelle `Automation`, sans le « _ » final du préfixe (contrats 2.3)
  - 3 : `Graph.parse` (`js/graph.js`) refuse tout le graphe dont un nœud est de type inconnu ou dont la version n'est ni 2 ni 3 (tests GRAPH-09 et STORE-07), et l'enregistrement suivant écrase la ligne `Workflow` ; les clés inconnues de la racine du graphe et les liens à sortie inconnue sont perdus à la relecture ; les colonnes inconnues et les lignes d'un autre `Type` de `Automation` sont tolérées et jamais réécrites
  - 4 : l'identifiant réel n'est pas relu après l'`AddTable` (`ensureTables`, `js/store.js`) ; `saveGraph`, `appendLog` et `writeLock` écrivent sans vérifier que les colonnes de `Automation` existent encore (l'erreur est alors journalisée dans le widget)
  - 12 : pas de logo (cahier 3.4) ; `z-index` en dur (`css/canvas.css`, `css/modal.css`, `css/style.css`), sans jetons `--z-*` ni couches ; le vert `--good` (résultat d'un test à blanc) n'est pas dans la palette que résume le cahier 3.4
  - pour mémoire, règle 5 respectée : `document.referrer` n'est jamais lu ; une seule fonction, `widgetAddress()` (`js/main.js`), lit l'adresse de la page, pour l'afficher quand le widget est ouvert hors de Grist
  - ligne « Automation+ » du guide, relevé à `f5e4100` : juste, sauf « Premier client du kit » (colonne « Premier pas »), périmé depuis le 16/10 : c'est Form+ (cahier 4.5), Automation+ vient après Publipostage+ ; précision : `Auteur` est une formule déclenchée (à la création de la ligne), avec repli sans formule si Grist la refuse
- 002 · faite · `e356021` · `LICENSE` ajouté, texte officiel de la GPL 3.0, SHA-256 `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`

## Changements qui touchent GFS
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
