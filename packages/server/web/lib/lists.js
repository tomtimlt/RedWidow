// Listes servies par le pont (missions, projets, runs, audit) : lecture défensive. Une entrée illisible
// est écartée, les textes sont bornés et sans caractère de contrôle. Aucune donnée n'est insérée en HTML.
import { isRecord, safeText } from "../screens/common.js";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_ITEMS = 500;
const STATES = ["idle", "running", "waiting", "stopped"];

const items = (msg) =>
  isRecord(msg) && Array.isArray(msg.items) ? msg.items.slice(0, MAX_ITEMS) : [];
const state = (v) => (STATES.includes(v) ? v : "idle");

/** Message `missions` → { id, title, project, updatedAt, live, state }. */
export function parseMissions(msg) {
  const out = [];
  for (const it of items(msg)) {
    if (!isRecord(it) || typeof it.id !== "string" || !ID.test(it.id)) continue;
    out.push({
      id: it.id,
      title: safeText(it.title, 120) || it.id,
      project: typeof it.project === "string" ? safeText(it.project, 64) : null,
      updatedAt: typeof it.updatedAt === "string" ? it.updatedAt : "",
      live: it.live === true,
      state: state(it.state),
    });
  }
  return out;
}

/** Message `projects` → { id, name }. */
export function parseProjects(msg) {
  const out = [];
  for (const it of items(msg)) {
    if (!isRecord(it) || typeof it.id !== "string" || !ID.test(it.id)) continue;
    out.push({ id: it.id, name: safeText(it.name, 120) || it.id });
  }
  return out;
}

/** Message `runs` → { id, kind, project, startedAt, size }. */
export function parseRuns(msg) {
  const out = [];
  for (const it of items(msg)) {
    if (!isRecord(it) || typeof it.id !== "string" || !ID.test(it.id)) continue;
    out.push({
      id: it.id,
      kind: it.kind === "terminal" ? "terminal" : "mission",
      project: typeof it.project === "string" ? safeText(it.project, 64) : null,
      startedAt:
        typeof it.startedAt === "string" || typeof it.startedAt === "number" ? it.startedAt : "",
      size: Number.isFinite(it.size) && it.size >= 0 ? it.size : 0,
    });
  }
  return out;
}

/** Message `audit` → { at, kind, detail } (champs scalaires seulement, bornés). */
export function parseAudit(msg) {
  const out = [];
  for (const it of items(msg).slice(0, 200)) {
    if (!isRecord(it)) continue;
    const at = it.at ?? it.ts ?? it.time ?? it.date ?? "";
    const parts = [];
    for (const [key, value] of Object.entries(it)) {
      if (["at", "ts", "time", "date", "kind"].includes(key)) continue;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        parts.push(`${safeText(key, 24)}=${safeText(String(value), 60)}`);
      }
      if (parts.length >= 6) break;
    }
    out.push({
      at: typeof at === "string" || typeof at === "number" ? at : "",
      kind: safeText(typeof it.kind === "string" ? it.kind : "événement", 40),
      detail: parts.join(" "),
    });
  }
  return out;
}

/** Taille lisible d'un journal. */
export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Kio`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mio`;
}

/** Pastilles d'activité du dock : clé de fenêtre → "running" | "waiting" (les missions au repos sont omises). */
export function activityMap(missions) {
  const map = new Map();
  for (const m of missions) {
    if (m.state === "running" || m.state === "waiting") map.set(`chat:${m.id}`, m.state);
  }
  return map;
}
