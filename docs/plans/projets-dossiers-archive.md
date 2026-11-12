# Plan interface — dossier de projet choisi, conteneurs multi-projets, archive

Partie interface de l'ADR 0052 (dossier de projet choisi, conteneurs multi-projets, archive de projet). La partie moteur (création avec parent, reprise d'un dossier, déplacement, archive, rattrapage de `project.workspaceNotMounted`) est livrée par des lots `dev` séparés. Ce plan ne la redéfinit pas.

## Décision

- Aucun chemin ne vient de la webview (ADR 0050). Tout dossier ou fichier est choisi par `showOpenDialog` / `showSaveDialog` côté hôte, **sans `defaultUri`**. Le seul autre chemin admis est le montage d'un conteneur, relu par l'hôte (`docker inspect`).
- La création de projet reste dans le studio (onglet « Créer »), avec trois choix. Export et import sont aussi dans le studio, page projets.
- Le cockpit porte les modes de conteneur, les projets d'un conteneur, la compatibilité avec le projet actif, le bandeau de partage incohérent et « Déplacer le projet ». Le bandeau est dans le cockpit, pas dans le chat : le chat garde le message d'erreur du catalogue (`project.workspaceNotMounted`), et l'hôte ouvre le cockpit.
- On ne peut plus lier un conteneur incompatible. Le bouton Lier est désactivé avec une explication, au lieu d'échouer après coup.

Alternatives écartées :
- Un bandeau dans le chat : il faudrait dupliquer la liste des conteneurs et le formulaire de création dans `chat.js`.
- Un choix de dossier dans la webview (texte libre) : interdit par l'ADR 0050.
- Un « Déplacer » dans le studio : `studio.ts` et `studio.js` sont déjà touchés par les lots A et D. On le met donc dans le cockpit, où se trouve le problème de partage.

## Parcours

### Création de projet (studio, onglet « Créer »)
Un champ nom, puis trois boutons radio :
1. **Nouveau dossier** : sélecteur natif de dossier parent, puis création exclusive de `<parent>/<slug>`.
2. **Dossier existant** : sélecteur natif du dossier, qui est repris tel quel.
3. **Dans un conteneur** : liste des conteneurs qui ont un montage `/workspace`. Le projet est créé sous ce montage, puis lié au conteneur par le parcours vérifié existant. L'option est grisée s'il n'y a aucun conteneur monté.

Le réglage « dossier racine des projets » (`setWorkspaceRoot`) disparaît de l'interface.

### Création de conteneur (cockpit, formulaires Exegol et Kali)
Deux boutons radio en tête : **Conteneur projet** et **Conteneur multi-projets**.
- Projet : le partage est le dossier du projet actif. Le choix de dossier partagé est masqué. L'option est désactivée s'il n'y a pas de projet actif.
- Multi-projets : on garde le bouton « Dossier partagé… » (`pickSharedFolder`) actuel.

### Cockpit : projets et conteneurs
- Chaque carte de conteneur liste les projets enregistrés dont le dossier est dans son partage. Le projet actif est marqué. Cliquer sur un autre projet l'active.
- Pour le projet actif, chaque carte indique s'il est compatible ou non. Lier n'est possible que si le conteneur est compatible.
- Un bouton « Déplacer le projet… » apparaît dans la zone du projet actif.

### Bandeau « partage incohérent » (cockpit)
Il s'affiche quand l'hôte reçoit le message moteur `{code:"project.workspaceNotMounted", container, mounted, project}`. Il propose trois actions :
1. **Créer un conteneur projet** : ouvre le formulaire de création avec le mode « Conteneur projet » présélectionné. Aucun message n'est envoyé à l'hôte.
2. **Choisir un conteneur compatible** : filtre la liste sur les conteneurs compatibles, qui gardent le bouton Lier. Aucun message n'est envoyé à l'hôte.
3. **Déplacer le projet** : envoie `moveProject`. L'hôte demande une confirmation modale, puis ouvre le sélecteur du dossier parent.

Le bandeau a aussi une croix, qui envoie `dismissMountIssue`.

