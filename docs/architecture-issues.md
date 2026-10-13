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

Décisions retenues : paquet adaptateur séparé (`@john-studio/agent-sdk`), paquet de libellés partagé (`@john-studio/messages`), sorties d'outil complètes avec plafonds et marqueur de troncature. Plan détaillé en 4 lots : A (points 9 et 10) et B (points 12 à 17) sont faits ; C1 (point 7) est en cours ; C2 (points 8 et 11) reste à faire.

7. **[en cours, lot C1] Le cœur produit du texte d'affichage en français [V].** Ce sont les `reason` de politique, les messages de `DockerError` et `labelOf`/`clip` dans `graph/build.ts`. Cela contredit la règle « aucune mise en forme dans le cœur ». Décision : codes et paramètres dans le cœur, libellés dans les UI.
8. **[à faire, lot C2] Approbation limitée à une `Promise` unique [V].** Il n'y a ni protocole événementiel, ni timeout, ni « toujours autoriser » persistant (`updatedPermissions` inutilisé), ni file d'attente côté UI. Le moteur ne propose qu'un push par sinks, sans `AsyncIterable<EngineEvent>`.
9. **Le SDK est lié directement au cœur — traité (lot A).** `@john-studio/core` ne dépend plus du SDK ni de `@modelcontextprotocol/sdk` (un test le garantit). Il expose l'interface `AgentRunner` (`core/src/runner.ts`) ; `@john-studio/agent-sdk` en fournit l'implémentation (`createSdkRunner`), que la CLI assemble. **Reste à vérifier :** l'empaquetage du binaire du SDK dans l'extension host VS Code (Electron, Node différent, remote ou web), qui n'a pas été testé.
10. **`runAgent` fait trop de choses — traité (lot A).** `runAgent` devient `createSdkRunner(options).run(input, ctx)` (`agent-sdk/src/runner.ts`) : `cwd` est obligatoire dans `RunInput` (plus de `process.cwd()` implicite), le registre de corrélation et les serveurs MCP sont construits à chaque run, et le toolset docker n'est plus codé en dur mais fourni par `dockerToolset()` (interface `Toolset.create(ctx)`), que la CLI passe sauf avec `--no-docker-tools`.
11. **[à faire, lot C2] Pas de session ni de multi-tour [V].** `prompt` est une `string`. Il n'y a ni `session_id`, ni `resume`, ni entrée en streaming, ni `maxBudgetUsd`, ni `systemPrompt` défini.
12. **Événements SDK ignorés — traité (lot B).** `EngineEvent` gagne `session.started`, `api.retry`, `permission.denied`, `task.updated`, `rate.limited` et `agent.thinking` (traduits dans `agent-sdk/src/runner.ts`). Les autres messages restent sans événement mais sont comptés dans `RunSummary.unhandledMessages` (`type/subtype`), recopié dans `run.finished`. **Reste à vérifier avec une vraie clé :** que le SDK émet bien ces messages dans l'ordre attendu (`pnpm test:contract`).

## P1 : modèle d'événements et journal — traités (lot B)

13. **Schéma versionné, validation complète — traité.** Chaque événement porte `v` (`EVENT_SCHEMA_VERSION`, 1). `EVENT_VALIDATORS` (un validateur par `kind`, exhaustif par typage) valide la charge utile à la relecture, et `EVENT_KINDS` en est dérivé. Un `v` absent vaut 1 ; un `v` supérieur est signalé dans `issues` et l'événement est écarté. Les anciens `tool.result` avec `summary` sont relus comme `output`.
14. **Plusieurs runs dans un même journal — traité.** `splitRuns(events)` sépare les runs ; `buildGraph(events, { runId? })` n'en traite qu'un (le dernier par défaut) et expose `graph.runs`. CLI : `john graph --run <id>` ; `john journal` liste les runs quand il y en a plusieurs et `--run <id>` rejoue l'un d'eux.
15. **Journal borné — traité.** `LineSplitter` coupe les lignes à 16 Kio (`maxLineLength`, champ `truncated`) et jette le reste de la ligne pour borner la mémoire ; `runProcess` n'écrit que `maxJournaledLines` (10 000) lignes par processus et reporte le reste dans `process.exited.droppedLines` ; `openJournal(path, { maxBytes })` (100 Mio par défaut, taille existante comprise) s'arrête proprement avec une ligne finale `journal.truncated`. **Non traité :** la rotation des fichiers.
16. **Causalité — traité, avec réserves.** La corrélation outil MCP ↔ `tool.requested` utilise l'identifiant d'appel transmis par le SDK dans `_meta` quand il existe (`toolUseIdFromExtra`, appariement exact), sinon la FIFO par outil et arguments ; `process.started.correlation` indique `exact`, `inferred` ou `none`. Le rattachement sous-agent passe par `agent_id` du hook et `task_started`. Les erreurs de sink émettent `sink.error` vers les autres sinks (sans récursion) et appellent `onSinkError`. **Hypothèses non vérifiées sans clé API :** que le SDK place bien l'identifiant dans `_meta`, et que le `task_id` des tâches corresponde à l'`agent_id` vu par le hook ; le test de contrat consigne ces deux points.
17. **Sorties d'outil complètes — traité.** `tool.result` porte `output` (texte complet jusqu'à `maxResultBytes`, 64 Kio par défaut), `truncated` et `bytes` (taille d'origine) ; le résumé sur une ligne est calculé par les UI. **Limite connue :** la coupe a lieu avant le masquage des secrets, donc un secret coupé pile à la limite n'est pas reconnu (seul un court fragment peut rester).

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
