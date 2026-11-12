import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStorage } from "../src/storage/index.js";
import { createSecretStore, readSecretKey } from "../src/storage/secrets.js";

const KEY = "k".repeat(40);
let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rw-secrets-"));
  file = join(dir, "secrets.json");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("coffre de secrets", () => {
  it("aller-retour, persistance, suppression, noms seulement", async () => {
    const s = await createSecretStore(file, KEY);
    await s.set("warband.token", "sk-valeur-secrete");
    await s.set("autre", "x");
    expect(await s.get("warband.token")).toBe("sk-valeur-secrete");
    expect(s.keys().sort()).toEqual(["autre", "warband.token"]);
    const t = await createSecretStore(file, KEY);
    expect(await t.get("warband.token")).toBe("sk-valeur-secrete");
    await t.delete("autre");
    expect(await t.get("autre")).toBeUndefined();
    expect(t.keys()).toEqual(["warband.token"]);
  });

  it("n'écrit jamais la valeur en clair", async () => {
    const s = await createSecretStore(file, KEY);
    await s.set("k", "valeur-en-clair-unique");
    const raw = await readFile(file, "utf8");
    expect(raw).not.toContain("valeur-en-clair-unique");
    expect(raw).not.toContain(KEY);
  });

  it.skipIf(process.platform === "win32")("fichier en 0600", async () => {
    await createSecretStore(file, KEY);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("refuse une mauvaise clé maître", async () => {
    await createSecretStore(file, KEY);
    await expect(createSecretStore(file, "z".repeat(40))).rejects.toMatchObject({
      code: "server.secretKeyWrong",
    });
  });

  it("refuse une clé trop courte et un fichier invalide", async () => {
    await expect(createSecretStore(file, "court")).rejects.toMatchObject({
      code: "server.secretKeyTooShort",
    });
    await writeFile(file, "pas du json");
    await expect(createSecretStore(file, KEY)).rejects.toMatchObject({
      code: "server.secretsCorrupt",
    });
  });

  it("refuse une entrée échangée (AAD)", async () => {
    const s = await createSecretStore(file, KEY);
    await s.set("a", "valeur-a");
    await s.set("b", "valeur-b");
    const doc = JSON.parse(await readFile(file, "utf8"));
    doc.entries.b = doc.entries.a;
    await writeFile(file, JSON.stringify(doc));
    const t = await createSecretStore(file, KEY);
    await expect(t.get("b")).rejects.toMatchObject({ code: "server.secretEntryInvalid" });
    expect(await t.get("a")).toBe("valeur-a");
  });

  it("utilise un IV différent à chaque écriture", async () => {
    const s = await createSecretStore(file, KEY);
    await s.set("k", "meme-valeur");
    const e1 = JSON.parse(await readFile(file, "utf8")).entries.k;
    await s.set("k", "meme-valeur");
    const e2 = JSON.parse(await readFile(file, "utf8")).entries.k;
    expect(e1.iv).not.toBe(e2.iv);
    expect(e1.data).not.toBe(e2.data);
  });

  it("réserve le nom témoin", async () => {
    const s = await createSecretStore(file, KEY);
    await expect(s.set("__check", "x")).rejects.toMatchObject({ code: "server.secretNameInvalid" });
  });
});

describe("clé maître et ouverture", () => {
  it("refuse le démarrage sans clé ou avec une clé courte", async () => {
    expect(() => readSecretKey({})).toThrowError(
      expect.objectContaining({ code: "server.secretKeyMissing" }),
    );
    expect(() => readSecretKey({ REDWIDOW_SECRET_KEY: "  " })).toThrowError(
      expect.objectContaining({ code: "server.secretKeyMissing" }),
    );
    expect(() => readSecretKey({ REDWIDOW_SECRET_KEY: "x".repeat(31) })).toThrowError(
      expect.objectContaining({ code: "server.secretKeyTooShort" }),
    );
    expect(readSecretKey({ REDWIDOW_SECRET_KEY: KEY })).toBe(KEY);
  });

  it("openStorage refuse sans clé et ouvre avec", async () => {
    await expect(openStorage(dir, {})).rejects.toMatchObject({ code: "server.secretKeyMissing" });
    const st = await openStorage(dir, { REDWIDOW_SECRET_KEY: KEY });
    st.state.set("k", 1);
    await st.secrets.set("s", "v");
    await st.state.flush();
    const again = await openStorage(dir, { REDWIDOW_SECRET_KEY: KEY });
    expect(again.state.get("k")).toBe(1);
    expect(await again.secrets.get("s")).toBe("v");
  });
});
