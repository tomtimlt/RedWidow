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
    docker/        client docker (argv), parsing `docker ps --format json`
    graph/         graphe causal à partir des parentId
    agent/         boucle `query()` du SDK, canUseTool → gate
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
