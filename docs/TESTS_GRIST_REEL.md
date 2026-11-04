# Tests à jouer dans un vrai Grist

Liste de scénarios manuels, à jouer par Antoine sur son Grist (instance Grist.Gouv) avec le document décrit dans `docs/GRIST_TEST_DOC.md`. Ils complètent les tests automatiques (`npm test`, `npm run test:e2e`), qui tournent sur une API Grist simulée et ne peuvent pas voir ce que fait vraiment Grist (droits, vues filtrées, plusieurs onglets, politique de sécurité de l'instance).

**Règle de maintenance** : chaque fonctionnalité livrée ajoute ses scénarios ici (colonne « Depuis » = version ou fonctionnalité), adapte ceux qu'elle change et marque « Retiré » ceux qui n'ont plus de sens. Le message de livraison renvoie à la liste des scénarios nouveaux ou modifiés, à jouer en priorité.

**Comment jouer** : ouvrir le widget sur la table `Contacts` (accès complet au document). Noter le résultat dans la dernière colonne : ✅ conforme, ❌ écart (décrire en une ligne), ➖ non joué. Quand un scénario décrit une limite connue, « conforme » veut dire que le comportement décrit est observé.

## Journal des campagnes

| Date | Version du widget (Réglages > Crédits) | Testeur | ✅ | ❌ | ➖ | Remarques |
|---|---|---|---|---|---|---|
| 2026-11-04 | 0.16.0, copie du dépôt servie à part | Claude, joué par un script (Chromium) dans un Grist officiel local (image `gristlabs/grist`), pas Grist.Gouv | 4 | 0 | le reste | Le cas d'Antoine, sans Condition : CAS-01 ✅ (deux tâches à B = 2, la troisième intacte), CAS-02 ✅ (`{id}` rempli seul : le type de colonne se lit bien dans `_grist_Tables_column`), INC-02 ✅ (bandeau rouge et Action marquée), INC-03 ✅ (point rouge, puis effacé à l'ouverture). À rejouer sur Grist.Gouv, depuis l'adresse en ligne |
| 2026-11-04 | 0.15.0, copie du dépôt servie à part | Claude, joué par un script (Chromium) dans un Grist officiel local (image `gristlabs/grist`), pas Grist.Gouv | 8 | 0 | le reste | SAVE-03 ✅ (aucun bouton « Enregistrer » après un fil lâché, le graphe, Activer, une largeur, Désactiver, Réactiver ; aucune clé `workflow` dans les réglages enregistrés de la vue), SAVE-04 ✅ (sans la table, le bouton apparaît), LINK-06 ✅ (menu sans Déclencheur, entrée posée au point de chute), NODE-06 ✅ (332 px, retrouvés au rechargement), CHK-05 ✅ (une vraie colonne Booléen comparée à true), RUN-13 ✅ (réduite, puis rechargée réduite : exécuté), UI-05 ✅ (« pré-alpha 0.15.0 »), START-03 ✅. À rejouer sur Grist.Gouv, depuis l'adresse en ligne |
| 2026-11-04 | 0.14.0, copie du dépôt servie à part | Claude, joué par un script (Chromium) dans un Grist officiel local (image `gristlabs/grist`), pas Grist.Gouv | 5 | 0 | le reste | Prise en main : TUTO-01, TUTO-03, TUTO-04, TUTO-05 et TUTO-07 ✅ (après la question de la table, captures chargées depuis le site du widget sans erreur de politique de sécurité, retenue au rechargement, Réglages > Aide par-dessus les Réglages, lectrice sans ouverture d'elle-même). À rejouer sur Grist.Gouv, depuis l'adresse en ligne |
| 2026-11-04 | 0.12.0 puis 0.13.0, copie du dépôt servie à part | Claude, joué par un script (Chromium) dans un Grist officiel local (image `gristlabs/grist`), pas Grist.Gouv | 8 | 0 | le reste | En 0.12.0 : START-03 ❌ (deux erreurs de politique de sécurité à chaque ouverture, le thème de Grist), START-04 ❌ (en lecture seule, une erreur « No write access » dans le journal toutes les 6 s), rechargement de l'onglet exécutant ❌ (environ 25 s à « un autre onglet l'exécute », et la modification faite entre-temps jamais exécutée), accès pas encore accordé ❌ (le widget avait l'air de marcher et n'enregistrait rien). Tous corrigés en 0.13.0 et rejoués ✅ : START-01, START-03, START-04, START-06, EXE-07, RUN-01, DRY-01, LOG (journal avec l'adresse e-mail). À rejouer sur Grist.Gouv, depuis l'adresse en ligne |

## Démarrage et accès

| ID | Depuis | Scénario | Étapes | Attendu | Résultat |
|---|---|---|---|---|---|
| START-01 | V0.5 | Ouverture normale | Ajouter une vue « Personnalisé » sur Contacts, coller l'adresse du widget, choisir l'accès complet | Grist demande l'accès au document ; après acceptation, un fond uni avec l'invite « Clic droit sur le fond… », aucune fenêtre d'erreur ; console sans erreur | ➖ |
| START-06 | V0.13.0 | Accès pas encore accordé | Ajouter une vue « Personnalisé », coller l'adresse, ne rien choisir dans « Niveau d'accès » ; puis, dans le panneau de droite de la vue, cliquer « Accepter » | D'abord, à la place du graphe : « Le widget a besoin de l'accès complet au document », avec la marche à suivre ; Ajouter, Tester et Activer grisés ; aucune question. Après « Accepter » : le widget se recharge seul et propose de créer sa table | ➖ |
| START-07 | V0.13.0 | Accès refusé, puis donné par la liste | Dans le panneau de droite, cliquer « Refuser » ; puis choisir « Accès complet au document » dans la liste « Niveau d'accès » ; essayer aussi « Lecture de la table sélectionnée » | Le message reste tant que l'accès n'est pas complet (lecture de la table comprise) ; avec l'accès complet, le widget repart seul | ➖ |
| START-02 | V0.5 | Page ouverte hors de Grist | Ouvrir l'adresse du widget directement dans un onglet | Fenêtre « Ouvrez ce widget depuis Grist » avec l'adresse et un bouton Copier | ➖ |
| START-03 | V0.13.0 (modifié) | Politique de sécurité | Ouvrir la console et l'onglet Réseau, recharger ; changer le thème de Grist (Paramètres du compte > Apparence : sombre), recharger | Aucune erreur de politique de sécurité (en 0.12.0, deux à chaque ouverture : « Applying inline style violates… ») ; seule requête hors du widget : `docs.getgrist.com/grist-plugin-api.js` ; Grist en sombre et widget en clair : les barres de défilement et les listes du widget restent claires | ➖ |
| START-04 | V0.13.0 (modifié) | Lecture seule | Activer un workflow avec un compte qui peut modifier, puis ouvrir la page du widget avec un compte qui n'a que la lecture du document ; attendre une minute, ouvrir le journal | Bandeau « Lecture seule : vous voyez ce workflow et pouvez le tester… » ; pas de bandeau « Automation active » ; Ajouter et Activer grisés, Tester actif ; les champs des nœuds grisés, le fond se déplace et se zoome, un nœud ne se déplace pas ; aucune erreur « No write access » dans le journal ; la table `Automation` ne change pas | ➖ |
| START-05 | V0.11.1 | Site en ligne à jour | Ouvrir `https://lombre33.github.io/GRIST_automation/js/version.js` dans un onglet (attendre 10 minutes après un envoi : cache de GitHub Pages), puis comparer à Réglages > Crédits d'un widget ouvert par son adresse | Le numéro est celui de `package.json`, partout le même ; s'il est plus ancien, la publication a échoué (onglet Actions du dépôt, « pages build and deployment ») | ➖ |

## Construire le graphe

| ID | Depuis | Scénario | Étapes | Attendu | Résultat |
|---|---|---|---|---|---|
| NODE-01 | V0.5 | Ajouter des nœuds | Clic droit sur le fond, taper « Décl », Entrée ; recommencer avec « Cond » et « Act » via le bouton Ajouter | Trois nœuds apparaissent là où on a cliqué (le bouton place au centre), le dernier est sélectionné | ➖ |
| NODE-02 | V0.5 | Colonnes proposées | Dans le déclencheur, ouvrir « Colonne surveillée » | Les colonnes de Contacts (Nom, Email, Statut, Montant, Date, Service, Cle), sans id, manualSort ni colonne technique ; la recherche trouve « stat » et « statut » | ➖ |
| NODE-03 | V0.16.0 (modifié) | Tables proposées | Dans l'action, ouvrir « Dans la table » | Contacts, Services, Archive ; « — Table de la vue — » en premier ; aucune table `Automation_` | ➖ |
| NODE-04 | V0.16.0 (modifié) | Colonnes de la cible | Choisir Archive dans « Dans la table », ouvrir « Colonne à remplir » | Les colonnes d'Archive (Nom, Motif, Source), plus celles de Contacts | ➖ |
| NODE-05 | V0.7 (modifié) | Opérateurs sans valeur | Dans une vérification de la condition, choisir « est vide » | Le champ Valeur de cette vérification est grisé, pas masqué | ➖ |
| LINK-01 | V0.5 | Lien en glissant | Glisser de la sortie du déclencheur vers l'entrée de la condition | Un lien courbe apparaît ; pendant le glissement, les entrées possibles sont mises en évidence | ➖ |
| LINK-02 | V0.7 (modifié) | Lien au clic | Cliquer la sortie « Oui » de la condition, puis l'entrée de l'action | Lien créé ; Échap pendant l'attente l'annule | ➖ |
| LINK-03 | V0.5 | Liens refusés | Essayer de relier une action vers une condition, une sortie vers le déclencheur, une condition à elle-même, et fermer un cycle entre deux conditions | Aucun lien créé, sans message d'erreur ni plantage | ➖ |
| LINK-04 | V0.5 | Une entrée, un lien | Relier deux nœuds différents à la même entrée | Le nouveau lien remplace l'ancien | ➖ |
| LINK-05 | V0.5 | Suppression | Cliquer un lien puis Suppr ; supprimer un nœud avec sa corbeille | Le lien disparaît ; le nœud part avec ses liens | ➖ |
| NAV-01 | V0.5 | Déplacer et zoomer | Glisser le fond, molette, glisser l'en-tête d'un nœud | Le fond bouge, le zoom se fait autour du pointeur (de 40 % à 160 %), le nœud suit la souris | ➖ |
| LINK-06 | V0.15.0 | Fil lâché sur le fond | Glisser depuis la sortie du déclencheur et relâcher sur le fond vide ; taper « cond », Entrée. Recommencer depuis la sortie « Sinon » de la condition, choisir Action ; puis relâcher un fil près du bas à droite, et appuyer sur Échap ; enfin relâcher un fil et cliquer ailleurs | Au relâchement, le menu d'ajout s'ouvre au bout du fil, sans « Déclencheur » ; le nœud choisi s'y pose, son entrée au bout du fil, déjà relié (en pointillés depuis « Sinon ») ; près du bord, le menu reste entier (il s'ouvre vers le haut près du bas) ; Échap ou un clic ailleurs : le fil disparaît, rien n'est ajouté | ➖ |
| NODE-06 | V0.15.0 | Largeur d'un nœud | Tirer le bord droit d'un nœud vers la droite, puis loin vers la gauche ; Tab jusqu'au titre du nœud, Maj + flèche droite, Maj + flèche gauche ; double-clic sur le bord ; recharger la page ; ouvrir le document avec un compte en lecture seule | Au survol du bord, un trait d'accent et une flèche double ; la largeur suit la souris, de 200 à 600 px, et les liens suivent ; Maj + flèche : 20 px de plus ou de moins ; double-clic : la largeur d'origine ; après rechargement, chaque nœud garde sa largeur ; en lecture seule, les largeurs sont là mais le bord ne se tire pas | ➖ |