### Export / Import (studio, page projets)
- Chaque ligne de projet a un bouton **Exporter**. L'hôte ouvre `showSaveDialog` avec le filtre `rwproj`, sans `defaultUri`.
- La page a un bouton **Importer un projet**. L'hôte ouvre d'abord le sélecteur de fichier (filtre `rwproj`, le manifeste fait foi), puis le sélecteur du dossier parent. Il lance l'import et rafraîchit la liste.

## Messages (forme exacte)

Tous les messages sont à clés fermées : toute clé en trop donne `null`. Règles communes :
- `name` : même validation que l'actuel `createProject` (non vide après trim, ≤ 80, sans NUL ni CR/LF).
- `projectId` : même validation que `activateProject`.
- `container` : non vide, ≤ 256 caractères.

Webview studio → hôte (`parseStudioMessage`) :
- `{type:"createProject", name, target:"newFolder"}`
- `{type:"createProject", name, target:"container", container}`. La clé `container` n'est admise que dans ce cas.
- `{type:"adoptProject", name}`
- `{type:"exportProject", projectId}`
- `{type:"importProject"}`
- Supprimé : `{type:"setWorkspaceRoot", value}`, ainsi que l'ancien `{type:"createProject", name}` sans `target`.

Hôte → webview studio (vue `project`) : nouveau champ `creationContainers: {name, short, state, mount}[]`. Il ne contient que les conteneurs dont le montage `/workspace` est absolu, et sert uniquement à l'affichage. L'hôte relit le montage au moment de la création, sans jamais le reprendre de la webview.

Webview cockpit → hôte (`parseCockpitMessage`) :
- `createExegol` / `createKali` : nouvelle clé **obligatoire** `shareMode: "project" | "multi"`.
- `{type:"moveProject"}` : agit sur le projet actif, relu par l'hôte.
- `{type:"dismissMountIssue"}`
- `{type:"activateProject", projectId}`

Hôte → webview cockpit (vue) :
- Chaque conteneur reçoit `projects: {id, name, active}[]` et `compatible: boolean`. `compatible` vaut `false` s'il n'y a pas de projet actif.
- Champ optionnel `mountIssue: {container, mounted: string | null, projectId, projectName}`.

## Libellés (fr → en)

| fr | en |
|---|---|
| Nouveau dossier | New folder |
| Dossier existant | Existing folder |
| Dans un conteneur | Inside a container |
| Choisir le dossier parent du projet | Choose the project's parent folder |
| Choisir le dossier à ouvrir comme projet | Choose the folder to open as a project |
| Aucun conteneur avec un dossier partagé. | No container with a shared folder. |
| Conteneur projet | Project container |
| Conteneur multi-projets | Multi-project container |
| Le dossier partagé sera le dossier du projet actif. | The shared folder will be the active project's folder. |
| Ouvrez un projet pour créer un conteneur projet. | Open a project to create a project container. |
| Projets dans ce conteneur | Projects in this container |
| Aucun projet dans ce partage. | No project in this share. |
| Compatible avec le projet actif | Compatible with the active project |
| Ce conteneur ne voit pas le dossier du projet. | This container cannot see the project folder. |
| Déplacer le projet… | Move project… |
| Déplacer « {name} » ? Le dossier sera déplacé, les liaisons aux conteneurs qui ne le voient plus seront retirées. | Move "{name}"? The folder will be moved and links to containers that no longer see it will be removed. |
| Déplacer | Move |
| Le conteneur {container} ne voit pas le dossier du projet {name}. | Container {container} cannot see the folder of project {name}. |
| Partage du conteneur : {mounted} | Container share: {mounted} |
| Créer un conteneur projet | Create a project container |
| Choisir un conteneur compatible | Choose a compatible container |
| Déplacer le projet | Move the project |
| Exporter | Export |
| Importer un projet | Import a project |
| Exporter le projet | Export project |
| Choisir l'archive de projet | Choose the project archive |
| Choisir le dossier parent du projet importé | Choose the parent folder for the imported project |
| Projet importé : {name} | Project imported: {name} |
| Projet exporté. | Project exported. |

Clé supprimée : « Les fichiers sont partagés avec le dossier du projet ouvert dans VS Code… migration explicite. » (`packages/messages/src/ui-domains/cockpit.ts:13`, `packages/vscode/media/i18n.js:446`).

