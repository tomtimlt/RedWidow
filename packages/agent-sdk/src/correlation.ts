export interface ToolCall {
  toolUseId: string;
  /** Id de l'événement `tool.requested` correspondant. */
  eventId: string;
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
 * Relie un handler MCP à la demande `canUseTool` qui l'a précédé. Le handler
 * ne reçoit pas le `tool_use_id` : on apparie par outil + arguments (FIFO si
 * plusieurs appels identiques), puis, à défaut, par outil seul — zod peut
 * retirer des clés inconnues et changer la clé canonique.
 */
export class ToolCallRegistry {
  private readonly pending = new Map<string, { key: string; call: ToolCall }[]>();

  register(tool: string, input: unknown, call: ToolCall): void {
    const list = this.pending.get(tool) ?? [];
    list.push({ key: canonicalJson(input), call });
    this.pending.set(tool, list);
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
