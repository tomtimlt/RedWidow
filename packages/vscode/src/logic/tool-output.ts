import { KALI_TOOL_PREFIX, stripControl } from "@warband/core";

export interface DisplayToolOutput {
  output: string;
  truncated: boolean;
  failed: boolean;
}

/** Le résultat conservé dans le journal reste brut ; seule sa présentation est transformée. */
export function displayToolOutput(
  tool: string,
  raw: string,
  maxChars: number,
  sourceTruncated = false,
): DisplayToolOutput {
  let text = raw;
  let failed = false;
  if (tool.startsWith(KALI_TOOL_PREFIX)) {
    try {
      const value: unknown = JSON.parse(raw);
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const result = value as Record<string, unknown>;
        if (
          typeof result.stdout === "string" &&
          typeof result.stderr === "string" &&
          (typeof result.success === "boolean" || Number.isInteger(result.return_code))
        ) {
          const code = typeof result.return_code === "number" ? result.return_code : undefined;
          failed =
            result.success === false ||
            (code !== undefined && code !== 0) ||
            result.timed_out === true;
          const parts: string[] = [];
          if (code !== undefined && code !== 0) parts.push(`Code de sortie : ${code}`);
          if (result.timed_out === true) parts.push("Délai d’exécution dépassé.");
          if (result.partial_results === true) parts.push("Résultats partiels.");
          if (
            result.success === false &&
            (code === undefined || code === 0) &&
            result.timed_out !== true
          )
            parts.push("La commande a échoué.");
          if (result.stdout !== "") parts.push(result.stdout);
          if (result.stderr !== "") parts.push(`Sortie d’erreur :\n${result.stderr}`);
          text = parts.join("\n\n");
        } else {
          text = JSON.stringify(value, null, 2);
        }
      }
    } catch {
      // Transport incomplet ou texte non JSON : ne pas reconstruire une réponse supposée.
    }
  }
  const clean = stripControl(text);
  return {
    output: clean.length > maxChars ? `${clean.slice(0, maxChars)}…` : clean,
    truncated: sourceTruncated || clean.length > maxChars,
    failed,
  };
}
