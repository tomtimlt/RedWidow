import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hashPassword,
  isValidPasswordHash,
  loadPasswordHash,
  verifyPassword,
} from "../src/auth/password.js";
import { runSetPassword, type SetPasswordIo } from "../src/auth/set-password.js";

const PW = "correct-horse-battery";

describe("mot de passe", () => {
  it("produit le format scrypt attendu et vérifie", async () => {
    const h = await hashPassword(PW);
    expect(h).toMatch(/^scrypt\$32768\$8\$1\$[\w-]{22}\$[\w-]{43}$/);
    expect(await verifyPassword(PW, h)).toBe(true);
    expect(await verifyPassword("autre-mot-de-passe", h)).toBe(false);
    expect(await verifyPassword("", h)).toBe(false);
  });

  it("sale chaque empreinte", async () => {
    expect(await hashPassword(PW)).not.toBe(await hashPassword(PW));
  });

  it("refuse un mot de passe de moins de 12 caractères", async () => {
    await expect(hashPassword("court")).rejects.toMatchObject({ code: "server.passwordTooShort" });
  });

  it("refuse les formats inconnus", async () => {
    const h = await hashPassword(PW);
    const parts = h.split("$");
    const bad = [
      "",
      "bcrypt$x",
      h.replace("scrypt", "argon2"),
      [parts[0], "3", ...parts.slice(2)].join("$"), // N non puissance de 2
      [parts[0], String(2 ** 30), ...parts.slice(2)].join("$"), // N trop grand
      `${h}$extra`,
      h.replace(/\$[^$]+$/, "$@@@"),
    ];
    for (const b of bad) {
      expect(isValidPasswordHash(b), b).toBe(false);
      expect(await verifyPassword(PW, b), b).toBe(false);
    }
  });
});

describe("chargement et set-password", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rw-auth-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const io = (line: string, out: string[] = []): SetPasswordIo => ({
    readHidden: async () => line,
    readLine: async () => line,
    isTTY: false,
    out: (l) => out.push(l),
    err: () => undefined,
  });

  it("refuse de démarrer sans empreinte", async () => {
    await expect(loadPasswordHash(dir, {})).rejects.toMatchObject({
      code: "server.passwordHashMissing",
    });
  });

  it("refuse une empreinte invalide (variable ou fichier)", async () => {
    await expect(
      loadPasswordHash(dir, { REDWIDOW_PASSWORD_HASH: "nimporte" }),
    ).rejects.toMatchObject({ code: "server.passwordHashInvalid" });
    await writeFile(join(dir, "auth.json"), '{"passwordHash":"nimporte"}');
    await expect(loadPasswordHash(dir, {})).rejects.toMatchObject({
      code: "server.passwordHashInvalid",
    });
    await writeFile(join(dir, "auth.json"), "pas du json");
    await expect(loadPasswordHash(dir, {})).rejects.toMatchObject({
      code: "server.passwordHashInvalid",
    });
  });

  it("--stdin écrit auth.json en 0600, vérifiable ensuite", async () => {
    await runSetPassword({ dataDir: dir, stdin: true, print: false }, io(PW));
    const st = await stat(join(dir, "auth.json"));
    expect(st.mode & 0o777).toBe(0o600);
    const hash = await loadPasswordHash(dir, {});
    expect(await verifyPassword(PW, hash)).toBe(true);
    // L'environnement l'emporte sur le fichier.
    const other = await hashPassword("autre-mot-de-passe-12");
    expect(await loadPasswordHash(dir, { REDWIDOW_PASSWORD_HASH: other })).toBe(other);
  });

  it("--print affiche seulement l'empreinte et n'écrit rien", async () => {
    const out: string[] = [];
    await runSetPassword({ dataDir: dir, stdin: true, print: true }, io(PW, out));
    expect(out).toHaveLength(1);
    expect(isValidPasswordHash(out[0] ?? "")).toBe(true);
    await expect(loadPasswordHash(dir, {})).rejects.toMatchObject({
      code: "server.passwordHashMissing",
    });
  });

  it("refuse un mot de passe court, une saisie sans terminal et deux saisies différentes", async () => {
    await expect(
      runSetPassword({ dataDir: dir, stdin: true, print: false }, io("court")),
    ).rejects.toMatchObject({ code: "server.passwordTooShort" });
    await expect(
      runSetPassword({ dataDir: dir, stdin: false, print: false }, io(PW)),
    ).rejects.toMatchObject({ code: "server.passwordNeedsStdin" });
    let n = 0;
    const tty: SetPasswordIo = { ...io(PW), isTTY: true, readHidden: async () => `${PW}${n++}` };
    await expect(
      runSetPassword({ dataDir: dir, stdin: false, print: false }, tty),
    ).rejects.toMatchObject({ code: "server.passwordMismatch" });
  });
});