## Exécution

Pour RUN-01 à RUN-09, construire d'abord : Déclencheur « modifiée », colonne Statut → Condition Statut est égal à Clos → Action « Ajouter une ligne » dans Archive, colonne Motif = « clos ». Cliquer Activer.

| ID | Depuis | Scénario | Étapes | Attendu | Résultat |
|---|---|---|---|---|---|
| RUN-01 | V0.5 | Modification qui déclenche | Passer le Statut d'un contact à Clos | Une ligne apparaît dans Archive avec Motif = clos ; le journal indique « modification ligne N : réussi » | ➖ |
| RUN-02 | V0.5 | Condition fausse | Passer le Statut à « En cours » | Aucune écriture, aucune ligne de journal | ➖ |
| RUN-03 | V0.5 | Autre colonne modifiée | Modifier Nom avec la colonne surveillée = Statut | Aucun déclenchement | ➖ |
| RUN-04 | V0.5 | Création | Déclencheur « créée », condition Montant supérieur à 100, action Ajouter dans Archive. Ajouter un contact à 50 puis un à 500 | Seul le contact à 500 écrit dans Archive | ➖ |
| RUN-05 | V0.5 | Suppression | Déclencheur « supprimée » sans condition, action Ajouter dans Archive. Supprimer un contact | Une ligne dans Archive. Avec une condition ajoutée : erreur claire « Condition impossible sans contenu de ligne » (le contenu d'une ligne supprimée n'est pas connu) | ➖ |
| RUN-06 | V0.16.0 (modifié) | Mise à jour de la ligne, sans boucle | Action « Modifier des lignes » (table de la vue, « — La même ligne — »), colonne Statut = « Clos », déclencheur « modifiée » sur Statut. Passer le Statut à En cours | La ligne passe à Clos, UNE seule exécution dans le journal (l'écriture du widget ne se relance pas) | ➖ |
| RUN-07 | V0.5 | Vue filtrée (limite connue) | Filtrer la vue sur Statut = En cours, puis passer un contact à Clos | Limite connue : le contact sort de la vue ; noter si un faux événement « suppression » ou « création » se déclenche | ➖ |
| RUN-08 | V0.6.2 (modifié) | Deux onglets | Ouvrir le document dans deux onglets avec le widget actif (tables créées), modifier un Statut | Une seule ligne écrite dans Archive ; un onglet affiche le bandeau « un autre onglet l'exécute » (voir EXE-*) | ➖ |
| RUN-09 | V0.5 | Table cible disparue | Supprimer ou renommer la table Archive, modifier un Statut | Message d'erreur lisible dans le journal, pas de plantage | ➖ |
| RUN-10 | V0.5 | Type incompatible | Action qui écrit « abc » dans une colonne numérique (Montant) | Comportement de Grist noté ; le widget n'affiche pas « réussi » si Grist refuse | ➖ |
| RUN-11 | V0.5 | Valeurs piégées | Écrire `<script>alert(1)</script>` puis `=1+1` depuis une action | Les valeurs sont écrites comme texte, rien ne s'exécute dans l'interface | ➖ |
| RUN-12 | V0.5 | Droits d'écriture | Compte sans droit d'écriture sur Archive, déclencher | Erreur lisible dans le journal | ➖ |
| RUN-13 | V0.15.0 | Vue du widget réduite | Activer, réduire le widget (menu de la vue > « Réduire la vue »), passer un contact à Clos dans une autre vue de la page ; recharger la page, widget toujours réduit, et recommencer | Le bandeau, avant de réduire, dit « … y compris si la vue du widget est réduite » ; les deux modifications sont exécutées (Archive et journal), la seconde aussi après le rechargement | ➖ |

## Exécution unique et anti-boucle

Prérequis : table `Automation` créée, graphe de base activé.

| ID | Depuis | Scénario | Étapes | Attendu | Résultat |
|---|---|---|---|---|---|
| EXE-01 | V0.6.2 | Un seul exécutant | Ouvrir le document dans deux onglets, activer le workflow dans le premier, recharger le second | Le second affiche « Automation active : un autre onglet l'exécute pour le moment… » ; une ligne `Lock` apparaît dans `Automation` pour `Contacts` | ➖ |
| EXE-02 | V0.6.2 | Pas de doublon | Dans le document, passer un Statut à Clos | Une seule ligne dans Archive et une seule ligne `Log` | ➖ |
| EXE-03 | V0.6.2 | Relais à la fermeture | Fermer l'onglet exécutant (fermer vraiment, pas juste changer d'onglet), attendre jusqu'à 25 s, modifier un Statut | Le second onglet affiche « Cet onglet exécute maintenant l'automation » et écrit dans Archive. Noter le délai observé | ➖ |
| EXE-04 | V0.6.2 | Libération à la désactivation | Désactiver dans l'onglet exécutant | La ligne `Lock` a un propriétaire vide ; le second onglet reste désactivé (« désactivée depuis un autre onglet ») au lieu de reprendre | ➖ |
| EXE-05 | V0.6.2 | Perte pendant le relais (limite connue) | Fermer l'onglet exécutant, modifier un Statut tout de suite | Limite connue : cette modification n'est exécutée par personne (au plus 20 s) ; noter ce qui est observé | ➖ |
| EXE-06 | V0.6.2 | Sans table, sans verrou | Refuser la création de la table, activer dans deux onglets | Limite connue : les deux onglets exécutent (doublon) ; noter | ➖ |
| EXE-07 | V0.13.0 | Rechargement de l'onglet exécutant | Workflow actif dans un seul onglet ; recharger la page (F5), puis modifier tout de suite un Statut | Le bandeau dit aussitôt « Automation active : elle ne s'exécute que tant que cette vue reste ouverte… », pas « un autre onglet l'exécute » ; la modification faite juste après le rechargement est exécutée (en 0.12.0 : environ 25 s d'attente, et elle était perdue) | ➖ |
| EXE-08 | V0.13.0 | Onglet dupliqué | Workflow actif ; dupliquer l'onglet (clic droit sur l'onglet du navigateur > Dupliquer), puis modifier un Statut | La copie affiche « un autre onglet l'exécute… » ; une seule ligne écrite dans Archive | ➖ |
| LOOP-01 | V0.6.2 | Une modification de personne juste après une écriture du widget | Avec RUN-06, juste après le déclenchement, modifier à la main le Statut d'une autre ligne | Cette seconde modification est bien traitée (avant 0.6.2, le lot suivant était ignoré) | ➖ |
| LOOP-02 | V0.6.2 | Boucle réelle arrêtée | Déclencheur « modifiée » sur Montant, action « Modifier des lignes » (la même ligne) qui écrit Montant = 5 puis un second workflow ou une formule qui le remodifie | Au plus 5 exécutions sur la ligne en 10 s, puis « trop d'exécutions rapprochées, arrêtée pour éviter une boucle » | ➖ |

