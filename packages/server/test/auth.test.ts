import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { hashPassword } from "../src/auth/password.js";
import { createServer } from "../src/http.js";

const webDir = fileURLToPath(new URL("../web", import.meta.url));
const ORIGIN = "https://chasse.exemple.fr";
const PASSWORD = "un-mot-de-passe-solide";

let hash = "";
let clock = 1_000_000;
const servers: Server[] = [];

beforeAll(async () => {
  hash = await hashPassword(PASSWORD);
});
afterAll(async () => {
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise((ok) => s.close(ok));
  }
});

async function start(onConnection?: (ws: WebSocket, id: string) => void) {
  const server = createServer(
    {
      host: "127.0.0.1",
      port: 0,
      dataDir: "/tmp/x",
      webDir,
      publicOrigin: ORIGIN,
      trustProxy: false,
    },
    { passwordHash: hash, now: () => clock, ...(onConnection && { onConnection }) },
  );
  servers.push(server);
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const login = (base: string, password: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers },
    body: JSON.stringify({ password }),
  });

async function session(base: string): Promise<string> {
  const res = await login(base, PASSWORD);
  expect(res.status).toBe(204);
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

describe("connexion", () => {
  it("bon mot de passe : 204 et cookie complet", async () => {
    const base = await start();
    const res = await login(base, PASSWORD);
    expect(res.status).toBe(204);
    const c = res.headers.get("set-cookie") ?? "";
    expect(c).toMatch(/^__Host-rw_session=[\w-]{43};/);
    for (const attr of ["Path=/", "HttpOnly", "Secure", "SameSite=Strict", "Max-Age=604800"]) {
      expect(c).toContain(attr);
    }
    expect(c).not.toContain("Domain");
  });

  it("mauvais mot de passe : 401 générique", async () => {
    const base = await start();
    const res = await login(base, "mauvais-mot-de-passe");
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.json()).toEqual({ error: { code: "auth.invalidCredentials" } });
  });

  it("deux échecs : 429 avec Retry-After, même pour le bon mot de passe, puis reprise", async () => {
    const base = await start();
    expect((await login(base, "mauvais-mot-de-passe")).status).toBe(401);
    const wait1 = await login(base, PASSWORD);
    expect(wait1.status).toBe(429);
    expect(wait1.headers.get("retry-after")).toBe("1");
    clock += 1000;
    expect((await login(base, "mauvais-mot-de-passe")).status).toBe(401); // 2e échec : 2 s
    const wait2 = await login(base, PASSWORD);
    expect(wait2.status).toBe(429);
    expect(wait2.headers.get("retry-after")).toBe("2");
    clock += 2000;
    expect((await login(base, PASSWORD)).status).toBe(204);
  });

  it("exige JSON, corps ≤ 4 Ko et forme valide", async () => {
    const base = await start();
    const post = (init: RequestInit) =>
      fetch(`${base}/api/login`, {
        method: "POST",
        ...init,
        headers: { Origin: ORIGIN, ...init.headers },
      });
    expect((await post({ body: "x", headers: { "Content-Type": "text/plain" } })).status).toBe(415);
    const json = { "Content-Type": "application/json" };
    expect((await post({ body: "{pas json", headers: json })).status).toBe(400);
    expect((await post({ body: '{"password":1}', headers: json })).status).toBe(400);
    expect(
      (await post({ body: JSON.stringify({ password: "x".repeat(5000) }), headers: json })).status,
    ).toBe(413);
    // Les requêtes mal formées ne comptent pas comme des échecs.
    expect((await login(base, PASSWORD)).status).toBe(204);
  });

  it("limite par IP derrière un proxy de confiance (dernier X-Forwarded-For)", async () => {
    const server = createServer(
      {
        host: "127.0.0.1",
        port: 0,
        dataDir: "/tmp/x",
        webDir,
        publicOrigin: ORIGIN,
        trustProxy: true,
      },
      { passwordHash: hash, now: () => clock },
    );
    servers.push(server);
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect(
      (await login(base, "mauvais-mot-de-passe", { "X-Forwarded-For": "9.9.9.9, 1.1.1.1" })).status,
    ).toBe(401);
    expect((await login(base, PASSWORD, { "X-Forwarded-For": "8.8.8.8, 1.1.1.1" })).status).toBe(
      429,
    );
    expect((await login(base, PASSWORD, { "X-Forwarded-For": "1.1.1.2" })).status).toBe(204);
  });
});

