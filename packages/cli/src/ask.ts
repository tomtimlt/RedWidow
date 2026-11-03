import { createInterface } from "node:readline/promises";
import type { ApprovalAnswer, Asker, RememberScope } from "@warband/core";
import { DEFAULT_LOCALE, formatReason, type Locale } from "@warband/messages";
import { stripControl } from "./sanitize.js";

/**
 * Approbateur terminal. Les demandes sont sérialisées : le SDK peut demander
 * plusieurs outils en parallèle, mais on n'affiche qu'une question à la fois.
 * Défaut sur « non » : seule une réponse explicite autorise :
 * `o` une fois, `s` pour la session, `t` toujours (règle ajoutée à la politique utilisateur).
 */
export function parseAnswer(text: string): ApprovalAnswer {
  const answer = text.trim().toLowerCase();
  const allow = (remember: RememberScope): ApprovalAnswer => ({ decision: "allow", remember });
  if (/^(o|oui|y|yes)$/.test(answer)) return allow("once");
  if (/^(s|session)$/.test(answer)) return allow("session");
  if (/^(t|toujours|a|always)$/.test(answer)) return allow("always");
  return { decision: "deny" };
}

export function createTerminalAsker(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stderr,
  locale: Locale = DEFAULT_LOCALE,
): Asker {
  let queue: Promise<unknown> = Promise.resolve();

  return (request, verdict, signal) => {
    const run = async () => {
      const rl = createInterface({ input, output, terminal: false });
      try {
        const detail = stripControl(
          typeof request.input.command === "string"
            ? request.input.command
            : JSON.stringify(request.input),
        );
        const answer = await rl.question(
          `\n? ${request.tool} : ${detail}\n  ${stripControl(formatReason(verdict.reason, locale))}\n  ${locale === "en" ? "Allow? [y]es once / [s]ession / [a]lways / [N]o " : "Autoriser ? [o]ui une fois / [s]ession / [t]oujours / [N]on "}`,
          { signal },
        );
        return parseAnswer(answer);
      } finally {
        rl.close();
      }
    };
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  };
}
