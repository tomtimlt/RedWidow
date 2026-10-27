import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { createSdkApi } from "../src/api.js";
import { createOpencodeRunner } from "../src/index.js";
import { harness } from "./helpers.js";

describe("annulation HTTP du catalogue OpenCode", () => {
  it("transmet le statut d'un refus HTTP sans exposer le corps de réponse", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(403, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: "oc_sk_test-secret" }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const api = createSdkApi({
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      directory: process.cwd(),
    });
    try {
      await expect(api.listProviders?.()).rejects.toMatchObject({
        code: "opencode.httpFailed",
        params: { operation: "provider.list", status: 403 },
      });
      await expect(api.getConfig()).rejects.toThrow(/opencode.httpFailed/);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it.each([
    { operation: "catalogue", blocked: "/config" },
    { operation: "catalogue", blocked: "/provider" },
    { operation: "run Auto", blocked: "/config" },
    { operation: "run Auto", blocked: "/provider" },
  ])(
    "interrompt $operation bloqué sur $blocked et ferme le client",
    async ({ operation, blocked }) => {
      let config: Record<string, unknown> = {};
      let reached: () => void = () => undefined;
      const requested = new Promise<void>((resolve) => {
        reached = resolve;
      });
      let disconnected = false;
      const requests: string[] = [];
      const server = createServer((request, response) => {
        const path = new URL(request.url ?? "/", "http://localhost").pathname;
        requests.push(path);
        if (path === blocked) {
          response.on("close", () => {
            disconnected = true;
          });
          reached();
          return;
        }
        response.setHeader("content-type", "application/json");
        if (path === "/config") response.end(JSON.stringify(config));
        else {
          response.statusCode = 500;
          response.end("{}");
        }
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const close = vi.fn(async () => undefined);
      const runner = createOpencodeRunner({
        createClient: (init) => {
          config = init.config;
          return createSdkApi({ baseUrl, directory: init.directory, onClose: close });
        },
      });
      const abort = new AbortController();
      const h = harness();
      const pending =
        operation === "catalogue"
          ? runner.listModels?.({ cwd: process.cwd(), signal: abort.signal })
          : h.run(runner, { model: undefined as never }, abort.signal);
      // Attache le rejet avant l'annulation pour éviter un rejet non observé.
      const settled = Promise.resolve(pending).then(
        (value) => ({ value, rejected: false }),
        () => ({ value: undefined, rejected: true }),
      );
      try {
        await requested;
        abort.abort();
        await vi.waitFor(
          () => {
            expect(close).toHaveBeenCalledOnce();
            expect(disconnected).toBe(true);
          },
          { timeout: 1_000 },
        );
        const result = await settled;
        if (operation === "catalogue") expect(result.rejected).toBe(true);
        else expect(result.value).toMatchObject({ status: "error", turns: 0 });
        expect(requests).toEqual(blocked === "/config" ? ["/config"] : ["/config", "/provider"]);
        expect(h.events.some((event) => event.kind === "session.started")).toBe(false);
      } finally {
        abort.abort();
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
        await settled;
      }
    },
  );
});
