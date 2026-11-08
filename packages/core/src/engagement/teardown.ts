import { projectTeardownPath } from "../project.js";
import { CodedError } from "../reason.js";
import { readCampaignSync } from "./campaign-store.js";
import type { TeardownItem } from "./plan.js";
import { readIfExists, readIfExistsSync, serialized, writePrivate } from "./private-file.js";

/** Élément de démontage fait : date et preuve (texte court), run éventuel. */
export interface TeardownDone {
  doneAt: string;
  proof: string;
  runId?: string;
}

interface TeardownFile {
  version: 1;
  done: Record<string, TeardownDone>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function parseTeardown(text: string | null): TeardownFile {
  if (text === null) return { version: 1, done: {} };
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.done))
    throw new CodedError("campaign.unreadable", { part: "teardown" });
  const done: Record<string, TeardownDone> = {};
  for (const [id, value] of Object.entries(raw.done)) {
    if (!isRecord(value) || typeof value.doneAt !== "string" || typeof value.proof !== "string")
      throw new CodedError("campaign.unreadable", { part: "teardown" });
    done[id] = {
      doneAt: value.doneAt,
      proof: value.proof,
      ...(typeof value.runId === "string" && { runId: value.runId }),
    };
  }
  return { version: 1, done };
}

export interface TeardownItemView extends TeardownItem {
  done: boolean;
  doneAt?: string;
  proof?: string;
}

/** Liste de clôture d'un projet et état de chaque élément. */
export interface TeardownStatus {
  items: TeardownItemView[];
  /** Éléments non faits. */
  remaining: number;
  /** Faux tant qu'un élément n'est pas fait, ou si la liste ne peut pas être lue de façon sûre. */
  canClose: boolean;
}

/**
 * Éléments à démonter : ceux du plan approuvé. Plan suspendu ou invalidé : ceux du brouillon
 * lisible (plus strict, jamais plus lâche). Plan illisible : `null` (clôture refusée, fail-closed).
 * Aucun plan, ou plan jamais approuvé : aucune obligation.
 */
function plannedItems(configDir: string, projectId: string): TeardownItem[] | null {
  const status = readCampaignSync(configDir, projectId);
  if (status.state === "none" || status.state === "draft") return [];
  if (status.state === "unreadable") return null;
  const plan = status.applied ?? status.draft;
  return plan ? plan.teardown : null;
}

/** État de la liste de clôture. Fichier d'avancement illisible : aucun élément considéré comme fait. */
export function readTeardownSync(configDir: string, projectId: string): TeardownStatus {
  const planned = plannedItems(configDir, projectId);
  if (planned === null) return { items: [], remaining: 0, canClose: false };
  let done: Record<string, TeardownDone> = {};
  try {
    done = parseTeardown(readIfExistsSync(projectTeardownPath(configDir, projectId))).done;
  } catch (err) {
    if (err instanceof CodedError && err.code === "project.invalid") throw err;
  }
  const items = planned.map((item): TeardownItemView => {
    const entry = done[item.id];
    return entry === undefined
      ? { ...item, done: false }
      : { ...item, done: true, doneAt: entry.doneAt, proof: entry.proof };
  });
  const remaining = items.filter((i) => !i.done).length;
  return { items, remaining, canClose: remaining === 0 };
}

/**
 * Vrai si la clôture de l'engagement est permise : tous les éléments de démontage du plan sont
 * faits. Faux dès qu'un élément manque, et si le plan est illisible (fail-closed). Ce n'est pas
 * un blocage d'outil : le moteur relance (`teardown.closeBlocked`), il n'empêche rien.
 */
export function canCloseEngagement(configDir: string, projectId: string): boolean {
  return readTeardownSync(configDir, projectId).canClose;
}

/**
 * Coche un élément de démontage avec sa preuve. Élément absent de la liste du plan →
 * `teardown.itemUnknown`. Réservé au moteur (outil `record_teardown`) : le fichier est un
 * chemin sensible pour les outils de l'agent. Idempotent : recocher garde la première date.
 */
export async function markTeardownDone(
  configDir: string,
  projectId: string,
  entry: { itemId: string; proof: string; runId?: string },
  now: () => Date = () => new Date(),
): Promise<{ item: TeardownItem; status: TeardownStatus }> {
  const planned = plannedItems(configDir, projectId);
  const item = planned?.find((i) => i.id === entry.itemId);
  if (item === undefined) throw new CodedError("teardown.itemUnknown", { itemId: entry.itemId });
  const path = projectTeardownPath(configDir, projectId);
  await serialized(path, async () => {
    let file: TeardownFile;
    try {
      file = parseTeardown(await readIfExists(path));
    } catch {
      file = { version: 1, done: {} };
    }
    if (file.done[entry.itemId] === undefined)
      file.done[entry.itemId] = {
        doneAt: now().toISOString(),
        proof: entry.proof,
        ...(entry.runId !== undefined && { runId: entry.runId }),
      };
    await writePrivate(path, `${JSON.stringify(file, null, 2)}\n`);
  });
  return { item, status: readTeardownSync(configDir, projectId) };
}
