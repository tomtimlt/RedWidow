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

7. **Le cœur produit du texte d'affichage en français [V].** Ce sont les `reason` de politique, les messages de `DockerError` et `labelOf`/`clip` dans `graph/build.ts`. Cela contredit la règle « aucune mise en forme dans le cœur ». Décision : codes et paramètres dans le cœur, libellés dans les UI.
8. **Approbation limitée à une `Promise` unique [V].** Il n'y a ni protocole événementiel, ni timeout, ni « toujours autoriser » persistant (`updatedPermissions` inutilisé), ni file d'attente côté UI. Le moteur ne propose qu'un push par sinks, sans `AsyncIterable<EngineEvent>`.
9. **Le SDK est lié directement au cœur [?].** Il lance un binaire CLI, donc l'empaquetage dans l'extension host VS Code (Electron, Node différent, remote ou web) n'est pas évident. Décision : interface `AgentRunner` avec une implémentation SDK injectée.
10. **`runAgent` fait trop de choses [V].** Il construit le client docker, le serveur MCP et les registres, et lit `process.cwd()`. Le toolset docker est codé en dur dans la boucle.
11. **Pas de session ni de multi-tour [V].** `prompt` est une `string`. Il n'y a ni `session_id`, ni `resume`, ni entrée en streaming, ni `maxBudgetUsd`, ni `systemPrompt` défini.
12. **Événements SDK ignorés [V].** Les `api_retry`, `permission_denied`, `task_*`, `rate_limit` et les blocs `thinking` n'ont pas d'équivalent dans `EngineEvent`.

## P1 : modèle d'événements et journal

13. **Schéma non versionné, validation superficielle [V].** Il n'y a pas de champ `v`. Le lecteur ne valide que les métadonnées et le `kind`, pas la charge utile. `EVENT_KINDS` est maintenu à la main en parallèle de l'union.
14. **Plusieurs runs dans un même journal [V].** Avec `--journal` réutilisé, `buildGraph` trie par `seq` seul. Les `seq` de deux runs s'entrelacent, `runId` est pris sur le premier événement, et il y a plusieurs racines.
15. **Journal non borné [V].** Chaque ligne de `process.output` est écrite, sans plafond ni rotation. `LineSplitter` n'a pas de longueur de ligne maximale.
16. **Causalité fragile [V].** La corrélation outil MCP ↔ `tool.requested` repose sur une FIFO par outil et arguments. La course sous-agent / `canUseTool` se rabat sur la racine. Les erreurs de sink sont avalées sans trace.
17. **Résumés de résultats tronqués à 200 caractères [V].** Le journal perd la sortie complète des outils.

## P2 : couche processus et Docker

18. **Annulation incomplète [V].** Le signal ne déclenche qu'un SIGTERM, sans escalade SIGKILL ni arrêt du groupe de processus. Il n'y a pas de timeout par processus.
19. **`DockerClient.exec` est public et non validé [V].** Il n'est pas exposé en MCP, mais il fait partie de l'API du cœur.
20. **Compatibilité podman non testée [?].** Les options `--format '{{json .}}'` et les noms de champs diffèrent. Le binaire est résolu via `PATH`, sans gestion de `DOCKER_HOST` ni des contextes.
21. **Portabilité Windows [V].** Les tests s'appuient sur `/bin/sh`, et `docker.exe` n'est pas traité.

## P2 : export graphe, outillage, livraison

22. **Layout naïf [V].** Une ligne par événement (hauteur O(n)), pas de repli ni de recherche, libellés tronqués. L'arbre est mono-parent : pas de liens approbation → processus ni de retries.
23. **Pas de CI [V].** Aucune matrice Node 20/22. commander 14 et vitest 4 ont été choisis pour Node 20, mais seul Node 22 a été utilisé pour les tests.
24. **Résolution de modules en double [V].** Les références de projet `tsc -b`, les `paths` de `tsconfig.test.json` et les alias vitest décrivent la même chose à trois endroits.
25. **Dépendances [V].** `@modelcontextprotocol/sdk` et `@anthropic-ai/sdk` sont des peers du SDK. Le premier n'est déclaré qu'en devDependency de `core`, et le second n'est pas déclaré. Le SDK est en 0.x et bouge vite. TypeScript 7 est très récent.
26. **Pas de stratégie de publication [V].** Le binaire `john` n'existe qu'après `pnpm build`, et il n'y a ni versionnage ni changelog.

## Décisions à demander en priorité

- ~~**Garde unique** (points 2 et 3)~~ : tranché, `PreToolUse`.
- ~~**Bash** (point 3)~~ : tranché, retiré par défaut.
- ~~**Politique** (point 4)~~ : tranché, config utilisateur + empreinte approuvée.
- ~~**Secrets** (point 5)~~ : tranché, dans le recorder.
- **Découpage :** le moteur reste-t-il un paquet unique, ou se sépare-t-il de l'adaptateur SDK ? (points 7 à 10)
