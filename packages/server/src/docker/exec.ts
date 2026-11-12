/**
 * Exec Docker avec TTY (ADR 0053, point 2) : create, start détourné (`Upgrade: tcp`), resize, code de
 * sortie. L'environnement de l'exec est une liste blanche fixe : il ne lit jamais celui du serveur.
 */
import { CodedError } from "@warband/core";
import type { DockerApi, HijackedStream } from "./api.js";

/** Environnement de l'exec : TERM et LANG seulement, constants (aucune variable du serveur n'y passe). */
export const SHELL_ENV: readonly string[] = ["TERM=xterm-256color", "LANG=C.UTF-8"];

/** Bash de connexion s'il existe, sinon `sh`. Une seule commande : pas d'aller-retour pour tester. */
export const SHELL_CMD: readonly string[] = [
  "/bin/sh",
  "-c",
  "if [ -x /bin/bash ]; then exec /bin/bash -l; else exec /bin/sh; fi",
];

export interface ExecHandlers {
  onData(chunk: Buffer): void;
  /** Flux terminé (shell sorti, conteneur arrêté ou `close()`), une seule fois. */
  onEnd(): void;
}

export interface ExecShell {
  write(data: string): void;
  resize(cols: number, rows: number): Promise<void>;
  /** Code de sortie du shell, `null` si le démon ne le donne pas. À appeler après `onEnd`. */
  exitCode(): Promise<number | null>;
  /** Ferme le flux (HUP du TTY) ; sans effet s'il est déjà fermé. */
  close(): void;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const MAX_EXIT_POLLS = 5;
const EXIT_POLL_MS = 100;

/** Crée l'exec dans `containerId`, le démarre en flux et applique la taille initiale. */
export async function startShell(
  api: DockerApi,
  containerId: string,
  size: { cols: number; rows: number },
  handlers: ExecHandlers,
): Promise<ExecShell> {
  const created = await api.json("POST", `/containers/${encodeURIComponent(containerId)}/exec`, {
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    Cmd: [...SHELL_CMD],
    Env: [...SHELL_ENV],
  });
  if (created.status !== 201 || !isRecord(created.data) || typeof created.data.Id !== "string")
    throw new CodedError("terminal.failed", { status: created.status });
  const execId = encodeURIComponent(created.data.Id);

  const stream: HijackedStream = await api.hijack(`/exec/${execId}/start`, {
    Detach: false,
    Tty: true,
  });
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    handlers.onEnd();
  };
  stream.socket.on("data", (chunk: Buffer) => handlers.onData(chunk));
  stream.socket.on("end", end);
  stream.socket.on("close", end);
  stream.socket.on("error", end);
  if (stream.head.length > 0) handlers.onData(stream.head);

  const resize = async (cols: number, rows: number): Promise<void> => {
    const res = await api.json("POST", `/exec/${execId}/resize?h=${rows}&w=${cols}`);
    if (res.status !== 200 && res.status !== 201 && res.status !== 204)
      throw new CodedError("terminal.failed", { status: res.status });
  };
  // Le démon n'accepte le redimensionnement qu'une fois l'exec démarré ; un échec ici n'est pas fatal.
  await resize(size.cols, size.rows).catch(() => undefined);

  return {
    write(data) {
      if (!ended && !stream.socket.destroyed) stream.socket.write(data);
    },
    resize,
    async exitCode() {
      for (let i = 0; i < MAX_EXIT_POLLS; i++) {
        const res = await api.json("GET", `/exec/${execId}/json`);
        if (res.status !== 200 || !isRecord(res.data)) return null;
        if (res.data.Running !== true) {
          const code = res.data.ExitCode;
          return typeof code === "number" && Number.isInteger(code) ? code : null;
        }
        await new Promise((ok) => setTimeout(ok, EXIT_POLL_MS));
      }
      return null;
    },
    close() {
      if (!stream.socket.destroyed) stream.socket.destroy();
      end();
    },
  };
}
