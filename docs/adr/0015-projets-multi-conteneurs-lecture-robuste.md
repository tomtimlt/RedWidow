# 0015 — Projet à plusieurs conteneurs, conteneur affiché, lecture robuste du projet

- Statut : accepté
- Date : 2026-10-24
- S'appuie sur : ADR 0007 (le nom exécuté est celui de la liste courante), ADR 0011 (familles), ADR 0013 (un fichier, une liste ; allowlist copiée au message ; `dedicated` supprimé ; le modèle ne choisit pas l'id de projet), ADR 0014 (exécution Kali)

## Contexte

`project.json` stocke déjà une liste par projet : `StoredProject = { id; name; workspace; containers: readonly string[] }`, `MAX_CONTAINERS = 32` (`packages/core/src/project.ts:17-18,29-39`). Trois défauts apparaissent dès qu'un projet a deux conteneurs ou plus, ou quand la lecture échoue.

1. **`status()` échoue sur un projet à plusieurs conteneurs.** `const container = active.containers.length === 1 ? active.containers[0] : undefined; if (active === null || container === undefined) throw new CodedError("project.absent")` (`project.ts:414-415`). Dès `containers.length >= 2`, la fonction se comporte comme s'il n'y avait aucun projet. `linkedProjectStatus` (`packages/vscode/src/logic/cockpit.ts:582-585`) gère déjà ce cas (il renvoie `container: null`), mais `status()` du cœur, utilisé par la CLI (`packages/cli/src/main.ts:399`), lève.

2. **Perte silencieuse du projet actif entre deux tours.** `onPrompt` relit `project.json` à chaque message (`packages/vscode/src/engine/main.ts:46-58`). Toute exception (fichier invalide, erreur FS transitoire) retombe sur `targets.note(text, [], null)`, indistinctement du cas « aucun projet actif ». La cible résultante est figée pour tout l'échange (`targets.current()` la relit telle quelle, pas le disque — `targets.ts:259`). `note()` exige alors `projectId !== null`, sinon lève `project.absent` (`tool-specs.ts:90-91`), dont le libellé fr est trompeur : `"aucun projet lié (project.json absent)"` (`packages/messages/src/fr.ts:240`). L'utilisateur voit « project.json absent » alors que la vraie cause est « lecture ratée ce tour-ci » ou « fichier invalide ».

3. **Ciblage implicite quand plusieurs conteneurs sont liés.** L'UI montre un conteneur « PRIMARY » avec un bouton de bascule. Le moteur n'a aucun champ pour le retenir : l'affichage, la barre et le terminal n'ont un conteneur que lorsqu'il y en a exactement un (ADR 0013 point 8).

Menace. Le modèle choisit l'argument `container` de `exec` et le texte de `note`. Il ne doit jamais choisir l'allowlist, l'identifiant de projet, ni le conteneur exécuté implicitement. ADR 0013 a retiré `dedicated` précisément parce qu'un champ unique mémorisé pouvait diverger de la liste courante, désigner un Kali, et rouvrir une résolution implicite que le message n'a pas citée. Toute réintroduction d'un champ qui *autorise une exécution* est un retour en arrière.

## Décision

1. **Pas de résolution d'exécution implicite à partir d'un champ mémorisé.** La règle de l'ADR 0013 point 5 reste intacte : sans `@`, l'exec Exegol n'accepte que si l'intersection « allowlist ∩ Exegol de la liste courante » vaut exactement un nom ; zéro ou plusieurs, refus (`@` obligatoire). Même règle pour `resolveKaliContainer`, famille `kali`. Aucune de ces résolutions ne lit un conteneur « principal ». `resolveExegolContainer` / `resolveKaliContainer` ne changent pas (`packages/core/src/exegol/targets.ts`).

2. **`status()` ne lève plus sur plusieurs conteneurs.** Elle aligne son contrat sur `linkedProjectStatus` : sans projet actif → `project.absent` ; projet actif → renvoie `{ workspace, container, image, state }`. `container` est le conteneur affiché (point 4), sinon l'unique conteneur s'il y en a exactement un, sinon `null` (et `image: null`, `state: null`). Un conteneur nommé mais absent de la liste donne `image: null`, `state: "absent"`.

3. **Lecture robuste du projet dans `onPrompt`.** On ne confond plus trois cas :
   - **Fichier absent (`null`) ou `activeId` nul** → `note(text, [], null)` sans drapeau. C'est le cas normal « aucun projet actif ».
   - **Fichier invalide (`project.invalid`)** → mauvaise configuration persistante. On ne relance pas la lecture. La cible reste `allowed: []`, `projectId: null`, drapeau `blocked: "invalid"`.
   - **Erreur de lecture transitoire (toute autre exception)** → une seule nouvelle tentative. Si elle échoue encore : `allowed: []`, `projectId: null`, drapeau `blocked: "readFailed"`.

   `onPrompt` ne **propage jamais** l'exception : le flux de consignes alimente directement `runner.run` (`engine.ts:131-134,206-208`), donc une exception y abort le run entier, pas seulement le tour. On garde donc le run vivant, l'allowlist vide (fail-closed : l'exec refuse déjà faute d'intersection), et on rend la cause **observable au point de blocage** via le drapeau.

