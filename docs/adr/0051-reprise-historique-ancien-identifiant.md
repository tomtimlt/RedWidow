# 0051 — Reprise de l'historique de l'ancien identifiant d'extension

- Statut : accepté
- Date : 2026-11-11

## Contexte
La 1.0.1 a renommé l'extension : `warband.warband` est devenu `tomtimlt.redwidow` (commit 7835991, `packages/vscode/extension.manifest.json`). VS Code range `globalState`, `workspaceState`, `globalStorageUri` et `storageUri` par identifiant d'extension. La nouvelle version démarre donc avec un historique vide. Les anciennes données restent sur le disque :
- l'index de chaque fenêtre est dans `…/User/workspaceStorage/<hash>/state.vscdb`, une base SQLite avec une table `ItemTable`. La clé `warband.warband` y contient un JSON qui regroupe toutes les clés de `workspaceState`, dont `warband.history.shared.v1` et les anciennes clés `warband.history*` ;
- les journaux sont dans `…/workspaceStorage/<hash>/warband.warband/runs` et `…/User/globalStorage/warband.warband/runs`.

L'ADR 0049 (historique global entre projets) a placé l'index dans `globalState`, qui part lui aussi vide.

## Décision
1. Une seule fois (marqueur dans `globalState`), à l'activation, l'extension cherche l'ancien identifiant à côté de ses propres dossiers de stockage :
   - `dirname(globalStorageUri)/warband.warband` ;
   - pour **chaque** dossier `dirname(dirname(storageUri))/*/`, le sous-dossier `warband.warband/runs` et le fichier `state.vscdb`.
2. Index : la base `state.vscdb` est lue en lecture seule avec `node:sqlite` s'il est disponible. On lit la valeur `warband.warband` de `ItemTable`, puis les clés d'historique, analysées par `parseIndex`. Les entrées sont fusionnées dans l'index global par la même fusion que l'ADR 0049 (par id, runIds réunis).
3. Si `node:sqlite` est absent ou que la lecture échoue, l'index est reconstruit depuis les journaux : une conversation par journal, titre tiré du premier message utilisateur, date du journal, « Sans projet ». Une erreur n'interrompt jamais l'activation.
4. Les journaux restent à leur place. La lecture les cherche aussi dans les dossiers `runs` trouvés, en plus des emplacements de l'ADR 0049.
5. Rien n'est écrit, déplacé ni supprimé sous l'ancien identifiant.

## Alternatives écartées
- Revenir à l'ancien identifiant : la publication sous `tomtimlt.redwidow` est déjà faite.
- Demander à l'utilisateur d'exporter et d'importer : trop lourd pour une perte qu'il n'a pas provoquée.

## Conséquences
- Ces chemins sont internes à VS Code. Ils sont lus seulement s'ils existent, et leur absence est sans effet.
- La lecture se limite aux données de l'extension elle-même. Aucun secret n'est dans ces clés : les jetons sont dans `SecretStorage`, qui n'est pas lu.
