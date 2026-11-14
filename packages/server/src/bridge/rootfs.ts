/**
 * Suppression en root dans un conteneur géré (ADR 0056). Les outils tournent en root dans le conteneur et créent
 * des fichiers appartenant à root dans le dossier partagé (monté en `/workspace`) ; le serveur, lui, n'est pas root
 * et ne peut pas les supprimer. Ce module est le SEUL endroit qui exécute une commande en root dans un conteneur
 * depuis l'API Fichiers : jamais de shell (`Cmd` est un tableau), jamais de TTY, jamais `Privileged`, un
 * environnement minimal fixe, et un chemin relatif revalidé ici même (en plus des gardes de chemin de l'appelant).
 * L'appelant ne l'invoque qu'après une confirmation humaine explicite.
 */
import { CodedError } from "@warband/core";
import type { DockerApi } from "../docker/api.js";
import { findManaged, WORKSPACE_MOUNT } from "../docker/containers.js";

/** Délai borné d'une suppression en root (démarrage compris). */
export const ROOT_REMOVE_TIMEOUT_MS = 60_000;
const POLL_MS = 200;
/** Environnement de l'exec : constant, jamais celui du serveur. */
export const ROOT_ENV: readonly string[] = [
  "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  "LANG=C.UTF-8",
];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Chemin relatif au DOSSIER PARTAGÉ du conteneur, strict : non vide, relatif, sans segment vide, `.` ni `..`,
 * sans caractère de contrôle. La racine du dossier partagé elle-même (chemin vide) est refusée.
 */
export function checkRootRelPath(relPath: string): string {
  if (
    typeof relPath !== "string" ||
    relPath === "" ||
    relPath.length > 4096 ||
    relPath.startsWith("/") ||
    relPath.includes("\\") ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: les caractères de contrôle sont précisément refusés
    /[\u0000-\u001f\u007f]/.test(relPath)
  )
    throw new CodedError("fs.invalidPath");
  for (const segment of relPath.split("/"))
    if (segment === "" || segment === "." || segment === "..")
      throw new CodedError("fs.invalidPath");
  return relPath;
}

export interface RootRemoveOptions {
  docker: DockerApi;
  /** Nom du conteneur géré (jamais le conteneur du serveur). */
  container: string;
  /** Chemin relatif au dossier partagé du conteneur (`<projet>/<relatif>`). */
  relPath: string;
  selfIds?: readonly string[];
  /** Injectables (tests). */
  timeoutMs?: number;
  pollMs?: number;
}

/**
 * Exécute `rm -rf -- /workspace/<relPath>` en root dans le conteneur, démarré seulement, et attend le code de
 * sortie. Conteneur inconnu ou non géré : `terminal.notManaged`. Arrêté : `fs.rootOwned`. Code ≠ 0, délai ou
 * refus du démon : `fs.rootRemoveFailed`.
 */
export async function removeAsContainerRoot(options: RootRemoveOptions): Promise<void> {
  const rel = checkRootRelPath(options.relPath);
  const { docker } = options;
  const c = await findManaged(docker, options.container, options.selfIds ?? []);
  if (c === null) throw new CodedError("terminal.notManaged");
  if (!c.running) throw new CodedError("fs.rootOwned", { container: c.name });

  const created = await docker.json("POST", `/containers/${encodeURIComponent(c.id)}/exec`, {
    AttachStdin: false,
    AttachStdout: false,
    AttachStderr: false,
    Tty: false,
    User: "root",
    Env: [...ROOT_ENV],
    Cmd: ["rm", "-rf", "--", `${WORKSPACE_MOUNT}/${rel}`],
  });
  if (created.status !== 201 || !isRecord(created.data) || typeof created.data.Id !== "string")
    throw new CodedError("fs.rootRemoveFailed", { status: created.status });
  const execId = encodeURIComponent(created.data.Id);
  const started = await docker.json("POST", `/exec/${execId}/start`, { Detach: true, Tty: false });
  if (started.status !== 200 && started.status !== 201 && started.status !== 204)
    throw new CodedError("fs.rootRemoveFailed", { status: started.status });

  const deadline = Date.now() + (options.timeoutMs ?? ROOT_REMOVE_TIMEOUT_MS);
  for (;;) {
    const res = await docker.json("GET", `/exec/${execId}/json`);
    if (res.status !== 200 || !isRecord(res.data))
      throw new CodedError("fs.rootRemoveFailed", { status: res.status });
    if (res.data.Running !== true) {
      const code = res.data.ExitCode;
      if (code === 0) return;
      throw new CodedError("fs.rootRemoveFailed", { code: typeof code === "number" ? code : -1 });
    }
    if (Date.now() >= deadline) throw new CodedError("fs.rootRemoveFailed", { code: -1 });
    await new Promise((ok) => setTimeout(ok, options.pollMs ?? POLL_MS));
  }
}
