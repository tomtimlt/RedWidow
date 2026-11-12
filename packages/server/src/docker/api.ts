/**
 * Client minimal de l'API Engine Docker sur socket Unix (`node:http`, `socketPath`), sans dépendance
 * (ADR 0053, point 2). Le socket de l'hôte n'est atteint que d'ici, côté serveur : jamais depuis un
 * navigateur ni depuis un conteneur géré. Les erreurs de transport sont codées (`docker.unavailable`) ;
 * un statut HTTP d'erreur est rendu tel quel à l'appelant, qui décide.
 */
import { request } from "node:http";
import type { Duplex } from "node:stream";
import { CodedError } from "@warband/core";

/** Chemin par défaut du socket du démon, monté dans le conteneur du serveur. */
export const DEFAULT_DOCKER_SOCKET = "/var/run/docker.sock";
/** Délai d'un appel ordinaire (connexion, en-têtes et corps). */
export const DOCKER_TIMEOUT_MS = 10_000;
/** Plafond du corps JSON d'une réponse : au-delà, la réponse est refusée. */
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** Socket du démon : `REDWIDOW_DOCKER_SOCKET`, sinon le chemin habituel. */
export function dockerSocketPath(env: Readonly<Record<string, string | undefined>>): string {
  return env.REDWIDOW_DOCKER_SOCKET?.trim() || DEFAULT_DOCKER_SOCKET;
}

export interface DockerResponse {
  status: number;
  /** Corps JSON décodé ; `undefined` s'il est vide ou n'est pas du JSON. */
  data: unknown;
}

/** Flux brut obtenu par détournement de la connexion (exec avec TTY). */
export interface HijackedStream {
  socket: Duplex;
  /** Octets déjà lus après les en-têtes de la réponse (première sortie du TTY). */
  head: Buffer;
}

export interface DockerApi {
  /** Appel JSON. Ne lève que pour le transport (`docker.unavailable`) ; le statut est rendu. */
  json(method: string, path: string, body?: unknown): Promise<DockerResponse>;
  /** Appel `Upgrade: tcp` : la connexion devient le flux du TTY. Statut ≠ 101 : `CodedError`. */
  hijack(path: string, body: unknown): Promise<HijackedStream>;
}

export interface DockerApiOptions {
  socketPath: string;
  timeoutMs?: number;
}

const unavailable = (): CodedError => new CodedError("docker.unavailable");

/** Client de l'API Engine sur le socket `socketPath`. Ne se connecte qu'à l'appel. */
export function createDockerApi(options: DockerApiOptions): DockerApi {
  const timeoutMs = options.timeoutMs ?? DOCKER_TIMEOUT_MS;
  const headersFor = (payload: string | undefined) => ({
    // Docker accepte n'importe quel Host sur le socket Unix.
    Host: "docker",
    ...(payload !== undefined && {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    }),
  });

  return {
    json(method, path, body) {
      return new Promise<DockerResponse>((ok, ko) => {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const req = request(
          { socketPath: options.socketPath, method, path, headers: headersFor(payload) },
          (res) => {
            const chunks: Buffer[] = [];
            let size = 0;
            res.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > MAX_RESPONSE_BYTES) {
                req.destroy();
                ko(unavailable());
                return;
              }
              chunks.push(chunk);
            });
            res.on("end", () => {
              let data: unknown;
              const text = Buffer.concat(chunks).toString("utf8");
              if (text !== "") {
                try {
                  data = JSON.parse(text);
                } catch {
                  data = undefined;
                }
              }
              ok({ status: res.statusCode ?? 0, data });
            });
            res.on("error", () => ko(unavailable()));
          },
        );
        req.setTimeout(timeoutMs, () => req.destroy());
        req.on("error", () => ko(unavailable()));
        req.end(payload);
      });
    },

    hijack(path, body) {
      return new Promise<HijackedStream>((ok, ko) => {
        const payload = JSON.stringify(body);
        const req = request({
          socketPath: options.socketPath,
          method: "POST",
          path,
          headers: { ...headersFor(payload), Connection: "Upgrade", Upgrade: "tcp" },
        });
        req.setTimeout(timeoutMs, () => req.destroy());
        req.on("upgrade", (_res, socket, head) => {
          // Le délai ne vaut que pour l'établissement : le flux vit ensuite aussi longtemps que le shell.
          req.setTimeout(0);
          socket.setTimeout(0);
          ok({ socket, head });
        });
        // Réponse ordinaire au lieu d'un détournement : le démon a refusé (exec introuvable, conteneur arrêté).
        req.on("response", (res) => {
          res.resume();
          ko(new CodedError("terminal.failed", { status: res.statusCode ?? 0 }));
        });
        req.on("error", () => ko(unavailable()));
        req.end(payload);
      });
    },
  };
}