4. **Conteneur affiché (`primary`), strictement d'affichage.** `StoredProject` gagne un champ optionnel `primary?: string`. S'il est présent il doit être un membre de `containers` ; sinon le fichier est `project.invalid` (cohérent avec la validation stricte de l'ADR 0013). Ce champ n'est lu **que** par `status()` et `linkedProjectStatus()` pour choisir le conteneur affiché (image, état, terminal, barre, ouverture de dossier). Il n'est **jamais** lu par `resolveExegolContainer`, `resolveKaliContainer`, la politique, ni la gate. Il n'autorise aucune exécution : l'allowlist de l'exec reste `containers` copiée au message. Écriture par `setPrimaryContainer(configDir, projectId, name | null)` : `name` doit appartenir à `containers` (sinon `project.notFound`, fichier inchangé) ; `null` efface le champ. Ce n'est pas un outil MCP (action de l'utilisateur, comme `setActiveProject`). Le modèle ne passe ni id de projet ni nom de conteneur à cette fonction.

5. **`note()` reste au projet, pas au conteneur.** La trouvaille appartient au projet (`appendFinding(configDir, projectId, …)`), pas à un conteneur. `note()` ne change donc pas sa logique de blocage : `projectId !== null` suffit (il fonctionne déjà pour un projet à plusieurs conteneurs). Seul le message d'échec devient exact selon le drapeau de la cible :
   - `projectId !== null` → écrit.
   - `projectId === null`, drapeau `"invalid"` → `project.invalid`.
   - `projectId === null`, drapeau `"readFailed"` → `project.readFailed` (code neuf).
   - `projectId === null`, pas de drapeau → `project.absent`.

6. **Libellés.** `project.absent` est reformulé pour ne plus affirmer « project.json absent » : fr `"aucun projet actif"`, en `"no active project"`. Nouveau code `project.readFailed` : fr `"lecture du projet impossible ce tour-ci"`, en `"could not read the active project this turn"`. Ajouts à `REASON_CODES` et aux deux catalogues (le test d'exhaustivité l'impose).

## Alternatives écartées

