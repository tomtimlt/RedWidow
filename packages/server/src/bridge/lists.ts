/**
 * Listes de la coquille (ADR 0052) : missions (index d'historique), runs (noms et métadonnées des
 * journaux, jamais leur contenu), projets, fin de l'audit du serveur. Tout est borné et trié du plus
 * récent au plus ancien. Un nom de fichier hors motif est ignoré ; aucun chemin ne vient du client.
 */
import { lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { readProjects } from "@warband/core";
import { isRunId, parseIndex } from "@warband/vscode/logic/history";
import { isLinked } from "./workspaces.js";

export const MAX_LIST_ITEMS = 500;
export const MAX_AUDIT_ITEMS = 200;
export const MAX_TITLE = 120;
/** Fin de fichier lue pour l'audit (octets) : le fichier croît sans borne, seule sa queue compte. */
const AUDIT_TAIL_BYTES = 512 * 1024;
/** Même garde-fou que l'écriture : aucune clé suspecte ne sort, même d'une ligne d'un ancien fichier. */
const FORBIDDEN = /secret|token|password|value|key/i;

export type MissionState = "idle" | "running" | "waiting" | "stopped";

export interface MissionItem {
  id: string;
  title: string;
  project: string | null;
  updatedAt: string;
  runIds: string[];
  live: boolean;
  state: MissionState;
}

export interface RunItem {
  id: string;
  kind: "mission" | "terminal";
  project: string | null;
  startedAt: string;
  size: number;
}

const MISSION_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;
const TERMINAL_FILE =
  /^term-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;

/** Cadre vivant vu de la liste : conversation affichée et état déduit de sa vue. */
export interface LiveMission {
  id: string;
  state: MissionState;
}

/** Arrêt en cours, puis attente d'approbation, puis tour en cours ; sinon repos. */
export function missionState(view: {
  busy: boolean;
  stopping?: boolean;
  approvals: readonly unknown[];
}): MissionState {
  if (view.stopping === true) return "stopped";
  if (view.approvals.length > 0) return "waiting";
  return view.busy ? "running" : "idle";
}

export function listMissions(index: unknown, live: readonly LiveMission[]): MissionItem[] {
  const states = new Map(live.map((l) => [l.id, l.state]));
  return parseIndex(index)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, MAX_LIST_ITEMS)
    .map((c) => ({
      id: c.id,
      title: c.title.slice(0, MAX_TITLE),
      project: c.projectId ?? null,
      updatedAt: c.updatedAt,
      runIds: c.runIds,
      live: states.has(c.id),
      state: states.get(c.id) ?? "idle",
    }));
}

/**
 * Journaux du dossier `runsDir` : noms et `stat` seulement (le contenu n'est jamais ouvert). Le projet
 * d'un run de mission vient de l'index ; un terminal n'a pas de projet. `project` filtre sur cette valeur.
 */
export async function listRuns(
  runsDir: string,
  index: unknown,
  project: string | null,
): Promise<RunItem[]> {
  const projectOf = new Map<string, string | null>();
  for (const c of parseIndex(index))
    for (const r of c.runIds) projectOf.set(r, c.projectId ?? null);
  const items: RunItem[] = [];
  for (const name of await readdir(runsDir)) {
    const mission = MISSION_FILE.exec(name)?.[1];
    const terminal = mission === undefined ? TERMINAL_FILE.exec(name)?.[1] : undefined;
    const id = mission ?? terminal;
    if (id === undefined || (mission !== undefined && !isRunId(id))) continue;
    const owner = mission === undefined ? null : (projectOf.get(id) ?? null);
    if (project !== null && owner !== project) continue;
    const info = await lstat(join(runsDir, name)).catch(() => null);
    if (info === null || !info.isFile()) continue;
    const started = info.birthtimeMs > 0 ? info.birthtime : info.mtime;
    items.push({
      id,
      kind: mission === undefined ? "terminal" : "mission",
      project: owner,
      startedAt: started.toISOString(),
      size: info.size,
    });
  }
  items.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  return items.slice(0, MAX_LIST_ITEMS);
}

export interface ProjectListItem {
  id: string;
  name: string;
  /** Le projet vit dans le dossier partagé d'un conteneur ; sinon il est « à lier » (ADR 0056). */
  linked: boolean;
  /** Conteneur qui l'héberge (nom), s'il est lié. */
  container?: string;
}

/** Projets et leur état de liaison. Sans racine des conteneurs (usage interne : noms seuls), `linked` vaut `false`. */
export async function listProjects(
  configDir: string,
  containersRoot?: string,
): Promise<ProjectListItem[]> {
  const file = await readProjects(configDir);
  return (file?.projects ?? []).slice(0, MAX_LIST_ITEMS).map((p) => {
    const linked = containersRoot !== undefined && isLinked(p, containersRoot);
    const container = p.primary ?? p.containers[0];
    return {
      id: p.id,
      name: p.name.slice(0, MAX_TITLE),
      linked,
      ...(linked && container !== undefined && { container }),
    };
  });
}

/** Dernières entrées de `audit.jsonl` (les plus récentes d'abord) ; lignes illisibles ignorées. */
export async function tailAudit(file: string, limit: number): Promise<Record<string, unknown>[]> {
  const n = Math.min(Math.max(1, Math.trunc(limit)), MAX_AUDIT_ITEMS);
  let text: string;
  try {
    const fh = await open(file, "r");
    try {
      const { size } = await fh.stat();
      const length = Math.min(size, AUDIT_TAIL_BYTES);
      const buf = Buffer.alloc(length);
      await fh.read(buf, 0, length, size - length);
      text = buf.toString("utf8");
      // Lecture partielle : la première ligne est probablement coupée.
      if (size > length) text = text.slice(text.indexOf("\n") + 1);
    } finally {
      await fh.close();
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: Record<string, unknown>[] = [];
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
    const line = lines[i];
    if (!line) continue;
    try {
      const v: unknown = JSON.parse(line);
      if (typeof v !== "object" || v === null || Array.isArray(v)) continue;
      out.push(
        Object.fromEntries(Object.entries(v).filter(([k]) => !FORBIDDEN.test(k))) as Record<
          string,
          unknown
        >,
      );
    } catch {
      // Ligne tronquée ou corrompue : ignorée.
    }
  }
  return out;
}
