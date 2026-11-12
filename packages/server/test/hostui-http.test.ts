import { mkdtemp, readdir, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { HostUi } from "../src/bridge/hostui.js";
import type { Sink } from "../src/bridge/hub.js";
import { DownloadStore, MAX_DOWNLOAD_TOTAL, MAX_DOWNLOADS } from "../src/downloads.js";
import { createServer } from "../src/http.js";
import { UploadStore } from "../src/uploads.js";

const webDir = fileURLToPath(new URL("../web", import.meta.url));
const ORIGIN = "https://chasse.exemple.fr";
const PASSWORD = "un-mot-de-passe-solide";

let dir = "";
let base = "";
let cookie = "";
let srv: ReturnType<typeof createServer>;
let now = 1_000_000;
let uploads: UploadStore;
let downloads: DownloadStore;
let ui: HostUi;
const shell = new Set<Sink>();
const sent: Record<string, unknown>[] = [];
const sink: Sink = { send: (_v, _f, m) => void sent.push(m) };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "rw-hostui-http-"));
  shell.add(sink);
  uploads = new UploadStore({ dir: join(dir, "uploads"), now: () => now, sweepMs: 0 });
  downloads = new DownloadStore({ shell: () => shell, now: () => now, sweepMs: 0 });
  ui = new HostUi({ shell: () => shell, uploads });
  srv = createServer(
    {
      host: "127.0.0.1",
      port: 0,
      dataDir: dir,
      webDir,
      publicOrigin: ORIGIN,
      trustProxy: false,
    },
    { passwordHash: await hashPassword(PASSWORD), files: { ui, uploads, downloads } },
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
  ui.dispose();
  downloads.dispose();
  await uploads.dispose();
  srv.closeAllConnections();
  await new Promise((ok) => srv.close(ok));
  await rm(dir, { recursive: true, force: true });
});

const auth = (extra: Record<string, string> = {}) => ({ Cookie: cookie, Origin: ORIGIN, ...extra });
const files = async () => readdir(join(dir, "uploads")).catch(() => []);

/** Ouvre un dialogue `file` et rend son identifiant. */
function openFile(accept = ["txt", "pdf"], maxBytes = 1024) {
  const p = ui.file({ title: "T", accept, maxBytes });
  const d = sent.filter((m) => m.type === "dialog").at(-1) as { id: string };
  return { p, id: d.id };
}
const up = (id: string, body: string, headers: Record<string, string>) =>
  fetch(`${base}/api/upload?dialog=${id}`, { method: "POST", headers, body });
const octet = (name: string) =>
  auth({ "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(name) });

describe("POST /api/upload", () => {
  it("OK : rattaché au dialogue, résolu par la coquille avec l'identifiant", async () => {
    const { p, id } = openFile();
    const res = await up(id, "bonjour", octet("note é.txt"));
    expect(res.status).toBe(200);
    const info = (await res.json()) as { id: string; name: string; size: number };
    expect(info).toMatchObject({ name: "note é.txt", size: 7 });
    expect(info.id).toMatch(/^up_[0-9a-f]{32}$/);
    expect(ui.answer(id, info.id, sink)).toBe(true);
    await expect(p).resolves.toBe(info.id);
    const taken = uploads.take(info.id);
    expect(taken?.path).toBe(join(dir, "uploads", info.id));
    await taken?.release();
  });

  it("trop gros : 413 (en-tête ou flux), aucun fichier restant", async () => {
    const { p, id } = openFile(["txt"], 10);
    const res = await up(id, "x".repeat(2 * 1024 * 1024), octet("a.txt"));
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "hostui.uploadTooLarge",
    );
    // Sans Content-Length (flux découpé) : coupé en cours de route.
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("x".repeat(8)));
        c.enqueue(new TextEncoder().encode("x".repeat(8)));
        c.close();
      },
    });
    const r2 = await fetch(`${base}/api/upload?dialog=${id}`, {
      method: "POST",
      headers: octet("a.txt"),
      body: stream,
      duplex: "half",
    });
    expect(r2.status).toBe(413);
    expect(await files()).toEqual([]);
    ui.answer(id, null, sink);
    await p;
  });

  it("mauvaise extension : 415 ; mauvais Content-Type : 415", async () => {
    const { p, id } = openFile(["txt"]);
    expect((await up(id, "x", octet("a.exe"))).status).toBe(415);
    expect((await up(id, "x", octet("sans-extension"))).status).toBe(415);
    expect(
      (await up(id, "x", auth({ "Content-Type": "text/plain", "X-Filename": "a.txt" }))).status,
    ).toBe(415);
    expect(await files()).toEqual([]);
    ui.answer(id, null, sink);
    await p;
  });

  it("sans dialogue en attente : 403 ; dialogue d'un autre kind : 403", async () => {
    expect((await up("inconnu", "x", octet("a.txt"))).status).toBe(403);
    const q = ui.confirm({ title: "T", text: "x" });
    const cid = sent.filter((m) => m.type === "dialog").at(-1)?.id as string;
    expect((await up(cid, "x", octet("a.txt"))).status).toBe(403);
    ui.answer(cid, false, sink);
    await q;
    expect((await up("a/b", "x", octet("a.txt"))).status).toBe(400);
    expect(await files()).toEqual([]);
  });

  it("sans session : 401 ; mauvaise Origin : 403 ; sans Origin : 403", async () => {
    const { p, id } = openFile();
    const h = { "Content-Type": "application/octet-stream", "X-Filename": "a.txt" };
    expect((await up(id, "x", { ...h, Origin: ORIGIN })).status).toBe(401);
    expect(
      (await up(id, "x", { ...h, Cookie: cookie, Origin: "https://evil.example" })).status,
    ).toBe(403);
    expect((await up(id, "x", { ...h, Cookie: cookie })).status).toBe(403);
    expect(await files()).toEqual([]);
    ui.answer(id, null, sink);
    await p;
  });

  it("nom piégé : le chemin reste sous le dossier des téléversements", async () => {
    for (const name of ["../x.txt", "a%00b.txt", "..%2F..%2Fetc%2Fpasswd.txt", "%E0%A4%A.txt"]) {
      const { p, id } = openFile();
      const res = await up(id, "x", {
        ...auth({ "Content-Type": "application/octet-stream" }),
        "X-Filename": name,
      });
      expect(res.status).toBe(200);
      const info = (await res.json()) as { id: string; name: string };
      expect(info.name).not.toMatch(/[\\/\0]/);
      expect(ui.answer(id, info.id, sink)).toBe(true);
      await p;
      const t = uploads.take(info.id);
      expect(t?.path).toBe(join(dir, "uploads", info.id));
      await t?.release();
    }
    expect(await files()).toEqual([]);
  });

  it("dialogue annulé pendant l'envoi : plus de fichier", async () => {
    const { p, id } = openFile();
    ui.answer(id, null, sink);
    await p;
    expect((await up(id, "x", octet("a.txt"))).status).toBe(403);
    expect(await files()).toEqual([]);
  });
});