- **Un conteneur « principal » qui sert la résolution d'exécution implicite.** C'est `dedicated` ressuscité (ADR 0013 l'a retiré) : un champ mémorisé qui peut diverger de la liste courante, désigner un Kali, et faire exécuter sans que le message ait cité le conteneur. Rejeté. Le `primary` retenu ici est inerte pour l'exécution.
- **Propager l'erreur de lecture depuis `onPrompt`.** Elle abort le run entier (le flux alimente `runner.run`), pas le tour. Un hoquet FS tuerait toute la session. Rejeté au profit du drapeau observable + allowlist vide fail-closed.
- **Dégrader silencieusement comme aujourd'hui.** Fail-closed pour l'exec, mais `note()` ment (« project.json absent ») et le projet est perdu sans trace. Rejeté.
- **Faire exiger `@` par un message d'erreur dédié quand plusieurs conteneurs sont liés.** Inutile : l'ADR 0013 refuse déjà l'exec ambiguë ; le seul vrai bug est `status()` qui lève, corrigé au point 2.
- **Ne rien stocker pour PRIMARY (l'UI choisit à la volée).** Le bouton de bascule de l'UI n'aurait rien à persister entre deux ouvertures. Un champ d'affichage optionnel est le support minimal, sans toucher la gate.

## Conséquences

- La CLI `status` peut désormais renvoyer `container: null` (projet à plusieurs conteneurs sans `primary`) : l'affichage CLI doit tolérer l'absence de nom.
- Un `primary` n'est qu'un confort d'affichage et de terminal, choisi par l'utilisateur. Il ne prouve rien sur l'exécution : l'exec sans `@` reste refusé dès que l'intersection Exegol n'est pas unique. C'est voulu.
- Les `project.json` existants (sans `primary`) restent valides sans réécriture ; la migration de l'ADR 0013 produit des projets à un conteneur, donc sans `primary`.
- `note()` cesse de mentir : l'utilisateur distingue « aucun projet actif », « fichier invalide » et « lecture ratée ce tour-ci ».
- Risque à surveiller : que le drapeau `blocked` ne serve jamais à élargir une autorisation. Il ne doit influencer que le code de raison de `note()`, pas l'allowlist (qui reste vide) ni l'exec.
- Capacité exposée à l'UI (branchement laissé à `cadre`) : lire `activeProject(file).containers` et `primary` (déjà via `readProjects`/`activeProject`), et appeler `setPrimaryContainer` pour la bascule. Aucun nouveau message webview n'est décidé ici.

## Plan

Trois lots pour `dev`. Les lots 1 et 2 corrigent les bugs et sont indépendants du produit ; le lot 3 ajoute le champ d'affichage et dépend de la confirmation produit (bascule PRIMARY).

### Lot M1 — `status()` ne lève plus sur plusieurs conteneurs

- **Fichiers :** `packages/core/src/project.ts` (`status` seulement) ; `packages/cli/src/main.ts` (affichage de `status` tolérant à `container` nul) ; `packages/core/test/project.test.ts`.
- **Décision :** point 2. Aligner le contrat de `status()` sur `linkedProjectStatus`. Sans projet actif → `project.absent`. Projet actif, un seul conteneur → ligne de ce conteneur. Projet actif, plusieurs conteneurs → `{ workspace, container: null, image: null, state: null }`. Conteneur nommé absent de la liste → `image: null, state: "absent"`.
- **Interdits :** ne pas toucher `resolveExegolContainer`/`resolveKaliContainer` ni l'allowlist. Ne pas lire un `primary` (il n'existe pas encore). Ne pas changer `linkedProjectStatus` dans ce lot.
- **Critères :** `status()` sur un projet à deux conteneurs renvoie `container: null` sans lever ; sur un projet à un conteneur, renvoie l'image/état de la ligne ; sans projet actif, lève `project.absent`. `node packages/cli/dist/main.js status` n'affiche pas « null » brut. `pnpm check` vert.

### Lot M2 — Lecture robuste du projet dans `onPrompt`, libellés exacts

- **Fichiers :** `packages/vscode/src/engine/main.ts` (`onPrompt` seulement) ; `packages/core/src/exegol/targets.ts` (champ `blocked` sur la cible et sa signature `note`) ; `packages/core/src/exegol/tool-specs.ts` (choix du code de raison dans `note`) ; `packages/core/src/reason.ts` (`project.readFailed`) ; `packages/messages/src/fr.ts` et `packages/messages/src/en.ts` (`project.absent` reformulé, `project.readFailed` ajouté) ; `packages/core/test/exegol-targets.test.ts` ; `packages/vscode/test/engine.test.ts` (ou le test de `main`/`onPrompt` existant) ; le test d'exhaustivité des raisons reste vert.
- **Décision :** points 3, 5 et 6. `note(text, allowed, projectId, blocked?)` où `blocked?: "invalid" | "readFailed"` n'est posé que lorsque `projectId` est nul pour cause de lecture (jamais pour « aucun projet actif »). La cible porte ce drapeau ; `current()` l'expose ; l'outil `note` choisit `project.invalid`, `project.readFailed` ou `project.absent` selon le point 5. `onPrompt` : `null`/`activeId` nul → `note(text, [], null)` ; `CodedError project.invalid` → `note(text, [], null, "invalid")` ; autre exception → une relecture, puis `note(text, [], null, "readFailed")`. `onPrompt` ne relance jamais l'exception.
- **Interdits :** ne pas propager depuis `onPrompt` (abort du run entier). Ne pas remplir `allowed` ni `projectId` sur un échec de lecture (fail-closed). Ne pas laisser le drapeau modifier l'allowlist ni l'exec. Ne pas changer `resolveCwd` (ADR 0013 point 6). Ne pas affaiblir la gate.
- **Critères :** `project.json` invalide → `note()` lève `project.invalid`, pas `project.absent` ; lecture transitoire ratée deux fois → `project.readFailed` ; fichier absent → `project.absent` ; un projet actif à plusieurs conteneurs → `note()` écrit (projet, pas conteneur). Le libellé fr de `project.absent` n'évoque plus « project.json absent ». `pnpm check` vert (dont l'exhaustivité des raisons).

### Lot M3 — Conteneur affiché `primary` (après confirmation produit)

- **Fichiers :** `packages/core/src/project.ts` (schéma `StoredProject`, validation stricte, `setPrimaryContainer`, préférence de `status`) ; `packages/vscode/src/logic/cockpit.ts` (`linkedProjectStatus` préfère `primary`) ; `packages/core/test/project.test.ts` ; `packages/vscode/test/cockpit.test.ts`.
- **Décision :** point 4. `primary?: string` optionnel, membre de `containers` sinon `project.invalid`. Lu seulement par `status()`/`linkedProjectStatus()` pour le conteneur affiché, selon l'ordre : `primary` s'il est posé, sinon l'unique conteneur, sinon `null`. `setPrimaryContainer(configDir, projectId, name | null)` : écriture atomique inchangée, `name` ∈ `containers` sinon `project.notFound`, `null` efface. Migration : champ optionnel, fichiers existants valides sans réécriture.
- **Interdits :** `primary` n'est jamais lu par `resolveExegolContainer`, `resolveKaliContainer`, la politique ni la gate. `setPrimaryContainer` n'est pas un outil MCP et ne reçoit pas d'argument du modèle. Ne pas ajouter de message webview ni de bouton (domaine de `cadre`). Ne pas changer l'allowlist copiée au message.
- **Critères :** un `project.json` avec `primary` hors `containers` est `project.invalid` ; `status()` d'un projet à deux conteneurs avec `primary` posé renvoie l'image/état de ce conteneur ; `setPrimaryContainer` refuse un nom hors `containers` sans modifier le fichier ; un fichier sans `primary` reste relu sans réécriture. `pnpm check` vert.
