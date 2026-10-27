import { z } from "zod";
import { defaultConfigDir } from "../approval/source.js";
import type { CallOptions, DockerClient } from "../docker/client.js";
import type { DockerToolContext, DockerToolSpec } from "../docker/tool-specs.js";
import { formatLines } from "../docker/tool-specs.js";
import { writeSummary } from "../project.js";
import { CodedError } from "../reason.js";
import {
  appendFinding,
  deleteFinding,
  FINDING_KINDS,
  FINDING_MAX_LABEL,
  FINDING_STATES,
  type FindingPatch,
  MITRE_TACTICS,
  type MitreTactic,
  readFindings,
  TECHNIQUE_PATTERN,
  updateFinding,
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
  readOnly?: boolean;
  run(args: Record<string, unknown>, call: CallOptions): Promise<string>;
}): DockerToolSpec {
  const schema = z.object(def.input);
  return {
    name: def.name,
    description: def.description,
    input: def.input,
    ...(def.readOnly && { readOnly: true }),
    run: async (args, ctx) => {
      const parsed = schema.safeParse(args);
      if (!parsed.success) {
        if (
          (def.name === "note" || def.name === "update_note") &&
          parsed.error.issues.some((issue) => issue.path.includes("label"))
        )
          throw new CodedError("finding.labelInvalid", { max: FINDING_MAX_LABEL });
        throw parsed.error;
      }
      return def.run(parsed.data as Record<string, unknown>, callOf(ctx));
    },
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

/** Projet de la cible notée (jamais fourni par le modèle) ; sinon erreur typée selon la cause. */
function activeProjectId(targets: ExegolTargets): string {
  const current = targets.current();
  if (current.projectId !== null) return current.projectId;
  if (current.blocked === "invalid") throw new CodedError("project.invalid");
  if (current.blocked === "readFailed") throw new CodedError("project.readFailed");
  throw new CodedError("project.absent");
}

/** Outils : `exec`, `note`, `list_notes`, `update_note`, `delete_note`, `remember`. Le conteneur est validé contre la cible du message, pas choisi librement. */
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
        "Note une trouvaille (hôte, identifiant, site, étape, butin) avec un état confirmé, hypothèse ou échoué. Le label est un titre court de 200 caractères maximum, pas un rapport : garder les détails dans le fichier de résultats. Pas d'exemple, seulement ce qui a été observé. " +
        "tactic : tactique MITRE ATT&CK, TA0043 Reconnaissance, TA0042 Resource Development, TA0001 Initial Access, TA0002 Execution, TA0003 Persistence, TA0004 Privilege Escalation, TA0005 Defense Evasion, TA0006 Credential Access, TA0007 Discovery, TA0008 Lateral Movement, TA0009 Collection, TA0011 Command and Control, TA0010 Exfiltration, TA0040 Impact. " +
        "technique : identifiant de technique (Txxxx ou Txxxx.xxx), seulement si elle est certaine. " +
        "from : ids des trouvailles qui ont mené à celle-ci. Le retour commence par l'id de la trouvaille.",
      input: {
        kind: z.enum(FINDING_KINDS),
        label: z
          .string()
          .trim()
          .min(1)
          .max(FINDING_MAX_LABEL)
          .describe(
            "Titre court (200 caractères maximum). Les résultats détaillés restent dans leur fichier.",
          ),
        state: z.enum(FINDING_STATES),
        tactic: z.enum(MITRE_TACTICS).optional(),
        technique: z.string().regex(TECHNIQUE_PATTERN).optional(),
        from: z.array(z.string()).max(8).optional(),
      },
      async run(args, call) {
        const projectId = activeProjectId(targets);
        const finding = await appendFinding(
          defaultConfigDir(),
          projectId,
          {
            kind: args.kind as (typeof FINDING_KINDS)[number],
            label: String(args.label),
            state: args.state as (typeof FINDING_STATES)[number],
            ...(args.tactic !== undefined && { tactic: args.tactic as MitreTactic }),
            ...(args.technique !== undefined && { technique: String(args.technique) }),
            ...(args.from !== undefined && { from: args.from as string[] }),
          },
          { ...(call.signal && { signal: call.signal }) },
        );
        const tail = `${finding.tactic ? ` ${finding.tactic}` : ""}${finding.technique ? ` ${finding.technique}` : ""}`;
        return `${finding.id} ${finding.kind} ${finding.state} ${finding.label}${tail}`;
      },
    }),
    spec({
      name: "list_notes",
      description:
        "Lit les trouvailles du projet actif avec leurs ids et parents from, pour retrouver les ids avant update_note ou delete_note. Ne lit ni historique ni résumé de conversation.",
      readOnly: true,
      input: {},
      async run() {
        return JSON.stringify(await readFindings(defaultConfigDir(), activeProjectId(targets)));
      },
    }),
    spec({
      name: "mark_path",
      description:
        "Marque de façon autonome les liens entrants du chemin retenu dans la Kill Chain. Après list_notes, fournis l’id de la trouvaille et pathFrom : sous-ensemble de ses parents from réellement parcourus ; [] retire le marquage. Corrige ce chemin au fil des observations et en fin de mission. Annotation verte seulement : ne change ni état, ni lien, ni preuve, ni fichier de résultats. Aucun conteneur requis.",
      input: { id: z.string().min(1), pathFrom: z.array(z.string().min(1)).max(8) },
      async run(args, call) {
        return JSON.stringify(
          await updateFinding(
            defaultConfigDir(),
            activeProjectId(targets),
            String(args.id),
            { pathFrom: args.pathFrom as string[] },
            { ...(call.signal && { signal: call.signal }) },
          ),
        );
      },
    }),
    spec({
      name: "update_note",
      description:
        "Modifie une trouvaille du projet actif par son id (voir list_notes). Les champs omis sont conservés ; null efface tactic/technique, [] efface from. Les parents doivent être des ids connus sans cycle causal.",
      input: {
        id: z.string().min(1),
        patch: z.object({
          label: z.string().trim().min(1).max(FINDING_MAX_LABEL).optional(),
          kind: z.enum(FINDING_KINDS).optional(),
          state: z.enum(FINDING_STATES).optional(),
          tactic: z.enum(MITRE_TACTICS).nullable().optional(),
          technique: z.string().regex(TECHNIQUE_PATTERN).nullable().optional(),
          from: z.array(z.string().min(1)).max(8).optional(),
        }),
      },
      async run(args, call) {
        return JSON.stringify(
          await updateFinding(
            defaultConfigDir(),
            activeProjectId(targets),
            String(args.id),
            args.patch as FindingPatch,
            { ...(call.signal && { signal: call.signal }) },
          ),
        );
      },
    }),
    spec({
      name: "delete_note",
      description:
        "Supprime une trouvaille du projet actif par son id (voir list_notes). Retire cet id des parents from de ses enfants directs, sans supprimer les enfants ni reconnecter leurs parents. Retourne la trouvaille supprimée et les ids des enfants détachés.",
      input: { id: z.string().min(1) },
      async run(args, call) {
        const projectId = activeProjectId(targets);
        return JSON.stringify(
          await deleteFinding(defaultConfigDir(), projectId, String(args.id), {
            ...(call.signal && { signal: call.signal }),
            beforeCommit: () => {
              if (activeProjectId(targets) !== projectId) throw new CodedError("project.invalid");
            },
          }),
        );
      },
    }),
    spec({
      name: "remember",
      description:
        "Écrit le résumé de session du projet actif : ce qu'il faut retenir pour la prochaine conversation (état, pistes, prochaines étapes). " +
        "Remplace le résumé précédent, il n'y a pas d'ajout : reprends l'essentiel de l'ancien si besoin. Pas de secret. Texte plafonné à 8 Kio.",
      input: {
        text: z.string().describe("Nouveau résumé complet du projet"),
      },
      async run(args) {
        const projectId = activeProjectId(targets);
        await writeSummary(defaultConfigDir(), projectId, String(args.text));
        return "Résumé du projet enregistré.";
      },
    }),
  ];
}
