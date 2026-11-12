import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/http.js";

const webDir = fileURLToPath(new URL("../web", import.meta.url));
const server = createServer({ host: "127.0.0.1", port: 0, dataDir: "/tmp/x", webDir });
let base = "";

beforeAll(async () => {
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((ok) => server.close(ok));
});

/** Requête brute : `fetch` normaliserait `/../`. */
async function raw(path: string, method = "GET"): Promise<number> {
  const { request } = await import("node:http");
  return new Promise((ok, ko) => {
    const u = new URL(base);
    const req = request({ host: u.hostname, port: u.port, path, method }, (res) => {
      res.resume();
      ok(res.statusCode ?? 0);
    });
    req.on("error", ko);
    req.end();
  });
}

describe("serveur HTTP", () => {
  it("/healthz répond 200 en JSON", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("sert la page d'accueil et les statiques", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toContain("RedWidow");
    expect((await fetch(`${base}/index.html`)).status).toBe(200);
  });

  it("pose les en-têtes de sécurité sur toute réponse", async () => {
    for (const path of ["/", "/healthz", "/absent"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
    }
  });

  it("refuse la traversée de chemin", async () => {
    for (const p of [
      "/../package.json",
      "/%2e%2e/package.json",
      "/%2e%2e%2fpackage.json",
      "/..%5cpackage.json",
      "/a/../../package.json",
      "/%00",
      "/index.html%00.png",
      "/%zz",
    ]) {
      expect([400, 404], p).toContain(await raw(p));
    }
  });

  it("répond 404 à une route inconnue", async () => {
    expect((await fetch(`${base}/inconnu.html`)).status).toBe(404);
    expect((await fetch(`${base}/package.json`)).status).toBe(404);
  });

  it("répond 405 à POST sur un statique", async () => {
    expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${base}/index.html`, { method: "PUT" })).status).toBe(405);
  });

  it("HEAD n'envoie pas de corps", async () => {
    const res = await fetch(`${base}/`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });
});

describe("loadConfig", () => {
  it("applique les valeurs par défaut", () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ host: "127.0.0.1", port: 8080, dataDir: "/data" });
  });

  it("lit l'environnement", () => {
    const c = loadConfig({ REDWIDOW_HOST: "0.0.0.0", REDWIDOW_PORT: "9000" });
    expect(c).toMatchObject({ host: "0.0.0.0", port: 9000 });
  });

  it("refuse un port invalide", () => {
    for (const p of ["0", "65536", "-1", "abc", "80.5", "1e3"]) {
      expect(() => loadConfig({ REDWIDOW_PORT: p }), p).toThrow(/REDWIDOW_PORT/);
    }
  });
});
