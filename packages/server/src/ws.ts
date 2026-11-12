import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { type WebSocket, WebSocketServer } from "ws";
import { originAllowed } from "./auth/origin.js";
import { readSessionCookie, type SessionStore } from "./auth/sessions.js";

/** Taille maximale d'un message entrant (1 Mo). */
export const WS_MAX_PAYLOAD = 1024 * 1024;

export interface WsOptions {
  origin: string;
  sessions: SessionStore;
  /** Appelé pour chaque connexion authentifiée (la logique métier viendra avec le pont moteur). */
  onConnection?: (socket: WebSocket, sessionId: string) => void;
}

/** Refuse l'upgrade : réponse HTTP minimale puis destruction du socket. */
function reject(socket: Duplex, status: 401 | 403 | 404, text: string): void {
  socket.write(
    `HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\nCache-Control: no-store\r\n\r\n`,
  );
  socket.destroy();
}

/**
 * Branche l'upgrade WebSocket sur `/ws` : Origin d'abord, puis session (cookie). À la fin d'une
 * session (révocation, éviction, expiration), ses sockets sont fermés. Renvoie une fonction d'arrêt.
 */
export function attachWebSocket(server: Server, options: WsOptions): () => void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD });
  const bySession = new Map<string, Set<WebSocket>>();

  const offEnd = options.sessions.onEnd((id) => {
    for (const s of bySession.get(id) ?? []) s.close(1008, "session terminée");
    bySession.delete(id);
  });
  // Les sessions expirées sans activité mettent fin à leurs sockets.
  const sweep = setInterval(() => options.sessions.purgeExpired(), 30_000);
  sweep.unref();

  /** Verdict de l'upgrade : identifiant de session, ou statut de refus. */
  const authorize = (req: IncomingMessage): { sessionId: string } | { status: 401 | 403 | 404 } => {
    let pathname = "";
    try {
      pathname = new URL(req.url ?? "/", "http://x").pathname;
    } catch {
      return { status: 404 };
    }
    if (pathname !== "/ws") return { status: 404 };
    if (!originAllowed(req.headers.origin, options.origin)) return { status: 403 };
    const sessionId = options.sessions.validate(readSessionCookie(req.headers.cookie));
    return sessionId === undefined ? { status: 401 } : { sessionId };
  };

  const onUpgrade = (req: IncomingMessage, socket: Duplex): void => {
    socket.on("error", () => socket.destroy());
    const verdict = authorize(req);
    if ("status" in verdict) {
      const text = { 401: "Unauthorized", 403: "Forbidden", 404: "Not Found" }[verdict.status];
      reject(socket, verdict.status, text);
      return;
    }
    const { sessionId } = verdict;
    wss.handleUpgrade(req, socket, Buffer.alloc(0), (ws) => {
      const set = bySession.get(sessionId) ?? new Set<WebSocket>();
      bySession.set(sessionId, set);
      set.add(ws);
      ws.on("close", () => {
        bySession.get(sessionId)?.delete(ws);
      });
      // Un message prolonge la session ; si elle a expiré entre-temps, on coupe.
      ws.on("message", () => {
        if (!options.sessions.touch(sessionId)) ws.close(1008, "session terminée");
      });
      ws.on("error", () => ws.terminate());
      options.onConnection?.(ws, sessionId);
    });
  };
  server.on("upgrade", onUpgrade);

  return () => {
    clearInterval(sweep);
    offEnd();
    server.off("upgrade", onUpgrade);
    for (const set of bySession.values()) for (const s of set) s.terminate();
    bySession.clear();
    wss.close();
  };
}
