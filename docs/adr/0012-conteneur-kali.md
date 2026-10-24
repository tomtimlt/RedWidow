# 0012 — Conteneur Kali : un bind `/workspace`, hors de l'outil agent

- Statut : accepté
- Date : 2026-10-22
- S'appuie sur : ADR 0011 (famille `kali`, label non recopié, `link` et `exec` restent Exegol)
- Amendé par : ADR 0014 (le label ne suffit toujours pas ; `link` et les outils Kali relisent la liste courante)

## Contexte

`DockerClient.run` (`packages/core/src/docker/client.ts:479-495`) lance `docker run --detach` avec `--name`, `--publish`, `--env`, l'image et une commande. Pas de volume, pas de label, pas de `--pull`. L'outil MCP `run` (`packages/core/src/docker/tool-specs.ts:118-138`) documente « Pas de volumes, réseau hôte ni mode privilégié » et n'appelle `docker.run` qu'avec image, nom, ports, env et commande. `execWorkspace` (`client.ts:533-548`) fixe `--workdir /workspace`.

Un `docker run` ou `create` avec volume n'est pas refusé dans `approval/shell.ts`. Il l'est dans `dockerRunHazard` (`packages/core/src/approval/policy.ts:116-154`, flags `--volume`, `--mount` et `-v`) appliqué par `evaluateBash` (`policy.ts:189-197`) : verdict `deny`, code `docker.hostAccess`, quelle que soit la règle. Ce lot ne touche pas cette politique.

ADR 0011 : la famille `kali` est aussi le label `io.warband.runtime` dont la valeur est exactement `kali`. Aucune valeur de label n'est recopiée par `listLabelPrefix`. Ce lot laissait `link` et l'`exec` Exegol refuser un Kali. L'ADR 0014 les reprend : le label n'est toujours pas une autorisation, la liste courante l'est.

Le montage d'un dossier de l'hôte est une décision de sécurité, pas un paramètre de plus sur `run`. L'agent ne doit pas pouvoir le demander.

## Décision

1. **Fonction neuve, invisible pour l'outil.** `createDockerClient` retourne `DockerClient & KaliContainerClient`. `createKaliContainer` n'est pas membre de `DockerClient`. `dockerToolSpecs` continue de prendre un `DockerClient`. L'outil `run` et `DockerClient.run` ne gagnent ni volume, ni label, ni `--pull`.

2. **Argv figé**, rien après l'image (l'entrée de l'image, `/start` compris, n'est pas remplacée) :

   `run --detach --interactive --tty --pull never --name <nom> --label io.warband.runtime=kali --network bridge --mount type=bind,source=<réel>,target=/workspace <image>`

   Image locale : `--pull never`. Réseau explicite `bridge`, jamais `host` et jamais le défaut du démon. Un seul montage, en écriture (pas de clé `readonly`). Destination littérale `/workspace`. Label constant, pas un paramètre. Pas de `--privileged`, `--volume`, `-v`, port, `--env`, `--entrypoint`, socket, capacité, périphérique, ni commande.

