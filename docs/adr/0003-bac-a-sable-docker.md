# 0003 — Bac à sable Docker : exécution de commandes par l'agent dans un conteneur géré

- Statut : proposé (décisions de produit Q1 à Q5 à confirmer par l'utilisateur)
- Date : 2026-10-14
- S'appuie sur : ADR 0001 (processus), ADR 0002 (Windows natif)

## Contexte

On veut donner à l'agent un environnement d'exécution (compiler, tester, lancer des scripts) **sans** réactiver Bash sur l'hôte (invariant). Plateforme prioritaire : Windows natif + Docker Desktop (backend WSL2, conteneurs Linux). Faits établis :

- `DockerClient` (`packages/core/src/docker/client.ts`) : `ps`, `images`, `logs`, `inspect`, `run`, `start`, `stop`, `rm` ; `run` sans volume ; opérandes par `assertOperand`, commande par `assertCommand` (256 éléments, 32 Kio, sans `\0`) ; appels par `runProcess` + `resolveBinary` (`safeEnv`), délai 30 min. `exec` a été retiré de l'interface publique (lot L2).
- `tool-specs.ts` : sortie d'outil plafonnée à 200 lignes ; `tool.result` à 64 Kio (`maxResultBytes`).
- `policy.ts` : pour un outil MCP, seule la règle sur le nom d'outil s'applique (pas de motif d'arguments) ; `mcp__docker__*` en `ask` sauf lectures (`allow`) et `rm` (`deny`).
- `gate.ts:97` `sessionKey` : pour un outil non-Bash, la clé de session est **le nom seul** ; un « session » sur un futur `exec` couvrirait toutes les commandes. C'est le point de sécurité principal.
- Les deux adaptateurs nomment un outil de toolset `mcp__<set>__<outil>` (`agent-opencode/src/tool-server.ts:90`), donc une seule clé de politique pour Claude et OpenCode.

Modèle de menaces (complète ADR 0001/0002) :

- **Le modèle contrôle** : l'argv de la commande, le répertoire de travail dans le conteneur, la durée demandée (plafonnée), les chemins des échanges de fichiers, et **tout le contenu du conteneur** (fichiers, processus d'arrière-plan, liens symboliques, noms de fichiers, sortie). La sortie est une donnée non fiable : injection de consignes, séquences de contrôle de terminal, faux secrets, archives piégées.
- **L'opérateur contrôle** : l'activation du bac à sable, l'image, le réseau, les limites, sa politique. **Le dépôt** ne contrôle que la politique approuvée par empreinte.
- **Frontière visée** : le conteneur (utilisateur non root, aucune capability, `no-new-privileges`, seccomp par défaut, aucun montage hôte, aucun socket docker, réseau coupé). Sous Docker Desktop, une évasion du conteneur donne la VM Linux, qui monte les disques Windows (`/run/desktop/mnt/host/…`) : la VM n'est **pas** une seconde frontière fiable, donc le durcissement du conteneur est obligatoire et vérifié avant chaque exécution.
- **Rôle de la gate** : consentement et traçabilité de chaque exécution. Le confinement est assuré par le conteneur, pas par l'analyse de la commande.

## Décision

### A. Toolset séparé `sandbox`, conteneur créé par l'opérateur

- Nouveau toolset `sandboxToolset()` (outils `mcp__sandbox__exec`, `mcp__sandbox__put`, `mcp__sandbox__get`, `mcp__sandbox__status`), distinct de `docker` : la politique et l'UI les distinguent du `run` générique.
- **Un bac à sable par run**, créé par le moteur au démarrage quand l'opérateur l'active (`--sandbox`), jamais par le modèle. Image, réseau et limites viennent de la CLI ou de la configuration utilisateur, jamais de l'entrée d'un outil ni de la politique du dépôt. Supprimé (`docker rm -f`) à la fin du run, sur annulation, et par le filet de sortie synchrone (comme `trackProcessTree`). `john sandbox prune` supprime les conteneurs portant le label (orphelins après un SIGKILL).
- **Autorité = registre en mémoire** (`SandboxRegistry`) des identifiants complets (64 hex) créés par ce processus. Le label `io.john-studio.sandbox=<runId>` ne sert qu'au nettoyage : il est falsifiable par quiconque peut lancer `docker run`, il n'autorise donc rien. L'outil `exec` ne prend **aucun nom de conteneur** : il cible le bac à sable du run. Absence de bac à sable → `deny` (`sandbox.unavailable`).
- **Vérification avant chaque `exec`/`put`/`get`** (`docker inspect` sur l'identifiant) : `Id` égal, label égal, `State.Running`, `HostConfig.Privileged=false`, `CapAdd` vide, `CapDrop` contient `ALL`, `SecurityOpt` contient `no-new-privileges` et aucun `seccomp=unconfined`/`apparmor=unconfined`, `Binds` et `Mounts` vides (hors volumes anonymes déclarés par l'image : refusés aussi, simplicité), `Devices` vide, `NetworkMode` égal à la valeur demandée, `PidMode`/`IpcMode`/`UTSMode`/`UsernsMode` non `host`, `Config.User` égal à l'utilisateur fixé. Tout écart → `deny` `sandbox.tampered` (fail-closed, non mémorisable).

### B. Création durcie (argv fixe, construit par le code)

`docker run -d --init --label io.john-studio.sandbox=<runId> --name john-sbx-<runId court> --user 65534:65534 --cap-drop ALL --security-opt no-new-privileges --network none --pids-limit 512 --memory 2g --memory-swap 2g --cpus 2 --restart no --stop-timeout 2 --log-driver none --workdir /work --entrypoint sleep <image> infinity`

- Puis initialisation par le **code** (jamais le modèle) : `docker exec -u 0 <id> mkdir -p /work` et `chown 65534:65534 /work` (argv fixes). L'image doit fournir `sleep`, `mkdir`, `chown` (busybox, debian, alpine… ; une image distroless est refusée avec `sandbox.imageUnsupported`).
- Jamais : `-v`, `--mount`, `--volumes-from`, `--device`, `--privileged`, `--cap-add`, `--security-opt` autre que ci-dessus, espace de noms `host`, `-p`/`-P`, `--env`/`--env-file`, socket docker. Le réseau `bridge` n'est possible que sur option explicite de l'opérateur (Q1).
- `sandbox.started` journalise identifiant, image, **empreinte (digest) de l'image** (via `inspect`), réseau et limites ; `sandbox.stopped` la fin (`runEnd`, `abort`, `error`, `exit`).

### C. Forme de `exec` : argv direct, sans shell imposé

- Entrée : `{ argv: string[], cwd?: string, timeoutSec?: number }`. Commande lancée : `docker exec --user 65534:65534 --workdir <cwd> <id> <argv…>` ; **pas** de `-i` (stdin fermé), `-t`, `-d`, `--privileged`, `-e`/`--env-file`, `--detach-keys`. L'identifiant vient du registre, jamais de l'entrée.
- Validation : `argv` 1 à 256 éléments, sans `\0`, `argv[0]` non vide, total ≤ 16 Kio (marge sous la limite de 32 767 caractères de `CreateProcess` après guillemets) ; `cwd` absolu POSIX, normalisé, sous `/work`, sans `..` ni `\0`, défaut `/work` ; `timeoutSec` ≤ plafond opérateur (défaut 600 s, maximum 1800 s).
- Le modèle peut passer `["sh","-c","…"]` : le conteneur est la frontière, on ne l'interdit pas, mais la gate le traite comme interpréteur (D).
- Exécutions **sérialisées** par bac à sable (file FIFO après la gate) : une seule à la fois, ce qui rend l'arrêt (E) sans ambiguïté.

### D. Évaluation par la gate et mémorisation

- `PolicyRule.command` s'applique à `mcp__sandbox__exec` : le motif est découpé sur les espaces et comparé **élément par élément** à `argv` (pas d'analyse shell), `*` en dernier élément couvre le reste, `*` dans un élément est un joker local. Les règles `deny` sont aussi comparées au nom normalisé de `argv[0]` (basename, comme `programName`).
- `argv[0]` interpréteur ou enveloppe (`sh`, `bash`, `dash`, `ash`, `zsh`, `python*`, `node`, `perl`, `ruby`, `php`, `env`, `xargs`, `nohup`, `timeout`, `nice`, `setsid`, `su`, `sudo`, `busybox`, `find` avec `-exec`/`-delete`) : une règle `allow` à joker ne s'applique pas, verdict au mieux `ask` (`sandbox.interpreter`) ; seule une règle sans joker identique à l'argv complet peut l'autoriser.
- Défaut : `ask` (`policy.default`). `DEFAULT_POLICY` n'ajoute aucune règle pour `mcp__sandbox__*` sauf `status` en `allow`. `put` et `get` : `ask` toujours (chemins hôte, voir F).
- **Mémorisation** : clé de session `mcp__sandbox__exec \0 <containerId> \0 JSON(argv) \0 cwd`, c'est-à-dire **l'argv exact dans ce conteneur**. Jamais l'outil entier, jamais un préfixe. `always` se réduit à `session` (l'identifiant du conteneur est éphémère) ; une autorisation durable passe par une règle écrite par l'opérateur. `sandbox.tampered`, `sandbox.unavailable` et tout verdict lié aux chemins hôte de `put`/`get` ne sont pas mémorisables. La règle générale de `sessionKey` devient : outil non-Bash **sans** dérivation de clé spécifique → mémorisable par nom (comportement actuel inchangé pour les autres outils), outil `mcp__sandbox__*` → clé ci-dessus ou `null`.
- Un mode « autonome » (aucune demande par exécution) n'est **pas** une mémorisation : s'il est retenu (Q3), c'est une option de lancement de l'opérateur, refusée si le réseau n'est pas `none`.