Les codes de raison de l'archive, de l'import et du déplacement viennent du lot moteur, avec leurs catalogues. L'interface les affiche avec `formatError` existant.

## Lots `surface`

Ordre : B est indépendant. A doit passer avant D (mêmes fichiers studio). C vient après B (même formulaire et même vue cockpit).

### Lot A — Création de projet à trois choix (studio)
- **Dépend de** : lot moteur `createManagedProject(configDir, name, parent)` et `adoptProjectDirectory(configDir, name, folder)`.
- **Fichiers** : `packages/vscode/src/logic/studio.ts`, `packages/vscode/media/studio.js`, `packages/vscode/src/extension/extension.ts` (branche `createProject` vers 4328-4343, branche `setWorkspaceRoot` vers 4140), `packages/vscode/src/logic/project-controls.ts` si besoin, `packages/messages/src/ui-domains/*`, `packages/vscode/media/i18n.js`.
- **Changement** :
  1. Parser : remplacer `createProject` par les deux formes avec `target`, ajouter `adoptProject`, supprimer `setWorkspaceRoot`.
  2. Hôte, `newFolder` : `showOpenDialog({canSelectFolders:true, canSelectFiles:false, canSelectMany:false})` sans `defaultUri`, puis `createManagedProject`. Une annulation ne crée rien.
  3. Hôte, `adoptProject` : même sélecteur, puis `adoptProjectDirectory`.
  4. Hôte, `container` : vérifier que le conteneur est connu et monté, relire son montage côté hôte, appeler `createManagedProject` avec ce parent, puis lier par le parcours vérifié existant (`project-container-link`). Si la liaison échoue, le projet reste créé et l'erreur est affichée.
  5. Vue `project` : ajouter `creationContainers`. Webview : trois boutons radio, liste des conteneurs pour le troisième.
  6. Supprimer de l'UI le réglage du dossier racine et ses libellés.
- **Critères** (`pnpm check` vert) :
  - `studio.test.ts` : les nouvelles formes sont parsées. Sont rejetés : `target` inconnu, `container` sans `target:"container"`, toute clé de chemin (`workspace`, `folder`, `parent`), `setWorkspaceRoot`.
  - Test DOM : chaque radio envoie le bon message, et l'option conteneur est grisée sans conteneur.
  - Le test « la création de projet n'ouvre plus de choix de dossier » est remplacé par son inverse côté hôte (sélecteur sans `defaultUri`).
  - `logic-i18n.test.ts` passe sur les nouveaux libellés.
- **Interdits** : lire un chemin venant de la webview. Proposer un `defaultUri`. Lire `warband.projects.workspaceRoot`. Toucher `packages/core`. Toucher le cockpit.

### Lot B — Modes de conteneur, projets d'un conteneur, compatibilité (cockpit)
- **Dépend de** : aucun lot moteur (`projectInSharedFolder` et `readProjectChoices` existent).
- **Fichiers** : `packages/vscode/src/logic/cockpit.ts` (parser et vue, 533-609), `packages/vscode/media/cockpit.js`, `packages/vscode/src/extension/extension.ts` (createExegol 1811-1929, createKali 1930-2016), `packages/vscode/src/logic/shared-folder.ts` si besoin, libellés.
- **Changement** :
  1. Parser : `shareMode` obligatoire sur `createExegol` / `createKali`. Ajouter `activateProject`.
  2. Hôte, `shareMode:"project"` : la source est le dossier du projet actif, relu dans le registre et revalidé par `validateSharedFolder`. Le dossier partagé mémorisé est ignoré, et la liaison est attendue. S'il n'y a pas de projet actif, c'est une erreur. Pour `"multi"`, le comportement actuel ne change pas.
  3. Vue : pour chaque conteneur monté, `projects` (projets de `readProjectChoices` dont le dossier est dans le montage) et `compatible`. Si un conteneur n'est pas compatible : `canLink=false` et un `linkTitle` explicatif.
  4. Webview : radios de mode dans les deux formulaires, liste des projets sur chaque carte, badge de compatibilité.
- **Critères** :
  - `cockpit.test.ts` : `shareMode` absent ou invalide donne `null`. Une source envoyée avec `shareMode:"project"` donne `null`. La vue calcule `projects` et `compatible` sur des dossiers temporaires réels, lien symbolique compris.
  - `cockpit-render.test.ts` : radios, projets et badge s'affichent, et Lier est désactivé si le conteneur est incompatible.
  - `shared-folder.test.ts` reste vert.
