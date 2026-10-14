# john-studio

CLI d'orchestration de conteneurs Docker via un agent : Claude Agent SDK, ou OpenCode pour les autres fournisseurs.

## Architecture

```
packages/
  core/          moteur — aucune dépendance d'affichage, renvoie des événements typés
    events.ts      modèle EngineEvent (union discriminée sur `kind`)
    recorder.ts    horodatage, seq, diffusion vers des sinks
    approval/      tokenizer shell, politique allow/ask/deny, gate (Asker injecté par l'UI)
    journal/       écriture/lecture JSONL
    process/       spawn sans shell, découpe de lignes robuste
    docker/        client docker (argv, opérandes validés), définitions d'outils neutres (`dockerToolSpecs`)
    graph/         graphe causal à partir des parentId
    runner.ts      interface AgentRunner (RunInput, RunContext, RunSummary) — aucun SDK
  agent-sdk/     adaptateur Claude Agent SDK : `createSdkRunner`, hook PreToolUse → gate, corrélation outil MCP ↔ tool.requested, sous-agents, `dockerToolset` (outils MCP `mcp__docker__*`)
  agent-opencode/ adaptateur OpenCode : `createOpencodeRunner`, permissions OpenCode → gate, outils docker en serveur MCP HTTP local
  export-html/   rendu HTML/SVG autonome du graphe
  cli/           commander, rendu terminal, approbateur readline
```

Les UI dépendent de `@john-studio/core`, jamais l'inverse. Une extension VS Code
importera `core` et fournira son propre `Asker` et ses propres sinks.

## Approbation

Chaque appel d'outil passe par `canUseTool` → `ApprovalGate` → `evaluatePolicy` :

- `deny` prime sur `ask`, qui prime sur `allow`, quel que soit l'ordre des règles ;
- une commande Bash est découpée en segments (`;`, `&&`, `||`, `|`, `&`) : un seul segment refusé suffit à tout refuser, et tous les segments doivent être autorisés pour que la commande passe ;
- substitution, expansion (`$VAR`, glob, accolades, `~`), redirection, affectation en préfixe ou arrière-plan → jamais d'auto-approbation (`ask`, ou `deny` si `default: "deny"`) ;
- `ask` sans approbateur interactif → `deny`.

Politique : `--policy <file>`, sinon `.john-studio/policy.json`, sinon la politique intégrée.

```json
{
  "default": "ask",
  "rules": [
    { "tool": "Read", "decision": "allow" },
    { "tool": "Bash", "command": "docker logs *", "decision": "allow" },
    { "tool": "Bash", "command": "docker rm *", "decision": "deny", "reason": "pas de suppression" }
  ]
}
```

Motifs : `*` final = zéro ou plusieurs arguments, `*` médian = exactement un.

### Réponses, mémoire et délai

Le terminal propose `[o]ui une fois / [s]ession / [t]oujours / [N]on` (défaut : non) :

