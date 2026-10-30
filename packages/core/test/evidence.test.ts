import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEvidence, listEvidence } from "../src/evidence.js";
import {
  appendFinding,
  attachEvidence,
  deleteFinding,
  readFindings,
  updateFinding,
} from "../src/exegol/findings.js";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const input = {
  label: "Capture",
  text: "contenu",
  source: { kind: "editor" as const, reference: "src/main.ts", startLine: 1, endLine: 2 },
};
const dir = () => mkdtemp(join(tmpdir(), "evidence-"));
const path = (d: string) => join(d, "projects", ID, "evidence.json");

describe("preuves explicites", () => {
  it("fusionne deux attaches concurrentes sous verrou et refuse un contexte périmé", async () => {
    const d = await dir();
    const first = await createEvidence(d, ID, input);
    const second = await createEvidence(d, ID, input);
    const finding = await appendFinding(d, ID, {
      kind: "host",
      label: "cible",
      state: "confirmed",
    });
    await Promise.all([
      attachEvidence(d, ID, finding.id, first.id),
      attachEvidence(d, ID, finding.id, second.id),
    ]);
    expect(new Set((await readFindings(d, ID))[0]?.evidenceIds)).toEqual(
      new Set([first.id, second.id]),
    );
    const third = await createEvidence(d, ID, input);
    await expect(
      attachEvidence(d, ID, finding.id, third.id, {
        beforeCommit() {
          throw new Error("projet changé");
        },
      }),
    ).rejects.toThrow("projet changé");
    expect((await readFindings(d, ID))[0]?.evidenceIds).not.toContain(third.id);
    await expect(attachEvidence(d, OTHER, finding.id, first.id)).rejects.toMatchObject({
      code: "finding.notFound",
    });
  });

  it("plafonne et signale l'expansion du masquage aux limites sans bloquer lecture ni migration", async () => {
    const d = await dir();
    const key = "WARBAND_EVIDENCE_EXPANSION_SECRET";
    const previous = process.env[key];
    delete process.env[key];
    try {
      const original = await createEvidence(d, ID, {
        label: "abcdefgh".repeat(25),
        text: "abcdefgh".repeat(2048),
        source: { kind: "tool", reference: "abcdefgh".repeat(128) },
      });
      process.env[key] = "abcdefgh";
      const [safe] = await listEvidence(d, ID);
      expect(safe?.redactionTruncated).toBe(true);
      expect(safe?.label.length).toBeLessThanOrEqual(200);
      expect(safe?.source.reference.length).toBeLessThanOrEqual(1024);
      expect(Buffer.byteLength(safe?.text ?? "")).toBeLessThanOrEqual(16384);
      expect(safe?.text.endsWith("…")).toBe(true);
      expect(JSON.stringify(safe)).not.toContain("abcdefgh");
      expect(safe?.storedSha256).toBe(original.sha256);
      expect(safe?.sha256).toBe(
        createHash("sha256")
          .update(safe?.text ?? "")
          .digest("hex"),
      );
      await createEvidence(d, ID, input);
      const [canonical] = await listEvidence(d, ID);
      expect(canonical?.redactionTruncated).toBe(true);
      expect(canonical?.text).toBe(safe?.text);
      expect(canonical?.sha256).toBe(safe?.sha256);
      expect(canonical).not.toHaveProperty("storedSha256");
      expect(await readFile(path(d), "utf8")).not.toContain("abcdefgh");
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });

  it("remasque les captures quand un secret est ajouté à l'environnement puis migre au prochain ajout", async () => {
    const d = await dir();
    const secret = "ancienne-valeur-devenue-sensible";
    const key = "WARBAND_EVIDENCE_TEST_SECRET";
    const previous = process.env[key];
    delete process.env[key];
    try {
      const original = await createEvidence(d, ID, {
        ...input,
        label: secret,
        text: `capture ${secret}`,
        source: { kind: "tool", reference: secret },
      });
      expect(original.text).toContain(secret);
      process.env[key] = secret;
      const [safe] = await listEvidence(d, ID);
      expect(JSON.stringify(safe)).not.toContain(secret);
      expect(safe?.storedSha256).toBe(original.sha256);
      expect(safe?.sha256).toBe(
        createHash("sha256")
          .update(safe?.text ?? "")
          .digest("hex"),
      );
      await createEvidence(d, ID, input);
      const disk = await readFile(path(d), "utf8");
      expect(disk).not.toContain(secret);
      expect(disk).not.toContain("storedSha256");
      const [canonical] = await listEvidence(d, ID);
      expect(canonical?.sha256).toBe(safe?.sha256);
      expect(canonical).not.toHaveProperty("storedSha256");
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });

  it("refuse les bornes brutes avant qu'un masquage puisse les réduire", async () => {
    const d = await dir();
    const secret = `ghp_${"a".repeat(17000)}`;
    await expect(createEvidence(d, ID, { ...input, text: secret })).rejects.toMatchObject({
      code: "project.invalid",
    });
    await expect(createEvidence(d, ID, { ...input, label: secret })).rejects.toMatchObject({
      code: "project.invalid",
    });
    expect(await readdir(d)).toEqual([]);
  });

  it("masque avant empreinte, stockage et retour ; conserve les lignes et permissions", async () => {
    const d = await dir();
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz1234";
    const row = await createEvidence(d, ID, { ...input, label: secret, text: `token=${secret}` });
    expect(row.label).toBe("[REDACTED]");
    expect(row.text).not.toContain(secret);
    expect(row.sha256).toBe(createHash("sha256").update(row.text).digest("hex"));
    expect(await listEvidence(d, ID)).toEqual([row]);
    expect(await readFile(path(d), "utf8")).not.toContain(secret);
    if (process.platform !== "win32") expect((await stat(path(d))).mode & 0o777).toBe(0o600);
    expect(await listEvidence(d, OTHER)).toEqual([]);
  });

  it("refuse traversées, références absolues et bornes invalides avant écriture", async () => {
    const d = await dir();
    await expect(createEvidence(d, "../escape", input)).rejects.toMatchObject({
      code: "project.invalid",
    });
    await expect(listEvidence(d, "../escape")).rejects.toMatchObject({ code: "project.invalid" });
    for (const reference of [
      "../secret",
      "/etc/passwd",
      "C:\\secret",
      "file:///secret",
      "foo/../secret",
    ]) {
      await expect(
        createEvidence(d, ID, { ...input, source: { kind: "editor", reference } }),
      ).rejects.toMatchObject({ code: "project.invalid" });
    }
    await expect(createEvidence(d, ID, { ...input, text: "é".repeat(8193) })).rejects.toMatchObject(
      { code: "project.invalid" },
    );
    await expect(
      createEvidence(d, ID, { ...input, source: { ...input.source, endLine: 0 } }),
    ).rejects.toMatchObject({ code: "project.invalid" });
    expect(await readdir(d)).toEqual([]);
  });

  it("sérialise les captures concurrentes et annule un contexte périmé sans temporaire", async () => {
    const d = await dir();
    const rows = await Promise.all(
      Array.from({ length: 12 }, (_, i) => createEvidence(d, ID, { ...input, label: `${i}` })),
    );
    expect(await listEvidence(d, ID)).toHaveLength(12);
    expect(new Set(rows.map((r) => r.id)).size).toBe(12);
    await expect(
      createEvidence(d, ID, input, {
        beforeCommit() {
          throw new Error("projet changé");
        },
      }),
    ).rejects.toThrow("projet changé");
    expect(await listEvidence(d, ID)).toHaveLength(12);
    expect(await readdir(join(d, "projects", ID))).toEqual(["evidence.json"]);
  });

  it("refuse JSON malformé, contenu modifié, doublons et secrets non masqués", async () => {
    const d = await dir();
    const row = await createEvidence(d, ID, input);
    for (const value of [
      "{",
      JSON.stringify([{ ...row, text: "altéré" }]),
      JSON.stringify([row, row]),
      JSON.stringify([{ ...row, label: "x".repeat(201) }]),
      JSON.stringify([{ ...row, source: { ...row.source, endLine: -1 } }]),
    ]) {
      await writeFile(path(d), value);
      await expect(listEvidence(d, ID)).rejects.toMatchObject({ code: "project.invalid" });
    }
  });

  it("lie seulement les preuves du projet et préserve les liens à la modification/suppression d'un parent", async () => {
    const d = await dir();
    const proof = await createEvidence(d, ID, input);
    const parent = await appendFinding(d, ID, {
      kind: "host",
      label: "parent",
      state: "confirmed",
    });
    const child = await appendFinding(d, ID, {
      kind: "step",
      label: "password=secret",
      state: "hypothesis",
      from: [parent.id],
      evidenceIds: [proof.id],
    });
    expect(child.label).toBe("password=[REDACTED]");
    expect((await updateFinding(d, ID, child.id, { state: "confirmed" })).evidenceIds).toEqual([
      proof.id,
    ]);
    await deleteFinding(d, ID, parent.id);
    expect((await readFindings(d, ID))[0]?.evidenceIds).toEqual([proof.id]);
    await expect(
      appendFinding(d, OTHER, {
        kind: "host",
        label: "x",
        state: "confirmed",
        evidenceIds: [proof.id],
      }),
    ).rejects.toMatchObject({ code: "project.invalid" });
    await expect(
      updateFinding(d, ID, child.id, { evidenceIds: Array(21).fill(proof.id) }),
    ).rejects.toMatchObject({ code: "project.invalid" });
    expect((await updateFinding(d, ID, child.id, { evidenceIds: [] })).evidenceIds).toBeUndefined();
    expect(await listEvidence(d, ID)).toEqual([proof]);
  });
});
