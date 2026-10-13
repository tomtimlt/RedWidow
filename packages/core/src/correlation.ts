export interface ToolCall {
  toolUseId: string;
  /** Id de l'événement `tool.requested` correspondant. */
  eventId: string;
}

/**
 * Extrait l'identifiant d'appel d'outil que le SDK peut transmettre aux
 * handlers MCP dans `extra._meta` (clé `claudecode/toolUseId`, ou toute clé
 * contenant `toolUseId`). `undefined` si absent : on retombe alors sur l'inférence.
 */
export function toolUseIdFromExtra(extra: unknown): string | undefined {
  const meta = (extra as { _meta?: unknown } | null | undefined)?._meta;
  if (typeof meta !== "object" || meta === null) return undefined;
  const record = meta as Record<string, unknown>;
  const direct = record["claudecode/toolUseId"];
  if (typeof direct === "string" && direct !== "") return direct;
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase().includes("tooluseid") && typeof value === "string" && value !== "") {
      return value;
    }
  }
  return undefined;
}

/** JSON canonique : clés triées, `undefined` ignoré. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return v;
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  });
}

/**
 * Relie un handler MCP à la demande `canUseTool` qui l'a précédé. Si le SDK
 * transmet le `tool_use_id` (`toolUseIdFromExtra`), l'appariement est exact
 * (`claimById`). Sinon on infère par outil + arguments (FIFO si plusieurs
 * appels identiques), puis, à défaut, par outil seul — zod peut retirer des
 * clés inconnues et changer la clé canonique.
 */
export class ToolCallRegistry {
  private readonly pending = new Map<string, { key: string; call: ToolCall }[]>();

  register(tool: string, input: unknown, call: ToolCall): void {
    const list = this.pending.get(tool) ?? [];
    list.push({ key: canonicalJson(input), call });
    this.pending.set(tool, list);
  }

  /** Appariement exact par `tool_use_id` ; retire l'entrée pour qu'aucune inférence ne la reprenne. */
  claimById(toolUseId: string): ToolCall | undefined {
    for (const [tool, list] of this.pending) {
      const index = list.findIndex((entry) => entry.call.toolUseId === toolUseId);
      if (index === -1) continue;
      const [entry] = list.splice(index, 1);
      if (list.length === 0) this.pending.delete(tool);
      return entry?.call;
    }
    return undefined;
  }

  claim(tool: string, args: unknown): ToolCall | undefined {
    const list = this.pending.get(tool);
    if (!list || list.length === 0) return undefined;
    const key = canonicalJson(args);
    const index = list.findIndex((entry) => entry.key === key);
    const [entry] = list.splice(index === -1 ? 0 : index, 1);
    if (list.length === 0) this.pending.delete(tool);
    return entry?.call;
  }
}