## Test à blanc (dry-run)

| ID | Depuis | Scénario | Étapes | Attendu | Résultat |
|---|---|---|---|---|---|
| DRY-01 | V0.11 (modifié) | Aucun effet | Cliquer Tester avec le graphe de base (la ligne testée est celle sélectionnée dans Grist, sinon la première de la vue ; son numéro figure dans le journal) | Aucune ligne écrite dans Archive ; chaque nœud affiche « Passé » ou « Action prévue » | ➖ |
| DRY-02 | V0.5 | Branche bloquée (condition sans lien « Sinon ») | Mettre une valeur de condition différente de celle de la première ligne, Tester | La condition affiche « Bloqué par la condition », l'action n'affiche rien | ➖ |
| DRY-05 | V0.16.0 (modifié) | Ligne choisie | Sélectionner la ligne 3 dans la vue Grist, cliquer Tester, puis sélectionner la ligne 5 et recommencer | Le journal dit « Test sur la ligne 3 » puis « Test sur la ligne 5 », avec le nombre d'écritures prévues ; l'état des nœuds suit la ligne testée | ➖ |
| DRY-03 | V0.16.0 (modifié) | Sans ligne | Filtrer la vue pour qu'elle soit vide, Tester | Message « Test impossible : aucune ligne dans la vue. » | ➖ |
| DRY-04 | V0.5 | Workflow inactif | Désactiver, Tester | Le test fonctionne quand même | ➖ |

## Conditions à plusieurs vérifications et branche « Sinon »

