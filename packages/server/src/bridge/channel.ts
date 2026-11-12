import { parseWebviewMessage } from "@warband/vscode/logic/approval";
import type { WebSocket } from "ws";
import { decodeEnvelope, encodeEnvelope, type View } from "./envelope.js";
import type { MissionHub, Sink } from "./hub.js";
import { parseShellControl } from "./shell-messages.js";
import { isHostedView } from "./views.js";

export interface BridgeStats {
  /** Messages reçus puis ignorés : enveloppe invalide, vue non branchée, message refusé par la validation. */
  ignored: number;
  /** Messages valides transmis à une session ou à la coquille. */
  accepted: number;
}

export interface Bridge {
  /** À brancher sur `ServerOptions.onConnection` : seuls les sockets authentifiés arrivent ici. */
  onConnection(socket: WebSocket, sessionId: string): void;
  stats(): BridgeStats;
}

/** Plafond d'un identifiant de demande ou de question dans un message de la coquille. */
const MAX_ID = 200;

/**
 * Pont socket ↔ hub (ADR 0052, points 2 et 4). Le socket est déjà authentifié (cookie, Origin) par
 * `attachWebSocket`. Chaque message est décodé, validé, puis routé ; ce qui est invalide est compté
 * et jamais transmis. Une fermeture de socket ne répond à aucune demande.
 */
export function createBridge(hub: MissionHub): Bridge {
  const stats: BridgeStats = { ignored: 0, accepted: 0 };

  return {
    stats: () => ({ ...stats }),
    onConnection(socket) {
      const sink: Sink = {
        send(view: View, frame: string, msg: Record<string, unknown>): void {
          if (socket.readyState !== socket.OPEN) return;
          try {
            socket.send(encodeEnvelope(view, frame, msg));
          } catch {
            // Socket en cours de fermeture : l'événement `close` le retire.
          }
        },
      };
      /** Cadres de chat annoncés par ce socket (`ready`) ; un message sur un autre cadre est ignoré. */
      const frames = new Set<string>();
      let shell = false;

      const ignore = () => void stats.ignored++;

      const onShell = async (frame: string, msg: Record<string, unknown>): Promise<void> => {
        if (msg.type === "ready") {
          if (!shell) hub.subscribeShell(sink);
          shell = true;
          stats.accepted++;
          return;
        }
        if (!shell) return ignore();
        if (msg.type === "approve") {
          // Mêmes validateurs que le chat ; la demande est routée vers la session du cadre de l'enveloppe.
          const parsed = parseWebviewMessage(msg);
          if (
            parsed?.type !== "approve" ||
            !(await hub.approve(frame, parsed.toolUseId, parsed.choice))
          )
            return ignore();
          stats.accepted++;
          return;
        }
        if (
          msg.type === "confirmResult" &&
          Object.keys(msg).length === 3 &&
          typeof msg.id === "string" &&
          msg.id.length <= MAX_ID &&
          typeof msg.accepted === "boolean"
        ) {
          if (!hub.answerConfirm(msg.id, msg.accepted)) return ignore();
          stats.accepted++;
          return;
        }
        // Contrôles (arrêt d'urgence, Bypass, configuration) : validés strictement, jamais de secret en retour global.
        const control = parseShellControl(msg);
        if (control === null || !(await hub.control(control, sink))) return ignore();
        stats.accepted++;
      };

      const onView = async (
        view: View,
        frame: string,
        msg: Record<string, unknown>,
      ): Promise<void> => {
        if (!(await hub.handleView(view, frame, msg, sink))) return ignore();
        stats.accepted++;
      };

      const onTerm = async (frame: string, msg: Record<string, unknown>): Promise<void> => {
        if (!(await hub.handleTerm(frame, msg, sink))) return ignore();
        stats.accepted++;
      };

      const onChat = async (frame: string, msg: Record<string, unknown>): Promise<void> => {
        const message = parseWebviewMessage(msg);
        if (message === null) return ignore();
        if (message.type === "ready") {
          if (!hub.subscribe(frame, sink)) return ignore();
          frames.add(frame);
          stats.accepted++;
          return;
        }
        if (!frames.has(frame)) return ignore();
        if (!(await hub.dispatch(frame, message, sink))) return ignore();
        stats.accepted++;
      };

      socket.on("message", (data, isBinary) => {
        if (isBinary) return ignore();
        const env = decodeEnvelope(data.toString());
        if (env === null) return ignore();
        // Vues non branchées (killchain, viewer) : acceptées par l'enveloppe, ignorées ici.
        const run =
          env.view === "shell"
            ? onShell(env.frame, env.msg)
            : env.view === "chat"
              ? onChat(env.frame, env.msg)
              : env.view === "term"
                ? onTerm(env.frame, env.msg)
                : isHostedView(env.view) || env.view === "studio"
                  ? onView(env.view, env.frame, env.msg)
                  : Promise.resolve(ignore());
        // Une erreur de session ne doit ni couper le serveur ni fuir : on compte, on ne répète rien.
        run.catch(ignore);
      });
      socket.on("close", () => hub.unsubscribe(sink));
    },
  };
}
