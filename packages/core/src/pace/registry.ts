import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
function readHalted(configDir: string, projectId: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(projectPaceHaltedPath(configDir, projectId), "utf8"),
    );
    return new Set(
      Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === "string") : [],
    );
  } catch {
    return new Set();
  }
}

function writeHalted(configDir: string, projectId: string, hosts: Set<string>): void {
  const path = projectPaceHaltedPath(configDir, projectId);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify([...hosts].sort()), { encoding: "utf8", mode: 0o600 });
}

/** Retire `host` des hôtes arrêtés du projet. `true` s'il y figurait. Geste humain (CLI). */
export function clearPaceHalt(configDir: string, projectId: string, host: string): boolean {
  const hosts = readHalted(configDir, projectId);
  const had = hosts.delete(normalizeHost(host));
  if (had) writeHalted(configDir, projectId, hosts);
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
  /** Contrôleur du projet actif, créé avec le rythme de la fiche ; `null` sans projet. */
  controller(sheet: ProgramSheet): PaceController | null;
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
      if (projectId === null) return null;
      const pace = sheet.pace.value;
      const key = `${projectId}:${JSON.stringify(pace)}`;
      const known = controllers.get(key);
      if (known) return known;
      const inner = createPaceController({
        ...pace,
        ...(options.now && { now: options.now }),
        onEvent(event: PaceEventData) {
          if (event.kind === "pace.halted") {
            const hosts = readHalted(options.configDir, projectId);
            hosts.add(event.host);
            try {
              writeHalted(options.configDir, projectId, hosts);
            } catch {
              // Persistance impossible : l'arrêt reste effectif dans ce processus.
              memoryOnly.add(`${projectId}:${event.host}`);
            }
          }
          recorder?.emit(event);
        },
      });
      const controller: PaceController = {
        get ceilingRps() {
          return inner.ceilingRps;
        },
        acquire(host) {
          if (
            inner.status(host).halted &&
            !memoryOnly.has(`${projectId}:${host}`) &&
            !readHalted(options.configDir, projectId).has(host)
          )
            inner.resume(host);
          return inner.acquire(host);
        },
        report: (host, outcome) => inner.report(host, outcome),
        resume(host) {
          clearPaceHalt(options.configDir, projectId, host);
          memoryOnly.delete(`${projectId}:${host}`);
          inner.resume(host);
        },
        status: (host) => inner.status(host),
      };
      controllers.set(key, controller);
      return controller;
    },
  };
}
