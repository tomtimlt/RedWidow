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

Décisions retenues : paquet adaptateur séparé (`@john-studio/agent-sdk`), paquet de libellés partagé (`@john-studio/messages`), sorties d'outil complètes avec plafonds et marqueur de troncature. Plan détaillé en 4 lots, tous faits : A (points 9 et 10), B (points 12 à 17), C1 (point 7), C2 (points 8 et 11). Un lot D (adaptateur OpenCode) est en préparation, voir la section « Adaptateurs » plus bas.

7. **Texte d'affichage dans le cœur — traité (lot C1).** Le cœur n'émet plus que des `Reason { code, params?, cause? }` (`core/src/reason.ts`, liste exhaustive `REASON_CODES`) : motifs de politique et d'approbation, erreurs de validation, `DockerError`, erreurs de processus et de journal, avertissements de politique. Les libellés vivent dans `@john-studio/messages` (`formatReason`, `formatError`, `eventLabel`, `summarizeOutput` ; catalogue `fr` complet, `en` minimal, repli sur code + paramètres), utilisé par la CLI, l'export HTML et les refus renvoyés au modèle. `graph/build.ts` ne produit plus de libellé (les nœuds portent l'événement source). Les anciens journaux restent lisibles (`legacy`). Seul texte français restant dans le cœur : le motif libre de la règle `mcp__docker__rm` de `DEFAULT_POLICY` (texte de règle, rendu tel quel). Les paramètres et causes passent par le masquage des secrets.
8. **Protocole d'approbation — traité (lot C2).** `approval.requested` est émis avant de solliciter l'`Asker` ; `timeoutMs` donne un refus `approval.timeout` ; `ApprovalAnswer.remember` (`once` / `session` / `always`) est géré par la gate : seuls les verdicts « ask » ordinaires (`policy.rule`, `policy.rule.custom`, `policy.default`, `bash.noRule`) sont mémorisables, jamais un `deny`, un chemin sensible ou hors espace de travail, un accès hôte docker ni un danger shell (testé). `always` ne persiste dans la politique utilisateur (`persistRule`, implémenté par la CLI) que pour une commande Bash simple ; sinon il se réduit à `session`. `createApprovalQueue()` fournit `pending()`, `answer()` et `requests()` pour une UI sans terminal (extension VS Code), et `Recorder.stream(signal?)` / `close()` un `AsyncIterable<EngineEvent>`. `updatedPermissions` du SDK reste volontairement inutilisé : le hook `PreToolUse` fait autorité, donc la mémoire d'approbation vit dans la gate. CLI : réponses `o` / `s` / `t` / `N` et `--approval-timeout`.
9. **Le SDK est lié directement au cœur — traité (lot A).** `@john-studio/core` ne dépend plus du SDK ni de `@modelcontextprotocol/sdk` (un test le garantit). Il expose l'interface `AgentRunner` (`core/src/runner.ts`) ; `@john-studio/agent-sdk` en fournit l'implémentation (`createSdkRunner`), que la CLI assemble. **Reste à vérifier :** l'empaquetage du binaire du SDK dans l'extension host VS Code (Electron, Node différent, remote ou web), qui n'a pas été testé.
10. **`runAgent` fait trop de choses — traité (lot A).** `runAgent` devient `createSdkRunner(options).run(input, ctx)` (`agent-sdk/src/runner.ts`) : `cwd` est obligatoire dans `RunInput` (plus de `process.cwd()` implicite), le registre de corrélation et les serveurs MCP sont construits à chaque run, et le toolset docker n'est plus codé en dur mais fourni par `dockerToolset()` (interface `Toolset.create(ctx)`), que la CLI passe sauf avec `--no-docker-tools`.
11. **Sessions et multi-tour — traité (lot C2).** `RunInput.prompt` accepte une `string` ou un `AsyncIterable<string>` (converti en `SDKUserMessage`), avec `sessionId`, `resume`, `maxBudgetUsd` et `systemPrompt` (ajouté au preset `claude_code`) ; `turn.finished` à chaque `result`, `sessionId` dans `run.finished`. CLI : `--resume`, `--max-budget-usd`, `--system-prompt`. Ces options (et `env`) ne sont plus surchargeables via `sdkOptions`. Un prompt en flux est journalisé avec `prompt: ""`.

    **Authentification (ajout du lot C2).** `RunInput.auth` (`auto` / `subscription` / `api-key`, CLI `--auth`) : `subscription` retire `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` et les variables Bedrock/Vertex/Foundry de l'environnement du binaire pour utiliser la connexion `/login` (ou `CLAUDE_CODE_OAUTH_TOKEN`) ; `api-key` exige la clé avant tout lancement. Événements `session.started.auth`, `auth.info` (type d'abonnement, origine du jeton ; jamais l'e-mail) et `auth.status` ; erreurs `auth.failed` / `auth.orgNotAllowed`. **Réserve de politique :** la documentation du SDK indique qu'Anthropic n'autorise pas, sauf accord préalable, les développeurs tiers à proposer la connexion claude.ai ou ses limites de débit dans leurs produits ; l'usage de son propre abonnement pour un outil personnel n'y est pas traité (avertissement dans le README). **Non vérifié sans connexion :** l'effet de `settingSources: []` sur le chargement des identifiants d'abonnement (le test de contrat `JOHN_CONTRACT_SUBSCRIPTION=1` le consigne).

    **Durcissement ajouté en fin de lot :** `extraArgs`, `settings` et `managedSettings` ne sont plus passables via `sdkOptions` (ils auraient permis `--dangerously-skip-permissions` ou des règles `allow`).
12. **Événements SDK ignorés — traité (lot B).** `EngineEvent` gagne `session.started`, `api.retry`, `permission.denied`, `task.updated`, `rate.limited` et `agent.thinking` (traduits dans `agent-sdk/src/runner.ts`). Les autres messages restent sans événement mais sont comptés dans `RunSummary.unhandledMessages` (`type/subtype`), recopié dans `run.finished`. **Reste à vérifier avec une vraie clé :** que le SDK émet bien ces messages dans l'ordre attendu (`pnpm test:contract`).

## P1 : modèle d'événements et journal — traités (lot B)

13. **Schéma versionné, validation complète — traité.** Chaque événement porte `v` (`EVENT_SCHEMA_VERSION`, 1). `EVENT_VALIDATORS` (un validateur par `kind`, exhaustif par typage) valide la charge utile à la relecture, et `EVENT_KINDS` en est dérivé. Un `v` absent vaut 1 ; un `v` supérieur est signalé dans `issues` et l'événement est écarté. Les anciens `tool.result` avec `summary` sont relus comme `output`.
14. **Plusieurs runs dans un même journal — traité.** `splitRuns(events)` sépare les runs ; `buildGraph(events, { runId? })` n'en traite qu'un (le dernier par défaut) et expose `graph.runs`. CLI : `john graph --run <id>` ; `john journal` liste les runs quand il y en a plusieurs et `--run <id>` rejoue l'un d'eux.
15. **Journal borné — traité.** `LineSplitter` coupe les lignes à 16 Kio (`maxLineLength`, champ `truncated`) et jette le reste de la ligne pour borner la mémoire ; `runProcess` n'écrit que `maxJournaledLines` (10 000) lignes par processus et reporte le reste dans `process.exited.droppedLines` ; `openJournal(path, { maxBytes })` (100 Mio par défaut, taille existante comprise) s'arrête proprement avec une ligne finale `journal.truncated`. **Non traité :** la rotation des fichiers.
16. **Causalité — traité, avec réserves.** La corrélation outil MCP ↔ `tool.requested` utilise l'identifiant d'appel transmis par le SDK dans `_meta` quand il existe (`toolUseIdFromExtra`, appariement exact), sinon la FIFO par outil et arguments ; `process.started.correlation` indique `exact`, `inferred` ou `none`. Le rattachement sous-agent passe par `agent_id` du hook et `task_started`. Les erreurs de sink émettent `sink.error` vers les autres sinks (sans récursion) et appellent `onSinkError`. **Hypothèses non vérifiées sans clé API :** que le SDK place bien l'identifiant dans `_meta`, et que le `task_id` des tâches corresponde à l'`agent_id` vu par le hook ; le test de contrat consigne ces deux points.
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

## P2 : couche processus et Docker

18. **Annulation incomplète [V].** Le signal ne déclenche qu'un SIGTERM, sans escalade SIGKILL ni arrêt du groupe de processus. Il n'y a pas de timeout par processus.
19. **`DockerClient.exec` est public et non validé [V].** Il n'est pas exposé en MCP, mais il fait partie de l'API du cœur.
20. **Compatibilité podman non testée [?].** Les options `--format '{{json .}}'` et les noms de champs diffèrent. Le binaire est résolu via `PATH`, sans gestion de `DOCKER_HOST` ni des contextes.
21. **Portabilité Windows [V].** Les tests s'appuient sur `/bin/sh`, et `docker.exe` n'est pas traité.

## P2 : export graphe, outillage, livraison

22. **Layout naïf [V].** Une ligne par événement (hauteur O(n)), pas de repli ni de recherche, libellés tronqués. L'arbre est mono-parent : pas de liens approbation → processus ni de retries.
23. **Pas de CI [V].** Aucune matrice Node 20/22. commander 14 et vitest 4 ont été choisis pour Node 20, mais seul Node 22 a été utilisé pour les tests.
24. **Résolution de modules en double [V] — aggravé par le lot A.** Chaque nouveau paquet ajoute une entrée aux trois endroits ci-dessous. Les références de projet `tsc -b`, les `paths` de `tsconfig.test.json` et les alias vitest décrivent la même chose à trois endroits.
25. **Dépendances [V] — partiellement traité (lot A).** Les peers `@modelcontextprotocol/sdk` et `@anthropic-ai/sdk` sont désormais déclarés dans `@john-studio/agent-sdk` et plus dans le cœur. Reste : le SDK en 0.x, TypeScript 7 très récent.
    Dépendances d'origine : `@modelcontextprotocol/sdk` et `@anthropic-ai/sdk` sont des peers du SDK. Le premier n'est déclaré qu'en devDependency de `core`, et le second n'est pas déclaré. Le SDK est en 0.x et bouge vite. TypeScript 7 est très récent.
26. **Pas de stratégie de publication [V].** Le binaire `john` n'existe qu'après `pnpm build`, et il n'y a ni versionnage ni changelog.

## Décisions à demander en priorité

- ~~**Garde unique** (points 2 et 3)~~ : tranché, `PreToolUse`.
- ~~**Bash** (point 3)~~ : tranché, retiré par défaut.
- ~~**Politique** (point 4)~~ : tranché, config utilisateur + empreinte approuvée.
- ~~**Secrets** (point 5)~~ : tranché, dans le recorder.
- ~~**Découpage** (points 7 à 10)~~ : tranché, adaptateur séparé (`@john-studio/agent-sdk`) et libellés dans `@john-studio/messages`.
- ~~**Journal** (points 15 et 17)~~ : tranché, sorties complètes avec plafonds et marqueurs de troncature.