| ID | Depuis | Scénario | Étapes | Attendu | Résultat |
|---|---|---|---|---|---|
| CHK-01 | V0.16.0 (modifié) | Ajouter et retirer | Dans une condition, cliquer « Ajouter une vérification », puis la corbeille d'une vérification | Un second bloc Colonne / Opérateur / Valeur apparaît ; le choix « Il faut » n'apparaît qu'avec deux vérifications ou plus (avant la 0.16.0 : « Combiner », grisé) ; la corbeille n'apparaît que s'il y en a plusieurs | ➖ |
| CHK-02 | V0.7 | ET | Statut = Clos ET Montant > 100, « Il faut : toutes vraies (ET) ». Passer un contact à Clos avec un montant de 50, puis un autre de 500 | Seul le contact à 500 déclenche l'action | ➖ |
| CHK-03 | V0.7 | OU | Même condition, « Il faut : une au moins (OU) ». Passer à Ouvert un contact à 500, puis à Clos un contact à 5 | Les deux déclenchent l'action | ➖ |
| CHK-04 | V0.7 | Vérification incomplète | Ajouter une vérification sans colonne, cliquer Activer | Refus, avec le nom de la condition dans le journal | ➖ |
| BRA-01 | V0.7 | Deux sorties | Regarder une condition | Deux sorties étiquetées « Oui » et « Sinon » ; le lien « Sinon » est en pointillés | ➖ |
| BRA-02 | V0.7 | Branche « Sinon » exécutée | Relier « Sinon » à une seconde action (Motif = autre), passer un Statut à « En cours » | L'action du « Sinon » écrit dans Archive, pas celle du « Oui » ; une seule ligne de journal | ➖ |
| BRA-03 | V0.7 | Test à blanc | Cliquer Tester quand la condition est fausse | La condition affiche « Faux : branche « sinon » », l'action du « Sinon » affiche « Action prévue » | ➖ |
| BRA-04 | V0.7 | Sans « Sinon » | Retirer le lien « Sinon », provoquer une condition fausse | Rien n'est écrit (comme avant la 0.7) | ➖ |
| BRA-05 | V0.7 | Clavier | Tab jusqu'à la sortie « Sinon », Entrée, Tab jusqu'à l'entrée de l'action, Entrée | Le lien « Sinon » est créé | ➖ |
| CHK-05 | V0.15.0 | Comparaison au texte tapé | Ajouter à Contacts une colonne Actif de type « Booléen » (case à cocher) ; mettre Cle = 01000 sur un contact et 33000 sur un autre. Conditions, testées une à une avec Tester : Cle est égal à 01000, Cle est égal à 33000, Cle est égal à 1000, Actif est égal à true, Actif est égal à false | Vraies pour la bonne ligne : 01000 et 33000 retrouvent leurs contacts, 1000 aucun ; true une case cochée, false une case décochée (avant la 0.15.0, un texte de chiffres ou une case n'était jamais égal à ce qui était tapé) | ➖ |
| MIG-01 | V0.7 | Ancien graphe | Ouvrir un document enregistré avec la 0.6 (table `Automation` déjà remplie) | Le graphe est retrouvé : chaque condition devient une vérification unique, l'état actif est conservé ; après une modification, la ligne `Workflow` est réécrite au nouveau format (Version = 3) | ➖ |

## Transformation et valeurs {Colonne}

Les valeurs de l'action et des transformations acceptent `{NomDeColonne}` (valeur de la ligne qui déclenche) et `{nom}` (résultat d'un nœud Transformation). `{{` et `}}` donnent des accolades littérales.

| ID | Depuis | Scénario | Étapes | Attendu | Résultat |
|---|---|---|---|---|---|
| TRF-01 | V0.16.0 (modifié) | Nœud Transformation | Ajouter un nœud Transformation entre le déclencheur et l'action | Champs Nom du résultat, Opération, Valeur A, Valeur B ; une entrée et une sortie ; « Valeur B » cachée pour Majuscules, Minuscules, Sans espaces autour (avant la 0.16.0 : grisée) | ➖ |
| TRF-02 | V0.8 | Concaténation | Transformation « titre » = `{Nom}` accolé à ` - {Statut}` ; action Archive.Motif = `Fiche {titre}`. Passer le Statut de « Ada » à Clos | Archive reçoit « Fiche Ada - Clos » | ➖ |
| TRF-03 | V0.8 | Calcul | Transformation `{Montant}` × 2 ; action Archive.Source = `{total}` (nom « total ») | Montant 21 écrit 42 ; 0,1 + 0,2 donne 0,3 | ➖ |
| TRF-04 | V0.8 | Colonne numérique | Même calcul vers une colonne numérique | La valeur reste un nombre dans Grist (pas du texte) | ➖ |
| TRF-05 | V0.8 | Erreurs lisibles | Division par 0 ; `{ColonneInconnue}` ; calcul sur une cellule vide ou textuelle | Message clair dans le journal (« Division par zéro », « Valeur inconnue : {…} », « Valeur non numérique ») ; rien n'est écrit | ➖ |
| TRF-06 | V0.8 | Chaîne | Deux transformations à la suite, la seconde utilisant le nom de la première | La seconde voit le résultat de la première | ➖ |
| TRF-07 | V0.8 | Validation | Activer avec une transformation sans valeur A, ou un nom invalide (`1abc`) ou en double | Refus avec la raison dans le journal | ➖ |
| TRF-08 | V0.8 | Valeurs piégées | Concaténer `=1+1` et `<script>alert(1)</script>` | Écrits tels quels comme texte, rien ne s'exécute | ➖ |
| TRF-09 | V0.8 | Test à blanc | Cliquer Tester | La transformation affiche « Passé » ; la ligne d'effets du journal montre la valeur déjà calculée | ➖ |
| TRF-10 | V0.8 | Suppression | Déclencheur « supprimée » avec `{Nom}` dans l'action | Erreur claire « pas de contenu de ligne » (limite connue, CDC §4.2) | ➖ |
| TRF-11 | V0.8 | Accolades littérales | Action Archive.Motif = `{{Nom}}` | Écrit `{Nom}` | ➖ |

## Votre cas guidé : une case qui change les lignes liées (0.16.0)

Prérequis : une table `Projets` (Nom, et une colonne Case de type « Booléen ») et une table `Taches` (Nom, Projet : Référence vers Projets, B : numérique), avec deux tâches sur le premier projet, une sur le deuxième, aucune sur le troisième. Le widget est ouvert sur `Projets`.