3. **Refus avant tout spawn**, première erreur seule. Le chemin n'est pas recopié dans les paramètres. Codes existants : `docker.invalidOperand` (image, nom) et `docker.invalidArgument` avec `field: "source"`.
   - Image et nom passent par `assertOperand`. Le nom est obligatoire. Vide, « -… », espace ou caractère hors du motif déjà en place : refus.
   - Source : chaîne ; `,`, NUL, CR ou LF → `delimiter` ; pas absolue pour `node:path` du processus → `relative` (vide, `foo`, `./a`, `~/a` inclus). On n'absolutise pas un relatif.
   - Forme lexicale normalisée : racine de lecteur ou `/` → `root` ; un socket connu est égal au chemin ou situé dessous → `socket`. Sockets : `/var/run/docker.sock`, `/run/docker.sock`, `/private/var/run/docker.sock`, `~/.docker/run/docker.sock` (`homedir()` au moment de l'appel), et le tube `\\.\pipe\docker_engine`.
   - `realpath` du chemin lexical. `ENOENT` ou `ENOTDIR` → `missing`. Autre échec → `unsupported`. On ne laisse pas le démon créer le dossier. Le même contrôle racine/socket s'applique au chemin réel ; une virgule dans le réel → `delimiter`. C'est ce réel qui est écrit dans `--mount`.
   - `mountExposesSensitive` (ci-dessous) : `sensitive` ou `unsupported`.
   - Puis le réel doit être un répertoire, sinon `notDirectory`.

4. **Secrets dans l'arbre monté.** Nouvelle fonction `mountExposesSensitive(directory, opts?)` dans `approval/paths.ts`. Elle réutilise la liste déjà privée des chemins sensibles et `canonical`. Elle retourne `"sensitive"`, `"unsupported"` ou `null`, sans le chemin. `sensitive` si le dossier est dans un chemin sensible ou si un chemin sensible (qui existe) est dans le dossier. Un sensible absent est ignoré. Un sensible impossible à résoudre refuse (`unsupported`). Ce n'est pas `checkPathAccess` : un dossier hors de l'espace de travail de l'agent reste montable. `checkPathAccess` ne change pas.

5. **Hors de ce lot.** Pas de formulaire, pas de sélecteur, pas de VPN, pas de retrait de `/start`. `link` et `resolveExegolContainer` ne changent pas ici. L'ADR 0014 change `link` et ajoute les outils Kali ; elle ne change pas cet argv. Aucun événement nouveau.

## Alternatives écartées

- **Ajouter le volume à `DockerClient.run` ou à l'outil `run`.** L'agent reçoit le client des outils. Un volume y serait une demande du modèle, contournant `docker.hostAccess`. La politique resterait un `deny` pour Bash, et un trou pour l'outil.
- **`--volume source:/workspace`.** Le `:` sépare la source, la destination et le mode. Un chemin absolu peut en contenir (lecteur Windows, nom de dossier). `--mount` ne coupe pas sur `:`. La virgule reste interdite, sinon on injecterait `bind-propagation` ou une autre cible.
- **Omettre `--network`.** Un démon dont le défaut est `host` donnerait le réseau de l'hôte. `none` couperait Kali sans décision de produit ; ce conteneur n'est pas le bac à sable abandonné (ADR 0003). `bridge` est explicite et n'est pas `host`.
- **Montage en lecture seule, `--user`, `--cap-drop`.** Durcissement du bac à sable, pas de ce runtime. La destination `/workspace` est le répertoire de travail déjà fixé par `execWorkspace`.
- **Réutiliser `checkPathAccess` seul.** Il refuse un chemin qui est *dans* un secret, pas un dossier qui *contient* un secret. Monter `/home/user` ou `/etc` passerait. Il refuse aussi « hors espace de travail », ce qui empêcherait le dossier choisi par l'appelant.
- **Laisser Docker créer la source absente.** Le démon crée alors un répertoire appartenant à root. `missing` avant le spawn.

## Conséquences

- L'agent ne gagne aucun moyen de monter l'hôte. Bash avec volume reste `deny`. L'outil `run` reste sans volume. La fonction n'est pas un outil : elle ne passe pas par la gate, et rien n'est mémorisable.
- Le processus dans le conteneur (root, réseau `bridge`) écrit dans le dossier réel de l'hôte. Course entre `realpath` et `docker run` : résidu accepté, le CLI ne prend pas un descripteur de fichier.
- Un lien vers `/`, vers un socket ou vers un secret est refusé parce que le chemin monté est le réel. Monter la maison, `/`, `/etc`, `/var/run` ou `~/.docker` est refusé. Monter un projet qui ne contient ni secret ni socket ne l'est pas.
- Le chemin figure dans l'argv journalisé par `process.started` seulement si le spawn a lieu. L'erreur de validation ne le contient pas.
- Image absente en local : échec `docker.failed`, pas de téléchargement.
- Le label fait entrer le conteneur dans `listLabelPrefix` comme `kali` même si l'image ne contient pas ces quatre lettres. Il n'autorise rien à lui seul. `link` et les outils Kali (ADR 0014) relisent la liste ; ils ne font pas confiance au nom stocké ni au label.

## Plan

Un seul lot, K1. Le brief pour `dev` est la section suivante.

### Objectif

Créer un conteneur détaché par `createKaliContainer`, argv figé, image locale, un bind `/workspace` contrôlé avant tout spawn. Ni l'outil MCP `run`, ni `DockerClient.run`, ni la gate ne changent.

### Fichiers

- `packages/core/src/docker/client.ts`
- `packages/core/src/approval/paths.ts` (`mountExposesSensitive` seulement ; `checkPathAccess` inchangé)
- `packages/messages/src/fr.ts` (clés de `ARGUMENT_REASONS` seulement)
- `packages/core/test/docker-client.test.ts`
- `packages/core/test/paths.test.ts`

`packages/core/src/index.ts` réexporte déjà ces modules. Ne pas y toucher. Ne pas modifier `tool-specs.ts`, `approval/shell.ts`, `approval/policy.ts`, `project.ts`, `exegol/targets.ts`, `reason.ts`.

### Décision

Reprendre les cinq points de la section Décision. Détail que `dev` ne doit pas réinventer :

- `export interface CreateKaliContainerOptions extends CallOptions { image: string; name: string; source: string }`. `export interface KaliContainerClient { createKaliContainer(options: CreateKaliContainerOptions): Promise<string> }`. Retour de `createDockerClient` : `DockerClient & KaliContainerClient`. `DockerClient` ne déclare pas la méthode. Le paramètre de `dockerToolSpecs` reste `DockerClient`.
- Ordre de validation : image (`assertOperand`, libellé `image`) ; nom (`assertOperand`, libellé `name`) ; délimiteurs de la source ; absolu ; racine et socket sur la forme normalisée ; `realpath` ; racine, socket et délimiteur sur le réel ; `mountExposesSensitive(réel)` ; répertoire. Aucun `spawn` avant la fin de cette chaîne. `checked("run", argv, call)` comme les autres méthodes. Identifiant : première ligne de stdout, trim, ou `""`.
- Argv, éléments séparés, dans cet ordre : `run`, `--detach`, `--interactive`, `--tty`, `--pull`, `never`, `--name`, nom, `--label`, `io.warband.runtime=kali`, `--network`, `bridge`, `--mount`, `type=bind,source=<réel>,target=/workspace`, image. Rien d'autre.
- `mountExposesSensitive` prend les mêmes options injectables que `checkPathAccess` (`cwd` inclus). Le client l'appelle avec le réel pour `cwd`, sans `roots`. Les tests de la fonction injectent le système de fichiers, ils ne créent rien sous le vrai `~/.ssh`.
- Motifs français dans `ARGUMENT_REASONS` : `delimiter` « caractère interdit dans le montage », `relative` « chemin relatif ou non absolu », `root` « racine du système de fichiers », `socket` « socket Docker », `missing` « dossier introuvable », `unsupported` « chemin non analysable », `sensitive` « chemin sensible », `notDirectory` « dossier attendu ». Pas de code de raison nouveau. `en.ts` a déjà le modèle qui affiche le motif.

### Critères

- Avec un dossier temporaire réel et le faux docker : l'argv enregistré est exactement celui de la Décision, `source=` égal au `realpath` du dossier, et la fonction renvoie l'identifiant. Aucun élément après l'image.
- Un chemin relatif, un nom vide, une image vide ou commençant par `-` lèvent avant tout spawn (`fake.calls()` vide). Le nom `-web` aussi (`docker.invalidOperand`).
- `source` avec une virgule, la racine (`path.parse(process.cwd()).root`), `/var/run/docker.sock` et `join(homedir(), ".docker")` refusent sans spawn (`delimiter`, `root`, `socket`, `socket`).
- Un fichier temporaire : `notDirectory`, sans spawn. Un absolu absent : `missing`, sans spawn.
- Sous Linux, un lien symbolique vers `/` : `root`, sans spawn.
- Sous Linux, `source` `/etc` : `sensitive`, sans spawn.
- `mountExposesSensitive`, système de fichiers injecté : un dossier dans `.ssh` est `sensitive` ; un parent qui contient `.ssh` est `sensitive` ; un projet frère de `.ssh` est `null`.
- L'attente d'argv de `docker.run` dans `docker-client.test.ts` ne change pas (pas de `--mount`, `--volume`, `--label`, `--pull`). Les noms d'outils restent `ps`, `images`, `logs`, `inspect`, `run`, `start`, `stop`, `rm`.
- `pnpm check` vert. Commit en français, sans pousser.

### Interdits

Pas d'interface, pas de formulaire, pas de VPN. Ne pas élargir l'outil agent. Ne pas ajouter de volume ni de label à `DockerClient.run`. Ne pas affaiblir `dockerRunHazard` ni la gate. Ne pas modifier `link` ni `resolveExegolContainer`. Ne pas passer `--entrypoint`, une commande, `--network host`, `--privileged`, un port ou un env. Ne pas retirer `/start`. Ne pas recopier le chemin dans l'erreur.

## Correctif 0.3.22 — shell interactif

Les créations Kali conservent stdin ouvert et allouent un pseudo-terminal
(`--interactive --tty`) en mode détaché. Une image dont l’entrée est un shell
ne quitte ainsi plus simplement sur EOF. La commande et l’entrée de l’image
restent inchangées. Les conteneurs déjà créés gardent leur ancienne configuration.
