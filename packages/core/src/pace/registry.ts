import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ProgramSheet } from "../program/sheet.js";
import { projectPaceHaltedPath } from "../project.js";
import type { Recorder } from "../recorder.js";
import { createPaceController, type PaceController, type PaceEventData } from "./controller.js";

const normalizeHost = (host: string): string =>
  host
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");

/**
 * Hôtes arrêtés, persistés par projet : l'arrêt est une décision qui doit survivre au processus
 * et la reprise (`program resume`) se fait depuis un autre processus que celui du run.
 */
interface PaceDisk {
  v: 2;
  halted: string[];
  groups: {
    hosts: string[];
    addresses: string[];
    pausedUntil?: number;
    suspectedUntil?: number;
    resumed?: number;
  }[];
}
function readState(configDir: string, projectId: string): PaceDisk {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(projectPaceHaltedPath(configDir, projectId), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { v: 2, halted: [], groups: [] };
    throw error;
  }
  if (Array.isArray(parsed) && parsed.every((h) => typeof h === "string"))
    return { v: 2, halted: parsed.map(normalizeHost), groups: [] };
  const value = parsed as PaceDisk;
  if (
    value?.v !== 2 ||
    !Array.isArray(value.halted) ||
    !value.halted.every((h) => typeof h === "string") ||
    !Array.isArray(value.groups) ||
    !value.groups.every(
      (g) =>
        Array.isArray(g.hosts) &&
        g.hosts.every((h) => typeof h === "string") &&
        Array.isArray(g.addresses) &&
        g.addresses.every((a) => typeof a === "string") &&
        [g.pausedUntil, g.suspectedUntil, g.resumed].every(
          (value) => value === undefined || (Number.isFinite(value) && value >= 0),
        ),
    )
  )
    throw Error("État de rythme illisible.");
  return value;
}
function readHalted(configDir: string, projectId: string): Set<string> {
  return new Set(readState(configDir, projectId).halted);
}
function writeState(configDir: string, projectId: string, value: PaceDisk) {
  const path = projectPaceHaltedPath(configDir, projectId),
    temporary = `${path}.${randomUUID()}.tmp`;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
function writeHalted(configDir: string, projectId: string, hosts: Set<string>) {
  writeState(configDir, projectId, {
    ...readState(configDir, projectId),
    halted: [...hosts].sort(),
  });
}

/** Retire `host` des hôtes arrêtés du projet. `true` s'il y figurait. Geste humain (CLI). */
export function clearPaceHalt(configDir: string, projectId: string, host: string): boolean {
  const disk = readState(configDir, projectId);
  const group = disk.groups.find((g) => g.hosts.includes(normalizeHost(host)));
  const members = new Set(group?.hosts ?? [normalizeHost(host)]);
  const hosts = new Set(disk.halted);
  let had = false;
  for (const member of members) had = hosts.delete(member) || had;
  const paused = (group?.pausedUntil ?? 0) > 0;
  if (had || paused)
    writeState(configDir, projectId, {
      ...disk,
      halted: [...hosts],
      groups: disk.groups.map((g) =>
        g === group
          ? { ...g, pausedUntil: 0, suspectedUntil: 0, resumed: (g.resumed ?? 0) + 1 }
          : g,
      ),
    });
  had ||= paused;
  return had;
}

/** Hôtes arrêtés du projet (lecture seule). */
export function haltedPaceHosts(configDir: string, projectId: string): string[] {
  return [...readHalted(configDir, projectId)].sort();
}

export interface PaceRegistryOptions {
  configDir: string;
  /** Projet actif (peut changer d'un tour à l'autre) ; `null` : pas de contrôleur. */
  projectId: () => string | null;
  now?: () => number;
}

export interface PaceRegistry {
  /** Contrôleur du projet actif, rythme Normal sans fiche ; éphémère sans projet. */
  controller(sheet?: ProgramSheet): PaceController | null;
  /** Journal vers lequel partent `pace.adjusted` et `pace.halted` (le dernier run attaché). */
  attach(recorder: Recorder): void;
}

/**
 * Un contrôleur de rythme par projet et par rythme de fiche (un rythme modifié puis approuvé
 * repart d'un contrôleur neuf). Les arrêts sont persistés et relus avant chaque décision : une
 * reprise faite en CLI est prise en compte par le run en cours.
 */
export function createPaceRegistry(options: PaceRegistryOptions): PaceRegistry {
  let recorder: Recorder | undefined;
  const controllers = new Map<string, PaceController>();
  // Arrêts dont l'écriture a échoué : jamais repris automatiquement (fail-closed).
  const memoryOnly = new Set<string>();
  return {
    attach(next) {
      recorder = next;
    },
    controller(sheet) {
      const projectId = options.projectId();
      const pace = sheet?.pace.value ?? { preset: "normal" as const };
      if (projectId === null) {
        const key = `ephemeral:${JSON.stringify(pace)}`;
        let controller = controllers.get(key);
        if (!controller) {
          controller = createPaceController({
            ...pace,
            ...(options.now && { now: options.now }),
            onEvent: (event) => recorder?.emit(event),
          });
          controllers.set(key, controller);
        }
        return controller;
      }
      const key = `${projectId}:${JSON.stringify(pace)}`;
      const known = controllers.get(key);
      if (known) return known;
      const seenResumes = new Map<string, number>();
      const inner = createPaceController({
        ...pace,
        ...(options.now && { now: options.now }),
        onEvent(event: PaceEventData) {
          const hosts = readHalted(options.configDir, projectId);
          if (event.kind === "pace.halted")
            for (const h of inner.members?.(event.host) ?? [event.host]) hosts.add(h);
          try {
            persist(hosts);
          } catch {
            if (event.kind === "pace.halted")
              for (const h of inner.members?.(event.host) ?? [event.host])
                memoryOnly.add(`${projectId}:${h}`);
          }
          recorder?.emit(event);
        },
      });
      const persist = (halted = readHalted(options.configDir, projectId)) => {
        const disk = readState(options.configDir, projectId);
        const groups = (inner.groups?.() ?? []).map((group) => ({
          ...group,
          resumed: Math.max(
            0,
            ...disk.groups
              .filter((g) => g.hosts.some((h) => group.hosts.includes(h)))
              .map((g) => g.resumed ?? 0),
          ),
        }));
        writeState(options.configDir, projectId, { v: 2, halted: [...halted], groups });
      };
      const loadGroups = () => {
        const disk = readState(options.configDir, projectId);
        for (const group of disk.groups) {
          for (const host of group.hosts) inner.bind?.(host, group.addresses);
          for (const host of group.hosts) {
            if ((group.resumed ?? 0) > (seenResumes.get(host) ?? 0)) inner.resume(host);
            seenResumes.set(host, group.resumed ?? 0);
            inner.restorePause?.(host, group.pausedUntil ?? 0, group.suspectedUntil ?? 0);
          }
        }
        for (const host of disk.halted) inner.restoreHalt?.(host);
        return disk;
      };
      loadGroups();
      const controller: PaceController = {
        get ceilingRps() {
          return inner.ceilingRps;
        },
        bind(host, addresses) {
          const disk = loadGroups();
          inner.bind?.(normalizeHost(host), addresses);
          const halted = new Set(disk.halted);
          for (const group of inner.groups?.() ?? []) {
            if (group.hosts.some((h) => halted.has(h)))
              for (const h of group.hosts) {
                halted.add(h);
                inner.restoreHalt?.(h);
              }
          }
          try {
            persist(halted);
          } catch {
            for (const h of halted) memoryOnly.add(`${projectId}:${h}`);
          }
        },
        members: (host) => inner.members?.(host) ?? [host],
        groups: () => inner.groups?.() ?? [],
        restoreHalt: (host) => inner.restoreHalt?.(host),
        acquire(host) {
          loadGroups();
          const disk = readHalted(options.configDir, projectId);
          const members = inner.members?.(host) ?? [host];
          if (members.some((h) => disk.has(h))) inner.restoreHalt?.(host);
          if (
            inner.status(host).halted &&
            !members.some((h) => memoryOnly.has(`${projectId}:${h}`) || disk.has(h))
          )
            inner.resume(host);
          return inner.acquire(host);
        },
        report: (host, outcome) => inner.report(host, outcome),
        restorePause: (host, paused, suspected) => inner.restorePause?.(host, paused, suspected),
        resume(host) {
          clearPaceHalt(options.configDir, projectId, host);
          for (const h of inner.members?.(host) ?? [host]) memoryOnly.delete(`${projectId}:${h}`);
          inner.resume(host);
        },
        status: (host) => inner.status(host),
      };
      controllers.set(key, controller);
      return controller;
    },
  };
}
