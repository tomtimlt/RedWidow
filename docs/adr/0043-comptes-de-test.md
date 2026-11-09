# ADR 0043 — Comptes de test

Statut : accepté le 9 novembre 2026.

## Contexte

Les missions de bug bounty, de CTF et de pentest utilisent souvent plusieurs comptes de test jetables. L’agent doit pouvoir les employer simplement pour naviguer et comparer les droits, sans les diffuser dans les journaux ou les exports.

## Décision

Les comptes sont propres à un projet et stockés dans SecretStorage de VS Code. Une page « Comptes de test » du groupe Projet permet de saisir un libellé, un site facultatif, un identifiant et un mot de passe ou cookie. Les valeurs sont transmises au moteur par son IPC privé validé.

Le contexte de mission expose les comptes au modèle. Les jetons `{{compte:A:identifiant}}` et `{{compte:A:secret}}` sont utilisables dans `http_request`, `exec` et `task_start`, ainsi que les variables `RW_COMPTE_A_IDENTIFIANT` et `RW_COMPTE_A_SECRET`. Il n’y a pas de restriction d’hôte attachée au compte : la politique, la gate et la fiche programme restent applicables. Une session HTTP conserve ses cookies en mémoire selon leurs règles de domaine, chemin et sécurité.

Le recorder masque les valeurs avant tout sink ; les journaux, le fil exporté et les ZIP d’audit ne doivent pas les contenir. Les valeurs de cookies reçus restent masquées même après expiration. La copie du contexte envoyée à l’interface est masquée ; le modèle reçoit le contexte complet.

## Conséquences

Les comptes doivent être jetables et fournis pour la mission. Leur utilisation reste soumise aux contrôles existants sur les actions et leurs arguments effectifs. Les arguments explicites des tâches supervisées sont conservés dans le registre privé du conteneur, y compris les valeurs substituées ; ils ne sont pas ajoutés au journal ni à l’export. Leur disponibilité dans le contexte du modèle permet à celui-ci de les utiliser directement ; ils ne sont pas ajoutés à l’environnement du fournisseur.

## Captures de l’interface

Réglages avant ajout : [sombre](../img/comptes-test-avant-sombre.png), [clair](../img/comptes-test-avant-clair.png).
Page Comptes de test : [sombre](../img/comptes-test-sombre.png), [clair](../img/comptes-test-clair.png), [mobile sombre](../img/comptes-test-sombre-mobile.png), [mobile clair](../img/comptes-test-clair-mobile.png).