describe("session", () => {
  it("/api/session : 401 sans cookie, 200 avec", async () => {
    const base = await start();
    const no = await fetch(`${base}/api/session`);
    expect(no.status).toBe(401);
    expect(await no.json()).toEqual({ error: { code: "auth.required" } });
    const cookie = await session(base);
    const ok = await fetch(`${base}/api/session`, { headers: { Cookie: cookie } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ authenticated: true });
    expect((await fetch(`${base}/api/session`, { headers: { Cookie: `${cookie}x` } })).status).toBe(
      401,
    );
  });

  it("expire après 12 h d'inactivité (horloge simulée)", async () => {
    const base = await start();
    const cookie = await session(base);
    clock += 11 * 3600_000;
    expect((await fetch(`${base}/api/session`, { headers: { Cookie: cookie } })).status).toBe(200);
    clock += 12 * 3600_000 + 1;
    expect((await fetch(`${base}/api/session`, { headers: { Cookie: cookie } })).status).toBe(401);
  });

  it("logout révoque la session et expire le cookie", async () => {
    const base = await start();
    const cookie = await session(base);
    const out = await fetch(`${base}/api/logout`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: ORIGIN },
    });
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await fetch(`${base}/api/session`, { headers: { Cookie: cookie } })).status).toBe(401);
  });

  it("logout sans session : 401", async () => {
    const base = await start();
    const res = await fetch(`${base}/api/logout`, { method: "POST", headers: { Origin: ORIGIN } });
    expect(res.status).toBe(401);
  });
});

describe("Origin", () => {
  it("refuse toute requête modifiante sans Origin ou avec un mauvais Origin (403)", async () => {
    const base = await start();
    const cookie = await session(base);
    const body = JSON.stringify({ password: PASSWORD });
    const json = { "Content-Type": "application/json" };
    for (const origin of [undefined, "https://evil.example", `${ORIGIN}.evil.example`, "null"]) {
      const h = { ...json, Cookie: cookie, ...(origin && { Origin: origin }) };
      for (const [path, method] of [
        ["/api/login", "POST"],
        ["/api/logout", "POST"],
        ["/", "PUT"],
        ["/api/x", "DELETE"],
      ] as const) {
        const res = await fetch(`${base}${path}`, {
          method,
          headers: h,
          ...(method === "POST" && { body }),
        });
        expect(res.status, `${method} ${path} ${origin}`).toBe(403);
      }
    }
    // La session n'a pas été révoquée par ces refus.
    expect((await fetch(`${base}/api/session`, { headers: { Cookie: cookie } })).status).toBe(200);
  });
});

