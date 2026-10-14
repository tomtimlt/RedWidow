# john-studio

Orchestration d'agents (Claude Agent SDK, OpenCode) avec journal d'événements, graphe causal et approbation des outils. Monorepo pnpm TypeScript. Tout le texte (commentaires, messages, docs) est en français.

## Organisation des modèles (consigne permanente)

Principe : **utiliser le modèle le moins cher qui peut faire le travail correctement.** On monte d'un cran seulement si le niveau en dessous échoue ou si la décision engage l'architecture. Les sous-agents repartent sans contexte : leur donner une consigne complète, et leur demander un **rapport court**.

| Rôle | Modèle | Agent | Fait | Ne fait pas |
|---|---|---|---|---|
| Éclaireur | haiku | `explorer` | Toute lecture et exploration : lire du code, grep, typings des dépendances, docs web, état du dépôt. Rapporte des faits cités (`fichier:ligne`). | Écrire des fichiers, décider, interpréter au-delà des faits. |
| Chef de chantier | sonnet | session principale + `dev` | Orchestre, découpe en lots, code, teste, vérifie, commit et push. Les lots larges sont confiés à `dev`. | Trancher une question d'architecture ou de sécurité ouverte. |
| Architecte | opus | `architect` | Choix d'architecture et de design, frontières entre paquets, modèle de menaces, revue de sécurité des lots sensibles, ADR. Reste architecte : il écrit des décisions et des plans, **pas de code**. | Implémenter, lire tout le dépôt (il s'appuie sur les rapports de `explorer`). |

Règles de délégation :
1. **Lecture d'abord par `explorer`.** Avant de planifier ou de coder dans une zone inconnue, lancer `explorer` (plusieurs en parallèle si les zones sont indépendantes). Ne pas lire soi-même de gros fichiers quand un rapport suffit.
2. **Décision ouverte → `architect`.** Dès qu'un choix a plusieurs options aux conséquences durables (nouveau paquet, API publique, sécurité, format d'événement, dépendance), lui soumettre le contexte et les options (rapports d'`explorer`), recevoir une décision courte et motivée. Si la décision est structurante, elle devient un ADR dans `docs/adr/`. Poser les questions de préférence à l'utilisateur seulement s'il s'agit d'un choix de produit.
3. **Implémentation → `dev`, un lot à la fois.** Lots séquentiels s'ils touchent les mêmes fichiers, parallèles sinon. Chaque consigne contient : objectif, fichiers concernés, décisions de l'architecte, critères d'acceptation, commandes de validation, interdits. Pas de lot sans critère vérifiable.
4. **Vérifier soi-même chaque lot** avant de pousser : `pnpm check`, relecture du diff, `git status` propre. Ne jamais pousser sur la foi du seul rapport d'un sous-agent.
5. **Escalade.** `explorer` bloqué ou ambigu → reformuler plus précisément, puis sonnet lit lui-même. `dev` échoue deux fois sur le même point → remonter à `architect` avec l'échec, pas insister. Revue finale d'un lot touchant la sécurité (approbation, politique, secrets, chemins, processus) → `architect`.
6. **Pas de sous-agent pour une petite modification** (quelques lignes, un fichier connu) : la faire directement.
7. **Économie de tokens.** Rapports de sous-agents ≤ 400 mots hors citations utiles ; pas de relecture d'un fichier déjà lu ; pas de sous-agent lancé pour redécouvrir ce que la conversation établit déjà.

## Commandes

- `pnpm check` : biome + `tsc -b` + `tsc -p tsconfig.test.json` + vitest. Doit être entièrement vert avant tout commit.
- `pnpm build` ; `pnpm test:contract` (appels réels, facturés, désactivé par défaut) ; `OPENCODE_BIN` (chemin du binaire) active les contrats OpenCode hors ligne : `OPENCODE_BIN=… pnpm test` (POSIX) ou `$env:OPENCODE_BIN="…"; pnpm test` (PowerShell). Pour poser une variable de façon portable dans un script : `node scripts/with-env.mjs KEY=VAL -- commande` (utilisé par `test:contract`).
- CLI : `node packages/cli/dist/main.js` (`run`, `agents`, `policy`, `journal`, `graph`).

## Architecture

- `core` : événements, recorder (masque les secrets avant tout sink), approbation (politique, gate, file), journal JSONL, graphe, `AgentRunner`. **Aucune dépendance à un SDK d'agent, aucun texte d'affichage** (codes `Reason` + paramètres).
- `messages` : libellés (fr complet, en minimal) pour les codes du cœur.
- `agent-sdk` : adaptateur Claude Agent SDK. `agent-opencode` : adaptateur OpenCode. Ils traduisent les flux vers les événements du cœur.
- `cli`, `export-html` : interfaces.
- Plan et état d'avancement : `docs/architecture-issues.md`. Décisions : `docs/adr/`.

## Invariants de sécurité (ne jamais affaiblir)

- La **gate d'approbation est l'unique autorité** (hook `PreToolUse` côté Claude, événement de permission côté OpenCode). `canUseTool` n'est qu'un filet fail-closed.
- Un `deny` de politique, un chemin sensible ou hors espace de travail, un `docker run` donnant accès à l'hôte et les dangers shell ne sont **jamais** contournables ni mémorisables.
- Options verrouillées côté SDK : `permissionMode`, `allowedTools`, `tools`, `hooks`, `settingSources`, `strictMcpConfig`, `extraArgs`, `settings`, `managedSettings`, `env`, etc. ne sont pas surchargeables.
- Secrets : masqués dans le recorder ; processus enfants avec `safeEnv` (liste blanche) ; l'e-mail du compte n'est jamais journalisé.
- La politique du dépôt n'est appliquée qu'après approbation de son empreinte.
- Bash est désactivé par défaut.

## Conventions

- Style biome, TypeScript strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`). Réutiliser les utilitaires existants (`reason()`, `CodedError`, `capOutput`, `errorInfo`…) avant d'en écrire.
- Tout nouveau code de raison : ajouter à `REASON_CODES` et aux catalogues fr (complet) et en ; un test d'exhaustivité existe. Tout nouveau `kind` d'événement : validateur, `KIND_CLASS` de l'export HTML.
- Chaque paquet ajouté touche `tsconfig.json` (références), `tsconfig.test.json` (paths), `vitest.config.ts` (alias) et le lockfile ; `test/workspace-consistency.test.ts` garde cette cohérence (et celle des dépendances `workspace:*` avec les `references` de chaque paquet).
- `zod` et `@anthropic-ai/sdk` restent déclarés dans `agent-sdk` / `agent-opencode` (en `dependencies`) : ce sont des peers requis des SDK (`@anthropic-ai/claude-agent-sdk` exige `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk` et `zod` ; `@modelcontextprotocol/sdk` exige `zod`). Ne pas les retirer. SDK instables (0.x/1.x) en version exacte.
- Aucun identifiant de modèle dans le code, les commits ou la documentation (sauf variable d'environnement de test). Messages de commit en français.
- Ne pas pousser sur une autre branche que celle de la session, ne pas ouvrir de PR sans demande.
