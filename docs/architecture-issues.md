# Points à trancher pour l'architecte

Statut : **[V]** vérifié dans le code ou par test, **[?]** déduit, non vérifié contre le vrai SDK.

## P0 : sécurité et fiabilité du contrat avec le SDK — traités

Décisions retenues : le hook `PreToolUse` fait autorité, `Bash` est retiré par défaut, la politique vient de la config utilisateur (celle du dépôt n'est appliquée qu'après approbation de son empreinte), et le masquage des secrets se fait dans le recorder.

1. **Test de contrat contre le vrai SDK — partiellement traité.** `packages/core/test/contract/sdk.contract.test.ts` vérifie l'ordre des événements, la visibilité des lectures auto-approuvées, le refus hors espace de travail et la liste des outils exposés. Il est désactivé par défaut (appels facturés) : `ANTHROPIC_API_KEY=… pnpm test:contract`. **Reste à faire :** l'exécuter une première fois avec une vraie clé ; il consigne aussi les types de messages SDK reçus, utiles pour le point 12.
2. **Garde unique — traité.** `agent/loop.ts` installe un hook `PreToolUse` sans `matcher` qui appelle l'`ApprovalGate` pour tout outil, y compris ceux que le SDK auto-approuve sans passer par `canUseTool` (ordre documenté : hooks → deny → ask → mode → allow → `canUseTool`). `canUseTool` n'est plus qu'un filet : il relaie la décision du hook sans la rejouer et refuse (avec un événement `error`) tout appel que le hook n'a pas vu. Le moteur impose `permissionMode: "default"`, `allowedTools: []`, `strictMcpConfig: true` et `settingSources: []`, et `sdkOptions` ne peut plus les surcharger.
3. **Outils natifs et Bash — traité.** Seuls `Read`, `Glob` et `Grep` sont exposés (`tools`, liste blanche) ; `Bash` n'apparaît qu'avec `bash: true` / `john run --allow-bash`, et reste alors soumis à la politique. L'analyseur (`approval/shell.ts`, `approval/policy.ts`) signale désormais `$'…'` et `$"…"`, les enveloppes d'exécution (`bash -c`, `env`, `xargs`, `eval`, `nohup`, `timeout`, `sudo`…, hazard `indirection`) et `find -exec/-delete`, qui ne sont jamais auto-approuvés. Un `docker|podman run|create` avec volume, `--mount`, `--privileged`, `--cap-add`, `--device`, `--security-opt` ou un espace de noms `host` est refusé (`dockerRunHazard`).
4. **Politique de confiance — traité.** `approval/source.ts` : `--policy` explicite, puis `.john-studio/policy.json` **seulement si son SHA-256 est approuvé** (`john policy trust`, stocké dans `<config>/trusted-policies.json`), puis `<config>/policy.json` (XDG, `%APPDATA%`), puis la politique intégrée. Un fichier de dépôt non approuvé ou modifié est ignoré avec un avertissement.
5. **Secrets — traité.** `runProcess` n'hérite plus de `process.env` mais d'une liste blanche (`safeEnv`). `redact.ts` masque motifs de clés (Anthropic, GitHub, AWS, Slack, JWT, `Bearer`, clés privées, URL avec identifiants, `clé=valeur`), valeurs de `env`, `--env`/`-e` d'un argv et valeurs sensibles de `process.env` ; le recorder l'applique avant tout sink, donc journal, CLI et export HTML reçoivent des événements déjà expurgés (`createRecorder({ redact: false })` pour désactiver, tests uniquement).
6. **Chemins de `Read`, `Glob`, `Grep` — traité.** `evaluatePolicy(…, ctx)` extrait les chemins des outils fichiers, résout les liens symboliques (y compris pour un fichier à créer) et applique : chemin sensible (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.config/gh`, `/etc/shadow`…) → `deny` quelles que soient les règles ; hors de l'espace de travail → `ask` (une règle `allow` ne s'y applique pas) ; un `deny` de règle l'emporte toujours.

## P1 : frontière cœur / UI, qui conditionne l'extension VS Code

Décisions retenues : paquet adaptateur séparé (`@john-studio/agent-sdk`), paquet de libellés partagé (`@john-studio/messages`), sorties d'outil complètes avec plafonds et marqueur de troncature. Plan détaillé en 4 lots, tous faits : A (points 9 et 10), B (points 12 à 17), C1 (point 7), C2 (points 8 et 11). Le lot D (adaptateur OpenCode) est fait, voir la section dédiée plus bas.

7. **Texte d'affichage dans le cœur — traité (lot C1).** Le cœur n'émet plus que des `Reason { code, params?, cause? }` (`core/src/reason.ts`, liste exhaustive `REASON_CODES`) : motifs de politique et d'approbation, erreurs de validation, `DockerError`, erreurs de processus et de journal, avertissements de politique. Les libellés vivent dans `@john-studio/messages` (`formatReason`, `formatError`, `eventLabel`, `summarizeOutput` ; catalogue `fr` complet, `en` minimal, repli sur code + paramètres), utilisé par la CLI, l'export HTML et les refus renvoyés au modèle. `graph/build.ts` ne produit plus de libellé (les nœuds portent l'événement source). Les anciens journaux restent lisibles (`legacy`). Seul texte français restant dans le cœur : le motif libre de la règle `mcp__docker__rm` de `DEFAULT_POLICY` (texte de règle, rendu tel quel). Les paramètres et causes passent par le masquage des secrets.
8. **Protocole d'approbation — traité (lot C2).** `approval.requested` est émis avant de solliciter l'`Asker` ; `timeoutMs` donne un refus `approval.timeout` ; `ApprovalAnswer.remember` (`once` / `session` / `always`) est géré par la gate : seuls les verdicts « ask » ordinaires (`policy.rule`, `policy.rule.custom`, `policy.default`, `bash.noRule`) sont mémorisables, jamais un `deny`, un chemin sensible ou hors espace de travail, un accès hôte docker ni un danger shell (testé). `always` ne persiste dans la politique utilisateur (`persistRule`, implémenté par la CLI) que pour une commande Bash simple ; sinon il se réduit à `session`. `createApprovalQueue()` fournit `pending()`, `answer()` et `requests()` pour une UI sans terminal (extension VS Code), et `Recorder.stream(signal?)` / `close()` un `AsyncIterable<EngineEvent>`. `updatedPermissions` du SDK reste volontairement inutilisé : le hook `PreToolUse` fait autorité, donc la mémoire d'approbation vit dans la gate. CLI : réponses `o` / `s` / `t` / `N` et `--approval-timeout`.
9. **Le SDK est lié directement au cœur — traité (lot A).** `@john-studio/core` ne dépend plus du SDK ni de `@modelcontextprotocol/sdk` (un test le garantit). Il expose l'interface `AgentRunner` (`core/src/runner.ts`) ; `@john-studio/agent-sdk` en fournit l'implémentation (`createSdkRunner`), que la CLI assemble. **Reste à vérifier :** l'empaquetage du binaire du SDK dans l'extension host VS Code (Electron, Node différent, remote ou web), qui n'a pas été testé.
10. **`runAgent` fait trop de choses — traité (lot A).** `runAgent` devient `createSdkRunner(options).run(input, ctx)` (`agent-sdk/src/runner.ts`) : `cwd` est obligatoire dans `RunInput` (plus de `process.cwd()` implicite), le registre de corrélation et les serveurs MCP sont construits à chaque run, et le toolset docker n'est plus codé en dur mais fourni par `dockerToolset()` (interface `Toolset.create(ctx)`), que la CLI passe sauf avec `--no-docker-tools`.
11. **Sessions et multi-tour — traité (lot C2).** `RunInput.prompt` accepte une `string` ou un `AsyncIterable<string>` (converti en `SDKUserMessage`), avec `sessionId`, `resume`, `maxBudgetUsd` et `systemPrompt` (ajouté au preset `claude_code`) ; `turn.finished` à chaque `result`, `sessionId` dans `run.finished`. CLI : `--resume`, `--max-budget-usd`, `--system-prompt`. Ces options (et `env`) ne sont plus surchargeables via `sdkOptions`. Un prompt en flux est journalisé avec `prompt: ""`.

    **Authentification (ajout du lot C2).** `RunInput.auth` (`auto` / `subscription` / `api-key`, CLI `--auth`) : `subscription` retire `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` et les variables Bedrock/Vertex/Foundry de l'environnement du binaire pour utiliser la connexion `/login` (ou `CLAUDE_CODE_OAUTH_TOKEN`) ; `api-key` exige la clé avant tout lancement. Événements `session.started.auth`, `auth.info` (type d'abonnement, origine du jeton ; jamais l'e-mail) et `auth.status` ; erreurs `auth.failed` / `auth.orgNotAllowed`. **Réserve de politique :** la documentation du SDK indique qu'Anthropic n'autorise pas, sauf accord préalable, les développeurs tiers à proposer la connexion claude.ai ou ses limites de débit dans leurs produits ; l'usage de son propre abonnement pour un outil personnel n'y est pas traité (avertissement dans le README). **Vérifié (2026-10-14) :** `settingSources: []` n'empêche pas l'authentification par `CLAUDE_CODE_OAUTH_TOKEN` (jeton `claude setup-token`). Non essayée : la connexion `/login` stockée dans `~/.claude`.

    **Durcissement ajouté en fin de lot :** `extraArgs`, `settings` et `managedSettings` ne sont plus passables via `sdkOptions` (ils auraient permis `--dangerously-skip-permissions` ou des règles `allow`).
12. **Événements SDK ignorés — traité (lot B).** `EngineEvent` gagne `session.started`, `api.retry`, `permission.denied`, `task.updated`, `rate.limited` et `agent.thinking` (traduits dans `agent-sdk/src/runner.ts`). Les autres messages restent sans événement mais sont comptés dans `RunSummary.unhandledMessages` (`type/subtype`), recopié dans `run.finished`. **Reste à vérifier avec une vraie clé :** que le SDK émet bien ces messages dans l'ordre attendu (`pnpm test:contract`).

## P1 : modèle d'événements et journal — traités (lot B)

13. **Schéma versionné, validation complète — traité.** Chaque événement porte `v` (`EVENT_SCHEMA_VERSION`, 1). `EVENT_VALIDATORS` (un validateur par `kind`, exhaustif par typage) valide la charge utile à la relecture, et `EVENT_KINDS` en est dérivé. Un `v` absent vaut 1 ; un `v` supérieur est signalé dans `issues` et l'événement est écarté. Les anciens `tool.result` avec `summary` sont relus comme `output`.
14. **Plusieurs runs dans un même journal — traité.** `splitRuns(events)` sépare les runs ; `buildGraph(events, { runId? })` n'en traite qu'un (le dernier par défaut) et expose `graph.runs`. CLI : `john graph --run <id>` ; `john journal` liste les runs quand il y en a plusieurs et `--run <id>` rejoue l'un d'eux.
15. **Journal borné — traité.** `LineSplitter` coupe les lignes à 16 Kio (`maxLineLength`, champ `truncated`) et jette le reste de la ligne pour borner la mémoire ; `runProcess` n'écrit que `maxJournaledLines` (10 000) lignes par processus et reporte le reste dans `process.exited.droppedLines` ; `openJournal(path, { maxBytes })` (100 Mio par défaut, taille existante comprise) s'arrête proprement avec une ligne finale `journal.truncated`. **Non traité :** la rotation des fichiers.
16. **Causalité — traité, avec réserves.** La corrélation outil MCP ↔ `tool.requested` utilise l'identifiant d'appel transmis par le SDK dans `_meta` quand il existe (`toolUseIdFromExtra`, appariement exact), sinon la FIFO par outil et arguments ; `process.started.correlation` indique `exact`, `inferred` ou `none`. Le rattachement sous-agent passe par `agent_id` du hook et `task_started`. Les erreurs de sink émettent `sink.error` vers les autres sinks (sans récursion) et appellent `onSinkError`. **Vérifié (2026-10-14) :** le SDK place bien l'identifiant dans `_meta` (`claudecode/toolUseId`). **Reste non vérifié :** que le `task_id` des tâches corresponde à l'`agent_id` vu par le hook (aucun scénario avec sous-agent).
17. **Sorties d'outil complètes — traité.** `tool.result` porte `output` (texte complet jusqu'à `maxResultBytes`, 64 Kio par défaut), `truncated` et `bytes` (taille d'origine) ; le résumé sur une ligne est calculé par les UI. **Limite connue :** la coupe a lieu avant le masquage des secrets, donc un secret coupé pile à la limite n'est pas reconnu (seul un court fragment peut rester).

## Adaptateur OpenCode (lot D, hors numérotation P0/P1)

`@john-studio/agent-opencode` (`createOpencodeRunner`) implémente `AgentRunner` pour OpenCode sans toucher au cœur, sauf :
les définitions d'outils docker deviennent neutres (`core/src/docker/tool-specs.ts`, `DockerToolSpec`, zod dans le cœur ;
`agent-sdk` les enveloppe avec `tool()`), `ToolCallRegistry` passe dans le cœur, les chemins `~/.local/share/opencode` et
`~/.config/opencode` (identifiants et clés) deviennent sensibles pour la politique, et de nouveaux codes de raison
(`provider.*`, `budget.exceeded`, `opencode.*`) sont ajoutés. La garde équivaut au hook `PreToolUse` : chaque
`permission.asked` passe par `gate.decide` (réponse `once` ou `reject`, jamais `always`), les outils MCP du moteur
repassent par la gate dans leur handler (défense en profondeur), la configuration effective est vérifiée avant le premier
tour. Tests : faux client injectable (`createClient`), serveur MCP HTTP, et tests de contrat réels
(`OPENCODE_BIN=<binaire>`, sans clé API : faux fournisseur OpenAI-compatible local), ignorés sans binaire.

**D0, essai du binaire réel.** `npm i opencode-ai` (1.19.0) fonctionne derrière le proxy ; `opencode serve` démarre en
4 s, hors ligne avec `OPENCODE_DISABLE_MODELS_FETCH=1`. Les cinq points non vérifiés :

1. **Nom de l'événement : `permission.asked`**, pas `permission.updated`. Propriétés (forme du binaire) :
   `{ id, sessionID, permission, patterns[], metadata, always[], tool: { messageID, callID } }` ; `permission.replied` :
   `{ sessionID, requestID, reply }`. Les types du SDK 1.19.0 (v1) sont en retard ; le moteur lit les deux formes.
   Le SDK n'est utilisé que derrière un contrat étroit (`OpencodeApi`).
2. **`"*": "ask"` est accepté et appliqué** (`config.get` le renvoie ; la règle par défaut est `allow`). Mais il ne suffit
   pas : une clé précise de la configuration globale (`bash: "allow"`) l'emporte, et la `permission` d'un **agent**
   (`agent.build.permission`) l'emporte sur le niveau supérieur. Le moteur force donc chaque outil connu (`ask`, ou
   `deny` si coupé), la permission des quatre agents intégrés, et vérifie la configuration effective (`config.get`
   expose `permission` et `agent.*.permission`). Autre piège : `tools: { x: true }` dans le corps d'un prompt crée une
   règle `allow` qui contourne `ask` : le moteur n'envoie que des `false`. `write` et `patch` passent par la
   permission `edit` et par l'indicateur d'outil `edit`.
3. **Les outils MCP distants passent par la permission** : clé `<serveur>_<outil>` (ex. `docker_ps`), couverte par
   `"*": "ask"`. OpenCode n'envoie aucun identifiant d'appel dans `_meta` (seulement `progressToken`) : la corrélation
   `process.*` ↔ `tool.requested` est `inferred` (outil + arguments), comme pour Claude sans `_meta`.
4. **Le `directory` du client ne confine pas** les outils fichiers : il fixe la racine des chemins relatifs. Hors de
   ce répertoire, OpenCode émet une demande séparée `external_directory` (`metadata.filepath`) pour le même `callID` ;
   le moteur lui applique la décision de l'appel (la politique juge déjà `path.outside` / `path.sensitive`). Les
   `patterns` d'une permission `read` sont relatifs à la racine du projet : le chemin absolu vient de la partie `tool`.
5. **SDK v2.** Sa route de réponse est `POST /permission/{requestID}/reply` `{ reply: once|always|reject }` ; la route
   v1 `/session/{id}/permissions/{permissionID}` fonctionne encore en 1.19.0. Le moteur essaie la v1 puis la v2 sur
   404/405 ; un 404 sur une réponse est toléré (OpenCode rejette d'office les demandes en attente d'une session après un
   refus, et rien ne s'exécute sans « once »).

Constats supplémentaires : (a) un `opencode.json` **du dépôt** peut déclarer un serveur MCP `local` dont la commande
est exécutée au démarrage, avant toute permission (vérifié) : le moteur pose `OPENCODE_DISABLE_PROJECT_CONFIG=1`, plus
`OPENCODE_PURE`, `OPENCODE_DISABLE_AUTOUPDATE`, `OPENCODE_DISABLE_SHARE` ; (b) `createOpencodeServer` du SDK hérite de
tout `process.env` et lance `opencode` via `PATH` : le moteur lance le binaire lui-même (port libre, mot de passe
aléatoire, environnement en liste blanche) ; (c) sans `--port` libre, OpenCode retombe sur 4096 ; (d) un refus
interrompt le tour (pas de nouvelle réponse du modèle) ; (e) les erreurs arrivent par `session.error`
(`APIError`, `ProviderAuthError`, `MessageAbortedError`, `UnknownError` avec pile : seule la première ligne est gardée)
puis `session.idle` (parfois deux fois) ; les essais par `session.status` `retry` ; (f) sans modèle configuré, OpenCode
peut choisir un modèle gratuit hébergé (fournisseur `opencode`) : le moteur exige un modèle explicite ; (g) la
configuration globale de l'utilisateur est conservée (fournisseurs, clés) mais son `plugin` est écarté.

**Réserves.** Le sandboxing de l'outil `bash` d'OpenCode n'existe pas (le garde-fou est la gate). Les fournisseurs
réels (clés, abonnements) n'ont pas été essayés. Les jetons ne sont pas journalisés (pas de champ dans le schéma).
En mode `--opencode-url`, la configuration imposée ne peut pas être transmise : seule la vérification s'applique.

## P2 : couche processus et Docker — traités (lots L1 et L2, ADR 0001)

Décisions : `docs/adr/0001-cycle-de-vie-des-processus-et-portabilite.md`. Windows natif en « best effort » (choix de l'utilisateur, usage personnel), Node >=22.12, dépôt privé.

18. **Cycle de vie des processus — traité (lot L1).** `core/src/process/terminate.ts` : `terminateProcessTree` (POSIX : processus lancé `detached`, SIGTERM au groupe, SIGKILL après `graceMs` = 5 s, puis destruction des tubes si des orphelins les gardent ouverts : la promesse ne reste jamais pendante), `spawnOptionsForTree`, `trackProcessTree` (registre des groupes vivants tués par SIGKILL synchrone à la sortie du processus parent). `runProcess` gère lui-même le signal, accepte `timeoutMs` et `killGraceMs` ; `process.exited` porte `termination` (`abort` / `timeout`) et `forced`. `DockerClient` : délai par défaut de 30 min. Le serveur OpenCode lancé par nous est arrêté par le même utilitaire. CLI : un second Ctrl-C quitte immédiatement (code 130). **Limites :** un SIGKILL de la CLI docker laisse le conteneur actif ; un parent tué par SIGKILL laisse des orphelins ; sous Windows, `child.kill()` seul (descendants non arrêtés).
19. **Surface de `DockerClient` — traité (lot L2).** `exec` n'est plus dans l'interface publique. Validations ajoutées : image non vide et ne commençant pas par `-` ; `command` ≤ 256 éléments et ≤ 32 Kio au total, sans `\0` ; valeurs d'`env` ≤ 32 Kio, sans `\0` (jamais recopiées dans les erreurs) ; `binary` = nom nu ou chemin absolu (un chemin relatif est refusé). Codes `docker.invalidArgument` et `docker.invalidBinary`.
20. **Podman — décidé : non supporté (lot L2).** Une sortie de `ps` / `images` / `inspect` dans un autre format lève `docker.unexpectedOutput` (commande et numéro de ligne, sans le contenu) au lieu de donner un résultat vide. `DOCKER_HOST`, `DOCKER_CONTEXT`, `DOCKER_CONFIG`, `DOCKER_CERT_PATH` et `DOCKER_TLS_VERIFY` sont transmis aux commandes (`safeEnv`). Voir « À faire plus tard » pour un support de podman.
21. **Portabilité Windows — décidé : best effort sans garantie.** `john run` n'est pas refusé sous Windows ; la CLI affiche sur stderr, au démarrage de `run` et de `agents`, un avertissement (garde des chemins sensibles POSIX donc incomplète, WSL recommandé, pas pour la production). Les tests POSIX-only sont sautés sous win32. Support complet : voir « À faire plus tard ».

## P2 : export graphe, outillage, livraison — traités (lots L3 et L4)

22. **Export HTML — partiellement traité (lot L4).** Les `process.output` d'un processus sont regroupés en un seul compteur « N lignes » (les orphelins sont fusionnés par parent) : la hauteur ne dépend plus du nombre de lignes de sortie. L'affichage est plafonné à `MAX_RENDERED_NODES` = 5000 nœuds (option `maxNodes`) avec le marqueur « N événements non affichés ». Le `<title>` porte le libellé complet (borné à 4000 caractères), le texte reste tronqué à 80. **Repoussé :** recherche, pagination, repli de sous-arbres, arêtes approbation → processus, lien des `api.retry` avec la requête fautive, lecture de `agentToolUseId` ; l'arbre reste mono-parent.
23. **CI — traité (lot L3).** `.github/workflows/ci.yml` : Ubuntu, Node 22 et 24, `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm build`, `john --help` ; permissions `contents: read`, annulation des exécutions concurrentes, actions épinglées par SHA de commit, aucun secret ni test de contrat. **Non exécuté sur GitHub** : le workflow n'a tourné que localement (YAML validé, SHA vérifiés contre les tags des dépôts d'origine). Node 20 est abandonné (`engines` >= 22.12), ce qui a permis vitest 5 et commander 15.
24. **Résolution de modules en double — traité par un garde-fou (lot L3).** Les trois listes (références `tsc -b`, `paths` de `tsconfig.test.json`, alias vitest) restent, car un tsconfig ne se génère pas ; `test/workspace-consistency.test.ts` échoue avec un message précis si un paquet manque quelque part ou si une dépendance `workspace:*` n'a pas sa référence `tsconfig`. Deux divergences réelles ont été corrigées (`agent-sdk` absent des références racine, `cli` absent des paths et alias).
25. **Dépendances — traité (lots A et L3).** Les SDK restent en `dependencies` (une bibliothèque non publiée n'a pas besoin de peers). `zod` et `@anthropic-ai/sdk` sont conservés parce que `@anthropic-ai/claude-agent-sdk` et `@modelcontextprotocol/sdk` les exigent comme peers non optionnels. Versions exactes pour les SDK instables (`@anthropic-ai/claude-agent-sdk` 0.3.299, `@opencode-ai/sdk` 1.19.0), `@anthropic-ai/sdk` en `^0.133.0`, vitest 5.0.4, commander 15, TypeScript 7.0.2.
26. **Publication — décidé : rester privé (lot L3).** Les six paquets sont `"private": true` pour éviter une publication accidentelle. Le bit exécutable du `bin` est posé par npm/pnpm à l'installation. Voir « À faire plus tard » pour la publication.

## Windows natif (ADR 0002) — lots W-L1 à W-L6 faits, validé sur un vrai Windows

Priorité n°1 (Docker Desktop sous Windows, WSL exclu). Décisions dans `docs/adr/0002-windows-natif.md`. Chaque lot touchant la sécurité a été relu par l'architecte.

| Lot | Contenu | État |
|---|---|---|
| W-L1 / W-L1b | `approval/paths.ts` : chemins multi-plateformes (UNC, `\\?\`, ADS, noms réservés, 8.3, `%VAR%`), `realpath` fail-closed, comparaison sans casse, chemins sensibles Windows et `~/.claude`, liens pendants, `external_directory` d'OpenCode plafonné à `ask` | fait, relu |
| W-L2 | Faux binaires en scripts Node (`argsPrefix`, ≤ 8 éléments, code seulement), `scripts/with-env.mjs`, `.gitattributes`, job Windows en CI (non bloquant) | fait |
| W-L3 | `process/resolve.ts` : binaire toujours en chemin absolu `.exe`, `PATH` relatif ignoré, `.cmd` refusé (sauf shim npm d'OpenCode sondé), `safeEnv` Windows, `envWithout` sans casse, empreinte par `realpathSync.native`, `rename` réessayé | fait |
| W-L4 | `terminateProcessTree` : `taskkill /PID n /T /F` (chemin absolu, sans shell), repli `child.kill()`, filet de sortie synchrone | fait |
| W-L5 / W-L5b | PowerShell interdit (`disallowedTools` + arrêt à `system/init` avec `sdk.unexpectedTool`), shells non analysables au mieux `ask` (`shell.unanalyzable`, jamais mémorisable), `posixShell` fail-closed sous win32, `deny` avec motif refuse l'outil entier, interpréteurs Windows | fait, relu |
| W-L2b | Tests rendus corrects sous Windows (voir ci-dessous) | fait |
| W-L6 | Validation réelle (Windows 11, Node 24, Docker Desktop 29.7, Claude réel par abonnement, OpenCode 1.19.0 natif) : étapes 0 à 11 réussies ; job CI bloquant, avertissement « best effort » retiré | fait |

**Validation W-L6 (2026-10-14).** `pnpm check` vert sous Windows (725 tests, OpenCode réel inclus). Écarts trouvés et corrigés : arbre en CRLF (biome), `with-env.mjs` cassé par un chemin à espace (`shell` inutile pour un `.exe`), liens symboliques remplacés par des jonctions dans les tests (privilège), faux binaire `opencode.exe`, `/etc/shadow` non sensible sous Windows (testé sur plateforme simulée, `ask` jamais `allow` en réel), `.env*` ajouté à `.gitignore`. Vérifiés en réel : `docker.exe` en chemin absolu (cwd piégé ignoré), formes de chemins refusées, `taskkill` (parent et petit-enfant disparus, `forced: true`), `safeEnv`, client Docker (`run`, `rm`, annulation), run Claude avec 11 outils sans `Bash` ni `PowerShell`, `policy trust`, journal, graphe HTML. **Limite de ligne de commande — traitée :** `runProcess` refuse, avant tout événement, une ligne de plus de 32 766 caractères sous Windows (`commandLineLength`, borne haute des guillemets et échappements) et traduit E2BIG / ENAMETOOLONG en `process.commandTooLong` (`ValidationError`, longueur seule, jamais les arguments). Relu par l'architecte.

**Première exécution du job Windows (commit f6b461c).** Linux est vert, Windows échoue sur environ 40 tests, ce qui est le but du job :
- la plupart supposent un Bash POSIX alors que `posixShell` est désormais refusé par défaut sous win32 (les tests doivent le déclarer) ;
- des chemins POSIX codés en dur (`/home/…`, `/w`) ;
- `spawn ENAMETOOLONG` dans `docker-client.test.ts` ;
- `process.test.ts:205` : pas de `SIGTERM` sous Windows (signal `null`).
Ce sont les premiers retours réels d'un Windows ; ils sont traités par le lot W-L2b.

**Décisions et réserves consignées**
- Avec la politique par défaut, `Bash` d'OpenCode sous Windows est refusé entièrement (les `deny` à motif de `DEFAULT_POLICY` s'appliquent à un shell non analysable) ; Bash est de toute façon désactivé par défaut.
- Le refus par motif sous un shell non POSIX est « au mieux » (ADR 0002 §E).
- `external_directory` : une règle `allow` y est ignorée, tout verdict est plafonné à `ask`.
- Hypothèse TOCTOU : l'agent ne peut pas échanger un lien symbolique entre le contrôle et l'usage dans l'espace de travail supervisé (limite acceptée).
- `parsePolicy` n'a pas de mécanisme d'avertissement (les règles ignorées sont silencieuses).
- La table des shims npm (`SHIM_PACKAGES`) ne contient que `opencode` ; à généraliser seulement si un autre binaire en a besoin.
- Non vérifié sans Windows : forme réelle des retours de `realpathSync.native`, comportement de `taskkill`, outils exposés par le SDK sous Windows, shell du bash d'OpenCode.

## Bac à sable Docker (ADR 0003) — accepté pour le profil durci par défaut, lots S1 à S5 à faire

Exécution de commandes par l'agent dans un conteneur créé par le moteur (`--sandbox`), sans Bash hôte. Décisions dans `docs/adr/0003-bac-a-sable-docker.md` : toolset `sandbox` séparé, cible = registre en mémoire (le label n'autorise rien), durcissement vérifié par `inspect` avant chaque appel (`sandbox.tampered` fail-closed), argv direct sans shell imposé, mémorisation limitée à l'argv exact dans le conteneur (jamais l'outil entier), délai/annulation par `docker restart`, échange de fichiers par flux tar lu et écrit par notre code. Décisions de produit en attente : réseau par défaut, choix de l'image, mode autonome, conservation du conteneur, limites par défaut.

| Lot | Contenu | Revue sécurité | État |
|---|---|---|---|
| S1 | Cycle de vie, registre, vérification `inspect`, événements `sandbox.*` | oui | à faire |
| S2 | Politique et gate pour `mcp__sandbox__exec` | oui | à faire |
| S3 | Toolset, CLI, annulation, filtrage des séquences de contrôle | annulation | à faire |
| S4 | `put`/`get` par tar strict | oui | à faire |
| S5 | Intégration avec vrai Docker, W-L6, README | non | à faire |

**Décisions de l'architecte (ADR 0003 §G).** Réseau toujours `none` (option `--sandbox-network` retirée) ; aucune image par défaut, fournie par l'opérateur, `--pull never`, absence → `sandbox.imageUnsupported` ; conteneur toujours supprimé en fin de run ; limites fixes, seul `--sandbox-timeout` réglable (600 s, max 1800 s). Tout autre profil réseau/privilèges est exclu de l'ADR et à rediscuter avec l'utilisateur. Ordre : S1 ∥ S2 ∥ `sandbox/tar.ts`, puis S3, puis `put`/`get`, puis S5. Question restante pour l'utilisateur (Q3) : mode autonome sans demande par exécution (recommandation : non).

## Décisions à demander en priorité

- ~~**Garde unique** (points 2 et 3)~~ : tranché, `PreToolUse`.
- ~~**Bash** (point 3)~~ : tranché, retiré par défaut.
- ~~**Politique** (point 4)~~ : tranché, config utilisateur + empreinte approuvée.
- ~~**Secrets** (point 5)~~ : tranché, dans le recorder.
- ~~**Découpage** (points 7 à 10)~~ : tranché, adaptateur séparé (`@john-studio/agent-sdk`) et libellés dans `@john-studio/messages`.
- ~~**Journal** (points 15 et 17)~~ : tranché, sorties complètes avec plafonds et marqueurs de troncature.
- ~~**P2** (points 18 à 26)~~ : tranché (ADR 0001 et utilisateur) — Windows best effort, Node >= 22.12, podman non supporté, dépôt privé.

## À faire plus tard

Ce qui a été volontairement repoussé ou n'a pas pu être vérifié. Rien ici n'est bloquant pour un usage personnel sur Linux ou macOS.

**Fonctionnalités**
- **Support de Windows natif** : voir la section « Windows natif (ADR 0002) » ci-dessous ; reste la validation sur un vrai Windows (lot W-L6).
- **Support de podman** : parsing tolérant (tableau JSON ou un objet par ligne, `Names` en tableau), option `engine`, tests dédiés.
- **Nettoyage des conteneurs** quand le client docker est tué par SIGKILL (timeout, annulation forcée) : suivre les conteneurs créés par `run` et les supprimer (`docker rm -f`).
- **Export HTML** : recherche, pagination, repli de sous-arbres, arêtes approbation → processus (ajouter `toolUseId` à `process.started` ou relier par le parent), lien des `api.retry`, lecture de `agentToolUseId`.
- **Publication npm** : décisions à prendre (publier ou non, nom du scope, licence — Apache-2.0 recommandée —, dépôt, changesets, README par paquet, CHANGELOG), puis retirer `private`.
- **Rotation des journaux** (seul le plafond d'octets existe).
- **Extension VS Code** : l'interface existe côté cœur (`createApprovalQueue`, `Recorder.stream`, `AgentRunner`) mais rien n'est construit ; vérifier l'empaquetage du binaire du SDK Claude dans l'extension host (Electron, Node différent, remote ou web).
- **Modèles gratuits d'OpenCode inutilisables avec notre configuration** (constaté le 2026-10-14, binaire 1.19.0) : `opencode/big-pickle` et les modèles `opencode/*-free` répondent 403 (« free tier can only be used from within OpenCode ») dès que la configuration impose `permission` / `agent` (restrictions de sécurité du moteur), alors que `opencode run` et `opencode serve` par défaut fonctionnent. Le moteur traduit l'erreur proprement (`provider.error`). Pas de contournement : utiliser un fournisseur avec clé, un modèle local (Ollama) ou un endpoint compatible OpenAI. Reste à savoir si la cause est la suppression d'outils de la requête (hypothèse non vérifiée).
- **SDK v2 d'OpenCode** : non étudié (l'adaptateur cible l'API v1 et tente la route v2 en repli).
- **Durcissement** : `plugins`, `agents` et `pathToClaudeCodeExecutable` restent passables via `sdkOptions` côté Claude ; à examiner.

**Vérifié le 2026-10-14 avec le vrai SDK Claude** (abonnement Pro via `CLAUDE_CODE_OAUTH_TOKEN` issu de `claude setup-token`, `JOHN_CONTRACT_SUBSCRIPTION=1`, 5 scénarios réussis sur 5) :
- Le SDK passe bien l'identifiant d'appel dans `_meta` des handlers MCP (clés `claudecode/toolUseId` et `progressToken`) : la corrélation outil → processus est **exacte** avec Claude.
- Messages réellement reçus : `system/init`, `system/status`, `stream_event`, `assistant`, `user`, `rate_limit_event`, `result/success`, plus `active_goal`, `autocompact_state`, `system/post_turn_summary` et `system/task_summary`. Ces quatre derniers et `stream_event` / `system/status` n'ont pas d'événement moteur : ils sont comptés dans `unhandledMessages`.
- `settingSources: []` n'empêche pas l'authentification par `CLAUDE_CODE_OAUTH_TOKEN` : `apiKeySource` = `none`, `tokenSource` = `CLAUDE_CODE_OAUTH_TOKEN`, `apiProvider` = `firstParty`, aucune erreur. `subscriptionType` n'est pas renseigné avec ce type de jeton.
- Lecture permise vue par la gate, lecture hors espace de travail refusée, Bash et écriture absents de la liste d'outils : conformes.
- Défaut corrigé au passage : le masquage cachait `apiKeySource` et `tokenSource` (leurs noms ressemblent à des secrets) ; ce sont des descripteurs, ajoutés aux clés sûres.

**Reste à vérifier**
- Avec une clé API (`ANTHROPIC_API_KEY`) : mode `auto`/`api-key` non essayé.
- Connexion `/login` stockée dans `~/.claude` (seule la voie `CLAUDE_CODE_OAUTH_TOKEN` a été essayée) ; égalité `task_id` / `agent_id` pour le rattachement des sous-agents (aucun scénario avec l'outil Task).
- Fournisseurs réels d'OpenCode (clés, abonnements) : seul un faux fournisseur local a été essayé.
- La CI GitHub Actions tourne (Linux Node 22/24 verts). Le job Windows, non bloquant, échoue encore (voir ci-dessous).

**Réserve de politique** : la documentation du SDK indique qu'Anthropic n'autorise pas, sauf accord préalable, les développeurs tiers à proposer la connexion claude.ai ou ses limites de débit dans leurs produits ; l'usage de son propre abonnement pour un outil personnel n'y est pas traité. Pour distribuer john-studio, utiliser des clés API.
