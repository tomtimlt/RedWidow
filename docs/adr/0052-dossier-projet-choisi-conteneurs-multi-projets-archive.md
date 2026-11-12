# 0052 — Dossier de projet choisi, conteneurs multi-projets, archive de projet

- Statut : accepté (remplace, dans l'ADR 0047, la création sous `~/.exegol/workspaces/<slug>` et la création « nom seul »)
- Date : 2026-11-12

## Contexte
Un projet est créé sous `~/.exegol/workspaces/<slug>`, ou sous le réglage machine `warband.projects.workspaceRoot` (`packages/core/src/project-workspace.ts:21-22`, `extension.ts:4328-4343`). Ce défaut vient d'Exegol et n'a pas de sens pour un conteneur Kali. Il n'existe aucun moyen de reprendre un dossier existant comme projet : `createSelectedProject` accepte un dossier (`packages/vscode/src/logic/project-controls.ts:31-39`), mais rien ne l'appelle.

Le dossier partagé d'un conteneur est choisi à sa création (ADR 0050). Le moteur exige que le dossier du projet soit dans ce partage. Sinon, `project.workspaceNotMounted` remonte sans être rattrapé (`packages/vscode/src/engine/main.ts:170`, `engine.ts:199`), et l'utilisateur n'a aucune issue. Un message promet « une migration explicite » qui n'existe pas (`packages/messages/src/ui-domains/cockpit.ts:13`, clé inutilisée).

Un conteneur peut déjà servir plusieurs projets si son partage est un dossier parent, mais rien ne le montre. Docker ne permet pas d'ajouter un montage à un conteneur existant.

Il n'existe pas d'export ni d'import de projet. L'export d'audit (`packages/vscode/src/logic/audit-export.ts`) est une preuve en lecture, pas une sauvegarde réimportable.

## Décision
1. **Dossier du projet sans valeur par défaut.** Créer un projet demande un nom et un dossier parent choisi par le sélecteur natif de l'hôte. Le dossier `<parent>/<slug>` est alors créé de façon exclusive. Le défaut `~/.exegol/workspaces` est supprimé du cœur. Le réglage `warband.projects.workspaceRoot` n'est plus lu pour créer un projet.
2. **Reprise d'un dossier existant.** « Ouvrir un dossier comme projet » enregistre un projet sur un dossier existant choisi par le sélecteur. Les vérifications sont celles d'un dossier partagé : chemin réel, pas de lien symbolique, `mountExposesSensitive` nul. Rien n'est écrit dans le dossier hors des six sous-dossiers usuels, créés seulement s'ils manquent.
3. **Création dans un conteneur.** On peut aussi créer un projet comme sous-dossier du partage d'un conteneur choisi. La liaison passe alors par le parcours vérifié existant.
4. **Deux modes de conteneur.** « Conteneur projet » : le partage est le dossier d'un projet. « Conteneur multi-projets » : le partage est un dossier parent choisi (ADR 0050). Dans les deux cas, un projet peut utiliser un conteneur si et seulement si son dossier est dans le partage (`projectInSharedFolder`, inchangé). Le cockpit affiche, pour chaque conteneur, les projets enregistrés contenus dans son partage, et pour chaque projet, les conteneurs compatibles.
5. **Partage incohérent : une issue, pas un arrêt muet.** `project.workspaceNotMounted` est rattrapé côté moteur. Le tour est refusé avant toute action d'agent, comme aujourd'hui. L'interface reçoit le code et ses paramètres, puis propose trois actions : créer un conteneur projet pour ce dossier, choisir un conteneur compatible, ou déplacer le projet dans le partage d'un conteneur. La clé « migration explicite » est supprimée.
6. **Déplacement de projet.** Il se fait toujours après confirmation humaine, vers un dossier parent choisi par le sélecteur. Mêmes vérifications qu'en 2. La destination ne doit pas exister. Le déplacement est un `rename` si les deux dossiers sont sur le même volume. Sinon, c'est une copie (sans suivre les liens), une vérification, puis la suppression de la source. Le registre n'est mis à jour qu'après la réussite. Les liaisons à des conteneurs qui ne voient plus le projet sont retirées.
7. **Archive de projet `.rwproj`.** C'est un zip qui contient :
   - `redwidow-project.json` : `format: "redwidow-project"`, `version: 1`, `project {id, name}`, `exportedAt`, `files[] {path, size, sha256}` ;
   - `workspace/…` : le dossier du projet, sans liens symboliques ni marqueurs `.redwidow-share-*` ;
   - `data/…` : `<configDir>/projects/<id>/`, journaux d'audit compris (déjà masqués à l'écriture).
   L'historique de conversation global (ADR 0049) n'est pas inclus dans la version 1. Les liaisons aux conteneurs ne sont pas exportées : un conteneur est local à une machine.
8. **Import.** C'est le manifeste qui reconnaît une archive, pas l'extension du fichier. Chaque entrée est validée : chemin relatif sous `workspace/` ou `data/`, pas de `..`, pas de chemin absolu, pas de lien symbolique, pas de doublon. Elle doit être présente au manifeste, avec la bonne taille et la bonne empreinte SHA-256. Les entrées hors manifeste sont refusées. Des plafonds s'appliquent : nombre d'entrées, taille par fichier, taille totale, taux de compression. L'extraction se fait dans un dossier temporaire voisin, puis un `rename` atomique vers `<parent choisi>/<slug>`. Le dossier parent est choisi par le sélecteur, sans valeur par défaut. L'id d'origine est conservé s'il est libre, sinon un nouvel id est attribué. Tout refus laisse le disque et le registre intacts.

## Alternatives écartées
- Garder un dossier racine par défaut : il n'a de sens que pour Exegol.
- Lien symbolique du projet dans un partage existant : le montage Docker ne suit pas un lien qui sort du dossier monté.
- Recréer automatiquement un conteneur avec un autre montage : cela détruit son état sans accord explicite.
- Réutiliser l'export d'audit comme archive : son format est une preuve, sans `workspace/` ni `data/` complets.

## Conséquences
- Les projets existants ne changent pas d'emplacement.
- L'invariant de partage n'est pas affaibli : un projet que le conteneur ne voit pas ne lance jamais d'action d'agent.
- La lecture de zip entre dans l'extension (`yauzl`, déjà utilisé par le CLI).
- Nouveaux codes de raison pour l'archive, l'import et le déplacement, à ajouter aux catalogues fr et en.
