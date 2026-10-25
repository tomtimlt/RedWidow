/**
 * Contrat minimal avec OpenCode. Les types du SDK 1.19.0 sont en retard sur le
 * binaire (ex. `permission.updated` côté types, `permission.asked` côté
 * binaire) : on n'en dépend pas et on lit les réponses de façon défensive.
 * Ce contrat étroit est aussi ce que les tests remplacent par un faux client.
 */

/** Événement du flux SSE d'OpenCode (`/event`). */
export interface OpencodeEvent {
  type: string;
  properties: Record<string, unknown>;
}

/** Corps d'un tour. `tools` ne contient que des `false` : un `true` créerait une règle « allow ». */
export interface PromptBody {
  text: string;
  model?: { providerID: string; modelID: string };
  variant?: string;
  system?: string;
  tools: Record<string, false>;
}

/** Réponse à une demande de permission : jamais « always », la mémoire reste dans la gate. */
export type PermissionResponse = "once" | "reject";

export interface OpencodeApi {
  /** Configuration effective (`GET /config`), après fusion de toutes les sources. */
  getConfig(signal?: AbortSignal): Promise<Record<string, unknown>>;
  /** Catalogue fourni par OpenCode, sans inférence. */
  listProviders?(signal?: AbortSignal): Promise<unknown>;
  /** Flux d'événements ; s'abonne immédiatement. */
  subscribe(signal: AbortSignal): Promise<AsyncIterable<OpencodeEvent>>;
  createSession(): Promise<string>;
  hasSession(id: string): Promise<boolean>;
  /** Lance un tour sans attendre sa fin (`promptAsync`). */
  prompt(sessionId: string, body: PromptBody): Promise<void>;
  abort(sessionId: string): Promise<void>;
  /** Parties d'un message (pour retrouver l'entrée d'un appel d'outil). */
  messageParts(sessionId: string, messageId: string): Promise<unknown[]>;
  /** Répond à une permission ; renvoie le statut HTTP (2xx = acceptée). */
  reply(request: { id: string; sessionID: string }, response: PermissionResponse): Promise<number>;
  close?(): Promise<void> | void;
}

/** Ce que reçoit `createClient` pour fabriquer un client (ou le faux d'un test). */
export interface ClientInit {
  /** Répertoire de travail du run. */
  directory: string;
  /** Configuration à imposer au serveur (sécurité comprise). */
  config: Record<string, unknown>;
  signal: AbortSignal;
}
