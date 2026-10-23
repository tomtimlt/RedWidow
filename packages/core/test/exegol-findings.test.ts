import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendFinding,
  createExegolTargets,
  type DockerClient,
  exegolToolSpecs,
  readFindings,
  USER_FINDINGS_FILE,
} from "../src/index.js";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function dir() {
  return mkdtemp(join(tmpdir(), "findings-"));
}

async function write(d: string, rows: unknown, projectId = ID) {
  const folder = join(d, "projects", projectId);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, USER_FINDINGS_FILE), JSON.stringify(rows), "utf8");
}

const base = { id: "a", kind: "host", label: "x", state: "confirmed" };

describe("trouvailles Exegol", () => {
  it("relit l'ancien format sans les nouveaux champs", async () => {
    const d = await dir();
    await write(d, [base]);
    expect(await readFindings(d, ID)).toEqual([base]);
  });

  it("conserve tactique, technique et liens à l'aller-retour", async () => {
    const d = await dir();
    const a = await appendFinding(d, ID, { kind: "host", label: "h", state: "confirmed" });
    const b = await appendFinding(d, ID, {
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
    expect((await readFindings(d, ID))[1]).toEqual(b);
  });

  it("n'enregistre pas un from vide", async () => {
    const d = await dir();
    const a = await appendFinding(d, ID, { kind: "host", label: "h", state: "failed", from: [] });
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
      await expect(readFindings(d, ID)).rejects.toMatchObject({ code: "project.invalid" });
    }
  });

  it("refuse à l'ajout un from inconnu", async () => {
    const d = await dir();
    await expect(
      appendFinding(d, ID, { kind: "host", label: "h", state: "confirmed", from: ["absent"] }),
    ).rejects.toMatchObject({ code: "project.invalid" });
  });

  it("isole les trouvailles de deux projets", async () => {
    const d = await dir();
    const a = await appendFinding(d, ID, { kind: "host", label: "h", state: "confirmed" });
    expect(await readFindings(d, OTHER)).toEqual([]);
    expect(await readFindings(d, ID)).toEqual([a]);
  });

  it("refuse un id qui n'est pas un UUID avant toute lecture", async () => {
    const d = await dir();
    await writeFile(join(d, USER_FINDINGS_FILE), JSON.stringify([base]), "utf8");
    await expect(readFindings(d, "..")).rejects.toMatchObject({ code: "project.invalid" });
    await expect(readFindings(d, "../etc/passwd")).rejects.toMatchObject({
      code: "project.invalid",
    });
    await expect(
      appendFinding(d, "pas-un-uuid", { kind: "host", label: "h", state: "confirmed" }),
    ).rejects.toMatchObject({ code: "project.invalid" });
    expect(await readdir(d)).toEqual([USER_FINDINGS_FILE]);
    expect(await readFindings(d, ID)).toEqual([]);
  });

  it("l'outil note sans projectId n'écrit aucun fichier", async () => {
    const root = await dir();
    const prev = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = root;
    try {
      const targets = createExegolTargets();
      const note = exegolToolSpecs({} as DockerClient, targets).find((s) => s.name === "note");
      expect(note).toBeDefined();
      await expect(
        note?.run(
          { kind: "host", label: "h", state: "confirmed", projectId: ID },
          { parentId: null, correlation: undefined, signal: undefined },
        ),
      ).rejects.toMatchObject({ code: "project.absent" });
      expect(await readdir(root)).toEqual([]);
      targets.note("observé", [], ID);
      await note?.run(
        { kind: "host", label: "vu", state: "confirmed", projectId: OTHER },
        { parentId: null, correlation: undefined, signal: undefined },
      );
      expect(await readFindings(join(root, "warband"), ID)).toHaveLength(1);
      expect(await readFindings(join(root, "warband"), OTHER)).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prev;
    }
  });
});
