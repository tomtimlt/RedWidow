# 0013 — Projets, allowlist d'exécution, trouvailles

- Statut : accepté
- Date : 2026-10-22
- S'appuie sur : ADR 0007 (le nom exécuté est celui de la liste courante), ADR 0008 (les chats ne portent pas de projet), ADR 0011 (famille), ADR 0012 (le label Kali n'autorise rien à lui seul)
- Amendé par : ADR 0014 (un Kali `running` avec `/workspace` se lie ; son exécution est `resolveKaliContainer`, pas l'exec Exegol)

## Contexte

`project.json` est un seul objet `{ container, workspace }` (`packages/core/src/project.ts:12-15`). Le code de ce commit exige encore `family === "exegol"`, l'état `running` et un montage `/workspace`, puis remplace tout le fichier (`project.ts:80-91`). La décision amendée accepte aussi un Kali. `readProject` lève `project.invalid` si le JSON n'est pas exactement ces deux clés (`project.ts:31-41`, `99-115`).

`resolveExegolContainer` (`packages/core/src/exegol/targets.ts:70-88`) ne retient que `family === "exegol"`. Sans `@`, le nom demandé doit être le dédié. Avec des `@`, n'importe quel Exegol de la liste courante cité dans le message suffit : le dédié ne borne pas cet ensemble. Le dédié est copié au moment du message (`packages/vscode/src/engine/main.ts:29-35`), pas relu dans l'outil.

`findings.json` est unique dans le dossier de config (`packages/core/src/exegol/findings.ts:6`, `82-83`). Plafond 200. `Finding.state` est l'avancement. Le studio recalcule la disposition ; il n'y a pas de fichier de graphe. L'outil `note` écrit toujours dans ce fichier global (`packages/core/src/exegol/tool-specs.ts:87`).

`loadPolicy` (`packages/core/src/approval/source.ts:115-159`) : chemin explicite, puis `.warband/policy.json` du `cwd` si l'empreinte est approuvée, puis politique utilisateur, puis défaut. Le moteur appelle `policyLoader(params.cwd)` avec le dossier ouvert (`packages/vscode/src/engine/engine.ts:160-171`). Le `cwd` de la gate est le même `params.cwd`. L'extension ne fournit pas `persistRule`. Il n'y a pas d'éditeur de règles. Aucun champ projet sur la conversation (`sessionId`, journaux JSONL).

Menace. Le modèle choisit l'argument `container` de `exec` et le texte de `note`. Il ne doit pas choisir l'allowlist, l'identifiant de projet, ni le fichier de trouvailles. Qui lance `docker run` contrôle les noms et les labels : la famille se recalcule sur la liste courante, elle n'est pas stockée comme une autorisation. Un `deny`, un chemin sensible et la gate ne se mémorisent pas. Accepter un nom qui n'est pas dans la liste courante est un contournement. Faire passer un Kali par `mcp__exegol__exec` aussi : son exécution est l'ADR 0014.

## Décision

1. **Un fichier, une liste.** `project.json` devient `{ activeId, projects }`. Chaque projet est `{ id, name, workspace, containers }`. `id` est un UUID v4 canonique en minuscules. `workspace` est absolu. `containers` est une liste de noms Docker, sans doublon, au plus 32. Au plus 32 projets. Clés exactes : une clé en trop, un type faux, un `activeId` qui ne désigne aucun projet, un id qui n'est pas un UUID v4, un chemin relatif, est `project.invalid`. Fichier absent : `null`. `activeId` null avec une liste non vide est valide et signifie qu'aucun projet n'est actif.

2. **Migration.** L'objet exact `{ container, workspace }` (workspace absolu, les deux chaînes non vides) devient un projet : `containers: [container]`, `name` = nom court (`shortContainerName`), `id` tiré une fois, `activeId` = cet id. `readProjects` réécrit alors le fichier (même écriture atomique, mode `0o600`) et, si `findings.json` est à la racine du dossier de config, le déplace vers le fichier de trouvailles de ce projet sans le relire. Destination déjà présente : on laisse le fichier global, on ne l'écrase pas. Une seconde lecture retrouve le même id. Toute autre forme reste `project.invalid` et n'est pas réécrite.

3. **Écriture, pas un outil.** Aucune fonction ne pose un tableau de noms sans regarder la liste. `associateContainer` ajoute le nom réel renvoyé par `lookupContainer` sur `listLabelPrefix` (toutes familles). Absent ou ambigu : `project.notFound`, fichier inchangé. Déjà présent : rien. Au-delà de 32 : `project.invalid`, fichier inchangé. Un Kali est stocké. `dissociateContainer`, `createProject`, `setActiveProject`, `removeProject` ne sont pas des outils MCP. `createProject` ne parle pas à Docker : nom 1 à 80 caractères sans CR, LF ni NUL ; workspace absolu, au plus 1024 caractères, sans NUL ; `containers` vide. S'il n'y a pas de projet actif, le nouveau le devient. Sinon l'actif ne change pas. `setActiveProject` refuse un id inconnu (`project.absent`). `removeProject` retire le projet et, s'il était actif, met `activeId` à null sans en activer un autre. Dernier projet retiré : le fichier est supprimé. Les trouvailles de ce projet restent sur le disque. `unlink` est `removeProject` du projet actif ; sans actif, ou fichier absent : rien.

4. **`link` ne remplace plus le fichier.** Refus, dans cet ordre : absent de la liste (`project.notFound`), famille autre que `exegol` ou `kali` (`project.notExegol`), pas `running` (`project.notRunning`), pas de montage `/workspace` (`project.noWorkspace`). Le montage non absolu est traité comme absent. Les deux familles passent. Ensuite, s'il n'y a pas de projet actif, `createProject` avec le nom court et ce montage, puis `associateContainer` du nom réel sur le projet actif. Un projet déjà actif garde son `workspace`. `link` n'enlève pas les noms déjà présents. Un refus n'écrit rien.

5. **Filtre d'exécution.** `ExegolTarget.dedicated` disparaît. La cible notée au message est `{ allowed, mentions, projectId }`. `allowed` est la copie des `containers` du projet actif à ce moment. Projet absent, `activeId` null, ou `project.json` illisible : `allowed` vide et `projectId` null. L'outil ne relit pas le fichier. `resolveExegolContainer` :
   - résout le nom demandé avec `lookupContainer` sur les seules entrées `family === "exegol"` de la liste courante (un champ `family` absent ne compte pas) ;
   - le nom réel doit être une entrée exacte de `allowed` ;
   - avec des `@`, ce nom réel doit être l'un des `@` résolus sur cette même liste Exegol ;
   - sans `@`, l'intersection entre `allowed` et les noms Exegol de la liste courante doit contenir exactement ce nom, et aucun autre.
   Sinon `exegol.containerDenied`. Un Kali de l'allowlist n'est jamais résolu par cet exec. Il l'est par `resolveKaliContainer` (ADR 0014) : même intersection, liste filtrée `family === "kali"`. Un nom hors liste, un court ambigu sur la liste de la famille, ou un nom cité par `@` mais absent de l'allowlist, est refusé. L'ordre est celui-ci : la liste de la famille d'abord, l'allowlist ensuite. On ne résout pas le court nom dans l'allowlist seule.

6. **Politique.** Pas de langage de règles du projet. Hors mode apprentissage, le `cwd` effectif du run est le `workspace` du projet actif lu au `start` s'il est absolu, sinon le `cwd` du `start`. `policyLoader`, le `workspace.cwd` de la gate et le `cwd` du `runner.run` reçoivent cette même chaîne. `configDir` de `loadPolicy` reste le dossier de config utilisateur. Le mode apprentissage ne lit pas le projet pour le `cwd` et garde sa politique figée. Une lecture invalide n'échoue pas le run : on garde le `cwd` du `start`, et l'allowlist du message reste vide. Le `cwd` ne change pas en cours de run. L'allowlist, elle, est relue à chaque message.

7. **Trouvailles.** Même format, plafond 200, mêmes `Finding.state`. Chemin : `<configDir>/projects/<id>/findings.json`. L'id passe par le contrôle UUID avant tout `join`. `readFindings` et `appendFinding` prennent cet id. L'outil `note` utilise `projectId` de la cible notée. `null` : `project.absent`, aucun fichier écrit. L'argument du modèle ne contient pas d'id de projet. Deux projets ne partagent pas ce fichier. Le fichier global n'est plus lu, sauf le déplacement du point 2.

8. **Écran.** Ce lot ne ajoute ni sélecteur de projet, ni message webview, ni bouton. Le bandeau, la barre et le terminal existants ne retiennent un conteneur que lorsque l'allowlist active en a exactement un. Zéro ou plusieurs : le dossier du projet s'ouvre encore, le terminal et la barre ne choisissent pas un nom. `canLink` est vrai pour un Exegol ou un Kali `running` avec `/workspace`, faux s'il est arrêté, sans montage, ou déjà dans l'allowlist (ADR 0014). Start et stop ne sont pas filtrés par l'allowlist ni par la famille.

## Alternatives écartées

- **Garder un champ `dedicated` en plus de l'allowlist.** Il peut désigner un Kali, ou diverger de la liste. Le seul Exegol vivant de l'allowlist suffit pour le message sans `@`. Zéro ou plusieurs : refus, il faut un `@` qui soit dans l'allowlist.
- **Accepter sans `@` n'importe quel nom de l'allowlist demandé par le modèle.** Avec plusieurs Exegol, le modèle choisirait sans que le message l'ait cité. C'est plus large que le dédié actuel.
- **Résoudre le nom court dans l'allowlist avant la liste complète.** Un court ambigu sur deux Exegol vivants deviendrait unique si un seul est allowlisté, contre l'ADR 0007.
- **Relire `project.json` dans l'outil `exec`.** Un élargissement de l'allowlist pendant le message s'appliquerait sans nouveau message utilisateur.
- **Politique ou graphe propre au projet.** `loadPolicy` du `workspace` et `Finding.state` existent. Un second format doublonnerait la gate ou le studio.
- **Un dossier de config par projet pour `project.json`.** Le fichier unique garde l'écriture atomique déjà là. L'isolement des trouvailles est le répertoire par id.
- **Exécuter un Kali parce que son nom est dans `containers`, sans le reclasser.** La famille est recalculée. Le nom stocké n'est pas une autorisation. Un Kali n'est exécutable que si la liste courante le classe `kali`, et seulement par les outils de l'ADR 0014.
- **Faire de `link` le remplacement historique.** Le second conteneur effacerait l'allowlist et rouvrirait le dédié unique, y compris si l'appelant finissait par y passer un Kali.

## Conséquences

- Un `@` ne vise plus tous les Exegol de la machine, seulement l'intersection avec l'allowlist du projet actif.
- Ajouter un second Exegol à l'allowlist coupe l'exécution implicite (sans `@`) jusqu'à ce que le message en cite un. C'est le coût du refus en cas d'ambiguïté.
- Un Kali associé se démarre, s'arrête et s'affiche. L'exec Exegol le refuse. Les outils Kali l'acceptent seulement si la liste courante le classe `kali` (ADR 0014). L'inverse est un résidu de l'ADR 0007 : si le même nom Docker change de famille et qu'il est resté dans l'allowlist, la nouvelle famille s'applique. On ne stocke pas l'identifiant de conteneur.
- Le montage `/workspace` d'un conteneur associé peut différer du `workspace` du projet. L'allowlist ne prouve pas cette égalité. La politique et la gate utilisent le `workspace` du projet, pas le montage.
- Politique et `cwd` sont figés au `start`. L'allowlist suit le projet actif au message suivant. Reprendre une conversation n'y attache pas l'ancien projet : le projet actif du moment s'applique. On n'ajoute pas de champ sur la conversation.
- Les chats d'une même fenêtre partagent ce projet actif.
- `link` sur un Kali `running` avec montage écrit, comme pour un Exegol. Un conteneur arrêté ou sans montage n'écrit rien.
- Start et stop d'un conteneur listé mais non associé restent possibles.
- Course entre deux migrations : la dernière écriture gagne. Pas une autorisation d'exécution.

## Plan

Un seul lot, P1. Le brief pour `dev` est la section suivante.

### Objectif

Remplacer l'objet unique par la liste de projets, migrer l'ancien fichier, isoler les trouvailles par projet, et n'autoriser l'exec Exegol que pour un nom de l'allowlist du projet actif qui est `exegol` sur la liste courante. Un Kali de l'allowlist passe par `resolveKaliContainer` (ADR 0014), pas par cet exec. Si le lot K2 n'est pas encore dans l'arbre, ce lot ne le réécrit pas : il ne réintroduit pas le refus de `link` sur un Kali.

### Fichiers

- `packages/core/src/project.ts`
- `packages/core/src/exegol/targets.ts`
- `packages/core/src/exegol/findings.ts`
- `packages/core/src/exegol/tool-specs.ts` (cible notée et chemin des trouvailles seulement)
- `packages/messages/src/fr.ts` et `packages/messages/src/en.ts` (phrase de `exegol.containerDenied` seulement)
- `packages/vscode/src/engine/engine.ts` (`resolveCwd` seulement)
- `packages/vscode/src/engine/main.ts`
- `packages/vscode/src/extension/extension.ts` (lecture du projet, envoi, studio, barre, terminal, dossier)
- `packages/vscode/src/logic/cockpit.ts` (bannière et `linkContainer` seulement ; `controlListedContainer` inchangé)
- `packages/core/test/project.test.ts`
- `packages/core/test/exegol-targets.test.ts`
- `packages/core/test/exegol-findings.test.ts`
- `packages/vscode/test/cockpit.test.ts`
- `packages/vscode/test/engine.test.ts`

Ne pas modifier `approval/source.ts`, `approval/policy.ts`, `approval/shell.ts`, `docker/client.ts`, `reason.ts`. `packages/core/src/index.ts` réexporte déjà ces modules.

### Décision

Reprendre les huit points de la section Décision. Détail que `dev` ne doit pas réinventer :

- `readProject` disparaît. `readProjects(configDir): Promise<ProjectFile | null>`. `activeProject(file): StoredProject | null` retourne le projet dont l'id est `activeId`, ou `null` si `activeId` est null. `ProjectFile = { activeId: string | null; projects: readonly StoredProject[] }`. `StoredProject = { id: string; name: string; workspace: string; containers: readonly string[] }`.
- Écriture atomique inchangée (`renameWithRetry`, mode `0o600`). Pas de fonction publique qui écrit un JSON arbitraire.
- `associateContainer(configDir, projectId, name, docker)` stocke le nom réel de la liste, pas le jeton court. Famille indifférente. Projet inconnu : `project.absent`.
- `link` appelle cette association seulement après les refus du point 4 (les deux familles). Il ne supprime pas `containers` et ne change pas le `workspace` d'un projet déjà actif.
- `createExegolTargets` : état initial `{ allowed: [], mentions: [], projectId: null }`. `note(text, allowed, projectId)` copie `allowed` et parse les `@` comme aujourd'hui (`promptForTargets`).
- `resolveExegolContainer` suit le point 5. Les tests qui passaient un `dedicated` passent `allowed: [nom]` quand le cas est l'ancien dédié unique, et une allowlist plus large quand le cas est un `@`. Un `@` vers un Exegol hors `allowed` lève `exegol.containerDenied`. Deux Exegol dans `allowed` et dans la liste, sans `@`, refusent même si le nom demandé est l'un des deux. Un seul Exegol allowlisté et vivant, sans `@`, accepte ce nom. Un Kali allowlisté, seul ou cité, est refusé par `resolveExegolContainer`. Une entrée sans `family` refuse. Un court nom ambigu sur la liste Exegol refuse même si un seul des deux noms est dans `allowed`. Si `resolveKaliContainer` existe déjà (ADR 0014), les mêmes règles d'intersection s'y appliquent avec `family === "kali"` : un Exegol allowlisté y est refusé.
- Libellés de `exegol.containerDenied` : fr `conteneur non autorisé pour ce message : … (Exegol de l'allowlist du projet)` ; en `container not allowed for this message: … (Exegol container on the project allowlist)`.
- `readFindings(configDir, projectId)` et `appendFinding(configDir, projectId, input)`. Id qui n'est pas un UUID v4 : `project.invalid`, avant toute lecture. Fichier absent : `[]`. L'outil `note` n'écrit pas si `projectId` est null (`project.absent`).
- `runEngine` gagne `resolveCwd?: (cwd: string) => Promise<string>`. Appelé seulement si le mode n'est pas `learning`, avec le `cwd` du `start`. Retour non absolu, vide, ou exception : on garde le `cwd` du `start`. Ce `cwd` effectif est celui de `policyLoader`, de `workspace.cwd` et de `runner.run`. `journalDir` fourni ne change pas. `main.ts` passe un résolveur qui lit `readProjects` : projet actif avec workspace absolu, sinon le `cwd` reçu. Exception de lecture : le `cwd` reçu.
- `onPrompt` de `main.ts` : lecture invalide ou sans projet actif → `note(text, [], null)`. Sinon `note(text, projets.containers, id)`.
- Envoi dans l'extension : sans `@` et sans `#`, bloquer seulement s'il n'y a pas de projet actif ou si son allowlist est vide. Ne pas refuser ici un Kali : le cœur refuse l'exec. Fichier invalide : même blocage que sans projet.
- `linkedProjectStatus` : `null` sans projet actif. Sinon `{ workspace, container, image, state }` où `container` est le nom unique de l'allowlist, ou `null` s'il n'y en a pas exactement un. `image` et `state` décrivent cette unique ligne vivante ; ligne absente : `image` null et `state` `"absent"`. Plusieurs noms : `container` null, `image` null, `state` null. Le terminal et la barre ne font rien sans ce `container` (barre masquée). L'ouverture de dossier utilise `workspace` dès que le statut n'est pas `null`.
- Bannière du cockpit : exactement un nom dans l'allowlist active → même bannière qu'aujourd'hui pour ce nom, avec le `workspace` du projet. Zéro ou plusieurs → pas de bannière unique. Une ligne est `linked` si son nom est dans l'allowlist. `canLink` est faux pour un conteneur arrêté, un conteneur sans montage, ou un nom déjà dans l'allowlist. Il est vrai pour un Kali dans les mêmes conditions qu'un Exegol. `linkContainer` appelle `link`, pas un remplacement du fichier. Pas de libellé d'écran nouveau.
- Instructions de l'outil `exec` : le conteneur est un Exegol de l'allowlist du projet ; sans un seul Exegol allowlisté et vivant, le message doit l'avoir cité avec `@`. Pas de shell. Le conteneur doit déjà tourner.

### Critères

- Un `project.json` `{ container, workspace }` avec workspace absolu est relu en un projet actif, même id à la seconde lecture, et `findings.json` global se retrouve sous `projects/<id>/findings.json`.
- JSON tronqué, clé en trop, workspace relatif, `activeId` inconnu : `project.invalid`, fichier non réécrit.
- `link` sur un arrêté ou un sans montage n'écrit pas (`project.notRunning`, `project.noWorkspace`). `link` sur un Exegol ou un Kali en cours avec montage ajoute son nom réel. Un second `link` garde le premier nom et le premier `workspace`.
- `associateContainer` sur un Kali listé ajoute le nom. `resolveExegolContainer` le refuse, avec ou sans `@`. `resolveKaliContainer`, s'il est déjà là, l'accepte quand il est le seul Kali de l'intersection, ou quand le `@` le cite.
- Deux projets : `appendFinding` de l'un est absent de `readFindings` de l'autre. L'outil `note` sans `projectId` n'écrit aucun fichier.
- `pnpm check` vert. Commit en français, sans pousser.

### Interdits

Pas d'écran de choix, pas de message webview nouveau, pas d'éditeur de politique, pas de `persistRule`. Ne pas faire passer un Kali par `mcp__exegol__exec`. Ne pas réintroduire le refus de `link` sur un Kali `running` avec `/workspace`. Ne pas filtrer start/stop par famille ni par allowlist. Ne pas relire `project.json` dans l'outil `exec`. Ne pas laisser le modèle passer un id de projet ou un chemin de trouvailles. Ne pas changer `Finding.state`, le plafond 200, ni ajouter un fichier de graphe. Ne pas mettre de projet sur la conversation. Ne pas affaiblir la gate, `loadPolicy`, ni `dockerRunHazard`. Ne pas modifier `DockerClient.run` ni `createKaliContainer`. Ne pas défaire le toolset `kali` de l'ADR 0014.