| ID | Depuis | Scénario | Étapes | Attendu | Résultat |
|---|---|---|---|---|---|
| CAS-01 | V0.16.0 | Une case, sans Condition | Déclencheur : Colonne surveillée = Case. Action : Modifier des lignes, Dans la table Taches, Repérer par la colonne Projet, Colonne à remplir B, Nouvelle valeur 2. Relier, Activer, cocher la case du premier projet | Les deux tâches du premier projet passent à B = 2, la troisième ne bouge pas ; journal « modification ligne 1 : réussi » | ➖ |
| CAS-02 | V0.16.0 | Référence reconnue | Dans l'Action, choisir Projet dans « Repérer par la colonne » ; puis taper autre chose dans « Valeur cherchée » et choisir de nouveau Projet | « Valeur cherchée » se remplit seule avec `{id}` ; une valeur déjà tapée n'est jamais remplacée | ➖ |
| CAS-03 | V0.16.0 | Projet sans tâche | Cocher la case du troisième projet | Rien n'est écrit ; journal « réussi — aucune ligne à modifier » | ➖ |
| CAS-04 | V0.16.0 | Mauvaise clé sur une Référence | Remplacer `{id}` par `{Nom}` dans « Valeur cherchée », cocher une case | Erreur « Ligne introuvable dans Taches : Projet = … (si c'est une colonne Référence, elle garde le numéro de la ligne : essayez {id}) », même avec « Toutes les modifier » | ➖ |
| CAS-05 | V0.16.0 | Recopier la case | « Nouvelle valeur » = `{Case}` (sur une colonne B de type Booléen) | Chaque tâche liée prend l'état de la case du projet, coché ou non | ➖ |
| INC-01 | V0.16.0 | Ce qui manque, sur les nœuds | Déclencheur et Action non reliés, Action sans colonne, cliquer Activer ; puis relier et choisir la colonne | Au refus : bord rouge et, en bas de l'Action, « N'est pas relié. » et « Choisissez la colonne à remplir. », une ligne chacun ; le rouge s'en va dès que tout est réglé | ➖ |
| INC-02 | V0.16.0 | Actif, rendu incomplet | Workflow actif ; dans l'Action sur Taches, remettre « Repérer par la colonne » à « — La même ligne — » ; puis rechoisir Projet | Bandeau rouge « Automation active mais incomplète, chaque exécution échoue : « Action » modifie une autre table… », l'Action en rouge ; tout revient au bandeau habituel une fois corrigé | ➖ |
| INC-03 | V0.16.0 | Point du journal | Journal fermé, provoquer une erreur (INC-02 puis cocher une case) ; ouvrir le journal | Un point rouge sur le bouton du journal, dont la bulle dit « Afficher ou masquer le journal : nouvelles erreurs » ; il disparaît à l'ouverture | ➖ |
| LBL-01 | V0.16.0 | Libellés et aides | Regarder un Déclencheur neuf, une Action neuve, le menu d'ajout ; ajouter une seconde Action | Déclencheur : « Table surveillée : Projets », « Colonne surveillée : — N'importe laquelle — », « Filtrer sur la colonne : — Aucun filtre — » ; libellés au-dessus des champs, choix lisibles en entier ; exemples grisés (« ex. Terminé, ou {Colonne} ») ; menu « Action : écrire dans une table »… ; la seconde s'appelle « Action 2 » ; la bulle de « Tester » dit ce qu'il fait | ➖ |
| LBL-02 | V0.16.0 | En anglais | Réglages > Langue : English, puis refaire LBL-01 et INC-02 | Les mêmes libellés en anglais (« Watched table », « Find by column », « Update rows »…), sans texte français restant, sauf les messages d'erreur du moteur (limite connue) | ➖ |
| CHK-06 | V0.16.0 | Cases à cocher | Condition « Case est coché », puis « Case n'est pas coché » ; Tester sur un projet coché et sur un décoché | Pas de valeur à taper ; vraies pour la bonne ligne (une case vide n'est pas cochée) | ➖ |

## Mise à jour d'une ligne repérée par une clé

Une action « Modifier des lignes » sur une autre table doit dire quelles lignes : « Repérer par la colonne » (colonne de la table visée) et « Valeur cherchée » (texte, `{Colonne}`, ou `{id}` pour une colonne Référence). Jusqu'à la 0.15.0, ces champs s'appelaient « Ligne repérée par » et « Valeur clé ». Avant la 0.9, l'action écrivait sur la ligne portant le même numéro que celle de l'événement (erreur corrigée).

