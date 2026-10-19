import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendFinding, readFindings, USER_FINDINGS_FILE } from "../src/index.js";

async function dir() {
  return mkdtemp(join(tmpdir(), "findings-"));
}

async function write(d: string, rows: unknown) {
  await writeFile(join(d, USER_FINDINGS_FILE), JSON.stringify(rows), "utf8");
}

const base = { id: "a", kind: "host", label: "x", state: "confirmed" };

describe("trouvailles Exegol", () => {
  it("relit l'ancien format sans les nouveaux champs", async () => {
    const d = await dir();
    await write(d, [base]);
    expect(await readFindings(d)).toEqual([base]);
  });

  it("conserve tactique, technique et liens à l'aller-retour", async () => {
    const d = await dir();
    const a = await appendFinding(d, { kind: "host", label: "h", state: "confirmed" });
    const b = await appendFinding(d, {
      kind: "credential",
      label: "c",
      state: "hypothesis",
      tactic: "TA0006",
      technique: "T1110.001",
      from: [a.id, a.id],
    });
    expect(b.from).toEqual([a.id]);
    expect(a).not.toHaveProperty("tactic");
    expect(a).not.toHaveProperty("from");
    expect((await readFindings(d))[1]).toEqual(b);
  });

  it("n'enregistre pas un from vide", async () => {
    const d = await dir();
    const a = await appendFinding(d, { kind: "host", label: "h", state: "failed", from: [] });
    expect(a).not.toHaveProperty("from");
  });

  it("refuse en lecture les valeurs invalides", async () => {
    const bad = [
      { tactic: "TA9999" },
      { technique: "1059" },
      { technique: "T1059.1" },
      { from: "a" },
      { from: [] },
      { from: ["1", "2", "3", "4", "5", "6", "7", "8", "9"] },
    ];
    for (const extra of bad) {
      const d = await dir();
      await write(d, [{ ...base, ...extra }]);
      await expect(readFindings(d)).rejects.toMatchObject({ code: "project.invalid" });
    }
  });

  it("refuse à l'ajout un from inconnu", async () => {
    const d = await dir();
    await expect(
      appendFinding(d, { kind: "host", label: "h", state: "confirmed", from: ["absent"] }),
    ).rejects.toMatchObject({ code: "project.invalid" });
  });
});
