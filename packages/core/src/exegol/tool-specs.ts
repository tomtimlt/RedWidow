import { z } from "zod";
import { defaultConfigDir } from "../approval/source.js";
import type { CallOptions, DockerClient } from "../docker/client.js";
import type { DockerToolContext, DockerToolSpec } from "../docker/tool-specs.js";
import { formatLines } from "../docker/tool-specs.js";
import { appendFinding, FINDING_KINDS, FINDING_STATES } from "./findings.js";
import { type ExegolTargets, resolveExegolContainer } from "./targets.js";

export const EXEGOL_SERVER_NAME = "exegol";
export const EXEGOL_TOOL_PREFIX = "mcp__exegol__";
export const EXEGOL_EXEC_TOOL = `${EXEGOL_TOOL_PREFIX}exec`;
export const EXEGOL_SERVER_INSTRUCTIONS =
  "Tu exécutes un argv dans un conteneur Exegol déjà lancé, répertoire /workspace. " +
  "Le champ container est le conteneur dédié du projet, ou un nom que l'utilisateur a cité avec @. " +
  "Tu ne crées, n'arrêtes ni ne supprimes de conteneur.";

const EXEC_TIMEOUT_MS = 600_000;

function spec(def: {
  name: string;
  description: string;
  input: z.ZodRawShape;
  run(args: Record<string, unknown>, call: CallOptions): Promise<string>;
}): DockerToolSpec {
  const schema = z.object(def.input);
  return {
    name: def.name,
    description: def.description,
    input: def.input,
    run: async (args, ctx) => def.run(schema.parse(args) as Record<string, unknown>, callOf(ctx)),
  };
}

function callOf(ctx: DockerToolContext): CallOptions {
  return {
    parentId: ctx.parentId,
    timeoutMs: EXEC_TIMEOUT_MS,
    ...(ctx.correlation && { correlation: ctx.correlation }),
    ...(ctx.signal && { signal: ctx.signal }),
  };
}

/** Un seul outil : `exec`. Le conteneur est validé contre la cible du message, pas choisi librement. */
export function exegolToolSpecs(docker: DockerClient, targets: ExegolTargets): DockerToolSpec[] {
  return [
    spec({
      name: "exec",
      description:
        "Exécute un argv dans le conteneur Exegol autorisé pour ce message (dédié, ou cité par @). " +
        "Le champ container est le nom court (htb1) ou le nom Docker, résolu sur la liste courante. " +
        "Pas de shell. Le conteneur doit déjà tourner.",
      input: {
        container: z.string().describe("Nom du conteneur dédié ou cité par @"),
        argv: z.array(z.string()).describe("Programme et arguments, sans shell"),
      },
      async run(args, call) {
        const rows = await docker.listLabelPrefix(call);
        const container = resolveExegolContainer(targets.current(), String(args.container), rows);
        const argv = args.argv as string[];
        const lines = await docker.execWorkspace(container, argv, call);
        return formatLines(lines);
      },
    }),
    spec({
      name: "note",
      description:
        "Note une trouvaille (hôte, identifiant, site, étape, butin) avec un état confirmé, hypothèse ou échoué. Pas d'exemple, seulement ce qui a été observé.",
      input: {
        kind: z.enum(FINDING_KINDS),
        label: z.string(),
        state: z.enum(FINDING_STATES),
      },
      async run(args) {
        const finding = await appendFinding(defaultConfigDir(), {
          kind: args.kind as (typeof FINDING_KINDS)[number],
          label: String(args.label),
          state: args.state as (typeof FINDING_STATES)[number],
        });
        return `${finding.kind} ${finding.state} ${finding.label}`;
      },
    }),
  ];
}
