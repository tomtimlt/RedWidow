# Points à trancher pour l'architecte

Statut : **[V]** vérifié dans le code ou par test, **[?]** déduit, non vérifié contre le vrai SDK.

## P0 : sécurité et fiabilité du contrat avec le SDK

1. **Rien n'a tourné contre le vrai SDK [V].** Tous les tests utilisent un faux `QueryFn` écrit d'après les typings. L'ordre réel `tool_use` → `canUseTool`, les messages partiels et les types de messages non gérés sont inconnus. Il manque au moins un test de contrat avec une vraie clé API.
2. **`canUseTool` est-il l'unique point de contrôle ? [?]** En mode `default`, le SDK peut auto-approuver certains outils (lectures dans le `cwd`) sans l'appeler. Dans ce cas la politique ne peut pas les refuser et le journal ne les voit pas. Décision : passer par un hook `PreToolUse` comme garde faisant autorité, ou restreindre `tools` / `allowedTools`.
3. **Outils natifs non restreints [V].** `Bash`, `Write`, `WebFetch` et les autres restent actifs à côté des outils MCP docker. La politique Bash repose sur un tokenizer maison. Il ne couvre pas les heredocs, `$'…'`, `bash -c`, `env`, `xargs`, `find -exec`, ni `docker run -v /:/host` via Bash. Décision : retirer Bash par défaut, ou le mettre en `deny` hors allowlist stricte.
4. **Politique lue dans le dépôt de travail [V].** `.john-studio/policy.json` vient du `cwd`. Un dépôt cloné peut embarquer une politique `allow` totale. Décision : source de confiance (config utilisateur, hash, ou confirmation à la première lecture).
5. **Fuite de secrets [V].** `runProcess` hérite de tout `process.env` (y compris `ANTHROPIC_API_KEY` pour les processus enfants). Le journal et l'export HTML enregistrent les variables d'environnement de `docker run --env`, les sorties de processus et les `input` d'outils sans masquage.
6. **`Read`, `Glob` et `Grep` sont `allow` sans restriction de chemin [V].** Un agent peut lire `~/.ssh`.

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

- **Garde unique :** `PreToolUse` ou `canUseTool` fait-il autorité ? (points 2 et 3)
- **Bash :** le garder derrière un tokenizer maison, ou le retirer au profit des outils MCP ? (point 3)
- **Politique :** quelle source de confiance ? (point 4)
- **Secrets :** où se fait le masquage, dans le recorder ou à l'écriture du journal ? (point 5)
- **Découpage :** le moteur reste-t-il un paquet unique, ou se sépare-t-il de l'adaptateur SDK ? (points 7 à 10)
