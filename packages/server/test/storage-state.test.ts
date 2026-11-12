import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dataPaths, ensureDataDir } from "../src/storage/paths.js";
import { createStateStore } from "../src/storage/state.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rw-state-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("stockage d'état", () => {
  it("aller-retour, clés, préfixe, suppression", async () => {
    const s = createStateStore(join(dir, "state.json"));
    await s.open();
    s.set("a.x", { n: 1 });
    s.update("a.y", [1, 2]);
    s.set("b", "t");
    expect(s.get("a.x")).toEqual({ n: 1 });
    expect(s.keys("a.").sort()).toEqual(["a.x", "a.y"]);
    expect(s.keys()).toHaveLength(3);
    s.set("b", undefined);
    s.set("a.y", () => 1);
    expect(s.get("b")).toBeUndefined();
    expect(s.keys()).toEqual(["a.x"]);
    await s.flush();
  });

  it("persiste après réouverture", async () => {
    const f = join(dir, "state.json");
    const s = createStateStore(f);
    await s.open();
    s.set("k", { v: [true, null] });
    await s.flush();
    const t = createStateStore(f);
    await t.open();
    expect(t.get("k")).toEqual({ v: [true, null] });
  });

  it("groupe les écritures et ne laisse aucun fichier temporaire", async () => {
    const f = join(dir, "state.json");
    const s = createStateStore(f);
    await s.open();
    for (let i = 0; i < 50; i++) s.set(`k${i}`, i);
    await s.flush();
    expect(await readdir(dir)).toEqual(["state.json"]);
    expect(Object.keys(JSON.parse(await readFile(f, "utf8")))).toHaveLength(50);
  });

  it("notifie les abonnés et permet de se désabonner", async () => {
    const s = createStateStore(join(dir, "state.json"));
    await s.open();
    const seen: unknown[] = [];
    const off = s.subscribe("k", (v) => seen.push(v));
    s.set("k", 1);
    s.set("autre", 2);
    off();
    s.set("k", 3);
    expect(seen).toEqual([1]);
    await s.flush();
  });

  it("met de côté un fichier corrompu et repart vide", async () => {
    const f = join(dir, "state.json");
    await writeFile(f, "{pas du json");
    const s = createStateStore(f);
    await s.open();
    expect(s.keys()).toEqual([]);
    const files = await readdir(dir);
    expect(files.some((n) => n.startsWith("state.json.corrompu-"))).toBe(true);
    s.set("k", 1);
    await s.flush();
    expect(JSON.parse(await readFile(f, "utf8"))).toEqual({ k: 1 });
  });

  it.skipIf(process.platform === "win32")("fichier en 0600, dossiers en 0700", async () => {
    const p = await ensureDataDir(join(dir, "data"));
    expect((await stat(p.root)).mode & 0o777).toBe(0o700);
    expect((await stat(p.runs)).mode & 0o777).toBe(0o700);
    const s = createStateStore(p.state);
    await s.open();
    s.set("k", 1);
    await s.flush();
    expect((await stat(p.state)).mode & 0o777).toBe(0o600);
  });

  it("dataPaths", () => {
    expect(dataPaths("/d")).toMatchObject({ state: "/d/state.json", secrets: "/d/secrets.json" });
  });
});
