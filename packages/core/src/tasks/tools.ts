import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { DockerClient } from "../docker/client.js";
import type { DockerToolSpec } from "../docker/tool-specs.js";
import {
  type ExegolTargets,
  resolveExegolContainer,
  resolveKaliContainer,
} from "../exegol/targets.js";
import { CodedError } from "../reason.js";
import type { Recorder } from "../recorder.js";
import { TASK_CLIENT_SCRIPT, TASK_SUPERVISOR_SCRIPT } from "./scripts.js";

export const TASK_START_TOOLS = new Set(["mcp__kali__task_start", "mcp__exegol__task_start"]);

const taskState = z
  .object({
    task_id: z.string().regex(/^[a-f0-9]{32}$/),
    program: z.string().max(80).optional(),
    status: z.enum([
      "starting",
      "running",
      "completed",
      "failed",
      "cancelled",
      "timed_out",
      "output_limit",
      "interrupted",
    ]),
    started_at: z.number().min(0).max(253402300799),
    finished_at: z.number().min(0).max(253402300799).optional(),
    exit_code: z.number().int().nullable(),
    timeout_seconds: z.number().int().min(1).max(86400),
    output_directory: z.string().max(256),
    stdout: z.string().max(8192).optional(),
    stderr: z.string().max(8192).optional(),
    stdout_bytes: z.number().int().nonnegative().optional(),
    stderr_bytes: z.number().int().nonnegative().optional(),
    stdout_truncated: z.boolean().optional(),
    stderr_truncated: z.boolean().optional(),
    cancellation_requested: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.output_directory === `/workspace/outputs/warband-task-${value.task_id}`);
const taskResponse = z.union([
  taskState,
  z.object({ tasks: z.array(taskState).max(50), truncated: z.boolean() }).strict(),
]);

function renderTask(value: Record<string, unknown>): string {
  if (Array.isArray(value.tasks)) {
    const tasks = value.tasks as Record<string, unknown>[];
    return tasks.length === 0
      ? "Aucune tâche conservée pour ce projet dans ce conteneur."
      : tasks.map((task) => renderTask(task)).join("\n\n") +
          (value.truncated ? "\nListe limitée aux 50 tâches les plus récentes." : "");
  }
  const labels: Record<string, string> = {
    starting: "démarrage",
    running: "en cours",
    completed: "terminée",
    failed: "échec",
    cancelled: "annulée",
    timed_out: "durée maximale dépassée",
    output_limit: "limite de sortie atteinte",
    interrupted: "interrompue, résultat non confirmé",
  };
  const text = [
    `Tâche : ${value.task_id}`,
    `État : ${labels[String(value.status)] ?? "inconnu"}`,
    `Dossier des résultats : ${value.output_directory}`,
    `Durée maximale : ${value.timeout_seconds} s`,
  ];
  if (typeof value.program === "string") text.splice(1, 0, `Programme : ${value.program}`);
  if (typeof value.started_at === "number") {
    text.push(`Début : ${new Date(value.started_at * 1000).toISOString()}`);
    const end = typeof value.finished_at === "number" ? value.finished_at : Date.now() / 1000;
    text.push(`Temps écoulé : ${Math.max(0, Math.floor(end - value.started_at))} s`);
  }
  if (value.exit_code !== null && value.exit_code !== undefined)
    text.push(`Code de sortie : ${value.exit_code}`);
  if (value.cancellation_requested)
    text.push("Annulation demandée ; consulter task_status pour confirmer son achèvement.");
  for (const stream of ["stdout", "stderr"]) {
    if (typeof value[stream] !== "string") continue;
    text.push(
      `${stream} (${value[`${stream}_bytes`]} octets${value[`${stream}_truncated`] ? ", extrait final, 8 Kio maximum" : ""}) :`,
      String(value[stream]) || "(vide)",
    );
  }
  return text.join("\n");
}

/** Appels courts : l’argv utilisateur ne passe jamais dans une commande shell interpolée. */
export function taskToolSpecs(
  family: "exegol" | "kali",
  docker: DockerClient,
  targets: ExegolTargets,
  recorder?: Recorder,
  containerEnv?: Readonly<Record<string, string>>,
): DockerToolSpec[] {
  const container = z.string().min(1).max(128);
  const taskId = z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .describe("Identifiant retourné par task_start");
  const definitions = [
    {
      name: "task_start",
      operation: "start",
      description:
        "Lance une commande longue et rend immédiatement un identifiant. Préférer cet outil aux appels synchrones pour les scans et commandes de durée incertaine. " +
        "Argv direct, sans shell implicite, répertoire /workspace. stdout.txt, stderr.txt et result.json sont conservés dans le dossier retourné. " +
        "La tâche continue après la fin du tour ou la fermeture du chat ; utiliser task_cancel pour l’arrêter. " +
        "Ne pas relancer une tâche dont seul l’appel MCP a expiré : consulter task_list et task_status.",
      input: {
        container,
        argv: z
          .array(
            z
              .string()
              .max(4096)
              .refine((s) => !s.includes("\0")),
          )
          .min(1)
          .max(128)
          .refine((argv) => argv.reduce((size, part) => size + part.length + 1, 0) <= 8192),
        timeout_seconds: z
          .number()
          .int()
          .min(1)
          .max(86400)
          .optional()
          .describe("Défaut 3600 s ; maximum 24 h"),
        max_parallel: z
          .number()
          .int()
          .min(1)
          .max(8)
          .optional()
          .describe(
            "Plafond de tâches actives dans ce projet/conteneur pour ce lancement (1–8 ; défaut 8).",
          ),
      },
    },
    {
      name: "task_list",
      operation: "list",
      description:
        "Liste les tâches créées par task_start pour le projet courant dans le conteneur autorisé, sans relancer de commande ni lire les anciennes conversations. Ne recense pas les processus de nmap_scan ou execute_command ; une liste vide ne prouve pas leur arrêt après un timeout.",
      input: { container },
      readOnly: true,
    },
    {
      name: "task_status",
      operation: "status",
      description:
        "Consulte l’état réel d’une tâche et les derniers 8 Kio de stdout/stderr. Aucune nouvelle exécution. Une sortie partielle ne signifie pas que la tâche a réussi. Espacer les consultations d’au moins quelques secondes.",
      input: {
        container,
        task_id: taskId,
        wait_seconds: z
          .number()
          .int()
          .min(0)
          .max(10)
          .optional()
          .describe("Attente bornée avant le relevé si la tâche est active ; défaut 2 s"),
      },
      readOnly: true,
    },
    {
      name: "task_status_json",
      operation: "status",
      description:
        "État structuré d’une tâche : status, exit_code, sorties et indicateurs de troncature, chemins et temps. Lecture seule. Une tâche active ou une sortie tronquée n’est pas une preuve de réussite.",
      input: { container, task_id: taskId },
      readOnly: true,
    },
    {
      name: "task_list_json",
      operation: "list",
      description:
        "Liste structurée des tâches du projet dans le conteneur autorisé. Réutiliser leurs ids avant de lancer une opération indépendante ; ne pas relancer une tâche active.",
      input: { container },
      readOnly: true,
    },
    {
      name: "task_cancel",
      operation: "cancel",
      description:
        "Demande l’arrêt du groupe de processus d’une tâche du projet. Conserve les résultats. Consulter ensuite task_status pour confirmer l’annulation ; une tâche déjà terminée garde son état.",
      input: { container, task_id: taskId },
    },
  ];
  return definitions.map(
    (definition): DockerToolSpec => ({
      name: definition.name,
      description: definition.description,
      input: definition.input,
      ...("readOnly" in definition && definition.readOnly && { readOnly: true }),
      async run(raw, ctx) {
        const args = z.object(definition.input).parse(raw);
        const current = targets.current();
        if (current.projectId === null)
          throw new CodedError(
            current.blocked === "invalid"
              ? "project.invalid"
              : current.blocked === "readFailed"
                ? "project.readFailed"
                : "project.absent",
          );
        const call = {
          parentId: ctx.parentId,
          timeoutMs: 15_000,
          ...(definition.operation === "start" && containerEnv && { containerEnv }),
          ...(ctx.signal && { signal: ctx.signal }),
          ...(ctx.correlation && { correlation: ctx.correlation }),
        };
        const rows = await docker.listLabelPrefix(call);
        if (targets.current() !== current) throw new CodedError("project.readFailed");
        const resolve = family === "kali" ? resolveKaliContainer : resolveExegolContainer;
        const name = resolve(
          current,
          family === "kali" ? args.container.replace(/^[@#]/, "") : args.container,
          rows,
        );
        if (rows.find((row) => row.name === name)?.state !== "running")
          throw new CodedError("project.notRunning", { name });
        ctx.signal?.throwIfAborted();
        const request = {
          operation: definition.operation,
          scope: createHash("sha256").update(current.projectId).digest("hex"),
          task_id: "task_id" in args ? args.task_id : randomUUID().replaceAll("-", ""),
          ...("argv" in args && { argv: args.argv }),
          timeout_seconds: "timeout_seconds" in args ? (args.timeout_seconds ?? 3600) : 3600,
          max_parallel: "max_parallel" in args ? (args.max_parallel ?? 8) : 8,
          wait_seconds:
            definition.operation === "status"
              ? "wait_seconds" in args
                ? (args.wait_seconds ?? 2)
                : 2
              : 0,
        };
        const lines = await docker.execWorkspace(
          name,
          ["python3", "-c", TASK_CLIENT_SCRIPT, JSON.stringify(request), TASK_SUPERVISOR_SCRIPT],
          call,
        );
        let value: Record<string, unknown>;
        try {
          value = taskResponse.parse(JSON.parse(lines.join("\n"))) as Record<string, unknown>;
        } catch {
          throw new CodedError("task.invalidResponse");
        }
        const reported = Array.isArray(value.tasks) ? value.tasks : [value];
        for (const item of reported as Record<string, unknown>[]) {
          const active = item.status === "starting" || item.status === "running";
          recorder?.emit(
            {
              kind: "task.updated",
              taskId: String(item.task_id),
              phase: active
                ? definition.operation === "start"
                  ? "started"
                  : "updated"
                : "finished",
              status: String(item.status),
              description: `${name} / ${String(item.program ?? "tâche")}`,
            },
            ctx.parentId,
          );
        }
        return definition.name.endsWith("_json")
          ? JSON.stringify({ version: 1, ...value, objectiveVerified: false })
          : renderTask(value);
      },
    }),
  );
}
