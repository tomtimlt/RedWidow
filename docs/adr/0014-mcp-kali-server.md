# 0014 — Un Kali déjà listé s'exécute par mcp-kali-server

- Statut : accepté
- Date : 2026-10-22
- S'appuie sur : ADR 0011 (famille, liste seule autorité), ADR 0012 (création figée, pas de volume sur `run`), ADR 0007 (nom exécuté = liste courante), ADR 0009 (`#` ne regarde pas la famille)
- Amende : ADR 0011, ADR 0012, ADR 0013

## Contexte

Le dépôt ne contient pas mcp-kali-server. La doc publique du projet [Wh0am123/MCP-Kali-Server](https://github.com/Wh0am123/MCP-Kali-Server) et la fiche [Kali](https://www.kali.org/tools/mcp-kali-server/) décrivent deux processus :

- l'API, lancée sur la machine Kali par `kali-server-mcp` ou `./server.py`, HTTP, `--ip` défaut `127.0.0.1`, `--port` défaut `5000` (README, fiche Kali, `server.py`) ;
- le pont MCP, `mcp-server` ou `client.py --server`, défaut `http://localhost:5000` (fiche Kali). Le fichier `mcp-kali-server.json` le lance par `command` et `args`, pas par une URL MCP. `client.py` appelle `mcp.run()` sans argument de transport.

`client.py` enregistre ces outils, et seulement ceux-là (`@mcp.tool`) :

| Outil | Appel HTTP (`server.py`) |
|---|---|
| `nmap_scan` | `POST /api/tools/nmap` |
| `gobuster_scan` | `POST /api/tools/gobuster` |
| `dirb_scan` | `POST /api/tools/dirb` |
| `nikto_scan` | `POST /api/tools/nikto` |
| `sqlmap_scan` | `POST /api/tools/sqlmap` |
| `metasploit_run` | `POST /api/tools/metasploit` |
| `hydra_attack` | `POST /api/tools/hydra` |
| `john_crack` | `POST /api/tools/john` |
| `wpscan_analyze` | `POST /api/tools/wpscan` |
| `enum4linux_scan` | `POST /api/tools/enum4linux` |
| `server_health` | `GET /health` |
| `execute_command` | `POST /api/command` |

`POST /api/command` exécute une chaîne (`shell=True` dans `server.py`). Les autres routes construisent une liste d'arguments (`shlex.split` sur `additional_args` et `scan_type`). L'API n'a pas d'authentification. `/mcp/capabilities` ne renvoie rien.

Le code (HEAD `7a993cb`) refuse encore un Kali : `resolveExegolContainer` ne garde que `family === "exegol"` (`packages/core/src/exegol/targets.ts:76`), `link` lève `project.notExegol` (`packages/core/src/project.ts:88`). L'outil Exegol reste un argv sans shell, `mcp__exegol__exec`, puis `docker exec --workdir /workspace`. Le lot P1 de l'ADR 0013 n'est pas dans ce commit : le projet est encore `{ container, workspace }`.

`#` joint un terminal déjà ouvert et ne lit pas la famille (ADR 0009). `terminalLaunch` non plus. Le menu `@` prend les noms de la vue, Kali compris. `canLink` est faux pour un Kali (`packages/vscode/src/logic/cockpit.ts:382`).

Menace. Le modèle choisit les arguments. Qui lance un conteneur contrôle les labels et l'image : la famille se recalcule sur `listLabelPrefix`, elle n'est pas stockée. L'API exécute des commandes sur la machine où elle tourne. La faire tourner sur l'hôte, ou publier le port, donnerait un shell hors de `evaluateBash`. `execute_command` passé comme un outil MCP ordinaire serait mémorisable en entier (`sessionKey` = nom d'outil) et autorisable par une règle `*`. La gate reste l'unique autorité.

## Décision

1. **Dans le conteneur listé, pas à côté.** `kali-server-mcp` tourne dans le conteneur dont le nom réel sort de `listLabelPrefix` avec `family === "kali"`. Il n'est pas lancé sur l'hôte. Rien n'est publié. L'écoute est le défaut documenté : `--ip 127.0.0.1 --port 5000`. Pas de `0.0.0.0`, pas d'autre port.

2. **Démarrage par le moteur, argv figé, après résolution.** Au premier appel d'outil approuvé, si `GET /health` ne répond pas : un seul `docker exec --detach --workdir /workspace <nom> kali-server-mcp --ip 127.0.0.1 --port 5000`. Binaire absent ou santé toujours en échec : `kali.unavailable`, aucun repli (`apt`, clone, `./server.py`, autre conteneur). Le pont `mcp-server` / `client.py` n'est pas branché au SDK.

3. **Les douze outils, pas un exec déguisé.** Toolset in-process `kali`. Noms visibles de la gate : `mcp__kali__` plus le nom du tableau. Chaque appel résout `container` (champ à nous, retiré avant l'HTTP) avec les règles du dédié et des `@`, sur les seules lignes `kali`. Sans `@` : le dédié, et il doit être ce Kali. Avec `@` : le nom doit être cité. Un `#` qui désigne un seul conteneur de la liste (nom complet, nom court, ou shell `court-2` à `court-4`) autorise les outils Kali sur ce conteneur, sans `@` de plus. `resolveExegolContainer` ignore ces jetons et refuse toujours un Kali. Absent, ambigu, autre famille, ou nom construit : `exegol.containerDenied`. État autre que `running` : `project.notRunning`, avant tout `exec`. Le corps HTTP reprend les clés de `client.py` (`format` pour John, pas `format_type`). L'URL est le littéral `http://127.0.0.1:5000` plus le chemin du tableau. Le JSON part sur stdin d'un `python3 -c` constant (bibliothèque standard), pas dans l'argv.

4. **La gate voit chaque appel avant l'HTTP.** Pas de règle `allow` nouvelle. Les onze outils structurés restent au défaut `ask` (mémorisables comme `mcp__exegol__exec` : le nom d'outil, pas les arguments). `mcp__kali__execute_command` est un shell non analysable : le parseur POSIX s'applique à `command` quelle que soit la plateforme de l'hôte ; un `deny` (règles Bash, `docker.hostAccess`) est conservé ; tout le reste est `shell.unanalyzable` (`ask`, jamais `allow`, ni par `*`, ni mémorisable). Le Bypass couvre tout `ask` d'un outil `mcp__kali__*` (le préfixe entier, pas seulement `execute_command`) et, de même, d'un outil `mcp__exegol__*` (exec, note, remember : ils s'exécutent dans le conteneur), pas le `deny`. Une redirection (`2>&1`), un chemin, plusieurs segments, un danger de shell ou une commande illisible, avalés dans ce même `ask`, sont couverts, de même qu'un jeton « chemin » (URL, wordlist, fichier de sortie) dans les paramètres des onze outils structurés. `isRememberable` reste faux : aucune règle n'est écrite.

5. **Mêmes gestes, sans libellé nouveau.** `link` accepte `exegol` et `kali` s'ils sont `running` et ont un `/workspace`, dans cet ordre de refus : absent (`project.notFound`), famille autre que ces deux (`project.notExegol`), arrêté (`project.notRunning`), sans montage (`project.noWorkspace`). `canLink` suit ce prédicat. Le fichier reste l'objet unique : `link` le remplace, comme aujourd'hui. `@`, le terminal et `#` ne sont pas reconstruits. Le monitor ajoute une ligne par appel `mcp__kali__*`, avec les statuts déjà là. Mode apprentissage : pas de toolset `kali`.

## Alternatives écartées

- **`mcp__exegol__exec` dans le Kali.** Contredit la décision de produit. Un argv sans shell n'est pas ce serveur.
- **Brancher `client.py` comme MCP du SDK.** La config documentée est un sous-processus. `execute_command` deviendrait un outil ordinaire : mémorisable en entier, couvert par un `allow` sur `*`. OpenCode ne garde la garde que sur nos toolsets.
- **API sur l'hôte, ou port publié.** L'API n'a pas de jeton. `127.0.0.1` de l'hôte ou `0.0.0.0` exécuterait sur l'hôte, ou exposerait le shell. Le défaut documenté reste dans l'espace de noms du conteneur.
- **Inventer un port, un transport SSE, ou des outils absents de `client.py`.** La doc donne HTTP `127.0.0.1:5000` et les douze noms. On n'en ajoute pas.
- **Relire la liste d'outils au démarrage.** `/mcp/capabilities` est vide. Une liste dynamique exposerait un outil que cette décision n'a pas vu.

## Conséquences

- Un conteneur hors de `listLabelPrefix` n'est jamais démarré ni exec. Un Kali classé seulement par l'image n'est pas réinspecté : même résidu que l'exec Exegol. `createKaliContainer` refuse toujours le socket, le réseau `host` et `--privileged` ; un conteneur que l'utilisateur a lancé autrement peut les avoir.
- L'API écoute sans authentification à l'intérieur du conteneur. Un processus déjà root dans ce conteneur pouvait déjà exécuter. Le démarrage ne lui ajoute pas l'hôte.
- Les douze outils redemandent à chaque fois hors Bypass, et le Bypass n'écrit pas de règle `always`. `sudo`, `rm *` et un `docker run` qui donne l'hôte sont refusés par les règles Bash, même dans le conteneur ; le Bypass ne lève pas ce `deny`, ni un danger dont le verdict est `deny`, ni un chemin sensible qui `deny`. Tout `ask` d'un outil `mcp__kali__*` (`id`, `go install … 2>&1`, un danger avalé dans `shell.unanalyzable` pour `execute_command` ; une URL, une wordlist ou un fichier de sortie pour les onze autres) est couvert par le Bypass, comme tout `ask` d'un outil `mcp__exegol__*`.
- Une approbation de session sur `nmap_scan` couvre les appels suivants de cet outil, arguments compris. Même résidu que `mcp__exegol__exec`.
- Le binaire `kali-server-mcp` n'est pas installé par ce lot. Image sans le paquet : `kali.unavailable`.
- `project.notExegol` reste au catalogue. `link` ne le lève plus pour un Kali.
- Le lot P1 (ADR 0013) n'est pas fait ici. Quand il le sera, il ne revient pas sur le lien ni sur ces outils.
- Le sélecteur de terminaux dit encore « Exegol » : chaîne d'écran, hors de ce lot. Les Kali de la liste y sont déjà proposés.

## Plan

Un seul lot, K2. Le brief pour `dev` est la section suivante. P1 ne fait pas partie de ce lot.

### Objectif

Rendre un Kali de `listLabelPrefix` liable et exécutable par les douze outils de mcp-kali-server, processus dans ce conteneur, gate inchangée dans sa sévérité.

### Fichiers

- `packages/core/src/project.ts` (`link` seulement)
- `packages/core/src/exegol/targets.ts` (`resolveKaliContainer` ; `resolveExegolContainer` inchangé dans son filtre)
- `packages/core/src/kali/tool-specs.ts` (nouveau)
- `packages/core/src/kali/api.ts` (nouveau : santé, démarrage, HTTP ; pas une méthode de `DockerClient`)
- `packages/core/src/docker/client.ts` (rien sur `DockerClient` ni sur `run` ; `createKaliContainer` inchangé)
- `packages/core/src/process/run.ts` (`stdin` optionnel, défaut inchangé)
- `packages/core/src/approval/policy.ts` (cas `execute_command` seulement)
- `packages/core/src/reason.ts` (`kali.unavailable`)
- `packages/core/src/index.ts` (export du module `kali`)
- `packages/messages/src/fr.ts` et `packages/messages/src/en.ts` (ce code seulement)
- `packages/agent-sdk/src/kali-tools.ts` (nouveau) et `packages/agent-sdk/src/index.ts`
- `packages/vscode/src/engine/runner-options.ts`
- `packages/vscode/src/logic/cockpit.ts` (branche `canLink` seulement)
- `packages/vscode/src/logic/chat.ts` (suivi de sortie : préfixe `mcp__kali__` en plus de l'exec Exegol)
- `packages/vscode/media/ui.js` (filtre des lignes du monitor seulement)
- tests cités dans les critères : `project.test.ts`, `exegol-targets.test.ts`, `shells.test.ts`, `docker-client.test.ts`, `cockpit.test.ts`, `runner-options.test.ts`, `ui.test.ts`, plus `packages/core/test/kali-api.test.ts`

### Décision

Reprendre les cinq points. Détail que `dev` ne doit pas réinventer :

- `link` : `notFound`, puis famille différente de `exegol` et de `kali` → `project.notExegol`, puis `notRunning`, puis `noWorkspace`. Un Kali `running` avec `workspace` écrit `{ container: nom réel, workspace }`.
- `resolveKaliContainer(target, requested, containers)` copie `resolveExegolContainer` en filtrant `family === "kali"`. Le dédié Exegol ne résout pas un outil Kali. L'inverse reste vrai.
- Noms exportés : `KALI_SERVER_NAME = "kali"`, `KALI_TOOL_PREFIX = "mcp__kali__"`, `KALI_EXECUTE_TOOL = "mcp__kali__execute_command"`.
- Argv de démarrage, éléments séparés : `exec`, `--detach`, `--workdir`, `/workspace`, nom, `kali-server-mcp`, `--ip`, `127.0.0.1`, `--port`, `5000`. Rien d'autre.
- HTTP : `python3`, `-c`, script constant qui lit un JSON sur stdin et appelle `urllib.request` vers `http://127.0.0.1:5000` + chemin. Timeout de la requête : 300 secondes (défaut de `client.py`). Timeout du `docker exec` : celui déjà utilisé par l'exec Exegol (600000). `runProcess` : `stdin` absent → `stdio` `ignore` comme aujourd'hui ; `stdin` chaîne → pipe, écriture, fermeture. Aucun autre appel ne passe `stdin`.
- Santé d'abord. Échec de connexion : un démarrage, puis au plus dix lectures de `/health`, puis `kali.unavailable` avec `{ name }`. Libellés : fr `serveur Kali indisponible dans le conteneur : …`, en `Kali server unavailable in the container: …`.
- Corps : clés de `client.py`. John envoie `format`. Champ `container` jamais envoyé. Clé absente ou chaîne vide : omise, pour laisser le défaut du serveur. Champs requis manquants : erreur de validation, sans `exec`.
- `evaluatePolicy` sur `KALI_EXECUTE_TOOL` : `evaluateBash` sur `input.command` ; `deny` conservé ; sinon `evaluateUnanalyzable` de cet outil. Pas de dépendance à `posixShell` ni à `win32`.
- Toolset ajouté à côté d'Exegol dans `runnerOptions`, sauf mode `learning` (cours seul).
- `canLink` : vrai seulement si non lié, `running`, et `workspace` défini. Plus de cas particulier Kali. Pas de chaîne nouvelle.
- Monitor : une ligne pour `mcp__exegol__exec` ou un outil préfixé `mcp__kali__`. `container` lu dans le JSON s'il y est ; `command` = le reste du JSON déjà stocké. Pas de chaîne française nouvelle. Le HTML vide et le titre « Terminaux Exegol » ne changent pas.

### Critères

- `link` d'un Kali `running` avec `workspace` écrit le nom réel. Un arrêté ou sans montage n'écrit pas. Un nom absent de la liste n'écrit pas. Un Exegol `running` avec montage écrit encore.
- `resolveExegolContainer` refuse un Kali. `resolveKaliContainer` refuse un Exegol, un nom hors liste, un `@` non cité, et un dédié qui n'est pas ce Kali.
- Les outils enregistrés sont exactement les douze noms. Un test échoue si un treizième apparaît.
- L'argv de démarrage est exactement celui de la Décision. Il ne contient ni `--publish`, `-p`, `--privileged`, `--network`, `--volume`, `--mount`, `-v`.
- `DockerClient.run` et `createKaliContainer` : attentes d'argv inchangées.
- `execute_command` avec `sudo id` est `deny`. Avec `docker run -v /:/h x` est `deny` (`docker.hostAccess`). Avec `id` est `ask` et `shell.unanalyzable`. Une politique `*` `allow` ne l'`allow` pas. `isRememberable` est faux.
- `nmap_scan` sans règle est `ask` et `policy.default`.
- Santé en échec : pas d'`exec` vers un autre nom que celui résolu. Binaire refusé : `kali.unavailable`, pas de seconde commande inventée.
- Mode `learning` : toolsets `["cours"]`. Sans mode : `exegol` et `kali`.
- `canLink` vrai pour un Kali `running` avec `workspace`, faux s'il est arrêté ou sans montage.
- `pnpm check` vert. Commit en français, sans pousser.

### Interdits

Pas de VPN. Pas de volume ni de label sur `DockerClient.run`. Pas de `--privileged`, pas de réseau `host`, pas de socket Docker. Ne pas affaiblir la gate, `dockerRunHazard`, ni la mémorisation de `execute_command`. Ne pas exécuter un conteneur absent de `listLabelPrefix`. Ne pas rouvrir `/start`. Ne pas modifier `terminalLaunch`, `planEditorShell`, `termlog`, ni le parseur `#`. Pas de libellé d'écran nouveau. Ne pas réaliser le format multi-projets de l'ADR 0013. Ne pas installer le paquet. Ne pas brancher `client.py` au SDK.

## Amendement — préparation pilotée par le cockpit

L’ADR 0018 autorise la préparation des prérequis lors des actions humaines
Créer, Démarrer et Lier. L’interdiction d’installer depuis un appel de
l’agent reste applicable. Les commandes de l’API sont exécutées depuis
`/workspace`, indépendamment du dossier du lanceur du paquet Kali.
