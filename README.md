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
    docker/        client docker (argv, opérandes validés) + outils MCP in-process `mcp__docker__*`
    graph/         graphe causal à partir des parentId
    agent/         boucle `query()` du SDK, canUseTool → gate, corrélation outil MCP ↔ tool.requested, sous-agents
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

## Outils Docker structurés

`runAgent` expose par défaut un serveur MCP in-process `docker` (`ps`, `images`, `logs`, `inspect`, `run`, `start`, `stop`, `rm`).
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
