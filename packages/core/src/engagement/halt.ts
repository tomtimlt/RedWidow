import { rm } from "node:fs/promises";
import { projectEngagementHaltPath } from "../project.js";
import { CodedError } from "../reason.js";
import { isMissing, readIfExists, readIfExistsSync, writePrivate } from "./private-file.js";

/** Arrêt d'urgence d'un projet (ADR 0041) : interrupteur posé et levé par un geste humain. */
export interface EngagementHalt {
  version: 1;
  haltedAt: string;
}

function parseHalt(text: string): EngagementHalt {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const ok =
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    raw.version === 1 &&
    typeof raw.haltedAt === "string" &&
    Object.keys(raw).every((k) => k === "version" || k === "haltedAt");
  if (!ok) throw new CodedError("engagement.unreadable", { part: "halt" });
  return raw as unknown as EngagementHalt;
}

/**
 * Lit l'interrupteur : `null` si absent, sinon l'arrêt en vigueur. **Fail-closed** : un fichier
 * présent mais illisible vaut arrêt actif (date inconnue : chaîne vide). Id non UUID → `project.invalid`.
 */
export function readHalt(configDir: string, projectId: string): EngagementHalt | null {
  const text = readIfExistsSync(projectEngagementHaltPath(configDir, projectId));
  if (text === null) return null;
  try {
    return parseHalt(text);
  } catch {
    return { version: 1, haltedAt: "" };
  }
}

/** Vrai si l'arrêt d'urgence du projet est actif (fichier présent, même illisible). */
export function isHalted(configDir: string, projectId: string): boolean {
  return readHalt(configDir, projectId) !== null;
}

/**
 * Pose l'arrêt d'urgence. Réservé à la CLI (puis à l'interface) : aucun outil d'agent ne
 * l'appelle. Idempotent : un arrêt déjà posé garde sa date d'origine.
 */
export async function setHalt(
  configDir: string,
  projectId: string,
  now: () => Date = () => new Date(),
): Promise<EngagementHalt> {
  const path = projectEngagementHaltPath(configDir, projectId);
  const existing = await readIfExists(path);
  if (existing !== null) {
    try {
      return parseHalt(existing);
    } catch {
      // Illisible : réécrit proprement, l'arrêt reste actif.
    }
  }
  const halt: EngagementHalt = { version: 1, haltedAt: now().toISOString() };
  await writePrivate(path, `${JSON.stringify(halt, null, 2)}\n`);
  return halt;
}

/**
 * Lève l'arrêt d'urgence (second geste humain). Vrai s'il était posé. Réservé à la CLI (puis à
 * l'interface) : aucun outil d'agent ne l'appelle.
 */
export async function clearHalt(configDir: string, projectId: string): Promise<boolean> {
  const path = projectEngagementHaltPath(configDir, projectId);
  try {
    await rm(path);
    return true;
  } catch (err) {
    if (isMissing(err)) return false;
    throw err;
  }
}