- **Interdits** : modifier `projectInSharedFolder`. Accepter un chemin de la webview. Recréer ou modifier un conteneur existant. Toucher le studio.

### Lot C — Bandeau de partage incohérent et déplacement (cockpit)
- **Dépend de** : lot moteur `moveProjectWorkspace`, du rattrapage `project.workspaceNotMounted` dans `engine/main.ts`, et du lot B.
- **Fichiers** : `packages/vscode/src/logic/cockpit.ts`, `packages/vscode/media/cockpit.js`, `packages/vscode/src/extension/extension.ts` (réception du message moteur, `moveProject`), `packages/messages/src/ui-domains/cockpit.ts`, `packages/vscode/media/i18n.js`.
- **Changement** :
  1. À la réception du message moteur, l'hôte mémorise `mountIssue` (un seul à la fois, effacé par un changement de projet actif, un déplacement réussi ou `dismissMountIssue`), puis ouvre le cockpit.
  2. Vue : champ `mountIssue`. Webview : bandeau avec les trois actions, les deux premières traitées dans la webview.
  3. `moveProject` : confirmation modale (`showWarningMessage`, `modal:true`, libellé « Déplacer »), sélecteur du dossier parent sans `defaultUri`, puis `moveProjectWorkspace`, et rafraîchissement. Une annulation à l'une des deux étapes ne fait rien.
  4. Supprimer la clé « migration explicite » (fr, en, i18n.js).
- **Critères** :
  - `cockpit.test.ts` : les deux nouveaux messages sont parsés, et rejetés s'ils ont une clé en trop.
  - `cockpit-render.test.ts` : le bandeau s'affiche, « Créer un conteneur projet » présélectionne `shareMode:"project"`, le filtre ne garde que les compatibles, et Déplacer envoie `{type:"moveProject"}`.
  - Test hôte ou logique : pas de déplacement sans confirmation.
  - Le test d'exhaustivité i18n passe après la suppression de la clé.
- **Interdits** : lancer un tour d'agent depuis le bandeau. Déplacer sans confirmation. Lever le refus du tour. Toucher `packages/core` ou `engine/main.ts`.

### Lot D — Export / Import de projet (studio)
- **Dépend de** : lot moteur `exportProjectArchive` / `importProjectArchive` (`packages/vscode/src/logic/project-archive.ts`), puis `registerImportedProject`, et du lot A (mêmes fichiers).
- **Fichiers** : `packages/vscode/src/logic/studio.ts`, `packages/vscode/media/studio.js`, `packages/vscode/src/extension/extension.ts`, libellés.
- **Changement** :
  1. Parser : ajouter `exportProject` et `importProject`.
  2. Hôte, export : relire le projet dans le registre, `showSaveDialog` (filtre `rwproj`, sans `defaultUri`), `exportProjectArchive`, puis notification.
  3. Hôte, import : `showOpenDialog` pour le fichier, puis `showOpenDialog` pour le dossier parent, `importProjectArchive`, notification et rafraîchissement de la liste. Une erreur est affichée par `formatError`.
  4. Webview : bouton Exporter par ligne, bouton Importer sur la page.
- **Critères** :
  - `studio.test.ts` : formes acceptées et rejetées (`projectId` invalide, toute clé `path` ou `file`).
  - Test DOM : les boutons envoient le bon message.
  - Une annulation de l'un des sélecteurs ne déclenche aucun appel d'archive (dépendances simulées).
- **Interdits** : lire ou écrire un zip dans le lot (c'est le module moteur). Chemin venant de la webview. `defaultUri`. Confondre avec `warband.exportAudit`.

## Questions pour l'utilisateur
1. Après un import, faut-il activer automatiquement le projet importé, ou seulement l'ajouter à la liste ?
2. « Dossier existant » : faut-il proposer comme nom le nom du dossier choisi ? Il faudrait alors choisir le dossier avant de saisir le nom.
3. Sans projet actif, « Conteneur projet » doit-il rester désactivé (choix du plan), ou proposer de choisir un projet ?
