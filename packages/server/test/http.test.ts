import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/http.js";

const webDir = fileURLToPath(new URL("../web", import.meta.url));
const ORIGIN = "https://chasse.exemple.fr";
const PASSWORD = "un-mot-de-passe-solide";
let base = "";
let cookie = "";
let srv: ReturnType<typeof createServer>;

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  srv = createServer(
    {
      host: "127.0.0.1",
      port: 0,
      dataDir: "/tmp/x",
      webDir,
      publicOrigin: ORIGIN,
      trustProxy: false,
    },
    { passwordHash },
  );
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const res = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ password: PASSWORD }),
  });
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
});
afterAll(async () => {
  srv.closeAllConnections();
  await new Promise((ok) => srv.close(ok));
});

const authed = { headers: () => ({ Cookie: cookie, Origin: ORIGIN }) };

/** Requête brute : `fetch` normaliserait `/../`. */
async function raw(path: string, method = "GET"): Promise<number> {
  const { request } = await import("node:http");
  return new Promise((ok, ko) => {
    const u = new URL(base);
    const req = request(
      { host: u.hostname, port: u.port, path, method, headers: { Cookie: cookie, Origin: ORIGIN } },
      (res) => {
        res.resume();
        ok(res.statusCode ?? 0);
      },
    );
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
    const res = await fetch(`${base}/`, { headers: authed.headers() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toContain("RedWidow");
    expect((await fetch(`${base}/index.html`, { headers: authed.headers() })).status).toBe(200);
  });

  it("pose les en-têtes de sécurité sur toute réponse", async () => {
    for (const path of ["/", "/healthz", "/absent"]) {
      const res = await fetch(`${base}${path}`, { headers: authed.headers(), redirect: "manual" });
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
      expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000");
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
    expect((await fetch(`${base}/inconnu.html`, { headers: authed.headers() })).status).toBe(404);
    expect((await fetch(`${base}/package.json`, { headers: authed.headers() })).status).toBe(404);
  });

  it("répond 405 à POST sur un statique", async () => {
    const init = (method: string) => ({ method, headers: authed.headers() });
    expect((await fetch(`${base}/`, init("POST"))).status).toBe(405);
    expect((await fetch(`${base}/index.html`, init("PUT"))).status).toBe(405);
  });

  it("HEAD n'envoie pas de corps", async () => {
    const res = await fetch(`${base}/`, { method: "HEAD", headers: authed.headers() });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });
});

describe("loadConfig", () => {
  const base0 = { REDWIDOW_PUBLIC_ORIGIN: ORIGIN };

  it("applique les valeurs par défaut", () => {
    const c = loadConfig(base0);
    expect(c).toMatchObject({
      host: "127.0.0.1",
      port: 8080,
      dataDir: "/data",
      publicOrigin: ORIGIN,
      trustProxy: false,
    });
  });

  it("lit l'environnement", () => {
    const c = loadConfig({
      ...base0,
      REDWIDOW_HOST: "0.0.0.0",
      REDWIDOW_PORT: "9000",
      REDWIDOW_TRUST_PROXY: "1",
    });
    expect(c).toMatchObject({ host: "0.0.0.0", port: 9000, trustProxy: true });
  });

  it("refuse l'absence d'origine publique", () => {
    expect(() => loadConfig({})).toThrow(expect.objectContaining({ code: "server.originMissing" }));
    expect(() => loadConfig({ REDWIDOW_PUBLIC_ORIGIN: "ftp://x" })).toThrow(
      expect.objectContaining({ code: "server.originInvalid" }),
    );
  });

  it("normalise l'origine publique", () => {
    expect(loadConfig({ REDWIDOW_PUBLIC_ORIGIN: "https://A.example.fr:443/x" }).publicOrigin).toBe(
      "https://a.example.fr",
    );
  });

  it("refuse un port invalide", () => {
    for (const p of ["0", "65536", "-1", "abc", "80.5", "1e3"]) {
      expect(() => loadConfig({ ...base0, REDWIDOW_PORT: p }), p).toThrow(/REDWIDOW_PORT/);
    }
  });
});
