# Sécurité

Ce widget est destiné à être relu par la DINUM avant publication. Ce document résume ce qu'il fait et ne fait pas ; le détail est dans `docs/CDC_Widget_Grist_Automation_Builder.md` (§4.4).

## Ce que fait le widget

- S'exécute dans l'iframe d'un widget personnalisé Grist, avec l'accès complet au document (`requiredAccess: 'full'`), parce qu'il lit les tables et écrit les effets des automatisations (le détail : `README.md`, « Accès au document demandé »). Tant que Grist ne l'a pas accordé (`access` dans l'adresse du cadre), il ne lit ni n'écrit rien et le dit (test `E2E-46`). Pour une personne qui n'a que la lecture du document (`readonly=true`), il n'écrit rien, pas même le verrou, et n'exécute rien (tests `E2E-47`, `E2E-48`).
- Ne contacte aucun serveur : aucun `fetch`, `XMLHttpRequest`, `WebSocket`, image ou police externes (tests `HYG-01` et `HYG-02`).
- Charge un seul script externe, `https://docs.getgrist.com/grist-plugin-api.js` (API officielle de Grist).
- Dans Grist Factory Suite (GFS), parle à GFS par `postMessage`, avec le kit commun des apps (sous-module `kit/`, commit `eaa2ae2`) : des modules du même site, sans appel réseau, sans `eval`, sans HTML ni attribut `style` (test `HYG-16`). Il n'envoie à GFS que la demande de son contexte (test `E2E-36`) et, quand GFS lui demande s'il peut partir (`fermer`, consigne 010), un oui ou un non, ou le texte de l'erreur si sa réponse échouait (200 caractères au plus, par le kit ; tests `CLOSE-10`, `E2E-63` à `E2E-68`) : rien du document, et la réponse ne vient qu'après la fin des écritures ; il ne lit un message que s'il vient du cadre parent et porte le contrat de GFS, et n'en retient que la barre à laisser libre et l'ambiance, que le kit vérifie (jetons connus, couleurs `#rrggbb`, rien qui sorte de sa déclaration) avant de les poser par le CSSOM sur `<html>` : la politique de sécurité de la page ne change pas.
- Ne garde aucune donnée hors du document Grist : la configuration, le journal et le verrou d'exécution sont dans une seule table, `Automation`, créée avec l'accord de la personne. Le navigateur ne garde que deux préférences d'affichage et la version de la prise en main déjà vue (`localStorage` : `ab_lang`, `ab_theme`, `ab_tuto`, un nombre relu seulement s'il en a la forme) et, le temps d'un rechargement, l'identifiant de l'onglet pour le verrou (`sessionStorage` : `ab_executor_<table>`, 16 caractères hexadécimaux tirés au hasard, relus seulement s'ils ont cette forme) ; rien qui vienne du document (test `HYG-09`).
- N'écrase jamais une configuration qu'il ne sait pas lire (version plus récente, contenu abîmé) : elle reste intacte dans le document et rien ne s'exécute à sa place ; n'écrit jamais dans une colonne de `Automation` qui n'existe pas (tests `GFS-04`, `GFS-12`, `E2E-27`, `E2E-28`).
- N'exécute jamais de code issu d'une configuration ou d'une valeur de cellule : conditions et transformations passent par des opérateurs nommés, sans `eval` ni `Function` (tests `HYG-01` et `SEC-02`). Les valeurs affichées sont écrites avec `textContent`, jamais `innerHTML` (test `HYG-04`).
- Traite toute valeur d'une ligne comme du texte non fiable, qu'elle vienne d'une personne, de l'API ou d'un formulaire public : elle est écrite telle quelle, jamais évaluée, lue comme une formule ni substituée une seconde fois (`{AutreColonne}` dans une valeur reste du texte) ; une valeur qui repère une ligne ne choisit que la ligne, la table et la colonne étant celles du graphe ; une comparaison n'est jamais une expression régulière ; un texte qui se lit « Infinity » reste un texte (tests `SEC-04`, `SEC-06` à `SEC-08`, `E2E-62`).

## Politique de sécurité de la page (CSP)

`default-src 'none'; script-src 'self' 'unsafe-eval' https://docs.getgrist.com/grist-plugin-api.js; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'`.

Les images viennent du site du widget (`'self'` : les captures de la prise en main, `img/tuto/`, en WebP) ou de la page elle-même (`data:` : les icônes) ; aucune d'un autre site (test `HYG-06`).

La page charge aussi un module de son propre site, `js/gfs.js`, et ceux du kit qu'il importe : `'self'` les couvre, aucune adresse n'est ajoutée (tests `HYG-06` et `HYG-15`).

Le script de Grist pose les couleurs de son thème dans une balise `<style id="grist-theme">` : `style-src 'self'` la refuserait, avec deux erreurs dans la console à chaque ouverture. La page porte donc un élément inerte de ce nom (`<template id="grist-theme">`), où le script écrit sans effet ; le widget garde son propre thème (test `E2E-45`). La politique n'est pas assouplie pour autant.

`'unsafe-eval'` est présent **uniquement à cause du script de Grist**, qui évalue ses propres modules : sans lui, l'objet `grist` n'existe pas et le widget ne peut pas demander l'accès au document. Le code du widget n'utilise pas `eval`. Point à signaler à l'audit.

## Limites connues

- Le widget n'exécute les automatisations que tant qu'il est ouvert dans un navigateur ; un seul onglet exécute à la fois (verrou dans la table `Automation`, relais après 20 s ; un onglet rechargé reprend tout de suite, test `E2E-49`).
- Le kit commun poste ses messages à GFS avec `targetOrigin '*'` et n'en compare pas l'origine : le cadre d'une app dans GFS a une origine opaque, qu'aucune comparaison ne reconnaîtrait. Il vérifie à la place que le message vient du cadre parent (`event.source`) et porte le contrat de GFS. Seule dans Grist, l'app n'écoute ni n'envoie aucun de ces messages.
- Un workflow actif réagit, sans geste de personne, à toute ligne créée ou modifiée que la vue reçoit, quelle qu'en soit l'origine (formulaire public, API, autre personne) : l'app ne distingue pas ces lignes. Il écrit avec les droits de la personne dont l'onglet exécute, et seulement ce que le graphe prévoit (ajouter une ligne, ou mettre à jour une ligne repérée par une clé, dans la table que le graphe nomme). Une ligne reçue pendant que personne n'a la vue ouverte n'est jamais traitée. Le détail est dans `GFS-ETAT.md` (consigne 009).
- La colonne « Auteur » du journal est l'email de la personne dont le navigateur exécute le widget, pas forcément celle qui a modifié la ligne d'origine.
- Les droits de l'utilisateur Grist sont respectés : le widget n'élève aucun droit.

## Signaler une vulnérabilité

Merci de ne pas ouvrir de ticket public : utiliser le signalement privé de GitHub (onglet « Security », « Report a vulnerability ») du dépôt, ou écrire à l'équipe Grist Factory.
