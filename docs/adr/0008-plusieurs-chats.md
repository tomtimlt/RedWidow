# 0008 — Plusieurs chats, un Bypass de fenêtre

- Statut : accepté ; Bypass global et préférences partagées remplacés par l’[ADR 0036](0036-isolation-chats.md)
- Date : 2026-10-16

## Contexte

Une fenêtre n'a qu'une session (`packages/vscode/src/extension/extension.ts`) et l'hôte du Bypass ne garde qu'un lien (`packages/vscode/src/logic/bypass.ts`) : un nouvel `attach` envoie `null` à l'ancien. L'historique est une seule clé `warband.history`. Les cartes d'approbation vivent dans l'état de cette session. `BYPASSABLE` et la gate ne changent pas (ADR 0006).

## Décision

1. **Une session, un moteur, par chat.** Au plus 4 chats. Fermer un chat arrête son moteur (`kill`, qui envoie l'état nul à ce moteur seul) et ne touche pas les autres.
2. **Bypass global, liens multiples.** L'interrupteur reste celui de la fenêtre. `attach` ajoute un lien, il ne remplace plus. L'affichage « actif » exige l'accusé conforme de chaque lien vivant. `reset`, expiration, accusé non conforme ou délai d'accusé coupent l'interrupteur pour tous les liens. Libérer un lien (chat fermé, moteur sorti) ne coupe pas les autres.
3. **Historique par chat.** Clé `warband.history.<id>`. Le chat de la barre latérale (`sidebar`) relit encore `warband.history` si la nouvelle clé est vide. Ses journaux restent dans `runs/` ; les autres chats ont `runs/<id>/`.
4. **Cartes.** Chaque session a son état et son `onView`. Une carte n'est poussée qu'à la surface de son chat.

Ouvrir une ancienne conversation appelle toujours `bypass.reset()` (ADR 0006) : l'interrupteur global retombe, donc tous les moteurs.

## Alternatives écartées

- **Un Bypass par chat.** Contredirait l'interrupteur unique de la fenêtre.
- **Garder un seul lien et couper les autres moteurs à chaque `attach`.** Fermer ou ouvrir un chat éteindrait le Bypass des autres.

## Conséquences

- Tant qu'un moteur n'a pas accusé, le badge n'est pas « actif », même si les autres l'ont déjà confirmé.
- Modèle et effort restent dans `globalState` (communs à la fenêtre). Seuls l'historique et la session d'agent sont par chat.
- `BYPASSABLE` et la gate ne sont pas modifiés.

## Plan

Fichiers : `bypass.ts`, `session.ts`, `extension.ts`, tests bypass et session. Critères : deux liens reçoivent l'état ; en libérer un laisse l'autre actif ; `reset` envoie `null` aux deux ; deux sessions n'échangent pas leurs cartes ; l'index s'écrit sous la clé du chat.
