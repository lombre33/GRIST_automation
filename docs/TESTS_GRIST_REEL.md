# Tests à jouer dans un vrai Grist

Liste de scénarios manuels, à jouer par Antoine sur son Grist (instance Grist.Gouv) avec le document décrit dans `docs/GRIST_TEST_DOC.md`. Ils complètent les tests automatiques (`npm test`, `npm run test:e2e`), qui tournent sur une API Grist simulée et ne peuvent pas voir ce que fait vraiment Grist (droits, vues filtrées, plusieurs onglets, politique de sécurité de l'instance).

**Règle de maintenance** : chaque fonctionnalité livrée ajoute ses scénarios ici (colonne « Depuis » = version ou fonctionnalité), adapte ceux qu'elle change et marque « Retiré » ceux qui n'ont plus de sens. Le message de livraison renvoie à la liste des scénarios nouveaux ou modifiés, à jouer en priorité.

**Comment jouer** : ouvrir le widget sur la table `Contacts` (accès complet au document). Noter le résultat dans la dernière colonne : ✅ conforme, ❌ écart (décrire en une ligne), ➖ non joué. Quand un scénario décrit une limite connue, « conforme » veut dire que le comportement décrit est observé.

## Journal des campagnes

| Date | Version du widget (Réglages > Crédits) | Testeur | ✅ | ❌ | ➖ | Remarques |
|---|---|---|---|---|---|---|
| | | | | | | |

## Démarrage et accès

| ID | Depuis | Scénario | Étapes | Attendu | Résultat |
|---|---|---|---|---|---|
| START-01 | V0.5 | Ouverture normale | Ajouter une vue « Personnalisé » sur Contacts, coller l'adresse du widget, choisir l'accès complet | Grist demande l'accès au document ; après acceptation, un fond uni avec l'invite « Clic droit sur le fond… », aucune fenêtre d'erreur ; console sans erreur | ➖ |
| START-02 | V0.5 | Page ouverte hors de Grist | Ouvrir l'adresse du widget directement dans un onglet | Fenêtre « Ouvrez ce widget depuis Grist » avec l'adresse et un bouton Copier | ➖ |
| START-03 | V0.5 | Politique de sécurité | Ouvrir la console et l'onglet Réseau, recharger | Aucune erreur de politique de sécurité ; seule requête hors du widget : `docs.getgrist.com/grist-plugin-api.js` | ➖ |
| START-04 | V0.5 | Lecture seule | Avec un compte en lecture seule sur le document, ouvrir le widget | Le widget s'ouvre ; modifier le graphe ne plante pas ; aucune écriture dans le document | ➖ |

## Construire le graphe

| ID | Depuis | Scénario | Étapes | Attendu | Résultat |
|---|---|---|---|---|---|
| NODE-01 | V0.5 | Ajouter des nœuds | Clic droit sur le fond, taper « Décl », Entrée ; recommencer avec « Cond » et « Act » via le bouton Ajouter | Trois nœuds apparaissent là où on a cliqué (le bouton place au centre), le dernier est sélectionné | ➖ |
| NODE-02 | V0.5 | Colonnes proposées | Dans le déclencheur, ouvrir « Colonne surveillée » | Les colonnes de Contacts (Nom, Email, Statut, Montant, Date, Service, Cle), sans id, manualSort ni colonne technique ; la recherche trouve « stat » et « statut » | ➖ |
| NODE-03 | V0.5 | Tables proposées | Dans l'action, ouvrir « Table cible » | Contacts, Services, Archive ; « Table courante » en premier ; aucune table `Automation_` | ➖ |
| NODE-04 | V0.5 | Colonnes de la cible | Choisir Archive comme table cible, ouvrir « Colonne » | Les colonnes d'Archive (Nom, Motif, Source), plus celles de Contacts | ➖ |
| NODE-05 | V0.5 | Opérateurs sans valeur | Dans la condition, choisir « est vide » | Le champ Valeur est grisé, pas masqué | ➖ |
| LINK-01 | V0.5 | Lien en glissant | Glisser de la sortie du déclencheur vers l'entrée de la condition | Un lien courbe apparaît ; pendant le glissement, les entrées possibles sont mises en évidence | ➖ |
| LINK-02 | V0.5 | Lien au clic | Cliquer la sortie de la condition, puis l'entrée de l'action | Lien créé ; Échap pendant l'attente l'annule | ➖ |
| LINK-03 | V0.5 | Liens refusés | Essayer de relier une action vers une condition, une sortie vers le déclencheur, une condition à elle-même, et fermer un cycle entre deux conditions | Aucun lien créé, sans message d'erreur ni plantage | ➖ |
| LINK-04 | V0.5 | Une entrée, un lien | Relier deux nœuds différents à la même entrée | Le nouveau lien remplace l'ancien | ➖ |
| LINK-05 | V0.5 | Suppression | Cliquer un lien puis Suppr ; supprimer un nœud avec sa corbeille | Le lien disparaît ; le nœud part avec ses liens | ➖ |
| NAV-01 | V0.5 | Déplacer et zoomer | Glisser le fond, molette, glisser l'en-tête d'un nœud | Le fond bouge, le zoom se fait autour du pointeur (de 40 % à 160 %), le nœud suit la souris | ➖ |

## Exécution

Pour RUN-01 à RUN-09, construire d'abord : Déclencheur « modifiée », colonne Statut → Condition Statut est égal à Clos → Action « Ajouter une ligne » dans Archive, colonne Motif = « clos ». Cliquer Activer.

| ID | Depuis | Scénario | Étapes | Attendu | Résultat |
|---|---|---|---|---|---|
| RUN-01 | V0.5 | Modification qui déclenche | Passer le Statut d'un contact à Clos | Une ligne apparaît dans Archive avec Motif = clos ; le journal indique « modification ligne N : réussi » | ➖ |
| RUN-02 | V0.5 | Condition fausse | Passer le Statut à « En cours » | Aucune écriture, aucune ligne de journal | ➖ |
| RUN-03 | V0.5 | Autre colonne modifiée | Modifier Nom avec la colonne surveillée = Statut | Aucun déclenchement | ➖ |
| RUN-04 | V0.5 | Création | Déclencheur « créée », condition Montant supérieur à 100, action Ajouter dans Archive. Ajouter un contact à 50 puis un à 500 | Seul le contact à 500 écrit dans Archive | ➖ |
| RUN-05 | V0.5 | Suppression | Déclencheur « supprimée » sans condition, action Ajouter dans Archive. Supprimer un contact | Une ligne dans Archive. Avec une condition ajoutée : erreur claire « Condition impossible sans contenu de ligne » (le contenu d'une ligne supprimée n'est pas connu) | ➖ |
| RUN-06 | V0.5 | Mise à jour de la ligne | Action « Mettre à jour la ligne » (table courante), colonne Source = « auto » | La ligne modifiée reçoit Source = auto ; l'écriture ne relance pas le workflow en boucle | ➖ |
| RUN-07 | V0.5 | Vue filtrée (limite connue) | Filtrer la vue sur Statut = En cours, puis passer un contact à Clos | Limite connue : le contact sort de la vue ; noter si un faux événement « suppression » ou « création » se déclenche | ➖ |
| RUN-08 | V0.5 | Deux onglets (limite connue) | Ouvrir le document dans deux onglets avec le widget actif, modifier un Statut | Limite connue : noter si la ligne est écrite deux fois dans Archive | ➖ |
| RUN-09 | V0.5 | Table cible disparue | Supprimer ou renommer la table Archive, modifier un Statut | Message d'erreur lisible dans le journal, pas de plantage | ➖ |
| RUN-10 | V0.5 | Type incompatible | Action qui écrit « abc » dans une colonne numérique (Montant) | Comportement de Grist noté ; le widget n'affiche pas « réussi » si Grist refuse | ➖ |
| RUN-11 | V0.5 | Valeurs piégées | Écrire `<script>alert(1)</script>` puis `=1+1` depuis une action | Les valeurs sont écrites comme texte, rien ne s'exécute dans l'interface | ➖ |
| RUN-12 | V0.5 | Droits d'écriture | Compte sans droit d'écriture sur Archive, déclencher | Erreur lisible dans le journal | ➖ |

## Test à blanc (dry-run)

| ID | Depuis | Scénario | Étapes | Attendu | Résultat |
|---|---|---|---|---|---|
| DRY-01 | V0.5 | Aucun effet | Cliquer Tester avec le graphe de base | Aucune ligne écrite dans Archive ; chaque nœud affiche « Passé » ou « Action prévue » | ➖ |
| DRY-02 | V0.5 | Branche bloquée | Mettre une valeur de condition différente de celle de la première ligne, Tester | La condition affiche « Bloqué par la condition », l'action n'affiche rien | ➖ |
| DRY-03 | V0.5 | Sans ligne | Filtrer la vue pour qu'elle soit vide, Tester | Message « Dry-run impossible : aucune ligne dans la vue. » | ➖ |
| DRY-04 | V0.5 | Workflow inactif | Désactiver, Tester | Le test fonctionne quand même | ➖ |

## Activation et sauvegarde

| ID | Depuis | Scénario | Étapes | Attendu | Résultat |
|---|---|---|---|---|---|
| ACT-01 | V0.5 | Activation refusée | Avec un graphe incomplet (action sans colonne, nœud isolé), cliquer Activer | Refus ; le panneau des logs s'ouvre avec la raison pour chaque problème | ➖ |
| ACT-02 | V0.5 | Bandeau et fermeture | Activer un graphe valide, puis recharger ou fermer l'onglet | Bandeau « onglet ouvert requis » affiché ; le navigateur demande confirmation avant de fermer. À noter : Chrome, Firefox, Edge | ➖ |
| SAVE-01 | V0.5 | Sauvegarde automatique | Construire un graphe, attendre une seconde, recharger la page | Nœuds, liens, valeurs et état actif retrouvés ; les listes se remplissent | ➖ |
| SAVE-02 | V0.5 | Une configuration par widget | Ajouter un second widget sur une autre page, même table | Il démarre vide : la configuration est propre à chaque widget (limite connue, avant les tables du document) | ➖ |

## Interface

| ID | Depuis | Scénario | Étapes | Attendu | Résultat |
|---|---|---|---|---|---|
| UI-01 | V0.5 | Panneau 700×400 | Redimensionner la vue Grist à environ 700×400 | Tous les boutons de l'en-tête visibles, aucun défilement de la page ; on peut zoomer pour voir trois nœuds | ➖ |
| UI-02 | V0.5 | Thème | Réglages > Sombre, Clair, Système | Fond, nœuds et textes changent ; lisibles dans les deux thèmes | ➖ |
| UI-03 | V0.5 | Langue | Réglages > EN puis FR | Tous les textes changent, y compris dans les nœuds | ➖ |
| UI-04 | V0.5 | Clavier | Tab dans les nœuds ; Entrée sur une sortie puis sur une entrée ; Suppr sur un en-tête de nœud ; Échap dans une liste | Tout est atteignable ; le lien se crée au clavier ; Échap ferme la liste sans fermer la fenêtre | ➖ |
| UI-05 | V0.5 | Crédits | Réglages | Auteur Grist Factory, site, licence GPL v3.0, version | ➖ |
| UI-06 | V0.5 | Fenêtres | Ouvrir les Réglages, Tab en boucle, Échap | Le focus reste dans la fenêtre ; Échap la ferme et le focus revient au bouton Réglages | ➖ |
