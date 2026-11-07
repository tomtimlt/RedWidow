# warband

Orchestration d'agents (Claude Agent SDK, OpenCode) avec journal d'événements, graphe causal et approbation des outils. Monorepo pnpm TypeScript. Tout le texte (commentaires, messages, docs) est en français.

## Organisation des modèles (consigne permanente)

La session principale orchestre, décide l'architecture moteur et fait la revue des lots. Elle ne code pas un lot (sauf quelques lignes, règle 7). Les fiches sont dans `.claude/agents/`. Le modèle de chaque fiche est épinglé dans son en-tête : ne pas le surcharger au lancement, ne pas utiliser un sous-agent intégré à la place.

Alias `opus` pour le cadrage produit (`cadre`). Alias `sonnet` pour le code (`dev`, `surface`). Alias `haiku` pour la lecture (`explorer`). Pas de variante Fast. Pas de modèle tiers. Économiser les tokens : pas de sous-agent de revue, pas de décision redéléguée quand l'orchestrateur a les faits.

Deux voies. Voie moteur (orchestrateur → `dev`) : le brief se formule avec les paquets, les types, les événements, la gate, les processus. Voie produit (`cadre`, `surface`) : le brief a besoin de l'interface, d'un branchement ou d'un rendu. On ne mélange pas les voies dans un même brief.

| Rôle | Agent | Fait | Ne fait pas |
|---|---|---|---|
| Éclaireur | `explorer` | Lecture. Faits cités (`fichier:ligne`). | Écrire, décider. |
| Orchestrateur et reviewer | session principale | Décision moteur, lots pour `dev`, revue courte de chaque lot. | Coder un lot. |
| Développeur moteur | `dev` | Un lot déjà décidé. | Trancher l'architecture. |
| Cadrage produit | `cadre` | Décision et lots pour `surface`. | Coder le lot. |
| Réalisation produit | `surface` | Un lot déjà cadré. | Trancher l'architecture. |

Pare-feu. Un sous-agent part vide. La consigne tient dans les sections Objectif, Fichiers, Faits, Décision, Critères, Interdits. On n'y colle pas le fil, ni un rapport entier : seulement les lignes utiles (faits cités, ou la décision, ou la section « décisions requises »). Rapport ≤ 400 mots. Pas de reprise d'un agent pour un autre rôle.

Règles de délégation :
1. **Lecture d'abord par `explorer`.** Plusieurs en parallèle si les zones sont indépendantes. Pas de gros fichier lu par l'orchestrateur quand un rapport suffit.
2. **Décision moteur → l'orchestrateur.** À partir des faits cités. Décision structurante = note courte dans `docs/adr/` (contexte, décision, conséquences), expliquée en clair à l'utilisateur. Préférence produit = question à l'utilisateur.
3. **Lot moteur → `dev`.** Un lot à la fois sur les mêmes fichiers. Objectif, fichiers, décision, critères, commande de validation, interdits.
4. **Décision produit → `cadre`, puis lot → `surface`.** Même forme de consigne. `cadre` ne reçoit pas un transcript ; `surface` reçoit la décision de `cadre`, pas le fil.
5. **Revue par l'orchestrateur** de chaque lot avant de pousser : `pnpm check`, diff, `git status`, et pour un lot qui touche la gate, la politique, les secrets, les chemins ou les processus, contrôle des invariants de sécurité ci-dessous. Revue courte. Jamais pousser sur le seul rapport.
6. **Escalade.** `explorer` ambigu → reformuler. `dev` échoue deux fois → l'orchestrateur reprend la décision, avec l'échec seulement. `surface` échoue deux fois → `cadre`.
7. **Pas de sous-agent pour quelques lignes** dans un fichier déjà connu.
8. **Pas de relecture** d'un fichier déjà rapporté, ni de sous-agent pour redécouvrir ce que le fil établit déjà.

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
- Un `deny` de politique, un chemin sensible ou hors espace de travail, un `docker run` donnant accès à l'hôte et les dangers shell ne sont **jamais mémorisables**. Ils sont **contournables uniquement pendant un Bypass actif** (2 h, 4 h au plafond, éteint à l'arrêt du moteur, effet seulement si un humain répond aux demandes) : l'utilisateur en devient alors responsable (ADR 0017).
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
