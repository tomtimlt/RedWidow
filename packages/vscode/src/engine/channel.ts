import type { FromEngine } from "../logic/protocol.js";
import type { EngineChannel } from "./engine.js";

/** Canal IPC du processus courant (enfant forké) ; sans IPC, le moteur n'a pas de raison d'exister. */
export function processChannel(proc: NodeJS.Process = process): EngineChannel {
  if (typeof proc.send !== "function") throw new Error("moteur lancé sans canal IPC");
  return {
    send: (message: FromEngine) =>
      new Promise<void>((resolve) => {
        try {
          if (!proc.connected) return resolve();
          proc.send?.(message, () => resolve());
        } catch {
          resolve();
        }
      }),
    onMessage: (handler) => void proc.on("message", handler),
    onDisconnect: (handler) => void proc.once("disconnect", handler),
  };
}
