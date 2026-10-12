# Cadrage du document Grist de test

Objectif : disposer d'un document Grist de test **reproductible** et d'un scénario d'intégration écrit à l'avance, pour ne pas reconstruire ni réexplorer à chaque session.

## 1. Environnement

- Hors Grist réel, les tests unitaires utilisent le simulateur `tests/fakes/fakeGrist.js` (gratuit, rapide).
- Pour l'intégration : un document Grist de test, hébergé par Antoine (instance DINUM ou Grist public de test), avec le widget pointant sur l'URL GitHub Pages de la branche de test.
- Le dépôt contient le schéma ci-dessous afin que le document puisse être recréé à l'identique.

## 2. Tables de données de test

**Contacts** (table pilote)
| Colonne | Type |
|---|---|
| Nom | Texte |
| Email | Texte |
| Statut | Choix (Nouveau, En cours, Clos) |
| Montant | Numérique |
| Date | Date |
| Service | Référence → Services |
| Cle | Texte (identifiant unique pour les cibles spécifiques) |

**Services**
| Colonne | Type |
|---|---|
| Nom | Texte |
| Responsable | Texte |
| Seuil | Numérique |

**Archive** (cible des actions cross-table)
| Colonne | Type |
|---|---|
| Nom | Texte |
| Motif | Texte |
| Source | Texte |

Tables techniques `_Automation_Workflows` et `_Automation_Logs` : créées par le widget lui-même (cas STO-05).

## 3. Jeu de données

- 10 contacts couvrant : valeurs vides, montants nuls et négatifs, noms avec accents et caractères spéciaux, un nom contenant `<script>` et un autre commençant par `=`, une clé en doublon (cas d'erreur).
- 3 services dont un avec seuil vide.
- Une vue filtrée sur `Statut = En cours` pour le cas DIFF-07.

## 4. Scénarios d'intégration

- IT-01 modification d'un statut déclenche l'ajout d'une ligne dans Archive.
- IT-02 création d'un contact avec condition sur Montant > Seuil du service (lookup).
- IT-03 suppression d'un contact : détection par `rowId`, log sans contenu.
- IT-04 vue filtrée : une ligne qui sort du filtre ne déclenche pas de suppression.
- IT-05 deux onglets (deux utilisateurs si possible) : une seule exécution par événement.
- IT-06 fermeture de l'onglet exécutant : reprise par l'autre.
- IT-07 utilisateur en lecture seule : erreur propre.
- IT-08 table cible renommée ou supprimée : erreur propre.
- IT-09 boucle volontaire A→B→A : arrêt par le garde-fou.
- IT-10 dry-run : aucune ligne écrite dans Archive.
- IT-11 valeurs d'injection : rien d'exécuté dans l'interface ni dans les cellules écrites.

## 5. Économie de crédits

- Les modules du moteur se testent sous Node sans Grist ; l'intégration ne se lance que pour une feature terminée.
- Chaque session d'intégration part de ce document et de cette liste, sans réexploration.
- Un fil dédié aux tests d'intégration n'est utile que si l'historique du fil principal devient long ; à décider à ce moment-là.

## 6. Points à fournir par Antoine

- URL de l'instance et du document de test, ou un document que je pourrai dupliquer.
- Confirmation de la manière dont l'accès au widget se fait depuis cet environnement (je ne peux pas atteindre l'instance DINUM depuis mon conteneur : les tests réels se feront de ton côté, avec mes scénarios).