- `s` retient l'autorisation en mémoire pour le run (même outil ; pour Bash, la même commande exacte) ;
- `t` fait de même et ajoute une règle `allow` à la politique utilisateur `<configDir>/policy.json`
  (créée à partir de la politique effective si elle n'existe pas). Seules les commandes Bash d'un seul segment,
  sans joker ni danger shell, sont persistées ;
- une autorisation mémorisée ne contourne jamais un `deny` de la politique ni les garde-fous (chemin sensible
  ou hors de l'espace de travail, conteneur avec accès à l'hôte, dangers du shell) : ces cas redemandent toujours ;
- `--approval-timeout <s>` refuse une demande restée sans réponse (code `approval.timeout`).

Côté bibliothèque, `approval.requested` est émis avant chaque sollicitation de l'`Asker`, et `createApprovalQueue()`
fournit un `Asker` à file d'attente (`pending()`, `answer()`, `requests()`) pour une UI sans terminal.
`Recorder.stream(signal?)` expose les événements en `AsyncIterable`. Le champ `updatedPermissions` du SDK n'est
volontairement pas utilisé : le hook `PreToolUse` fait autorité.

## Sessions

`run --resume <id>` reprend une session, `--max-budget-usd <n>` plafonne la dépense, `--system-prompt <texte>` ajoute du
texte au prompt système (preset `claude_code`). L'identifiant de session est affiché en fin de run. Côté bibliothèque,
`RunInput.prompt` accepte un `AsyncIterable<string>` (session multi-tours) ; chaque tour émet `turn.finished`.

## Authentification

john-studio lance le binaire Claude Code via le Claude Agent SDK, qui choisit ses identifiants dans l'ordre :
fournisseurs cloud, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY` (toujours utilisée si présente en mode non
interactif), `apiKeyHelper`, `CLAUDE_CODE_OAUTH_TOKEN`, puis la connexion d'abonnement (Pro/Max) de `/login`.

- **Par défaut (`--auth auto`)**, l'environnement est hérité tel quel : sans clé définie, c'est votre abonnement qui sert.
  Si `ANTHROPIC_API_KEY` est définie, elle l'emporte (facturation à l'usage) : `unset ANTHROPIC_API_KEY` pour l'éviter.
- **`--auth subscription`** force l'abonnement : le sous-processus reçoit l'environnement sans `ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN` ni `CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY`. Connectez-vous d'abord avec `claude` puis `/login`,
  ou générez un jeton avec `claude setup-token` et exportez-le dans `CLAUDE_CODE_OAUTH_TOKEN`.
- **`--auth api-key`** exige `ANTHROPIC_API_KEY` et échoue avant de lancer si elle manque.

Le mode effectif est affiché au démarrage (attendu) et dans l'événement `session.started` / `auth.info` (abonnement,
clé API, fournisseur). L'adresse e-mail du compte n'est jamais journalisée. Une erreur d'authentification du SDK
devient un événement `error` (`auth.failed`, `auth.orgNotAllowed`) qui indique quoi faire.

> **Avertissement.** Anthropic n'autorise pas, sauf accord préalable, les développeurs tiers à proposer la connexion
> claude.ai ou ses limites de débit dans leurs produits, y compris les agents construits sur le Claude Agent SDK ;
> l'usage de votre propre abonnement pour un outil personnel local n'est pas explicitement traité par la documentation.
> Pour distribuer john-studio à d'autres, utilisez des clés API (`ANTHROPIC_API_KEY`, Bedrock, Vertex…).

## Autres agents (OpenCode)

`john run --agent opencode --model fournisseur/modèle "…"` pilote [OpenCode](https://opencode.ai/docs/) (OpenAI,
Gemini, Ollama ou tout endpoint compatible OpenAI, OpenRouter…) avec le même cœur : événements, journal, graphe et
**la même gate d'approbation**. `john agents` liste les moteurs et indique si le binaire `opencode` est trouvé.

- **Installation.** Le binaire s'installe à part (`npm i -g opencode-ai`, ou voir la documentation d'OpenCode) ;
  `--opencode-bin <chemin>` pour un chemin explicite, `--opencode-url <url>` pour se connecter à un serveur existant
  (`OPENCODE_SERVER_PASSWORD` pour son mot de passe ; la configuration imposée ne peut alors pas lui être transmise,
  elle est seulement vérifiée).
- **Modèle.** `--model fournisseur/modèle` est obligatoire (ou `model` dans la configuration OpenCode) : sans lui,
  OpenCode pourrait choisir un modèle gratuit hébergé par un tiers.
- **Authentification.** john-studio ne touche pas à `auth.json` et n'automatise aucune connexion d'abonnement.
  Connectez-vous avec `opencode auth login`, ou transmettez la clé du fournisseur par l'environnement :
  `--pass-env OPENAI_API_KEY` (le serveur lancé n'hérite que d'une liste blanche de variables, plus les proxys et
  dossiers XDG, plus celles de `--pass-env`). Les secrets sont masqués dans le journal comme pour Claude.
- **Garde.** Le serveur est lancé sur 127.0.0.1 (port libre, mot de passe aléatoire, fermé en fin de run) avec une
  configuration imposée : `permission` à `ask` (ou `deny` pour les outils coupés) pour **tous** les outils, partage et
  mise à jour désactivés, configuration de projet et plugins ignorés. Chaque demande de permission devient un appel à
  la gate (`allow` → réponse `once`, `deny` ou délai → `reject`) ; la réponse « always » n'est jamais envoyée, la
  mémoire reste dans la gate. Les noms d'outils sont ramenés à ceux de la politique (`read` → `Read` avec `file_path`,
  `bash` → `Bash` avec `command`, `<serveur>_<outil>` → `mcp__<serveur>__<outil>`) : politique, garde-fous de chemin
  et motifs Bash s'appliquent à l'identique. Le moteur refuse de démarrer si la configuration effective contient un
  `allow` (y compris par agent), un plugin ou un hook (code `opencode.unsafeConfig`).
- **Outils.** Par défaut `read`, `glob`, `grep` et les outils docker, servis par un serveur MCP HTTP en processus
  (jeton Bearer aléatoire) dont chaque appel repasse par la gate avant d'exécuter. `--allow-bash` ajoute `bash`.
- **Limites.** Un refus interrompt le tour côté OpenCode (le modèle ne voit pas le refus). Les jetons consommés ne
  sont pas journalisés (le schéma d'événements n'a que le coût). `maxRetries` d'`api.retry` vaut 0 (inconnu).
  Le sandboxing de `bash` reste celui d'OpenCode : sans sandbox, préférez les outils docker.

Exemples de configuration d'un endpoint compatible OpenAI (`opencode.json` global, ou option `config` de l'API) :
`provider.<id> = { npm: "@ai-sdk/openai-compatible", options: { baseURL, apiKey: "{env:VARIABLE}" }, models: {…} }`,
puis `--model <id>/<modèle>`.

## Outils Docker structurés

`dockerToolset()` (passé à `createSdkRunner({ toolsets })`, activé par la CLI sauf `--no-docker-tools`) expose un serveur MCP in-process `docker` (`ps`, `images`, `logs`, `inspect`, `run`, `start`, `stop`, `rm`).
Chaque appel passe d'abord par la politique (`canUseTool`), puis s'exécute via `runProcess` ; ses événements `process.*` sont
rattachés au `tool.requested` correspondant. Les opérandes commençant par `-` sont refusés, `run` n'accepte ni volumes ni
mode privilégié. Par défaut : lectures `allow`, `run/start/stop` `ask`, `rm` `deny`. `--no-docker-tools` les désactive.

Docker uniquement : podman n'est pas supporté (la sortie de `ps --format` diffère et est refusée avec `docker.unexpectedOutput`).
`DOCKER_HOST` et `DOCKER_CONTEXT` sont transmis aux commandes. `--docker` accepte un nom simple ou un chemin absolu.

Les messages de sous-agents sont conservés : leurs événements sont enfants du `tool.requested` de l'outil `Task`
(`agentToolUseId` renseigné). Limite : si le SDK appelle `canUseTool` avant d'émettre le message du sous-agent, le
`tool.requested` est rattaché à la racine.

## Usage

```sh
pnpm install && pnpm build
node packages/cli/dist/main.js run "liste les conteneurs arrêtés"
node packages/cli/dist/main.js policy check "docker ps -a | grep web"   # exit 0 allow / 2 ask / 3 deny
node packages/cli/dist/main.js journal .john-studio/runs/<run>.jsonl -v
node packages/cli/dist/main.js graph .john-studio/runs/<run>.jsonl -o run.html
node packages/cli/dist/main.js ps -a
node packages/cli/dist/main.js agents                                       # claude, opencode (binaire trouvé ?)
node packages/cli/dist/main.js run --agent opencode -m fournisseur/modèle "liste les conteneurs"
```

## Développement

```sh
pnpm check   # biome + tsc (sources et tests) + vitest
```
