/** Messages acceptés depuis la webview du terminal (non fiables) : seul `openShell`, sans autre clé. */
export type TerminalMessage = { type: "openShell" };

/** Valide un message du terminal ; toute autre forme, type ou clé supplémentaire → `null`. */
export function parseTerminalMessage(raw: unknown): TerminalMessage | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  if (m.type !== "openShell") return null;
  return Object.keys(m).every((k) => k === "type") ? { type: "openShell" } : null;
}
