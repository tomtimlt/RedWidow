import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  type BurpBackend,
  CodedError,
  type IntegrationConfig,
  parseIntegrations,
} from "@warband/core";

/** Transport local de l’extension ; aucune dépendance MCP dans le cœur. */
export function createIntegrationBackend(config: IntegrationConfig): BurpBackend {
  if (!parseIntegrations([config])) throw new CodedError("integration.invalidConfig");
  const origin = `http://127.0.0.1:${config.port}`;
  const url = new URL(config.path, origin);
  const invoke = async <T>(
    signal: AbortSignal | undefined,
    run: (client: Client) => Promise<T>,
  ): Promise<T> => {
    const timeout = AbortSignal.timeout(20_000);
    const abort = new AbortController();
    const signals = [timeout, abort.signal, ...(signal ? [signal] : [])];
    const combined = AbortSignal.any(signals);
    let received = 0;
    const localFetch: typeof fetch = async (input, init) => {
      const target = new URL(input instanceof Request ? input.url : input.toString());
      if (target.origin !== origin || target.username || target.password || target.hash)
        throw new CodedError("integration.invalidResponse");
      const response = await fetch(target, {
        ...init,
        redirect: "error",
        signal: AbortSignal.any([combined, ...(init?.signal ? [init.signal] : [])]),
      });
      const reader = response.body?.getReader();
      if (!reader) return response;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              controller.close();
              return;
            }
            received += next.value.byteLength;
            if (received > 1024 * 1024) {
              await reader.cancel();
              controller.error(new CodedError("integration.invalidResponse"));
              abort.abort();
              return;
            }
            controller.enqueue(next.value);
          } catch (error) {
            controller.error(error);
          }
        },
        cancel: (reason) => reader.cancel(reason),
      });
      return new Response(stream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };
    const client = new Client({ name: "warband-burp", version: "1.0.0" });
    const transport =
      config.transport === "sse"
        ? new SSEClientTransport(url, { fetch: localFetch })
        : new StreamableHTTPClientTransport(url, { fetch: localFetch });
    // Une fermeture sur timeout couvre aussi une initialisation qui ne répond jamais.
    let rejectAbort: (error: Error) => void = () => {};
    const interrupted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const close = () => {
      rejectAbort(
        new CodedError(timeout.aborted ? "integration.timeout" : "integration.unavailable"),
      );
      void client.close().catch(() => undefined);
    };
    combined.addEventListener("abort", close, { once: true });
    try {
      combined.throwIfAborted();
      const operation = async () => {
        // Le SDK déclare sessionId?: string mais le transport HTTP expose string | undefined.
        await client.connect(transport as Parameters<Client["connect"]>[0]);
        combined.throwIfAborted();
        return await run(client);
      };
      return await Promise.race([operation(), interrupted]);
    } catch (error) {
      if (error instanceof CodedError && error.code.startsWith("integration.")) throw error;
      throw new CodedError(timeout.aborted ? "integration.timeout" : "integration.unavailable");
    } finally {
      combined.removeEventListener("abort", close);
      abort.abort();
      await client.close().catch(() => undefined);
    }
  };
  return {
    list: (args, signal) =>
      invoke(signal, (client) =>
        client.listTools(args, { timeout: 15_000, ...(signal && { signal }) }),
      ),
    call: async (args, signal) => {
      const result = await invoke(signal, (client) =>
        client.callTool(args, undefined, { timeout: 15_000, ...(signal && { signal }) }),
      );
      return { content: result.content, isError: result.isError };
    },
  };
}
