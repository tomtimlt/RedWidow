import type { EngineEvent } from "@warband/core";

export type ResearchResult = "completed" | "failed" | "cancelled";
/** Les outils Web renvoient des objets JSON : un champ texte vide ne constitue pas une réponse utile. */
function hasContent(output: string): boolean {
  const text = output.trim();
  if (!text) return false;
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const body = (value as Record<string, unknown>).text;
      return typeof body === "string" && body.trim().length > 0;
    }
    return false;
  } catch {
    return true;
  }
}
/** Contrôle commun aux runners : seule une réponse d'un outil Web demandé compte. */
export function createResearchTracker() {
  let active = false;
  let searched = false;
  let read = false;
  const calls = new Map<string, "search" | "read">();
  return {
    begin(requested: boolean) {
      active = requested;
      searched = false;
      read = false;
      calls.clear();
    },
    observe(event: EngineEvent): ResearchResult | undefined {
      if (!active) return undefined;
      if (
        event.kind === "tool.requested" &&
        ["mcp__web__search_web", "mcp__web__read_url"].includes(event.tool)
      )
        calls.set(event.toolUseId, event.tool === "mcp__web__search_web" ? "search" : "read");
      if (
        event.kind === "tool.result" &&
        calls.has(event.toolUseId) &&
        !event.isError &&
        hasContent(event.output)
      )
        if (calls.get(event.toolUseId) === "search") searched = true;
        else if (calls.get(event.toolUseId) === "read" && searched) read = true;
      if (event.kind === "turn.finished") {
        active = false;
        return event.status === "success" && searched && read ? "completed" : "failed";
      }
      return undefined;
    },
    cancel(): ResearchResult | undefined {
      if (!active) return undefined;
      active = false;
      return "cancelled";
    },
  };
}
