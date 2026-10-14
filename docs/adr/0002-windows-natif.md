# 0002 — Windows natif

- Statut : accepté (A à G) ; la validation réelle (H) conditionne la levée de l'avertissement « best effort »
- Date : 2026-10-14
- Remplace : la section D de l'ADR 0001

## Contexte

L'utilisateur travaille sous Windows avec Docker Desktop ; WSL lui est impossible. Le support natif devient la priorité n°1, avant l'extension VS Code. Faits établis par exploration (les points marqués [?] sont à confirmer sur un vrai Windows) :

- `packages/core/src/approval/policy.ts:205-220` : chemins sensibles POSIX seulement ; `~/.claude/.credentials.json` absent sur toutes les plateformes. `expandHome` (`:288`) ignore `~\`. `canonical` (`:242`) avale toute erreur de `realpath` et réattache la fin brute ; `isInside` (`:258`) est lexical. Sous Windows, `\\?\`, `\\.\`, UNC, flux ADS, noms réservés, fin de nom par point ou espace, noms courts 8.3 et `%VAR%` échappent au contrôle lexical.
- `evaluatePolicy` (`:363`) : un outil inconnu (`PowerShell`) n'a que `firstMatch` puis `policy.default` ; une règle `tool: "*"` en `allow` l'approuverait.
- `agent-sdk/src/runner.ts:349-380` : seul Bash est filtré et interdit ; le SDK expose un outil PowerShell sous Windows sans Git Bash.
- Processus : sous Windows, `terminateProcessTree` = `child.kill()` (les descendants survivent) ; `spawn` d'un `.cmd` sans shell échoue (EINVAL) ; libuv cherche un nom nu **dans le répertoire courant avant `PATH`** sous Windows : `spawn("docker")` avec `cwd` = espace de travail peut exécuter un `docker.exe` déposé par l'agent.
- `safeEnv` manque `SYSTEMROOT`-dépendants (`PROGRAMDATA`, `SYSTEMDRIVE`…) ; `envWithout` compare la casse exacte.
- Tests : faux binaires `#!/bin/sh`, chemins POSIX en dur, `/proc` ; CI Linux seule ; pas de `.gitattributes`.

Modèle de menaces : inchangé (ADR 0001). Le modèle contrôle les arguments des outils et peut écrire dans l'espace de travail ; l'opérateur contrôle la CLI et l'environnement ; le dépôt ne contrôle que la politique approuvée. Spécifique à Windows : chemins à plusieurs écritures pour un même fichier, partages réseau (un accès UNC envoie le condensat NTLM de l'utilisateur au serveur), binaires résolus depuis le répertoire courant, shells non analysables.

## Décision

### A. Périmètre

