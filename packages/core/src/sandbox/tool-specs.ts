import { z } from "zod";
import { type DockerToolSpec, formatLines } from "../docker/tool-specs.js";
import { capOutput } from "../output.js";
import { CodedError } from "../reason.js";
import { activeSandboxId, execInSandbox, type SandboxContext } from "./sandbox.js";

/** Nom du serveur MCP du bac à sable : les outils vus par le modèle s'appellent `mcp__sandbox__<nom>`. */
export const SANDBOX_SERVER_NAME = "sandbox";
export const SANDBOX_SERVER_INSTRUCTIONS =
  "Bac à sable Docker du run : `exec` lance une commande (argv direct, sans shell) dans un conteneur isolé, sans réseau, utilisateur non privilégié, répertoire de travail /work. Chaque exécution est soumise à approbation.";

/** Texte renvoyé au modèle : code de sortie puis sorties étiquetées, plafonnées (lignes et octets). */
function render(r: {
  code: number | null;
  signal: string | null;
  stdout: string[];
  stderr: string[];
}) {
  const lines = [`code de sortie : ${r.code ?? r.signal ?? "inconnu"}`];
  if (r.stdout.length > 0) lines.push("[stdout]", ...r.stdout);
  if (r.stderr.length > 0) lines.push("[stderr]", ...r.stderr);
  return capOutput(formatLines(lines)).output;
}

/**
 * Spécifications neutres du toolset `sandbox` (`exec` seulement ; `put`/`get` viennent avec S4).
 * L'identifiant du conteneur vient du registre (`containerId`), jamais de l'entrée : le schéma
 * ne le déclare pas et un champ supplémentaire est écarté par la validation. Les exécutions sont
 * sérialisées (file FIFO, une seule à la fois par bac à sable), ce qui rend l'arrêt non ambigu.
 */
export function sandboxToolSpecs(
  ctx: SandboxContext,
  containerId: () => string | undefined = () => activeSandboxId(ctx),
): DockerToolSpec[] {
  const schema = z.object({
    argv: z
      .array(z.string())
      .min(1)
      .max(256)
      .describe('Programme et arguments, sans shell (ex. ["npm","test"])'),
    cwd: z.string().optional().describe("Répertoire absolu sous /work (défaut : /work)"),
    timeoutSec: z.number().positive().optional().describe("Délai en secondes (plafonné)"),
  });
  let tail: Promise<void> = Promise.resolve();

  return [
    {
      name: "exec",
      description:
        "Exécute une commande (argv direct) dans le bac à sable du run. Sortie plafonnée ; délai dépassé ou annulation : le conteneur est redémarré (le contenu de /work est conservé).",
      input: schema.shape,
      run: async (args, call) => {
        const input = schema.parse(args);
        const previous = tail;
        let release: () => void = () => {};
        tail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          if (call.signal?.aborted) throw new CodedError("sandbox.execAborted", { output: "" });
          const id = containerId();
          if (id === undefined) throw new CodedError("sandbox.unavailable");
          const result = await execInSandbox(
            ctx,
            id,
            {
              argv: input.argv,
              ...(input.cwd !== undefined && { cwd: input.cwd }),
              ...(input.timeoutSec !== undefined && { timeoutSec: input.timeoutSec }),
            },
            {
              parentId: call.parentId,
              ...(call.correlation && { correlation: call.correlation }),
              ...(call.signal && { signal: call.signal }),
            },
          );
          const output = render(result);
          const restarted = result.restarted === true ? 1 : 0;
          if (result.termination === "timeout")
            throw new CodedError("sandbox.execTimeout", {
              seconds: input.timeoutSec ?? ctx.maxTimeoutSec,
              restarted,
              output,
            });
          if (result.termination === "abort")
            throw new CodedError("sandbox.execAborted", { restarted, output });
          return output;
        } finally {
          release();
        }
      },
    },
  ];
}
