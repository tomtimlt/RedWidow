import { setTimeout } from "node:timers/promises";
import {
  activeProject,
  CodedError,
  type LabelPrefixContainer,
  lookupContainer,
  type ProjectFile,
  type StoredProject,
} from "@warband/core";

/** Intention de création bornée au projet et au dossier capturés avant le lancement de la CLI. */
export async function createAndLinkContainer(
  project: StoredProject,
  token: string,
  deps: {
    signal: AbortSignal;
    read(): Promise<ProjectFile | null>;
    list(): Promise<readonly LabelPrefixContainer[]>;
    identity(row: LabelPrefixContainer): Promise<string>;
    start(): Promise<void>;
    link(name: string, projectId: string, verify: () => Promise<void>): Promise<unknown>;
    now?: () => number;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    timeoutMs?: number;
  },
): Promise<string> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms, signal) => setTimeout(ms, undefined, { signal }));
  const currentProject = async () => {
    deps.signal.throwIfAborted();
    const file = await deps.read();
    const active = file && activeProject(file);
    if (!active || active.id !== project.id || active.workspace !== project.workspace)
      throw new CodedError("project.absent");
  };
  await currentProject();
  if ((await deps.list()).some((row) => lookupContainer(token, [row]) !== null))
    throw new CodedError("project.notFound", { name: token });
  await currentProject();
  await deps.start();
  const deadline = now() + (deps.timeoutMs ?? 30 * 60_000);
  while (now() < deadline) {
    await currentProject();
    const rows = (await deps.list()).filter((row) => row.family === "exegol");
    const name = lookupContainer(token, rows);
    const row = rows.find((candidate) => candidate.name === name);
    if (row?.state === "running") {
      const id = await deps.identity(row);
      const verify = async () => {
        await currentProject();
        const fresh = (await deps.list()).find((candidate) => candidate.name === row.name);
        if (
          !fresh ||
          fresh.family !== "exegol" ||
          fresh.state !== "running" ||
          fresh.workspace !== row.workspace ||
          (await deps.identity(fresh)) !== id
        )
          throw new CodedError("project.notFound", { name: row.name });
      };
      await verify();
      await deps.link(row.name, project.id, verify);
      await verify();
      return row.name;
    }
    await sleep(2000, deps.signal);
  }
  throw new CodedError("project.notRunning", { name: token });
}

/**
 * Suivi du démarrage d'un conteneur Exegol non lié (aucune liaison, aucun projet exigé) : même
 * observation bornée que la liaison (ADR 0047). Attend l'apparition du conteneur en état running,
 * annulable, 30 min max ; sinon `project.notRunning`. Renvoie le nom réel.
 */
export async function awaitCreatedContainer(
  token: string,
  deps: {
    signal: AbortSignal;
    list(): Promise<readonly LabelPrefixContainer[]>;
    start(): Promise<void>;
    now?: () => number;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    timeoutMs?: number;
  },
): Promise<string> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms, signal) => setTimeout(ms, undefined, { signal }));
  deps.signal.throwIfAborted();
  if ((await deps.list()).some((row) => lookupContainer(token, [row]) !== null))
    throw new CodedError("project.notFound", { name: token });
  await deps.start();
  const deadline = now() + (deps.timeoutMs ?? 30 * 60_000);
  while (now() < deadline) {
    deps.signal.throwIfAborted();
    const rows = (await deps.list()).filter((row) => row.family === "exegol");
    const name = lookupContainer(token, rows);
    const row = rows.find((candidate) => candidate.name === name);
    if (row?.state === "running") return row.name;
    await sleep(2000, deps.signal);
  }
  throw new CodedError("project.notRunning", { name: token });
}