Supporté : Windows 10 22H2 et 11, x64 ; Node >= 22.12 ; PowerShell 5.1 et 7 comme shell de l'opérateur ; Docker Desktop (backend WSL2, conteneurs Linux, contexte `desktop-linux`, tube nommé) ; `claude.exe` fourni par le paquet optionnel du SDK ; OpenCode en `.exe` natif. Git for Windows est optionnel (requis seulement si Bash est activé). Hors périmètre : arm64, conteneurs Windows, espaces de travail sur partage réseau ou lecteur mappé (refusés, voir B), outil PowerShell de l'agent (voir E). macOS : chemin de code POSIX, **sans test ni CI**, best effort ; seule adaptation : comparaison des chemins insensible à la casse (APFS l'est par défaut).

### B. Sûreté des chemins (fail-closed)

1. Nouveau module `packages/core/src/approval/paths.ts`. `PolicyContext` reçoit `platform?: "posix" | "darwin" | "win32"` (défaut : `process.platform`) et `env?` (défaut : `process.env`). Toute la logique utilise le module `path` de la saveur (`path.win32` / `path.posix`), jamais le `path` global. Ces champs ne viennent que du code, jamais de la politique ni du modèle.
2. **Formes refusées** (win32, sur le chemin brut, `deny` avec le nouveau code `path.unsupported` { path, form }) : préfixe `\\` ou `//` (UNC, `\\?\`, `\\.\`, `\\wsl$`) ; `:` ailleurs qu'en position 1 après une lettre de lecteur (ADS) ; `X:` non suivi d'un séparateur (relatif au lecteur) ; segment se terminant par `.` ou espace (hors `.` et `..`) ; nom réservé (CON, PRN, AUX, NUL, COM0-9, LPT0-9, variantes ¹²³, CONIN$, CONOUT$, avec ou sans extension, casse ignorée) ; segment contenant `%…%`. Un segment 8.3 (`~` suivi d'un chiffre) n'est refusé que s'il figure dans la **partie non résolue** par `realpath`.
3. **Canonisation** : `canonical` ne remonte vers l'ancêtre que sur `ENOENT`/`ENOTDIR` ; toute autre erreur sous win32 donne `path.unsupported` (form `unresolvable`). Un résultat commençant par `\\?\` est dépouillé ; un résultat UNC est refusé. Comparaison insensible à la casse pour win32 et darwin.
4. **Chemins sensibles**, toutes plateformes : ajout de `.claude` et `.claude.json` (identifiants, e-mail du compte). Win32, relatifs au répertoire personnel : liste POSIX existante (séparateurs adaptés), `NTUSER.DAT`, `AppData\Roaming\Microsoft\Credentials`, `AppData\Local\Microsoft\Credentials`, `AppData\Roaming\Microsoft\Protect`, `AppData\Roaming\Microsoft\Crypto`, `AppData\Local\Microsoft\Vault`, `AppData\Roaming\gcloud`, `AppData\Roaming\GitHub CLI`, `AppData\Roaming\john-studio`, profils de navigateurs (`AppData\Local\Google\Chrome\User Data`, `AppData\Local\Microsoft\Edge\User Data`, `AppData\Roaming\Mozilla\Firefox\Profiles`) ; mêmes sous-chemins sous `%APPDATA%`/`%LOCALAPPDATA%` s'ils diffèrent. Absolus : `%SystemRoot%\System32\config`, `%SystemRoot%\NTDS`, `%SystemRoot%\repair`, `%ProgramData%\ssh`, `%ProgramData%\Microsoft\Crypto` (repli `C:\Windows`, `C:\ProgramData`). Le répertoire de configuration réellement utilisé par `policy-store` doit figurer dans la liste sur chaque plateforme. La liste est un plancher, pas une garantie d'exhaustivité.
5. `expandHome` accepte `~\` sous win32. Le motif `Glob` utilise `isAbsolute` de la saveur.
6. **OpenCode `external_directory`** (toutes plateformes) : chaque motif est ramené à sa base statique et passe par le contrôle de chemins ; verdict au mieux `ask`, `deny` si sensible ou non analysable ; aucun motif exploitable donne `ask`.
7. Tests : suites paramétrées posix/win32/darwin exécutées sur Linux avec un faux `realpath` (table, erreurs avec `code`) ; tests de `realpathSync.native` réel limités au job Windows.

### C. Arrêt de l'arbre de processus

Sous win32, `terminateProcessTree` lance `%SystemRoot%\System32\taskkill.exe /PID <pid> /T /F` (chemin absolu, `shell: false`, `safeEnv`, délai 5 s), puis `child.kill()` si `taskkill` échoue. Pas de grâce : Windows n'a pas d'équivalent de SIGTERM pour un processus console, donc `graceMs` est ignoré et `forced` vaut `true`. On ne lance jamais `taskkill` après `close` (réutilisation de PID). `killWaitMs` et la destruction des tubes restent inchangés. Le filet `process.on("exit")` appelle `spawnSync(taskkill…)` (délai 2 s) pour chaque arbre vivant. Limite acceptée : les descendants d'un enfant déjà terminé ne sont plus atteignables.

### D. Binaires et environnement

- `resolveBinary` déplacé dans le cœur (`process/resolve.ts`), injectable (`platform`, `env`, `isFile`), utilisé par `DockerClient`, OpenCode et `taskkill`. Sous win32, le binaire est **toujours** résolu en chemin absolu avant `spawn` ; les entrées de `PATH` vides ou relatives sont ignorées (sur toutes les plateformes) ; seule l'extension `.exe` est exécutable.
- Shim `.cmd`/`.bat` : jamais exécuté. Pour un shim npm `<dir>\opencode.cmd`, on sonde `<dir>\node_modules\opencode-ai\bin\opencode.exe` ; sinon erreur `binary.shimUnsupported` invitant à passer le chemin absolu de l'`.exe`.
- `safeEnv` win32 : ajouter `SYSTEMROOT`, `WINDIR`, `SYSTEMDRIVE`, `PATHEXT`, `TEMP`, `TMP`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `APPDATA`, `LOCALAPPDATA`, `PROGRAMDATA`, `PROGRAMFILES`, `PROGRAMFILES(X86)`, `PROGRAMW6432`, `COMMONPROGRAMFILES`, `USERNAME`, `COMPUTERNAME`, `NUMBER_OF_PROCESSORS`, `PROCESSOR_ARCHITECTURE`, `OS` (ceux déjà présents restent). Clés comparées sans casse, une seule occurrence par clé (`Path`/`PATH`). `CLAUDE_CODE_GIT_BASH_PATH` seulement si Bash est activé.
- `envWithout` compare sans casse sur toutes les plateformes.
- `source.ts` utilise `realpathSync.native` (casse canonique du disque) pour la clé d'empreinte ; `policy-store` réessaie le `rename` trois fois sur `EPERM`/`EBUSY`/`EACCES` sous win32, puis échoue.

### E. Shells

- `PowerShell` rejoint `Bash` comme outil de shell : filtré de `builtinTools`, toujours placé dans `disallowedTools` (aucune option pour l'activer dans cet ADR).
- Au message `system/init`, si la liste d'outils contient `PowerShell`, ou `Bash` sans activation explicite, le run est arrêté (nouveau code `sdk.unexpectedTool`).
- Côté gate, tout outil de shell non analysable (`PowerShell`, bash d'OpenCode sous win32 tant que son shell n'est pas confirmé POSIX) donne au mieux `ask`, avec le code `shell.unanalyzable`, jamais mémorisable ; une règle `deny` s'applique toujours.
- `programName` retire `.exe .cmd .bat .com .ps1` sans casse, et accepte `\` comme séparateur. `cmd`, `powershell`, `pwsh`, `wsl`, `start` sont traités comme des interpréteurs (comme `sh -c`) : jamais auto-approuvés.
- L'analyseur POSIX reste celui de Bash, qui sous Windows est Git Bash : l'échappement par `\` y est correct.

### F. Tests portables

- Faux binaires : `process.execPath` + option `argsPrefix` (tableau de chaînes sans `\0`, au plus 16 éléments), ajoutée à `DockerClient` et au lancement d'OpenCode, alimentée par le code seulement (ni CLI ni politique). Les faux sont des scripts `.mjs`. Le faux `claude` passe par la prise en charge des `.js`/`executable` du SDK.
- `test:contract` via un script Node (`scripts/with-env.mjs`), sans `cross-env`.
- Chemins de test construits avec `path` et `fs.realpathSync.native(os.tmpdir())` ; existence de processus via `process.kill(pid, 0)`, plus de `/proc`.
- `.gitattributes` (`* text=auto eol=lf`, binaires marqués) et `formatter.lineEnding: "lf"` dans biome.

### G. CI

Job `windows-latest`, Node 22, pnpm via `pnpm/action-setup` (version de `packageManager`), `pnpm install --frozen-lockfile` puis `pnpm check` complet. Sans Docker ni appels réels. `continue-on-error: true` jusqu'à la fin du lot 4, puis bloquant.

## Alternatives écartées

- **`ask` pour les formes non analysables** : un humain lit mal `\\?\C:\Users\x\.ssh.` ; les chemins sensibles doivent rester non contournables.
- **Ne compter que sur `realpathSync.native`** : son comportement sur ces formes n'est pas garanti, et il ne voit pas la partie non résolue.
- **Job objects** : exigent un module natif.
- **`tree-kill`** : dépendance pour quelques lignes.
- **`cmd.exe /d /s /c` pour les shims** : réintroduit l'analyse d'arguments de `cmd` (famille CVE-2024-27980) et `%VAR%` ; la sonde npm couvre le cas réel.
- **`spawn` injectable pour les tests** : ne teste ni la résolution ni l'arrêt réels.
- **Binaires Node compilés (SEA)** : lourds, sans gain sur `execPath` + script.
- **Analyseur PowerShell** : grammaire trop riche pour un contrôle fiable ; un faux sentiment de sécurité.

## Conséquences

- Positives : garde des chemins testée pour les trois saveurs sur Linux ; plus aucun binaire nu lancé depuis l'espace de travail ; arbres de processus arrêtés.
- Négatives : faux positifs (fichiers légitimes `foo~1`, lecteurs mappés, chemins avec `%`) ; aucune exécution de shell sous Windows sans Git Bash ; arrêt forcé sans grâce (un `docker run` tué laisse son conteneur, comme sous POSIX après SIGKILL).
- À surveiller : forme réelle des retours de `realpathSync.native` ; outils exposés par le SDK sans Bash ; shell utilisé par le bash d'OpenCode ; `opencode serve` natif. Revue de sécurité par `architect` obligatoire pour les lots 1, 3 et 5.
- L'avertissement de la CLI (ADR 0001 D) reste affiché jusqu'à la réussite de la validation H et du lot 6.

## Plan

Lots détaillés dans la réponse de l'architecte du 2026-10-14 : 1 chemins, 2 tests portables et CI, 3 binaires et environnement, 4 arbre de processus, 5 shells, 6 validation réelle et levée de l'avertissement.
