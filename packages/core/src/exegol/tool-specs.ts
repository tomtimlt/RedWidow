import { z } from "zod";
import { defaultConfigDir } from "../approval/source.js";
import type { CallOptions, DockerClient } from "../docker/client.js";
import type { DockerToolContext, DockerToolSpec } from "../docker/tool-specs.js";
import { formatLines } from "../docker/tool-specs.js";
import { CodedError } from "../reason.js";
import {
  appendFinding,
  FINDING_KINDS,
  FINDING_STATES,
  MITRE_TACTICS,
  type MitreTactic,
  TECHNIQUE_PATTERN,
} from "./findings.js";
import { type ExegolTargets, resolveExegolContainer } from "./targets.js";

export const EXEGOL_SERVER_NAME = "exegol";
export const EXEGOL_TOOL_PREFIX = "mcp__exegol__";
export const EXEGOL_EXEC_TOOL = `${EXEGOL_TOOL_PREFIX}exec`;
export const EXEGOL_SERVER_INSTRUCTIONS =
  "Tu exécutes un argv dans un conteneur Exegol déjà lancé, répertoire /workspace. " +
  "Le champ container est un Exegol de l'allowlist du projet. " +
  "Sans un seul Exegol allowlisté et vivant, le message doit l'avoir cité avec @. " +
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
        "Exécute un argv dans un conteneur Exegol de l'allowlist du projet. " +
        "Sans un seul Exegol allowlisté et vivant, le message doit l'avoir cité avec @. " +
        "Le champ container est le nom court ou le nom Docker, résolu sur la liste courante. " +
        "Pas de shell. Le conteneur doit déjà tourner.",
      input: {
        container: z.string().describe("Nom court ou nom Docker d'un Exegol de l'allowlist"),
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
        "Note une trouvaille (hôte, identifiant, site, étape, butin) avec un état confirmé, hypothèse ou échoué. Pas d'exemple, seulement ce qui a été observé. " +
        "tactic : tactique MITRE ATT&CK, TA0043 Reconnaissance, TA0042 Resource Development, TA0001 Initial Access, TA0002 Execution, TA0003 Persistence, TA0004 Privilege Escalation, TA0005 Defense Evasion, TA0006 Credential Access, TA0007 Discovery, TA0008 Lateral Movement, TA0009 Collection, TA0011 Command and Control, TA0010 Exfiltration, TA0040 Impact. " +
        "technique : identifiant de technique (Txxxx ou Txxxx.xxx), seulement si elle est certaine. " +
        "from : ids des trouvailles qui ont mené à celle-ci. Le retour commence par l'id de la trouvaille.",
      input: {
        kind: z.enum(FINDING_KINDS),
        label: z.string(),
        state: z.enum(FINDING_STATES),
        tactic: z.enum(MITRE_TACTICS).optional(),
        technique: z.string().regex(TECHNIQUE_PATTERN).optional(),
        from: z.array(z.string()).max(8).optional(),
      },
      async run(args) {
        const current = targets.current();
        const projectId = current.projectId;
        if (projectId === null) {
          if (current.blocked === "invalid") throw new CodedError("project.invalid");
          if (current.blocked === "readFailed") throw new CodedError("project.readFailed");
          throw new CodedError("project.absent");
        }
        const finding = await appendFinding(defaultConfigDir(), projectId, {
          kind: args.kind as (typeof FINDING_KINDS)[number],
          label: String(args.label),
          state: args.state as (typeof FINDING_STATES)[number],
          ...(args.tactic !== undefined && { tactic: args.tactic as MitreTactic }),
          ...(args.technique !== undefined && { technique: String(args.technique) }),
          ...(args.from !== undefined && { from: args.from as string[] }),
        });
        const tail = `${finding.tactic ? ` ${finding.tactic}` : ""}${finding.technique ? ` ${finding.technique}` : ""}`;
        return `${finding.id} ${finding.kind} ${finding.state} ${finding.label}${tail}`;
      },
    }),
  ];
}
