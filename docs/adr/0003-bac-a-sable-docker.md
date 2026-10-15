# 0003 — Bac à sable Docker : exécution de commandes par l'agent dans un conteneur géré

- Statut : accepté pour le profil durci par défaut (lots S1 à S5) ; amendé le 2026-10-15 par la section H (réseau sortant optionnel `bridge`, profil « développement », lots N1 à N5) ; tout profil de privilèges (root, capacités, accès hôte) reste exclu
- Date : 2026-10-14 (acceptation : 2026-10-14 ; amendement H : 2026-10-15)
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

`docker run -d --pull never --init --label io.john-studio.sandbox=<runId> --name john-sbx-<runId court> --user 65534:65534 --cap-drop ALL --security-opt no-new-privileges --network none --pids-limit 512 --memory 2g --memory-swap 2g --cpus 2 --restart no --stop-timeout 2 --log-driver none --workdir /work --entrypoint sleep <image> infinity`

- Puis initialisation par le **code** (jamais le modèle) : `docker exec -u 0 <id> mkdir -p /work` et `chmod 1777 /work` (le `chown` échoue sous `--cap-drop ALL` : constaté sur Docker Desktop 29.7 ; root reste propriétaire de `/work`, sans capacité, et l'utilisateur 65534 y écrit grâce au bit sticky 1777) (argv fixes). L'image doit fournir `sleep`, `mkdir`, `chown` (busybox, debian, alpine… ; une image distroless est refusée avec `sandbox.imageUnsupported`).
- Jamais : `-v`, `--mount`, `--volumes-from`, `--device`, `--privileged`, `--cap-add`, `--security-opt` autre que ci-dessus, espace de noms `host`, `-p`/`-P`, `--env`/`--env-file`, socket docker. Le réseau est toujours `none` dans cet ADR (Q1) ; aucune option ne le change.
- `--pull never` : le moteur ne télécharge jamais d'image ; l'opérateur la tire lui-même au préalable (image absente → `sandbox.imageUnsupported`).
- Ordre dans le journal : `sandbox.started` précède `run.started` ; c'est donc un événement racine (`parentId` null). `john sandbox prune` ne supprime que les conteneurs portant le label ET le nom `john-sbx-*`, liste d'abord et exige `--yes`.
- `sandbox.started` journalise identifiant, image, **empreinte (digest) de l'image** (via `inspect`), réseau et limites ; `sandbox.stopped` la fin (`runEnd`, `abort`, `error`, `exit`).

### C. Forme de `exec` : argv direct, sans shell imposé

- Entrée : `{ argv: string[], cwd?: string, timeoutSec?: number }`. Commande lancée : `docker exec --user 65534:65534 --workdir <cwd> <id> <argv…>` ; **pas** de `-i` (stdin fermé), `-t`, `-d`, `--privileged`, `-e`/`--env-file`, `--detach-keys`. L'identifiant vient du registre, jamais de l'entrée.
- Validation : `argv` 1 à 256 éléments, sans `\0`, `argv[0]` non vide, total ≤ 16 Kio (marge sous la limite de 32 767 caractères de `CreateProcess` après guillemets) ; `cwd` absolu POSIX, normalisé, sous `/work`, sans `..` ni `\0`, défaut `/work` ; `timeoutSec` ≤ plafond opérateur (défaut 600 s, maximum 1800 s).
- Le modèle peut passer `["sh","-c","…"]` : le conteneur est la frontière, on ne l'interdit pas, mais la gate le traite comme interpréteur (D).
- Exécutions **sérialisées** par bac à sable (file FIFO après la gate) : une seule à la fois, ce qui rend l'arrêt (E) sans ambiguïté.

### D. Évaluation par la gate et mémorisation

- `PolicyRule.command` s'applique à `mcp__sandbox__exec` : le motif est découpé sur les espaces et comparé **élément par élément** à `argv` (pas d'analyse shell), `*` en dernier élément couvre le reste, pas de joker local : `*` seul, comme jeton entier ; un motif contenant un autre `*` (ex. `rm -rf /work/*`) est refusé au chargement de la politique (`policy.invalid.commandWildcard`). Les règles `deny` comparent le nom normalisé (`programName` : chemin, casse, `.exe`) du programme du motif à celui de `argv[0]` : `/bin/rm *`, `RM *` et `rm.exe *` refusent `rm`. `cwd` doit être un chemin absolu normalisé sous `/work` (ni `..`, ni `.`, ni `//`, ni barre finale), sinon `deny`.
- `argv[0]` interpréteur ou enveloppe (`sh`, `bash`, `dash`, `ash`, `zsh`, `python*`, `node`, `perl`, `ruby`, `php`, `env`, `xargs`, `nohup`, `timeout`, `nice`, `setsid`, `su`, `sudo`, `busybox`, `find` avec `-exec`/`-delete`) : une règle `allow` à joker ne s'applique pas, verdict au mieux `ask` (`sandbox.interpreter`) ; seule une règle sans joker identique à l'argv complet peut l'autoriser.
- Défaut : `ask` (`policy.default`). `DEFAULT_POLICY` n'ajoute aucune règle pour `mcp__sandbox__*` sauf `status` en `allow`. `put` et `get` : `ask` toujours (chemins hôte, voir F).
- **Mémorisation** : clé de session `mcp__sandbox__exec \0 <containerId> \0 JSON(argv) \0 cwd`, c'est-à-dire **l'argv exact dans ce conteneur**. Jamais l'outil entier, jamais un préfixe. `always` se réduit à `session` (l'identifiant du conteneur est éphémère) ; une autorisation durable passe par une règle écrite par l'opérateur. `sandbox.tampered`, `sandbox.unavailable` et tout verdict lié aux chemins hôte de `put`/`get` ne sont pas mémorisables. La règle générale de `sessionKey` devient : outil non-Bash **sans** dérivation de clé spécifique → mémorisable par nom (comportement actuel inchangé pour les autres outils), outil `mcp__sandbox__*` → clé ci-dessus ou `null`.
- Un mode « autonome » (aucune demande par exécution) n'est **pas** une mémorisation et n'est pas livré par S1 à S5 (Q3, en attente de l'utilisateur). S'il est retenu, ce sera une option de lancement de l'opérateur, jamais de la politique du dépôt.

### E. Durée, annulation, sortie

- Délai et annulation : `runProcess` (signal, `timeoutMs`) arrête l'arbre de la CLI `docker` côté hôte (ADR 0001/0002), ce qui **n'arrête pas** le processus dans le conteneur. Le moteur fait alors `docker restart -t 2 <id>` : tous les processus du conteneur sont tués, le système de fichiers est conservé, sans dépendre d'un `kill`/`pkill` dans l'image. Échec du redémarrage → bac à sable marqué hors service, `rm -f`, exécutions suivantes refusées (`sandbox.unavailable`). Résultat d'outil : `sandbox.execTimeout` / `sandbox.execAborted` avec la sortie partielle. Les processus d'arrière-plan laissés par une exécution normale restent (bornés par `pids-limit`, mémoire, CPU) et meurent au redémarrage ou à la suppression.
- Sortie : stdout et stderr (étiquetés), code de sortie ; plafonds existants (200 lignes par l'outil, `maxResultBytes`, `maxJournaledLines`, 16 Kio par ligne). Journalisation par les `process.*` existants (argv `docker exec …` complet), masquage par le recorder. Aucun nouveau `kind` pour l'exécution ; seuls `sandbox.started` / `sandbox.stopped` sont ajoutés.
- **Séquences de contrôle** : la CLI retire les caractères C0/C1 (sauf `\n`, `\t`) et les séquences ESC de toute sortie d'outil et de tout argv affiché dans une demande d'approbation (sinon la sortie du conteneur peut maquiller la question suivante). Le texte renvoyé au modèle reste brut (borné).

### F. Échange de fichiers sans volume

- Par `docker cp` en **flux tar** uniquement : `docker cp - <id>:/work/…` (entrée) et `docker cp <id>:<src> -` (sortie). Le tar est **produit et lu par notre code** (module `core/src/sandbox/tar.ts`, ustar + en-têtes pax pour les noms longs, sans dépendance) : `docker cp` n'extrait jamais rien sur l'hôte, donc aucun lien symbolique ni chemin piégé n'y est créé par la CLI docker.
- `put { hostPath, containerPath }` : `hostPath` passe par le contrôle de chemins de `Read` (sensible → `deny`, hors espace de travail → `ask` non mémorisable) ; un répertoire est parcouru, chaque entrée contrôlée, liens symboliques ignorés, seuls fichiers réguliers et répertoires ; plafonds 256 Mio et 10 000 entrées. `containerPath` sous `/work`.
- `get { containerPath, hostPath }` : lecteur tar strict (fichiers réguliers et répertoires seulement ; lien, lien dur, périphérique, FIFO, noms absolus, `..`, `\0`, et sous win32 les formes refusées par `paths.ts` → refus de toute l'archive) ; mêmes plafonds, mesurés pendant la lecture ; écriture dans l'espace de travail seulement, chaque chemin final contrôlé comme une écriture (`Write`), destination existante → refus (pas d'écrasement), écriture via un répertoire temporaire puis `rename`. Jamais mémorisable.

### G. Questions Q1 à Q5 (tranchées le 2026-10-14)

- **Q1 — Réseau** (technique, tranché) : `none`, fixe. Pas d'option `--sandbox-network` ; `inspect` exige `NetworkMode=none`. Tout autre réseau ou privilège relève d'un autre ADR. **Révisé par H** (choix de produit de l'utilisateur, 2026-10-15) : `none` reste le défaut, `bridge` devient un choix explicite de l'opérateur ; les privilèges restent exclus.
- **Q2 — Image** (technique, tranché) : aucune image par défaut codée en dur. L'opérateur la fournit (`--sandbox-image` ou configuration utilisateur), de préférence épinglée par digest ; absence → refus de démarrer le run avec `sandbox.imageUnsupported`. Le digest est journalisé (`sandbox.started`).
- **Q3 — Mode autonome** (produit, en attente) : hors S1 à S5. Recommandation : ne pas le livrer ; les autorisations larges passent par des règles `allow` écrites par l'opérateur (D).
- **Q4 — Conservation du conteneur** (technique, tranché) : toujours supprimé en fin de run. Le registre en mémoire est l'autorité (A) ; un conteneur d'un run précédent ne peut pas être réadopté sans faire du label une autorité. Pas d'option `--sandbox-keep`.
- **Q5 — Limites** (technique, tranché) : valeurs de B fixes (`pids-limit 512`, `memory 2g` sans swap, `cpus 2`) ; seul le délai d'exécution est réglable (`--sandbox-timeout`, défaut 600 s, maximum 1800 s). Options de mémoire/CPU à ajouter seulement sur besoin constaté, avec plafond. **Révisé par H.4** (besoin constaté).

### H. Amendement du 2026-10-15 : profil « développement » (réseau sortant)

Contexte : le bac à sable, validé sur Docker Desktop réel, est inutilisable pour le développement courant (pas d'installation de dépendances, de clonage, d'appel d'API). L'utilisateur (propriétaire, usage personnel) révise Q1. **Inchangé** : utilisateur 65534, `--cap-drop ALL`, `no-new-privileges`, aucun montage, aucun périphérique, aucun espace de noms `host`, aucun port publié, `--pull never`, gate par exécution, mémorisation par argv exact. Cet amendement n'ajoute aucun privilège.

#### H.1 Option réseau

- CLI `--sandbox-network <none|bridge>` (refusée sans `--sandbox`, toute autre valeur → `sandbox.invalidArgument`) ; extension : réglage `john.sandbox.network` (`none` | `bridge`), **portée `machine`** : un `.vscode/settings.json` de dépôt ne peut ni l'activer ni le lire comme source. La politique du dépôt et l'entrée des outils ne le touchent jamais (A inchangé).
- **Défaut `none`** dans les deux interfaces. `bridge` est un choix d'opérateur fait une fois (réglage machine persistant) : le coût pour l'utilisateur est un réglage, le gain est qu'un oubli ou une nouvelle machine reste fermé (fail-closed).
- `bridge` = **réseau `bridge` par défaut de Docker**, pas de réseau dédié par run. Un réseau dédié n'isolerait que des autres conteneurs du pont par défaut, alors que l'hôte et le LAN restent joignables quoi qu'on fasse (H.2) ; il ajouterait création, suppression et `prune` de réseaux. À reconsidérer si l'opérateur fait tourner des services sensibles sur le pont par défaut.
- Jamais `host`, `container:<…>`, ni réseau nommé : seules les deux valeurs ci-dessus existent dans le code.

#### H.2 Modèle de menaces avec réseau

- **Ce qui peut sortir** : pas seulement le contenu du conteneur (fichiers `put`, image, sorties). Le modèle peut placer dans un argv **tout ce qui est dans son contexte** : fichiers de l'hôte lus par `Read`, sorties d'outils, conversation. Avec `bridge`, un agent piégé par une injection de consignes (README, dépendance, page web, sortie de commande) dispose d'un canal d'exfiltration (`curl`, `git push`, DNS). Le masquage du recorder protège le journal, **pas** cette sortie. Aucune variable d'environnement de l'hôte n'entre dans le conteneur (pas de `--env` hôte, `docker exec` sans `-e`) : pas de jeton ni de clé SSH à voler sur place.
- **Ce qui peut entrer** : code arbitraire téléchargé (`npm install` exécute des scripts `postinstall`). Il s'exécute dans la frontière inchangée (non root, sans capacité) ; le risque nouveau est l'exfiltration et le rebond réseau, pas l'évasion.
- **Hôte et LAN** : sous Docker Desktop, `host.docker.internal` / la passerelle (`192.168.65.254`) mènent aux services de l'hôte Windows, **y compris ceux qui écoutent sur 127.0.0.1** ; le LAN et les métadonnées d'un éventuel nuage sont joignables. `--add-host host.docker.internal:…` ne neutralise que le nom, pas l'adresse : **écarté** (fausse sécurité). Le code ne peut pas filtrer le trafic sortant sans capacité réseau ni pare-feu hôte ; c'est un risque résiduel assumé, pas une mesure.
- **Mesures retenues (vérifiables par le code)** :
  1. **Démon Docker exposé** : avant de créer un bac à sable `bridge`, le moteur tente une connexion TCP sur `127.0.0.1:2375` (option Docker Desktop « Expose daemon on tcp://localhost:2375 without TLS ») ; connexion acceptée → refus `sandbox.networkUnsafe` (`{ port: 2375 }`), fail-closed. Un démon joignable depuis le conteneur vaudrait accès complet à l'hôte.
  2. **Serveur local de l'adaptateur** : tout serveur HTTP local du moteur (ex. `opencode serve`) est joignable depuis le conteneur via la passerelle. S'il permet de répondre aux demandes de permission sans authentification, un processus du bac à sable pourrait **s'auto-approuver** et contourner la gate (invariant). Tant qu'il n'est pas établi que ce serveur exige un secret par run absent du conteneur, `bridge` est **refusé avec l'adaptateur OpenCode** (`sandbox.networkUnsafe`, `{ reason: "adapterServer" }`). L'adaptateur Claude (stdio) n'est pas concerné. À lever par N0.
  3. Le conteneur ne reçoit jamais de port publié, d'`ExtraHosts`, ni de DNS imposé par une entrée non opérateur (vérifié, H.3).
- **Risques résiduels (écrits noir sur blanc)** : (a) exfiltration de tout ce que le modèle a vu, par n'importe quelle exécution approuvée ou couverte par une règle `allow` ; (b) accès aux services de l'hôte Windows (y compris loopback) et du LAN, sans authentification propre à eux ; (c) code de dépendances non relu exécuté dans le conteneur ; (d) une règle `allow` à joker sur `npm`, `pip`, `cargo`, `git`, `curl` vaut désormais exécution de code distant **et** sortie réseau sans demande. Atténuations hors code, recommandées dans le README : n'activer `bridge` que pour un dépôt de confiance, ne pas laisser de service sans mot de passe écouter sur l'hôte, Enhanced Container Isolation si disponible.

#### H.3 Vérification, journal, approbation

- `inspectSandbox` reçoit la valeur choisie (registre, jamais l'entrée d'outil) et vérifie : `HostConfig.NetworkMode` égal à `none` ou `bridge` selon le choix ; `NetworkSettings.Networks` a **exactement une clé**, égale à ce choix (un `docker network connect` ultérieur ne change pas `NetworkMode` mais ajoute une clé : altération) ; `HostConfig.PortBindings` vide/nul, `PublishAllPorts` faux, `ExtraHosts` vide/nul ; `HOME` conforme à H.4. Écart → `sandbox.tampered`, comme le reste de A.
- `sandbox.started.network` : passe du littéral `none` à `none | bridge` (validateur élargi, compatible avec les journaux existants). Pas de nouveau `kind`.
- Approbation : la carte (extension) et la question (CLI) d'un `mcp__sandbox__exec` affichent « réseau activé » quand `bridge` ; l'en-tête de session l'affiche en permanence. **Pas de confirmation supplémentaire** à la première activation : le choix est déjà un acte explicite de l'opérateur au niveau machine, et une confirmation de plus s'ajoute à la fatigue d'approbation. La mémorisation (D) est inchangée.

#### H.4 Utilisabilité sans privilège

- **`HOME`** : l'utilisateur 65534 a `HOME=/nonexistent` (ou `/`) dans la plupart des images, d'où l'échec des caches `npm`, `pip`, `cargo`, `git config`. Le code passe **une seule** variable constante `--env HOME=/home/john` à `docker run` (exception unique et fixe à l'interdit `--env` de B, aucune valeur venant de l'opérateur ou du modèle) et l'initialisation crée `/home/john` comme `/work` (`mkdir -p`, `chmod 1777`). Pas sous `/work` : un `get /work` ne ramènerait pas des centaines de Mio de cache.
- **`/tmp`** : déjà inscriptible (système de fichiers du conteneur non `--read-only`) ; pas de `tmpfs` (ajouterait un montage à vérifier sans besoin constaté).
- **Limites** : `pids-limit 512` reste fixe (suffisant pour npm, pip, cargo). Mémoire et CPU deviennent réglables par l'opérateur : `--sandbox-memory` / `john.sandbox.memory` (défaut 2g, de 1g à 8g, swap égal à la mémoire) et `--sandbox-cpus` / `john.sandbox.cpus` (défaut 2, de 1 à 8) ; la valeur choisie est vérifiée par `inspect` et journalisée dans `limits`.
- **Durée de vie** : si l'extension crée un run (donc un bac à sable) par message, `/work` disparaît entre deux messages, ce qui rend le développement impossible. Le bac à sable doit vivre **le temps de la session du moteur dans le même processus** (registre en mémoire toujours autorité, jamais de réadoption par label, Q4 inchangée sur ce point), supprimé à la fermeture de la conversation, à l'arrêt de l'extension et par le filet de sortie. À confirmer par N0.
- **Image** : reste fournie par l'opérateur ; le README donne un exemple de `Dockerfile` (node, python, git, outils de compilation) à construire localement, l'utilisateur 65534 n'ayant pas besoin d'installer de paquets système.
- **Hors périmètre** : publier un port vers l'hôte pour ouvrir un serveur de développement dans le navigateur (question de produit, H.6) ; installer des paquets système (exigerait root : exclu).

#### H.5 Plan (N0 à N5)

Ordre : N0 ; puis N1 et N2 en parallèle ; puis N3 ; N4 et N5 indépendants. Revue sécurité de l'architecte : **N1, N2, N3**.

- **N0 — Faits (explorer).** (a) L'adaptateur OpenCode lance-t-il un serveur HTTP local ; sur quelle adresse ; avec quelle authentification ; peut-il répondre à une demande de permission ? (b) L'extension crée-t-elle un run par message ou par conversation, et quand le bac à sable est-il supprimé ? Rapport cité `fichier:ligne`.
- **N1 — Cœur.** `sandbox.ts` : `network: "none" | "bridge"` dans les options de `createSandbox`, conservé dans `SandboxRecord` ; `runArgs` construit `--network <valeur>` et `--env HOME=/home/john` ; init crée `/home/john` ; `inspectSandbox` vérifie H.3 ; sonde `127.0.0.1:2375` avant `bridge` ; code `sandbox.networkUnsafe` (`REASON_CODES`, fr complet, en) ; validateur `sandbox.started` élargi. Critères : faux docker vérifiant l'argv **exact** de `run` pour `none` et `bridge` (aucune autre option ajoutée) ; `inspect` altéré → `sandbox.tampered` pour : `NetworkMode` `host`, `container:x`, autre nom, `bridge` quand `none` demandé ; deux clés dans `Networks` ; `PortBindings` non vide ; `PublishAllPorts` vrai ; `ExtraHosts` non vide ; `HOME` différent ; port 2375 en écoute (serveur de test) → `sandbox.networkUnsafe` et aucun `docker run` émis ; suite existante verte.
- **N2 — CLI et extension (options).** `--sandbox-network`, `--sandbox-memory`, `--sandbox-cpus` dans `sandbox-options.ts` (refusés sans `--sandbox`, bornes de H.4) ; réglages `john.sandbox.network|memory|cpus` en portée `machine` dans le manifeste ; refus de `bridge` avec OpenCode tant que N0(a) ne l'a pas levé. Critères : tests de résolution (valeurs hors liste/bornes refusées, défauts `none`/2g/2) ; test que le manifeste déclare ces réglages en portée `machine`.
- **N3 — Approbation et affichage.** Mention « réseau activé » sur la carte d'approbation `mcp__sandbox__exec`, la question CLI et l'en-tête de session ; libellés fr/en. Critères : test de rendu (présent si `bridge`, absent si `none`), neutralisation des séquences de contrôle inchangée.
- **N4 — Durée de vie par conversation** (selon N0(b)). Critères : faux docker — deux messages successifs d'une même conversation utilisent le même identifiant ; fermeture de conversation et arrêt de l'extension émettent `rm -f` et `sandbox.stopped`.
- **N5 — Documentation et validation réelle.** README (risques résiduels H.2, exemple de `Dockerfile`), tests opt-in `JOHN_DOCKER_TESTS=1` : `bridge` → `npm`/`curl` d'un site public réussit, `id -u` ≠ 0, CapEff nul ; `none` → résolution DNS impossible.

#### H.6 Questions de produit (utilisateur)

- **P1 — Défaut de l'extension** : `none` (recommandé : un réglage à poser une fois) ou `bridge` d'emblée ?
- **P2 — Serveur de développement visible depuis le navigateur de l'hôte** (publication d'un port sur `127.0.0.1` uniquement) : recommandation **pas maintenant** ; l'agent peut lancer et tester le serveur dans le conteneur (`curl localhost`). À traiter dans un amendement séparé si le besoin est réel.

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
- Risques résiduels (S2/tar) : (a) un accord de session sur `sh x.sh` couvre aussi les versions modifiées de `x.sh` (l'argv est identique) ; (b) un `allow` à joker sur `sed`, `tar`, `git`, `make`, `ssh`, `rsync`, `vim` ou `less` vaut exécution arbitraire dans le conteneur (détection par drapeaux : plus tard) ; (c) les fichiers extraits par `get` le sont en 0644, le bit exécutable est perdu.
- Risques résiduels : évasion par faille du noyau de la VM Docker Desktop (atténuée par non-root, aucune capability, seccomp ; Enhanced Container Isolation recommandée si disponible) ; image malveillante (journaliser le digest, recommander une image épinglée) ; remplissage disque (pas de quota portable sur overlay2).
- À vérifier sur Windows (W-L6) : longueur de ligne de commande, `docker restart` pendant un `exec` en cours, comportement de `docker cp -` sur tube nommé.

## Plan

Ordre : S1 et S2 en parallèle, et `sandbox/tar.ts` (première moitié de S4) en parallèle d'eux ; puis S3 ; puis le branchement `put`/`get` de S4 ; puis S5. Contrat qui rend S2 indépendant de S1 : la dérivation de clé de session reçoit l'identifiant du conteneur en paramètre (fourni par le registre au moment de l'appel), jamais depuis l'entrée de l'outil. Revue sécurité de l'architecte : S1, S2, S4 (et le chemin d'annulation de S3).

- **S1 — Cycle de vie (cœur).** `core/src/sandbox/` : `createSandbox`, `inspectSandbox` (vérification A), `execInSandbox`, `restartSandbox`, `removeSandbox`, `SandboxRegistry`, filet de sortie ; `DockerClient` réutilisé par `runProcess`/`resolveBinary`, argv construits par le code ; kinds `sandbox.started`/`sandbox.stopped` (validateurs, `KIND_CLASS`) ; codes `sandbox.*` (`REASON_CODES`, fr, en). Critères : tests avec faux binaire docker vérifiant l'argv **exact** de `run`, `exec`, `restart`, `rm` ; chaque champ d'`inspect` altéré → `sandbox.tampered` ; identifiant hors registre refusé ; aucun chemin d'entrée ne permet d'ajouter une option docker.
- **S2 — Politique et gate.** Motifs `command` sur argv pour `mcp__sandbox__exec`, interpréteurs, `deny` sur basename, clé de session D, `always` → `session`, non-mémorisables. Critères : tests « session sur `npm test` n'autorise pas `npm test x` ni un autre conteneur », « `allow sh *` ne couvre pas `sh -c …` », « `deny rm *` refuse `/bin/rm` », « clé jamais égale au nom seul », comportement des autres outils inchangé (suite existante verte).
- **S3 — Toolset et CLI.** Spécifications neutres dans `tool-specs.ts`, enveloppes `agent-sdk` et `agent-opencode`, file sérialisée, délai/annulation → `restart`, résultat `sandbox.execTimeout`/`execAborted`, nettoyage de fin de run ; CLI `--sandbox`, `--sandbox-image`, `--sandbox-timeout` (pas d'option réseau), `john sandbox prune`, filtrage des séquences de contrôle dans l'affichage et la question d'approbation ; libellés fr/en. Critères : tests avec faux docker (délai → `restart` appelé, sortie partielle rendue, conteneur supprimé en fin de run et sur Ctrl-C), test d'une sortie contenant `\x1b[2K` affichée neutralisée.
- **S4 — Échange de fichiers.** `sandbox/tar.ts` (écriture et lecture strictes), `put`/`get`. Critères : archives piégées (lien symbolique, lien dur, `../`, chemin absolu, nom ADS/réservé win32, dépassement de taille déclarée et réelle, en-tête pax hostile) refusées en bloc sans rien écrire ; destination existante refusée ; entrée sensible d'un répertoire `put` refusée.
- **S5 — Validation réelle et documentation.** Tests d'intégration avec vrai Docker, opt-in (`JOHN_DOCKER_TESTS=1`), dont l'impossibilité de lire `/run/desktop` ou un fichier hôte, `id -u` ≠ 0, `capsh`/`/proc/self/status` CapEff nul, réseau absent ; ajout aux étapes W-L6 ; README.
