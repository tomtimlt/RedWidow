import { createInterface } from "node:readline/promises";
import type { Asker } from "@john-studio/core";

/**
 * Approbateur terminal. Les demandes sont sérialisées : le SDK peut demander
 * plusieurs outils en parallèle, mais on n'affiche qu'une question à la fois.
 * Défaut sur « non » : seule une réponse explicite o/y autorise.
 */
export function createTerminalAsker(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stderr,
): Asker {
  let queue: Promise<unknown> = Promise.resolve();

  return (request, verdict, signal) => {
    const run = async () => {
      const rl = createInterface({ input, output, terminal: false });
      try {
        const detail =
          typeof request.input.command === "string"
            ? request.input.command
            : JSON.stringify(request.input);
        const answer = await rl.question(
          `\n? ${request.tool} : ${detail}\n  ${verdict.reason}\n  Autoriser ? [o/N] `,
          { signal },
        );
        const yes = /^(o|oui|y|yes)$/i.test(answer.trim());
        return { decision: yes ? ("allow" as const) : ("deny" as const) };
      } finally {
        rl.close();
      }
    };
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  };
}