### E. Durée, annulation, sortie

- Délai et annulation : `runProcess` (signal, `timeoutMs`) arrête l'arbre de la CLI `docker` côté hôte (ADR 0001/0002), ce qui **n'arrête pas** le processus dans le conteneur. Le moteur fait alors `docker restart -t 2 <id>` : tous les processus du conteneur sont tués, le système de fichiers est conservé, sans dépendre d'un `kill`/`pkill` dans l'image. Échec du redémarrage → bac à sable marqué hors service, `rm -f`, exécutions suivantes refusées (`sandbox.unavailable`). Résultat d'outil : `sandbox.execTimeout` / `sandbox.execAborted` avec la sortie partielle. Les processus d'arrière-plan laissés par une exécution normale restent (bornés par `pids-limit`, mémoire, CPU) et meurent au redémarrage ou à la suppression.
- Sortie : stdout et stderr (étiquetés), code de sortie ; plafonds existants (200 lignes par l'outil, `maxResultBytes`, `maxJournaledLines`, 16 Kio par ligne). Journalisation par les `process.*` existants (argv `docker exec …` complet), masquage par le recorder. Aucun nouveau `kind` pour l'exécution ; seuls `sandbox.started` / `sandbox.stopped` sont ajoutés.
- **Séquences de contrôle** : la CLI retire les caractères C0/C1 (sauf `\n`, `\t`) et les séquences ESC de toute sortie d'outil et de tout argv affiché dans une demande d'approbation (sinon la sortie du conteneur peut maquiller la question suivante). Le texte renvoyé au modèle reste brut (borné).

### F. Échange de fichiers sans volume

- Par `docker cp` en **flux tar** uniquement : `docker cp - <id>:/work/…` (entrée) et `docker cp <id>:<src> -` (sortie). Le tar est **produit et lu par notre code** (module `core/src/sandbox/tar.ts`, ustar + en-têtes pax pour les noms longs, sans dépendance) : `docker cp` n'extrait jamais rien sur l'hôte, donc aucun lien symbolique ni chemin piégé n'y est créé par la CLI docker.
- `put { hostPath, containerPath }` : `hostPath` passe par le contrôle de chemins de `Read` (sensible → `deny`, hors espace de travail → `ask` non mémorisable) ; un répertoire est parcouru, chaque entrée contrôlée, liens symboliques ignorés, seuls fichiers réguliers et répertoires ; plafonds 256 Mio et 10 000 entrées. `containerPath` sous `/work`.
- `get { containerPath, hostPath }` : lecteur tar strict (fichiers réguliers et répertoires seulement ; lien, lien dur, périphérique, FIFO, noms absolus, `..`, `\0`, et sous win32 les formes refusées par `paths.ts` → refus de toute l'archive) ; mêmes plafonds, mesurés pendant la lecture ; écriture dans l'espace de travail seulement, chaque chemin final contrôlé comme une écriture (`Write`), destination existante → refus (pas d'écrasement), écriture via un répertoire temporaire puis `rename`. Jamais mémorisable.

## Alternatives écartées

- **`sh -c` imposé** : rend tout motif de politique inopérant et ajoute une couche d'échappement ; l'argv direct garde des règles lisibles, `sh -c` reste possible mais au mieux `ask`.
- **Mémoriser par motif de commande (préfixe)** : `git *` couvre `git -c core.sshCommand=…` ; seul l'argv exact est sûr. Les autorisations larges relèvent de règles écrites par l'opérateur.
- **Cible par label vérifié** : un label se pose avec `docker run --label` ; le registre en mémoire ne se falsifie pas.
- **Arrêt par `pkill`/`kill` dans le conteneur ou `timeout` dans l'argv** : dépend de l'image, et le modèle choisit l'argv ; `docker restart` est universel.
- **Volume de travail partagé** : supprimerait la frontière (écriture de l'agent sur l'hôte, liens symboliques) ; exclu.
- **`docker cp` avec extraction par la CLI** : historique de CVE de liens symboliques (CVE-2018-15664, CVE-2019-14271), comportement sous Windows non maîtrisé.
- **Conteneur choisi ou créé par le modèle** : image et options hors du contrôle de l'opérateur.

## Conséquences

- Positives : l'agent exécute du code sans Bash hôte ; chaque exécution est approuvée, journalisée, bornée ; le confinement ne dépend pas de l'analyse de la commande.
- Négatives : une demande par commande distincte (fatigue d'approbation) ; un délai dépassé redémarre le conteneur ; images minimales (distroless) non supportées ; code tar maison à maintenir et à tester par fuzzing léger.
- Risques résiduels : évasion par faille du noyau de la VM Docker Desktop (atténuée par non-root, aucune capability, seccomp ; Enhanced Container Isolation recommandée si disponible) ; avec réseau `bridge`, exfiltration et accès à l'hôte par `host.docker.internal` [?] (à vérifier : services de l'hôte liés à 127.0.0.1 joignables ?) ; image malveillante (journaliser le digest, recommander une image épinglée) ; remplissage disque (pas de quota portable sur overlay2).
- À vérifier sur Windows (W-L6) : longueur de ligne de commande, `docker restart` pendant un `exec` en cours, comportement de `docker cp -` sur tube nommé.

## Plan

Séquentiel. Revue sécurité de l'architecte : S1, S2, S4 (et le chemin d'annulation de S3).

- **S1 — Cycle de vie (cœur).** `core/src/sandbox/` : `createSandbox`, `inspectSandbox` (vérification A), `execInSandbox`, `restartSandbox`, `removeSandbox`, `SandboxRegistry`, filet de sortie ; `DockerClient` réutilisé par `runProcess`/`resolveBinary`, argv construits par le code ; kinds `sandbox.started`/`sandbox.stopped` (validateurs, `KIND_CLASS`) ; codes `sandbox.*` (`REASON_CODES`, fr, en). Critères : tests avec faux binaire docker vérifiant l'argv **exact** de `run`, `exec`, `restart`, `rm` ; chaque champ d'`inspect` altéré → `sandbox.tampered` ; identifiant hors registre refusé ; aucun chemin d'entrée ne permet d'ajouter une option docker.
- **S2 — Politique et gate.** Motifs `command` sur argv pour `mcp__sandbox__exec`, interpréteurs, `deny` sur basename, clé de session D, `always` → `session`, non-mémorisables. Critères : tests « session sur `npm test` n'autorise pas `npm test x` ni un autre conteneur », « `allow sh *` ne couvre pas `sh -c …` », « `deny rm *` refuse `/bin/rm` », « clé jamais égale au nom seul », comportement des autres outils inchangé (suite existante verte).
- **S3 — Toolset et CLI.** Spécifications neutres dans `tool-specs.ts`, enveloppes `agent-sdk` et `agent-opencode`, file sérialisée, délai/annulation → `restart`, résultat `sandbox.execTimeout`/`execAborted`, nettoyage de fin de run ; CLI `--sandbox`, `--sandbox-image`, `--sandbox-network`, `--sandbox-timeout`, `john sandbox prune`, filtrage des séquences de contrôle dans l'affichage et la question d'approbation ; libellés fr/en. Critères : tests avec faux docker (délai → `restart` appelé, sortie partielle rendue, conteneur supprimé en fin de run et sur Ctrl-C), test d'une sortie contenant `\x1b[2K` affichée neutralisée.
- **S4 — Échange de fichiers.** `sandbox/tar.ts` (écriture et lecture strictes), `put`/`get`. Critères : archives piégées (lien symbolique, lien dur, `../`, chemin absolu, nom ADS/réservé win32, dépassement de taille déclarée et réelle, en-tête pax hostile) refusées en bloc sans rien écrire ; destination existante refusée ; entrée sensible d'un répertoire `put` refusée.
- **S5 — Validation réelle et documentation.** Tests d'intégration avec vrai Docker, opt-in (`JOHN_DOCKER_TESTS=1`), dont l'impossibilité de lire `/run/desktop` ou un fichier hôte, `id -u` ≠ 0, `capsh`/`/proc/self/status` CapEff nul, réseau absent ; ajout aux étapes W-L6 ; README.
