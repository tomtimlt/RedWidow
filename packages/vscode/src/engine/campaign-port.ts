import {
  type AgentCampaignPort,
  type CampaignRunStatus,
  CodedError,
  type Intent,
  REASON_CODES,
  type ReasonCode,
} from "@warband/core";
import type { CampaignOp, FromEngine, ToEngine } from "../logic/protocol.js";

/** Délai d'une requête de campagne avant erreur codée (ADR 0054, lot 3a). */
export const CAMPAIGN_IPC_TIMEOUT_MS = 30_000;

type CampaignResult = Extract<ToEngine, { type: "campaignResult" }>;

export interface IpcCampaignPortOptions {
  timeoutMs?: number;
  /** Identifiant de requête (défaut : compteur local au port). */
  newId?: () => string;
}

/**
 * Port de campagne côté moteur : chaque appel devient une requête `campaign` vers l'hôte, qui
 * seul tient le coordinateur. `onMessage` enregistre le rappel qui reçoit les `campaignResult`
 * (le moteur les aiguille depuis son canal). Les refus de l'hôte reviennent en `CodedError`.
 */
export function createIpcCampaignPort(
  send: (message: FromEngine) => void,
  onMessage: (handler: (message: CampaignResult) => void) => void,
  options: IpcCampaignPortOptions = {},
): AgentCampaignPort {
  const timeoutMs = options.timeoutMs ?? CAMPAIGN_IPC_TIMEOUT_MS;
  let counter = 0;
  const newId = options.newId ?? (() => `c${++counter}`);
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: unknown) => void; timer: NodeJS.Timeout }
  >();

  onMessage((message) => {
    const entry = pending.get(message.id);
    if (!entry) return; // réponse tardive ou inconnue : sans effet
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) return entry.resolve(message.value);
    const code = message.reason?.code;
    if (code !== undefined && (REASON_CODES as readonly string[]).includes(code))
      return entry.reject(new CodedError(code as ReasonCode, message.reason?.params));
    entry.reject(new CodedError("ipc.invalidMessage", { field: "reason", reason: "invalid" }));
  });

  const call = <T>(op: CampaignOp, args: Record<string, unknown>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = newId();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new CodedError("campaign.ipcTimeout", { op, seconds: timeoutMs / 1000 }));
      }, timeoutMs);
      timer.unref();
      pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      send({ v: 1, type: "campaign", id, op, args });
    });

  return {
    openIntents: (drafts) => call<readonly Intent[]>("openIntents", { drafts: [...drafts] }),
    status: () => call<CampaignRunStatus>("status", {}),
    closeIntent: (closure) => call<Intent>("closeIntent", { closure }),
  };
}
