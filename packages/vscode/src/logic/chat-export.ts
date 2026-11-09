import { capOutput, type EngineEvent } from "@warband/core";

/** Exporte uniquement les événements du journal masqué, dans leur ordre de lecture. */
export function exportChat(
  events: readonly EngineEvent[],
  options: { thinking?: boolean } = {},
): { markdown: string; jsonl: string } {
  const calls = new Map<string, number>();
  const rows: EngineEvent[] = [];
  const lines = ["# Fil de mission", ""];
  for (const event of events) {
    const key = "toolUseId" in event ? `${event.runId}/${event.toolUseId}` : "";
    if (event.kind === "tool.requested") calls.set(key, calls.size + 1);
    let text: string;
    let row = event;
    switch (event.kind) {
      case "mission.noContainer":
        text = "Pas de conteneur attaché : outils shell indisponibles.";
        break;
      case "user.message":
        text = `Utilisateur : ${event.text}`;
        break;
      case "agent.text":
        text = `Agent : ${event.text}`;
        break;
      case "agent.thinking":
        if (!options.thinking || event.redacted) continue;
        text = `Pensée : ${event.text}`;
        break;
      case "tool.requested":
        text = `${event.tool} ${JSON.stringify(event.input)}`;
        break;
      case "tool.result": {
        const capped = capOutput(event.output, 4096);
        row = { ...event, output: capped.output, truncated: capped.truncated || event.truncated };
        text = `${event.isError ? "Erreur" : "Résultat"} : ${capped.output}${row.truncated ? "\n[Sortie tronquée — consulter le journal ou read_output.]" : ""}`;
        break;
      }
      case "approval.decided":
        text = `Approbation : ${event.decision} (${event.reason.code})`;
        break;
      case "continuation.auto":
        text = `Continuation automatique : ${event.count}/${event.max}`;
        break;
      case "pace.halted":
        text = `Arrêt de rythme : ${event.host} (${event.cause})`;
        break;
      case "pace.adjusted":
        text = `Rythme : ${event.host} (${event.cause})`;
        break;
      default:
        continue;
    }
    const prefix = `[${event.ts}] [appel ${calls.get(key) ?? calls.size}]`;
    // Les lignes de conversation sont séparées des métadonnées de l’export.
    lines.push(`${prefix} ${event.kind}`, ...text.split("\n").map((line) => `> ${line}`), "");
    rows.push(row);
  }
  return {
    markdown: `${lines.join("\n")}\n`,
    jsonl: rows.map((e) => JSON.stringify(e)).join("\n") + (rows.length ? "\n" : ""),
  };
}