| ID | Depuis | Scénario | Étapes | Attendu | Résultat |
|---|---|---|---|---|---|
| KEY-01 | V0.16.0 (modifié) | Champs de l'action | Action « Modifier des lignes » ; choisir une colonne dans « Repérer par la colonne », puis revenir à « — La même ligne — » ; passer à « Ajouter une ligne » | « Repérer par la colonne » (colonnes de la table visée, « — La même ligne — » par défaut) ; « Valeur cherchée » et « Si plusieurs lignes » n'apparaissent qu'une colonne choisie ; les trois disparaissent pour « Ajouter une ligne » | ➖ |
| KEY-02 | V0.9 | Mise à jour par clé | Action sur Archive, repérée par Motif = `{Nom}`, colonne Source = vu. Archive contient une ligne Motif = Ada ; passer à Clos le contact Ada | Seule la ligne Ada d'Archive reçoit Source = vu | ➖ |
| KEY-03 | V0.9 | Clé introuvable | Modifier un contact dont le nom n'est dans aucune ligne d'Archive | Erreur « Ligne introuvable dans Archive : Motif = … », rien d'écrit | ➖ |
| KEY-04 | V0.16.0 (modifié) | Clé en double | Deux lignes d'Archive avec le même Motif, déclencher ; puis « Si plusieurs lignes : Arrêter (erreur) », déclencher | D'abord, les deux lignes sont modifiées (une nouvelle action : « Toutes les modifier ») ; puis erreur « Plusieurs lignes dans Archive … », rien d'écrit. Une action enregistrée avant la 0.16.0 montre « Arrêter (erreur) » et s'arrête comme avant | ➖ |
| KEY-05 | V0.16.0 (modifié) | Autre table sans clé | Action « Modifier des lignes » sur Archive, « — La même ligne — », Activer | Refus, avec « modifie une autre table : choisissez « Repérer par la colonne » » dans le journal et en rouge sur l'action | ➖ |
| KEY-06 | V0.9 | Type de la clé | Clé numérique d'un côté, texte de l'autre (5 et « 5 ») | La ligne est trouvée | ➖ |
| KEY-07 | V0.9 | Même table, autre ligne | Action sur « — Table de la vue — », repérée par Cle = k2 | La ligne dont Cle = k2 est modifiée, pas celle qui a déclenché | ➖ |
| KEY-08 | V0.9 | Test à blanc | Cliquer Tester | Les effets annoncés portent le numéro de la ligne trouvée ; rien n'est écrit | ➖ |
| KEY-09 | V0.15.0 | Clé à zéro en tête | Archive : Motif = 01000 sur une ligne, 1000 sur une autre ; action repérée par Motif = 01000 | Seule la ligne 01000 est modifiée (avant la 0.15.0, c'était la ligne 1000) | ➖ |

## Recherche dans une autre table et filtre du déclencheur

Prérequis : table `Services` (Nom, Seuil) du document de test. Le nœud Recherche (appelé Lecture jusqu'à la 0.15.0) met une cellule d'une autre table à disposition sous `{nom}` ; une condition peut comparer à `{nom}` ou à `{Colonne}` (pour une accolade littérale : `{{`).

| ID | Depuis | Scénario | Étapes | Attendu | Résultat |
|---|---|---|---|---|---|
| LKP-01 | V0.16.0 (modifié) | Nœud Recherche | Ajouter un nœud Recherche | Champs Nom du résultat, Chercher dans (« — Table de la vue — » par défaut), Repérer par la colonne, Valeur cherchée, Colonne à lire, Si aucune ligne ; les listes de colonnes suivent la table choisie | ➖ |
| LKP-02 | V0.10 | Seuil lu ailleurs | Recherche « seuil » = Services.Seuil où Nom = `{Service}` ; condition Montant supérieur à `{seuil}` ; action Archive | Déclenche seulement si le montant dépasse le seuil du service du contact | ➖ |
| LKP-03 | V0.10 | Service absent | Contact dont le service n'existe pas dans Services | Erreur « Ligne introuvable dans Services … » ; avec « Si aucune ligne : Continuer à vide », pas d'erreur | ➖ |
| LKP-04 | V0.10 | Service en double | Deux lignes Services de même nom | Erreur « Plusieurs lignes dans Services … » dans les deux modes | ➖ |
| LKP-05 | V0.10 | Seuil vide | Service dont le Seuil est vide | Comportement noté (comparaison avec une valeur vide : faux) | ➖ |
| LKP-06 | V0.10 | Validation | Activer avec une Recherche sans colonne qui repère la ligne, sans valeur cherchée ou sans colonne à lire ; deux nœuds avec le même nom | Refus avec la raison dans le journal | ➖ |
| LKP-07 | V0.10 | Condition avec `{Colonne}` | Condition Montant supérieur à `{Plafond}` (colonne de la ligne) | Comparaison avec la valeur de la colonne Plafond de la même ligne | ➖ |
| LKP-08 | V0.10 | Valeur littérale avec accolades | Condition Nom égal à `{{x}}` ; contact dont le nom est `{x}` | La condition est vraie | ➖ |
| TGT-01 | V0.16.0 (modifié) | Filtre du déclencheur | Déclencheur « modifiée », « Filtrer sur la colonne » = Cle, « Valeur attendue » = `k2` (jusqu'à la 0.15.0 : « Ligne précise » et « Valeur clé ») | Seule la modification de la ligne dont Cle = k2 déclenche | ➖ |
| TGT-02 | V0.16.0 (modifié) | Selon l'événement | Passer le déclencheur à « créée » puis « supprimée » ; revenir à « modifiée » | « Filtrer sur la colonne » et « Valeur attendue » disparaissent (avant la 0.16.0 : grisés) ; « Valeur attendue » n'apparaît qu'une colonne choisie ; Activer est refusé tant qu'un filtre est renseigné pour une création | ➖ |
| TGT-03 | V0.10 | Clé en double | Deux lignes avec Cle = k2, modifier chacune | Les deux déclenchent (décision à valider par Antoine, le CDC parlait d'erreur) | ➖ |

## Historique des exécutions

| ID | Depuis | Scénario | Étapes | Attendu | Résultat |
|---|---|---|---|---|---|
| HIS-01 | V0.11 | Activation tracée | Activer puis désactiver, regarder `Automation` | Deux lignes `Log` (Evenement activate puis deactivate) avec Auteur = votre email | ➖ |
| HIS-02 | V0.11 | Relecture | Recharger, ouvrir le journal | Les 20 dernières entrées, la plus récente en haut ; une activation s'affiche « Workflow activé. (email) » | ➖ |
| HIS-03 | V0.11 | Pages | Avec plus de 20 entrées, cliquer « Exécutions plus anciennes » | 20 entrées plus anciennes sont ajoutées sous les autres ; le bouton disparaît quand il n'y en a plus | ➖ |
| HIS-04 | V0.11 | Nouvelle exécution pendant la lecture | Déclencher une exécution puis cliquer « Exécutions plus anciennes » | Pas de doublon ni de trou dans la liste | ➖ |
| HIS-05 | V0.11 | Une table par vue | Deux widgets sur deux tables de vue différentes | Chacun n'affiche que ses entrées | ➖ |
| HIS-06 | V0.11 | Volume (limite connue) | Plus de 1 000 entrées dans `Automation` | Noter le temps de chargement ; le widget lit toute la table à chaque page (à optimiser si lent) | ➖ |

## Activation et sauvegarde

| ID | Depuis | Scénario | Étapes | Attendu | Résultat |
|---|---|---|---|---|---|
| ACT-01 | V0.16.0 (modifié) | Activation refusée | Avec un graphe incomplet (action sans colonne, nœud isolé), cliquer Activer | Refus ; le journal s'ouvre avec la raison pour chaque problème ; chaque nœud concerné a un bord rouge et, en bas, ce qui lui manque (voir INC-01) | ➖ |
| ACT-02 | V0.5 | Bandeau et fermeture | Activer un graphe valide, puis recharger ou fermer l'onglet | Bandeau « onglet ouvert requis » affiché ; le navigateur demande confirmation avant de fermer. À noter : Chrome, Firefox, Edge | ➖ |
| SAVE-01 | V0.5 | Sauvegarde automatique | Construire un graphe, attendre une seconde, recharger la page | Nœuds, liens, valeurs et état actif retrouvés ; les listes se remplissent | ➖ |
| SAVE-03 | V0.15.0 | Pas de bouton « Enregistrer » de Grist | Avec la table `Automation`, modifier le graphe, l'activer, le désactiver, déplacer et élargir un nœud ; regarder l'en-tête de la vue, à droite de son titre | Aucun bouton « Enregistrer » ni « Retour » n'apparaît (en 0.14.0, il apparaissait à chaque changement) ; après rechargement, tout est retrouvé, lu dans la table | ➖ |
| SAVE-04 | V0.15.0 | Sans la table | Dans un document sans table `Automation`, refuser sa création, construire un graphe | Le bouton « Enregistrer » de Grist apparaît : sans la table, c'est dans les réglages de la vue que le graphe est gardé ; l'enregistrer, recharger : le graphe est retrouvé | ➖ |
| SAVE-02 | V0.6 (modifié) | Une configuration par table | Ajouter un second widget sur une autre page, même table | Il retrouve le même graphe, lu dans `Automation` (une ligne `Workflow` par table surveillée). Si les tables n'existent pas, il démarre vide (options du widget seulement) | ➖ |

## Table du document, accord et journal

Prérequis : document sans table `Automation` pour TAB-01 à TAB-03 ; les suivants se jouent ensuite, tables créées.

| ID | Depuis | Scénario | Étapes | Attendu | Résultat |
|---|---|---|---|---|---|
| TAB-01 | V0.6 | Accord demandé | Ouvrir le widget dans un document sans table `Automation` | Une fenêtre « Créer la table du widget dans ce document ? » ; le focus est sur « Créer la table » ; cliquer à côté ne la ferme pas | ➖ |
| TAB-02 | V0.6 | Création acceptée | Cliquer « Créer la table » | Une seule table `Automation` apparaît dans la liste des pages de Grist ; le journal du widget dit « Table du widget créée. » | ➖ |
| TAB-03 | V0.6 | Colonne Auteur | Dans la table `Automation`, regarder le type de la colonne Auteur | C'est une colonne à formule déclenchée `user.Email` ; sinon (Grist a refusé) la colonne existe, vide : noter l'écart | ➖ |
| TAB-04 | V0.6 | Accord refusé | Dans un document sans tables, répondre « Ne pas créer » (ou Échap) | Le widget reste utilisable (graphe, Tester) ; aucune table créée | ➖ |
| TAB-05 | V0.6 | Redemandé à l'activation | Après TAB-04, construire un graphe valide, cliquer Activer | La fenêtre revient ; refuser encore : le workflow s'active quand même, le journal dit « Non enregistré : la table du widget n'a pas été créée dans ce document. » | ➖ |
| TAB-06 | V0.6 | Graphe enregistré | Construire le graphe de base, attendre une seconde, regarder `Automation` | Une ligne de Type `Workflow` pour la table `Contacts` : Actif, Version, Résumé lisible (« Déclencheur : … → Condition : … → Action … »), Config en JSON | ➖ |
| TAB-07 | V0.6 | Mise à jour sans doublon | Modifier une valeur de condition, attendre, regarder la table | La même ligne est modifiée (pas de seconde ligne pour `Contacts`) | ➖ |
| TAB-08 | V0.6 | Relecture au démarrage | Recharger la page du widget, ou l'ouvrir depuis un autre navigateur | Le graphe et l'état actif sont retrouvés depuis le document | ➖ |
| TAB-09 | V0.6 | Journal des exécutions | Activer, modifier le Statut d'une ligne pour déclencher | Une ligne de Type `Log` dans `Automation` : date, table, événement (update), numéro de ligne, résultat (success), détail, Auteur = votre email | ➖ |
| TAB-10 | V0.6 | Journal relu | Recharger la page, ouvrir le journal (panneau des logs | Les 20 dernières exécutions apparaissent | ➖ |
| TAB-11 | V0.6 | Table masquée du widget | Ouvrir la liste des tables d'une action | `Automation` n'y figure pas | ➖ |
| TAB-12 | V0.6 | Droits insuffisants | Avec un compte qui ne peut pas créer de table, accepter la création | Message « Enregistrement dans le document impossible : … » dans le journal ; le widget continue de marcher | ➖ |
| TAB-13 | V0.11.1 | Contenu illisible dans le document | Dans `Automation`, ouvrir la ligne `Workflow` de `Contacts`, remplacer `Config` par `{"version":4,"nodes":[],"edges":[]}`, recharger le widget | « Workflow conservé tel quel » prend la place du canevas, avec l'explication ; Ajouter, Tester et Activer sont grisés (pas masqués) ; le journal dit « Configuration illisible : elle est conservée telle quelle… ». Après quelques secondes, `Config` est inchangée et aucune ligne `Workflow`, `Lock` ou `Log` n'a été ajoutée | ➖ |
| TAB-14 | V0.11.1 | Rien ne tourne à la place | Avoir activé un workflow avant TAB-13, puis après TAB-13 modifier le Statut d'une ligne de `Contacts` | Aucune écriture dans `Archive` par ce widget, pas de bandeau « onglet ouvert requis » | ➖ |
| TAB-15 | V0.11.1 | Repartir de zéro | Après TAB-13, supprimer la ligne `Workflow` de `Contacts` dans `Automation`, recharger | L'explication a disparu et le widget est de nouveau modifiable (il repart du graphe de ses réglages, ou d'un canevas vide) | ➖ |
| TAB-16 | V0.11.1 | Nom de table pris à la casse près | Dans un document sans `Automation`, créer une table nommée `AUTOMATION` (majuscules), ouvrir le widget | Aucune fenêtre de création ; le journal dit que le document a déjà une table « AUTOMATION » à renommer ; rien n'est créé ; le widget reste utilisable, son graphe est gardé dans ses réglages | ➖ |
| TAB-17 | V0.11.1 | Colonne indispensable supprimée | Dans `Automation`, supprimer la colonne `Config`, recharger | Le journal dit que la table n'a pas les colonnes attendues (Config) ; rien n'est écrit dans la table ; le graphe reste dans les réglages de la vue | ➖ |
| TAB-18 | V0.11.1 | Colonne facultative supprimée | Dans `Automation`, supprimer la colonne `Detail`, recharger, déclencher une exécution | L'exécution est journalisée dans la table (sans `Detail`), sans erreur | ➖ |
| TAB-19 | V0.11.1 | Colonne supprimée en cours de route | Widget actif, supprimer la colonne `Detail`, déclencher une exécution puis une seconde | La première écriture dans le journal peut échouer (« Enregistrement dans le document impossible : … » : noter le message de Grist) ; la seconde passe, sans `Detail` | ➖ |

## Interface

| ID | Depuis | Scénario | Étapes | Attendu | Résultat |
|---|---|---|---|---|---|
| UI-01 | V0.5 | Panneau 700×400 | Redimensionner la vue Grist à environ 700×400 | Tous les boutons de l'en-tête visibles, aucun défilement de la page ; on peut zoomer pour voir trois nœuds | ➖ |
| UI-02 | V0.5 | Thème | Réglages > Sombre, Clair, Système | Fond, nœuds et textes changent ; lisibles dans les deux thèmes | ➖ |
| UI-03 | V0.5 | Langue | Réglages > EN puis FR | Tous les textes changent, y compris dans les nœuds | ➖ |
| UI-04 | V0.5 | Clavier | Tab dans les nœuds ; Entrée sur une sortie puis sur une entrée ; Suppr sur un en-tête de nœud ; Échap dans une liste | Tout est atteignable ; le lien se crée au clavier ; Échap ferme la liste sans fermer la fenêtre | ➖ |
| UI-05 | V0.15.0 (modifié) | Crédits | Réglages | Auteur Grist Factory, site, licence GPL v3.0, version précédée de « pré-alpha » (« pre-alpha » en anglais) | ➖ |
| UI-06 | V0.5 | Fenêtres | Ouvrir les Réglages, Tab en boucle, Échap | Le focus reste dans la fenêtre ; Échap la ferme et le focus revient au bouton Réglages | ➖ |
| UI-07 | V0.11.1 | Couleur du test à blanc | Tester avec le graphe de base, en clair puis en sombre | L'action prévue est signalée en bleu d'accent (barre pleine à texte blanc), plus en vert ; lisible dans les deux thèmes | ➖ |
| UI-08 | V0.11.1 | Superpositions | Ouvrir le journal, le menu d'ajout (clic droit sur le fond), les Réglages | Même ordre qu'en 0.11 : le menu d'ajout recouvre le journal, la fenêtre des Réglages recouvre tout | ➖ |

## Prise en main

Pour revoir la prise en main comme à la première fois : une fenêtre de navigation privée, ou effacer les données du site `lombre33.github.io` dans le navigateur.

| ID | Depuis | Scénario | Étapes | Attendu | Résultat |
|---|---|---|---|---|---|
| TUTO-01 | V0.14.0 | Première ouverture | Dans un navigateur qui ne l'a jamais vue, avec un compte qui peut modifier : ouvrir le widget dans un document sans table `Automation`, répondre à la question | La question d'abord, seule ; la prise en main « Prise en main » s'ouvre juste après la réponse, sur « Un workflow, du déclencheur à l'action », avec une capture du widget | ➖ |
| TUTO-02 | V0.14.0 | Parcours | « Suivant » jusqu'au bout, « Précédent », un clic sur un point ; au clavier, Tab jusqu'aux points puis ← →, Début, Fin ; à 700 × 400 | Six écrans, chacun avec sa capture, la fenêtre ne change pas de hauteur et ne défile pas ; « Fermer, Précédent, Suivant » puis, au dernier écran, « Précédent, Fermer » (Fermer en bleu) ; un seul arrêt de Tab pour les points | ➖ |
| TUTO-03 | V0.14.0 | Une seule fois | La fermer (Fermer, Échap ou le dernier écran), recharger la page, rouvrir le document | Elle ne revient pas d'elle-même | ➖ |
| TUTO-04 | V0.14.0 | Réglages > Aide | Réglages, ligne « Aide », bouton « Prise en main » ; puis Échap | Elle s'ouvre par-dessus les Réglages, sur son premier écran ; Échap ne ferme qu'elle, le focus revient au bouton | ➖ |
| TUTO-05 | V0.14.0 | Lecture seule | Avec un compte qui n'a que la lecture, dans un navigateur qui ne l'a jamais vue, ouvrir la page du widget | Elle ne s'ouvre pas d'elle-même ; Réglages > Aide l'ouvre | ➖ |
| TUTO-06 | V0.14.0 | Anglais et sombre | Réglages > Sombre, EN, puis Aide | Textes en anglais, captures en anglais (colonnes Name, Status) ; les captures claires se lisent dans la fenêtre sombre, les points se voient | ➖ |
| TUTO-07 | V0.14.0 | Politique de sécurité | Console et onglet Réseau ouverts, passer les six écrans | Aucune erreur de politique de sécurité ; les images viennent de `lombre33.github.io/GRIST_automation/img/tuto/` | ➖ |
| TUTO-08 | V0.14.0 | Dans GFS | Ouvrir l'app depuis GFS, dans un navigateur qui ne l'a jamais vue | Elle ne s'ouvre pas d'elle-même (le cadre de GFS ne retient rien : elle reviendrait à chaque chargement) ; Réglages > Aide l'ouvre, captures comprises | ➖ |

## Dans Grist Factory Suite (GFS) : la barre et l'ambiance

À jouer dans GFS (consignes 003 et 006), avec l'app ouverte depuis l'adresse en ligne du dépôt. Les positions de la barre se changent avec le bouton « Position de la barre » de GFS ; l'ambiance, dans sa fenêtre « Thème ». Les essais automatiques jouent ces mêmes situations dans un faux GFS (`E2E-36` à `E2E-44`), pas dans le vrai.

| ID | Depuis | Scénario | Étapes | Attendu | Résultat |
|---|---|---|---|---|---|
| LIEN-01 | V0.12.0 | Seule, rien ne change | Ouvrir l'app dans une vue « Personnalisé » de Grist, sans GFS | Les couleurs bleu et gris d'avant, mêmes coins et mêmes traits ; aucune erreur dans la console ; rien n'est écarté | ➖ |
| LIEN-02 | V0.12.0 | Ouverture dans GFS | Ouvrir l'app depuis GFS (barre à gauche, par défaut), recharger plusieurs fois | La page apparaît directement dans l'ambiance de GFS, sans éclair d'une autre couleur ; la barre ne recouvre que le fond du graphe | ➖ |
| LIEN-03 | V0.12.0 | Barre en haut | Position de la barre : en haut, à 700 × 400, en français puis en anglais | La barre d'outils se partage autour de la barre : « Ajouter », « Tester », « Activer » et les deux boutons à icône sont tous visibles, aucun recouvert ; le titre peut être coupé par « … » | ➖ |
| LIEN-04 | V0.12.0 | Barre en bas, journal ouvert | Barre en bas, ouvrir le journal (bouton à icône « liste ») | Le journal remonte juste au-dessus de la barre, ses lignes se lisent ; fermé, il reprend sa place | ➖ |
| LIEN-05 | V0.12.0 | Menus et fenêtres, aux quatre bords | Pour chaque bord : clic droit sur le fond près de la barre, ouvrir une liste dans un nœud, ouvrir les Réglages, et la question de la table dans un document sans `Automation` | Le menu d'ajout, les listes et les fenêtres sont entièrement hors de la barre ; une fenêtre trop haute se réduit et défile dedans | ➖ |
| LIEN-06 | V0.12.0 | La barre change en route | Passer la barre de haut en bas, à gauche, à droite, sans recharger | L'app suit à chaque fois ; quand la barre n'est plus en haut, la barre d'outils reprend sa ligne d'origine ; rien ne reste décalé | ➖ |
| LIEN-07 | V0.12.0 | Un nœud sous la barre | Barre à gauche ; glisser le fond pour qu'un nœud soit sous la barre, ouvrir une de ses listes ; recommencer en dézoomant au maximum | La liste s'ouvre à côté de la barre, jamais dessous | ➖ |
| LIEN-08 | V0.12.0 | Les ambiances | Fenêtre « Thème » de GFS : Pop, Papier, Brut, Néon, une couleur libre, puis Grist Factory ; en clair puis en sombre | La page, la barre d'outils, les cartes des nœuds, les listes, les fenêtres et le journal prennent l'ambiance sans recharger (fond et décor, arrondis, traits, ombres, polices des titres, bouton « Activer » plein) ; tout se lit ; Grist Factory rend l'aspect d'origine | ➖ |
| LIEN-09 | V0.12.0 | Mode choisi dans l'app | Dans une ambiance, Réglages > Sombre, Clair, Système | L'ambiance suit le mode de l'app (son choix, puis le système), pas celui de Grist ; le choix reste après recharge | ➖ |
| LIEN-10 | V0.12.0 | Test à blanc dans une ambiance | Dans Néon puis Brut, Tester avec le graphe de base | Les états des nœuds (passé, bloqué, « sinon » en ambre, action en accent) se lisent ; l'ambre reste de l'ambre | ➖ |
| LIEN-11 | V0.12.0 | Le kit est publié avec le site | Ouvrir `https://lombre33.github.io/GRIST_automation/kit/js/gfs-link.js` | Le code du module s'affiche (le sous-module est publié avec le site) | ➖ |
