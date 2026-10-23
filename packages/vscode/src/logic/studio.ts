/** Pages des réglages, dans l'ordre de la barre des captures. */
export const STUDIO_PAGES = [
  "project",
  "containers",
  "providers",
  "model",
  "harness",
  "mcp",
  "atlas",
  "layout",
  "modes",
  "personas",
  "approvals",
  "killchain",
  "system",
] as const;

export type StudioPage = (typeof STUDIO_PAGES)[number];

const LABELS: Record<StudioPage, string> = {
  project: "Projet",
  containers: "Conteneurs",
  providers: "Fournisseurs",
  model: "Modèle",
  harness: "Harness",
  mcp: "MCP",
  atlas: "Atlas",
  layout: "Disposition",
  modes: "Modes",
  personas: "Personas",
  approvals: "Approbations",
  killchain: "Kill chain",
  system: "Contrôle système",
};

export function studioLabel(page: StudioPage): string {
  return LABELS[page];
}

export function isStudioPage(value: string): value is StudioPage {
  return (STUDIO_PAGES as readonly string[]).includes(value);
}

export type StudioMessage =
  | { type: "open"; page: StudioPage }
  | { type: "refresh" }
  | { type: "unlink" }
  /** Ouvre le dossier de cours : aucun champ, le chemin vient de l'hôte (`coursRoot()`). */
  | { type: "openCours" }
  /** Ouvre la Kill chain en vue plein écran (hôte seul). */
  | { type: "openKillchain" };

/** Valide un message de la webview réglages. */
export function parseStudioMessage(raw: unknown): StudioMessage | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const keys = Object.keys(m);
  if (m.type === "refresh" && keys.length === 1) return { type: "refresh" };
  if (m.type === "unlink" && keys.length === 1) return { type: "unlink" };
  if (m.type === "openCours" && keys.length === 1) return { type: "openCours" };
  if (m.type === "openKillchain" && keys.length === 1) return { type: "openKillchain" };
  if (
    m.type === "open" &&
    keys.length === 2 &&
    keys.includes("page") &&
    typeof m.page === "string" &&
    isStudioPage(m.page)
  ) {
    return { type: "open", page: m.page };
  }
  return null;
}