describe("routes et pages", () => {
  it("publiques : /healthz, /login, /login.js, /assets/*", async () => {
    const base = await start();
    for (const p of ["/healthz", "/login", "/login.js", "/assets/login.css"]) {
      expect((await fetch(`${base}${p}`)).status, p).toBe(200);
    }
  });

  it("police et logo de l'écran de connexion servis sans session (font/woff2, svg)", async () => {
    const base = await start();
    const font = await fetch(`${base}/assets/fonts/geist-latin.woff2`);
    expect(font.status).toBe(200);
    expect(font.headers.get("content-type")).toBe("font/woff2");
    expect((await font.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    const logo = await fetch(`${base}/assets/logo.svg`);
    expect(logo.status).toBe(200);
    expect(logo.headers.get("content-type")).toBe("image/svg+xml");
    // Plus de module d'effets de texte : ni sous /assets, ni dans la coquille.
    expect((await fetch(`${base}/assets/fx.js`)).status).toBe(404);
    expect((await fetch(`${base}/lib/fx.js`, { redirect: "manual" })).status).toBe(302);
  });

  it("page HTML sans session : 302 vers /login ; /api/* : 401", async () => {
    const base = await start();
    for (const p of ["/", "/index.html", "/inconnu"]) {
      const res = await fetch(`${base}${p}`, { redirect: "manual" });
      expect(res.status, p).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    }
    expect((await fetch(`${base}/api/autre`)).status).toBe(401);
  });

  it("CSP avec nonce, différent d'une réponse à l'autre, injecté dans le script", async () => {
    const base = await start();
    const nonces: string[] = [];
    for (let i = 0; i < 2; i++) {
      const res = await fetch(`${base}/login`);
      const csp = res.headers.get("content-security-policy") ?? "";
      const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1] ?? "";
      expect(nonce.length).toBeGreaterThanOrEqual(22);
      expect(csp).toBe(
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'`,
      );
      const html = await res.text();
      expect(html).toContain(`nonce="${nonce}"`);
      expect(html).not.toContain("{{nonce}}");
      expect(html).not.toMatch(/<style|style=|onclick=|<script(?![^>]*src=)/);
      nonces.push(nonce);
    }
    expect(nonces[0]).not.toBe(nonces[1]);
  });
});

describe("WebSocket", () => {
  /** Ouvre une WebSocket et renvoie le statut HTTP de refus, ou « open ». */
  function open(
    base: string,
    headers: Record<string, string>,
  ): Promise<{ status: number | "open"; ws?: WebSocket }> {
    return new Promise((ok) => {
      const ws = new WebSocket(`${base.replace("http", "ws")}/ws`, { headers });
      ws.on("open", () => ok({ status: "open", ws }));
      ws.on("unexpected-response", (_req, res) => {
        res.resume();
        ok({ status: res.statusCode ?? 0 });
      });
      ws.on("error", () => undefined);
    });
  }

  it("refuse sans cookie (401) et avec mauvais Origin (403), accepte avec session", async () => {
    const seen: string[] = [];
    const base = await start((_ws, id) => seen.push(id));
    const cookie = await session(base);
    expect((await open(base, { Origin: ORIGIN })).status).toBe(401);
    expect((await open(base, { Cookie: "__Host-rw_session=faux", Origin: ORIGIN })).status).toBe(
      401,
    );
    expect((await open(base, { Cookie: cookie })).status).toBe(403);
    expect((await open(base, { Cookie: cookie, Origin: "https://evil.example" })).status).toBe(403);
    expect(seen).toHaveLength(0);
    const good = await open(base, { Cookie: cookie, Origin: ORIGIN });
    expect(good.status).toBe("open");
    expect(seen).toHaveLength(1);
    good.ws?.close();
  });

  it("refuse un chemin autre que /ws", async () => {
    const base = await start();
    const cookie = await session(base);
    const status = await new Promise<number>((ok) => {
      const ws = new WebSocket(`${base.replace("http", "ws")}/autre`, {
        headers: { Cookie: cookie, Origin: ORIGIN },
      });
      ws.on("unexpected-response", (_r, res) => {
        res.resume();
        ok(res.statusCode ?? 0);
      });
      ws.on("error", () => undefined);
    });
    expect(status).toBe(404);
  });

  it("ferme les sockets d'une session révoquée", async () => {
    const base = await start();
    const cookie = await session(base);
    const { ws } = await open(base, { Cookie: cookie, Origin: ORIGIN });
    expect(ws).toBeDefined();
    const closed = new Promise<number>((ok) => ws?.on("close", (code) => ok(code)));
    await fetch(`${base}/api/logout`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: ORIGIN },
    });
    expect(await closed).toBe(1008);
  });
});
