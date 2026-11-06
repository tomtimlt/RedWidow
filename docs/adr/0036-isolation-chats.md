# 0036 — Isolation du Bypass et des préférences entre chats

- Statut : accepté
- Date : 2026-11-06
- Remplace les décisions de partage du Bypass et des préférences de l'ADR 0008.

## Contexte

Plusieurs chats peuvent fonctionner simultanément. Un interrupteur de fenêtre et des préférences d'exécution partagées permettent au choix effectué dans un chat de modifier les autres ou leurs valeurs initiales.

## Décision

Chaque chat possède son hôte Bypass en mémoire, initialement désactivé. Il communique uniquement avec ses moteurs et traite leurs accusés ; expiration, erreur d'accusé, remise à zéro, ouverture d'une conversation et fermeture restent locales au chat. Un changement de projet ou de dossier peut explicitement désactiver tous les hôtes. La barre d'état identifie le chat actif et son action désactive son seul Bypass. Le contrat de la gate et l'exclusion de l'apprentissage restent inchangés.

Les préférences de fournisseur, modèle, effort et variante sont stockées par chat dans le workspace ; les anciennes clés globales propres au chat restent lisibles comme repli de compatibilité. L'ancienne clé `warband.prefs` est lue seulement comme valeur initiale de compatibilité, jamais écrite. Les sélections de profil, Web et MCP sont locales à la session. Les réglages System control restent le catalogue et les valeurs par défaut globaux. L'historique commun reste inchangé.

## Conséquences

Activer, arrêter ou réinitialiser un chat ne change pas les autres. Les réglages machine demeurent administrables globalement ; les choix locaux ne modifient pas ces réglages. Le Bypass n'est jamais persisté.
