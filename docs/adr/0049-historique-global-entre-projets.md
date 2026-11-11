# 0049 — Historique global entre projets

- Statut : accepté
- Date : 2026-11-11

## Contexte
Le filtre « Tous les projets » de l'historique n'affiche que les conversations du projet courant. L'index partagé est rangé dans `context.workspaceState` (`packages/vscode/src/extension/extension.ts:332-338`) et les journaux dans `context.storageUri/runs` (`extension.ts:340-343`). Ces deux emplacements dépendent du dossier ouvert. Or chaque projet ouvre son propre dossier (`openActiveProjectWorkspace`, `extension.ts:4122`). Une fenêtre ne voit donc jamais les conversations des autres projets. Le filtre de la webview (`media/chat.js:1537-1556`) n'est pas en cause.

La reprise d'une conversation d'un autre projet est déjà refusée (`logic/session.ts:1574`) : le moteur tourne dans le dossier et sous la politique du projet actif.

## Décision
1. L'index de l'historique passe dans `context.globalState` sous une nouvelle clé, et les nouveaux journaux dans `context.globalStorageUri/runs`. L'historique devient commun à toutes les fenêtres et à tous les projets.
2. Migration à l'activation : l'index de `workspaceState` (`warband.history.shared.v1` et les anciennes clés) est fusionné dans l'index global. Les anciens journaux restent lisibles à leur emplacement d'origine (`storageUri/runs`) : la lecture essaie le dossier global, puis l'ancien. Chaque projet migre la première fois que sa fenêtre s'ouvre.
3. `globalState` est partagé entre fenêtres : une mise à jour relit l'état stocké avant d'appliquer son changement, pour ne pas écraser l'écriture d'une autre fenêtre. `historyRefresh` relit l'index.
4. Une conversation d'un autre projet s'ouvre en lecture seule. « Reprendre » affiche un avertissement modal qui nomme son projet. Si l'utilisateur confirme, on change de projet par le même chemin que le Studio (mêmes refus si des tours tournent, `resetAllBypass`, ouverture du dossier du projet). La conversation est mémorisée pour être rouverte en lecture seule dans la fenêtre du projet. L'utilisateur la reprend alors depuis là, sous la politique de ce projet.

## Alternatives écartées
- Lire les dossiers `workspaceStorage` des autres fenêtres : chemins internes à VS Code, non stables.
- Reprendre directement sans changer de projet : le moteur tournerait dans le mauvais dossier, sous la mauvaise politique.

## Conséquences
- La rétention s'applique désormais à l'ensemble des projets.
- Les journaux d'un projet jamais rouvert depuis la migration restent invisibles jusqu'à sa prochaine ouverture.
- Aucun invariant de sécurité n'est touché : la reprise reste soumise au projet actif, et le Bypass est coupé au changement de projet.