describe("GET /api/download/<id>", () => {
  const get = (id: string, headers = auth()) => fetch(`${base}/api/download/${id}`, { headers });

  it("usage unique, en-têtes, nom assaini, message shell", async () => {
    const id = await downloads.offer({
      filename: '../rapport "été".md',
      mime: "text/markdown",
      body: Buffer.from("# Rapport"),
    });
    expect(id).toMatch(/^dl_[0-9a-f]{32}$/);
    const msg = sent.filter((m) => m.type === "download").at(-1);
    expect(msg).toEqual({ type: "download", id, filename: "rapport _été_.md" });
    const res = await get(id as string);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("# Rapport");
    expect(res.headers.get("content-type")).toBe("text/markdown");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toBe(
      `attachment; filename="rapport___t__.md"; filename*=UTF-8''rapport%20_%C3%A9t%C3%A9_.md`,
    );
    expect((await get(id as string)).status).toBe(404);
  });

  it("sans session : 401, et l'offre n'est pas consommée", async () => {
    const id = (await downloads.offer({
      filename: "a.txt",
      mime: "text/plain",
      body: Buffer.from("x"),
    })) as string;
    expect((await get(id, { Origin: ORIGIN } as never)).status).toBe(401);
    expect((await get(id)).status).toBe(200);
  });

  it("id invalide ou mime piégé", async () => {
    expect((await get("../x")).status).toBe(404);
    const id = (await downloads.offer({
      filename: "a.txt",
      mime: "text/html\r\nX: y",
      body: Buffer.from("x"),
    })) as string;
    expect((await get(id)).headers.get("content-type")).toBe("application/octet-stream");
  });

  it("expire après 5 min (horloge simulée), maxAgeMs plafonné", async () => {
    const a = (await downloads.offer({
      filename: "a.txt",
      mime: "text/plain",
      body: Buffer.from("x"),
    })) as string;
    const b = (await downloads.offer({
      filename: "b.txt",
      mime: "text/plain",
      body: Buffer.from("x"),
      maxAgeMs: 10_000,
    })) as string;
    now += 11_000;
    expect((await get(b)).status).toBe(404);
    expect((await get(a)).status).toBe(200);
    const c = (await downloads.offer({
      filename: "c.txt",
      mime: "text/plain",
      body: Buffer.from("x"),
      maxAgeMs: 3_600_000,
    })) as string;
    now += 5 * 60_000 + 1;
    expect((await get(c)).status).toBe(404);
  });
});

describe("DownloadStore : bornes de mémoire", () => {
  it("50 offres au plus, 64 Mio au total, flux accepté", async () => {
    const s = new DownloadStore({ shell: () => [], sweepMs: 0 });
    const ids: (string | null)[] = [];
    for (let i = 0; i < MAX_DOWNLOADS + 1; i++) {
      ids.push(await s.offer({ filename: "a", mime: "text/plain", body: Buffer.from("x") }));
    }
    expect(ids.slice(0, MAX_DOWNLOADS).every((x) => x !== null)).toBe(true);
    expect(ids[MAX_DOWNLOADS]).toBeNull();
    expect(s.take(ids[0] as string)).toBeDefined();
    expect(
      await s.offer({ filename: "a", mime: "text/plain", body: Buffer.from("x") }),
    ).not.toBeNull();
    s.dispose();

    const t = new DownloadStore({ shell: () => [], sweepMs: 0 });
    const big = Buffer.alloc(MAX_DOWNLOAD_TOTAL / 2);
    const a = await t.offer({ filename: "a", mime: "x/y", body: big });
    const b = await t.offer({ filename: "b", mime: "x/y", body: big });
    expect(a && b).toBeTruthy();
    expect(await t.offer({ filename: "c", mime: "x/y", body: Buffer.from("x") })).toBeNull();
    // Un flux qui dépasse est refusé et rend sa réservation.
    t.take(a as string);
    const stream = (async function* () {
      yield big;
      yield big;
    })();
    expect(await t.offer({ filename: "d", mime: "x/y", body: stream })).toBeNull();
    expect(await t.offer({ filename: "e", mime: "x/y", body: big })).not.toBeNull();
    t.dispose();
  });
});
