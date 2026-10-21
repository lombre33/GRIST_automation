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

## 4. Scénarios

Les scénarios à jouer dans ce document sont dans `docs/TESTS_GRIST_REEL.md` (liste vivante, enrichie à chaque fonctionnalité, avec un journal des campagnes). Les anciens IT-01 à IT-11 y ont été repris et adaptés à la vue nodale.

## 5. Économie de crédits

- Les modules du moteur se testent sous Node sans Grist ; l'intégration ne se lance que pour une feature terminée.
- Chaque session d'intégration part de ce document et de `docs/TESTS_GRIST_REEL.md`, sans réexploration.
- Un fil dédié aux tests d'intégration n'est utile que si l'historique du fil principal devient long ; à décider à ce moment-là.

## 6. Points à fournir par Antoine

- URL de l'instance et du document de test, ou un document que je pourrai dupliquer.
- Confirmation de la manière dont l'accès au widget se fait depuis cet environnement (je ne peux pas atteindre l'instance DINUM depuis mon conteneur : les tests réels se feront de ton côté, avec mes scénarios).
