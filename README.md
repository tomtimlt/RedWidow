# john-studio

CLI d'orchestration de conteneurs Docker via le Claude Agent SDK.

## Architecture

```
packages/
  core/          moteur — aucune dépendance d'affichage, renvoie des événements typés
    events.ts      modèle EngineEvent (union discriminée sur `kind`)
    recorder.ts    horodatage, seq, diffusion vers des sinks
    approval/      tokenizer shell, politique allow/ask/deny, gate (Asker injecté par l'UI)
    journal/       écriture/lecture JSONL
    process/       spawn sans shell, découpe de lignes robuste
    docker/        client docker (argv, opérandes validés)
    graph/         graphe causal à partir des parentId
    runner.ts      interface AgentRunner (RunInput, RunContext, RunSummary) — aucun SDK
  agent-sdk/     adaptateur Claude Agent SDK : `createSdkRunner`, hook PreToolUse → gate, corrélation outil MCP ↔ tool.requested, sous-agents, `dockerToolset` (outils MCP `mcp__docker__*`)
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

## Outils Docker structurés

`dockerToolset()` (passé à `createSdkRunner({ toolsets })`, activé par la CLI sauf `--no-docker-tools`) expose un serveur MCP in-process `docker` (`ps`, `images`, `logs`, `inspect`, `run`, `start`, `stop`, `rm`).
Chaque appel passe d'abord par la politique (`canUseTool`), puis s'exécute via `runProcess` ; ses événements `process.*` sont
rattachés au `tool.requested` correspondant. Les opérandes commençant par `-` sont refusés, `run` n'accepte ni volumes ni
mode privilégié. Par défaut : lectures `allow`, `run/start/stop` `ask`, `rm` `deny`. `--no-docker-tools` les désactive.

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
```

## Développement

```sh
pnpm check   # biome + tsc (sources et tests) + vitest
```
