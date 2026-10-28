/** Pages des réglages, dans l'ordre de la barre des captures. */
export const STUDIO_PAGES = ["project", "containers", "killchain", "atlas", "system"] as const;

export type StudioPage = (typeof STUDIO_PAGES)[number];

const LABELS: Record<StudioPage, string> = {
  project: "Projet",
  containers: "Conteneurs",
  atlas: "Atlas",
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
  | { type: "openReport"; projectId: string }
  | { type: "exportKillchain"; projectId: string }
  | { type: "exportReport"; projectId: string }
  | { type: "open"; page: StudioPage }
  | { type: "refresh" }
  | { type: "openCockpit" }
  | { type: "unlink" }
  | { type: "activateProject"; projectId: string }
  /** Le dossier est choisi dans un dialogue natif ; aucun chemin accepté ici. */
  | { type: "createProject"; name: string }
  /** Résumé du projet affiché : l'hôte revalide le projet actif avant l'écriture. */
  | { type: "saveSummary"; projectId: string; text: string }
  /** La cible est relue et confirmée par l'hôte avant toute suppression. */
  | { type: "deleteFinding"; projectId: string; id: string }
  /** Annotation visuelle d'un lien existant ; aucun état de trouvaille n'est modifié. */
  | { type: "setPathEdge"; projectId: string; from: string; to: string; retained: boolean }
  /** Ouvre le dossier de cours : aucun champ, le chemin vient de l'hôte (`coursRoot()`). */
  | { type: "openCours" }
  /** Ouvre la Kill chain en vue plein écran (hôte seul). */
  | { type: "openKillchain" };

/** Valide un message de la webview réglages. */
export function parseStudioMessage(raw: unknown): StudioMessage | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const keys = Object.keys(m);
  if (
    (m.type === "exportReport" || m.type === "exportKillchain" || m.type === "openReport") &&
    keys.length === 2 &&
    keys.every((key) => key === "type" || key === "projectId") &&
    typeof m.projectId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(m.projectId)
  )
    return { type: m.type, projectId: m.projectId };
  if (
    m.type === "setPathEdge" &&
    keys.length === 5 &&
    keys.every((key) => ["type", "projectId", "from", "to", "retained"].includes(key)) &&
    typeof m.projectId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(m.projectId) &&
    [m.from, m.to].every(
      (id) =>
        typeof id === "string" && id.trim().length > 0 && id.length <= 200 && !/\p{Cc}/u.test(id),
    ) &&
    m.from !== m.to &&
    typeof m.retained === "boolean"
  )
    return {
      type: "setPathEdge",
      projectId: m.projectId,
      from: m.from as string,
      to: m.to as string,
      retained: m.retained,
    };
  if (m.type === "openCockpit" && keys.length === 1) return { type: "openCockpit" };
  if (m.type === "refresh" && keys.length === 1) return { type: "refresh" };
  if (m.type === "unlink" && keys.length === 1) return { type: "unlink" };
  if (m.type === "openCours" && keys.length === 1) return { type: "openCours" };
  if (m.type === "openKillchain" && keys.length === 1) return { type: "openKillchain" };
  if (
    m.type === "activateProject" &&
    keys.length === 2 &&
    typeof m.projectId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(m.projectId)
  ) {
    return { type: "activateProject", projectId: m.projectId };
  }
  if (
    m.type === "createProject" &&
    keys.length === 2 &&
    typeof m.name === "string" &&
    m.name.trim().length > 0 &&
    m.name.trim().length <= 80 &&
    !/[\0\r\n]/.test(m.name)
  ) {
    return { type: "createProject", name: m.name.trim() };
  }
  if (
    m.type === "deleteFinding" &&
    keys.length === 3 &&
    keys.every((key) => key === "type" || key === "projectId" || key === "id") &&
    typeof m.projectId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(m.projectId) &&
    typeof m.id === "string" &&
    m.id.trim().length > 0 &&
    m.id.length <= 200 &&
    !/\p{Cc}/u.test(m.id)
  ) {
    return { type: "deleteFinding", projectId: m.projectId, id: m.id };
  }
  if (
    m.type === "saveSummary" &&
    keys.length === 3 &&
    typeof m.projectId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(m.projectId) &&
    typeof m.text === "string" &&
    Buffer.byteLength(m.text, "utf8") <= 8192
  ) {
    return { type: "saveSummary", projectId: m.projectId, text: m.text };
  }
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
