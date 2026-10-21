# Sécurité

Ce widget est destiné à être relu par la DINUM avant publication. Ce document résume ce qu'il fait et ne fait pas ; le détail est dans `docs/CDC_Widget_Grist_Automation_Builder.md` (§4.4).

## Ce que fait le widget

- S'exécute dans l'iframe d'un widget personnalisé Grist, avec l'accès complet au document (`requiredAccess: 'full'`), parce qu'il lit les tables et écrit les effets des automatisations.
- Ne contacte aucun serveur : aucun `fetch`, `XMLHttpRequest`, `WebSocket`, image ou police externes (tests `HYG-01` et `HYG-02`).
- Charge un seul script externe, `https://docs.getgrist.com/grist-plugin-api.js` (API officielle de Grist).
- Ne garde aucune donnée hors du document Grist : la configuration, le journal et le verrou d'exécution sont dans une seule table, `Automation`, créée avec l'accord de la personne.
- N'exécute jamais de code issu d'une configuration ou d'une valeur de cellule : conditions et transformations passent par des opérateurs nommés, sans `eval` ni `Function` (tests `HYG-01` et `SEC-02`). Les valeurs affichées sont écrites avec `textContent`, jamais `innerHTML` (test `HYG-04`).

## Politique de sécurité de la page (CSP)

`default-src 'none'; script-src 'self' 'unsafe-eval' https://docs.getgrist.com/grist-plugin-api.js; style-src 'self'; img-src data:; base-uri 'none'; form-action 'none'`.

`'unsafe-eval'` est présent **uniquement à cause du script de Grist**, qui évalue ses propres modules : sans lui, l'objet `grist` n'existe pas et le widget ne peut pas demander l'accès au document. Le code du widget n'utilise pas `eval`. Point à signaler à l'audit.

## Limites connues

- Le widget n'exécute les automatisations que tant qu'il est ouvert dans un navigateur ; un seul onglet exécute à la fois (verrou dans la table `Automation`, relais après 20 s).
- La colonne « Auteur » du journal est l'email de la personne dont le navigateur exécute le widget, pas forcément celle qui a modifié la ligne d'origine.
- Les droits de l'utilisateur Grist sont respectés : le widget n'élève aucun droit.

## Signaler une vulnérabilité

Merci de ne pas ouvrir de ticket public : utiliser le signalement privé de GitHub (onglet « Security », « Report a vulnerability ») du dépôt, ou écrire à l'équipe Grist Factory.
