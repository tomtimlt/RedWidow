import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { matchesFingerprint, sha256File } from "../src/logic/integrity.js";

const dir = mkdtempSync(join(tmpdir(), "warband-integrity-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("empreinte du binaire", () => {
  const file = join(dir, "bin");
  writeFileSync(file, "contenu");
  const hex = createHash("sha256").update("contenu").digest("hex");

  it("calcule le SHA-256", async () => {
    expect(await sha256File(file)).toBe(hex);
    expect(await matchesFingerprint(file, hex)).toBe(true);
  });

  it("refuse un octet modifié, un fichier absent, une empreinte mal formée", async () => {
    const altere = join(dir, "altere");
    writeFileSync(altere, "contenuX");
    expect(await matchesFingerprint(altere, hex)).toBe(false);
    expect(await matchesFingerprint(join(dir, "absent"), hex)).toBe(false);
    expect(await matchesFingerprint(file, "")).toBe(false);
  });
});
