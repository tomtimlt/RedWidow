import { createOpencodeClient } from "@opencode-ai/sdk";
import { CodedError } from "@warband/core";
import type { OpencodeApi, OpencodeEvent } from "./types.js";

type Obj = Record<string, unknown>;

const asObj = (value: unknown): Obj =>
  typeof value === "object" && value !== null ? (value as Obj) : {};

export interface SdkApiOptions {
  baseUrl: string;
  directory: string;
  /** Mot de passe du serveur (HTTP basic, utilisateur `opencode`). */
  password?: string;
  onClose?: () => Promise<void>;
}

/** Client réel : adapte `@opencode-ai/sdk` (API v1) au contrat étroit `OpencodeApi`. */
export function createSdkApi({
  baseUrl,
  directory,
  password,
  onClose,
}: SdkApiOptions): OpencodeApi {
  // L'en-tête va dans la configuration du client : un `fetch` personnalisé n'est pas utilisé par le flux SSE.
  const authorization =
    password === undefined
      ? undefined
      : `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
  const headers = authorization === undefined ? {} : { authorization };
  const client = createOpencodeClient({ baseUrl, directory, headers });

  const failed = (result: { error?: unknown; response?: Response }, what: string) =>
    new CodedError("opencode.httpFailed", {
      operation: what,
      status: result.response?.status ?? 0,
    });

  return {
    async getConfig(signal) {
      const result = await client.config.get(signal === undefined ? {} : { signal });
      if (result.error !== undefined || !result.data) throw failed(result, "config");
      return asObj(result.data);
    },
    async listProviders(signal) {
      const result = await client.provider.list(signal === undefined ? {} : { signal });
      if (result.error !== undefined || !result.data) throw failed(result, "provider.list");
      return result.data;
    },
    async subscribe(signal) {
      const sub = await client.event.subscribe({ signal });
      const stream = sub.stream as AsyncIterable<unknown>;
      return (async function* (): AsyncGenerator<OpencodeEvent> {
        for await (const raw of stream) {
          const event = asObj(raw);
          if (typeof event.type === "string") {
            yield { type: event.type, properties: asObj(event.properties) };
          }
        }
      })();
    },
    async createSession() {
      const result = await client.session.create({ body: {} });
      const id = asObj(result.data).id;
      if (typeof id !== "string") throw failed(result, "session.create");
      return id;
    },
    async hasSession(id) {
      const result = await client.session.get({ path: { id } });
      return result.response?.status === 200 && asObj(result.data).id === id;
    },
    async prompt(sessionId, body) {
      // Le serveur accepte `variant`, encore absent des types du SDK v1.
      const promptBody = {
        parts: [
          { type: "text" as const, text: body.text },
          ...(body.images ?? []).map((image) => ({
            type: "file" as const,
            mime: image.mimeType,
            filename: image.name,
            url: `data:${image.mimeType};base64,${image.data}`,
          })),
        ],
        ...(body.model && { model: body.model }),
        ...(body.variant !== undefined && { variant: body.variant }),
        ...(body.system !== undefined && { system: body.system }),
        tools: body.tools,
      };
      const result = await client.session.promptAsync({
        path: { id: sessionId },
        body: promptBody,
      });
      if (result.error !== undefined) throw failed(result, "prompt");
    },
    async abort(sessionId) {
      await client.session.abort({ path: { id: sessionId } });
    },
    async messageParts(sessionId, messageId) {
      const result = await client.session.message({
        path: { id: sessionId, messageID: messageId },
      });
      const parts = asObj(result.data).parts;
      return Array.isArray(parts) ? parts : [];
    },
    async reply({ id, sessionID }, response) {
      // Route historique (SDK v1) d'abord ; route actuelle (SDK v2) si le serveur ne la connaît plus.
      const legacy = await client.postSessionIdPermissionsPermissionId({
        path: { id: sessionID, permissionID: id },
        body: { response },
      });
      const status = legacy.response?.status ?? 0;
      if (status !== 404 && status !== 405) return status;
      const url = new URL(`/permission/${encodeURIComponent(id)}/reply`, baseUrl);
      url.searchParams.set("directory", directory);
      const next = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ reply: response }),
      });
      return next.status;
    },
    async close() {
      await onClose?.();
    },
  };
}
