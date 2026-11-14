import { setTimeout } from "node:timers/promises";
import { CodedError, type LabelPrefixContainer, lookupContainer } from "@warband/core";

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
