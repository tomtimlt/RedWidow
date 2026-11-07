import { mkdir, mkdtemp, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { deleteFinding, updateFinding } from "../src/exegol/findings.js";
import {
  appendFinding,
  createExegolTargets,
  type DockerClient,
  exegolToolSpecs,
  readFindings,
  readSummary,
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
    ).rejects.toMatchObject({ code: "finding.parentUnknown", params: { ids: "absent" } });
  });

  it("évince la plus ancienne note et retire les parents orphelins", async () => {
    const d = await dir();
    const first = await appendFinding(d, ID, { kind: "host", label: "n0", state: "confirmed" });
    const child = await appendFinding(d, ID, {
      kind: "step",
      label: "enfant",
      state: "hypothesis",
      from: [first.id],
    });
    await updateFinding(d, ID, child.id, { pathFrom: [first.id] });
    for (let i = 0; i < 199; i++)
      await appendFinding(d, ID, { kind: "host", label: `n${i + 1}`, state: "confirmed" });
    const rows = await readFindings(d, ID);
    expect(rows).toHaveLength(200);
    expect(rows.some((r) => r.id === first.id)).toBe(false);
    const kept = rows.find((r) => r.id === child.id);
    expect(kept).toBeDefined();
    expect(kept).not.toHaveProperty("from");
    expect(kept).not.toHaveProperty("pathFrom");
    const ids = new Set(rows.map((r) => r.id));
    expect(rows.every((r) => (r.from ?? []).every((p) => ids.has(p)))).toBe(true);
  }, 60_000);

  it("refuse pathFrom hors from avec un code dédié, et entrée mal typée sans ZodError", async () => {
    const d = await dir();
    const a = await appendFinding(d, ID, { kind: "host", label: "a", state: "confirmed" });
    const b = await appendFinding(d, ID, { kind: "host", label: "b", state: "confirmed" });
    await expect(updateFinding(d, ID, b.id, { pathFrom: [a.id] })).rejects.toMatchObject({
      code: "finding.pathNotSubset",
      params: { ids: a.id },
    });
    const targets = createExegolTargets();
    targets.note("observé", [], ID);
    const specs = exegolToolSpecs({} as DockerClient, targets);
    const note = specs.find((s) => s.name === "note");
    if (!note) throw new Error("outil absent");
    const ctx = { parentId: null, correlation: undefined, signal: undefined };
    await expect(note.run({ kind: 42, label: "x", state: "confirmed" }, ctx)).rejects.toMatchObject(
      {
        code: "finding.invalidInput",
        params: { field: "kind" },
      },
    );
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

  it("l'outil remember écrit le résumé du projet de la cible, jamais un id fourni", async () => {
    const root = await dir();
    const prev = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = root;
    try {
      const targets = createExegolTargets();
      const remember = exegolToolSpecs({} as DockerClient, targets).find(
        (s) => s.name === "remember",
      );
      expect(remember).toBeDefined();
      const ctx = { parentId: null, correlation: undefined, signal: undefined };
      expect(Object.keys(remember?.input ?? {})).toEqual(["text"]);
      // Sans projet actif : project.absent, aucun fichier.
      await expect(remember?.run({ text: "x", projectId: ID }, ctx)).rejects.toMatchObject({
        code: "project.absent",
      });
      expect(await readdir(root)).toEqual([]);
      targets.note("observé", [], ID);
      await remember?.run({ text: "premier", projectId: OTHER, path: "/etc" }, ctx);
      await remember?.run({ text: "second", projectId: OTHER }, ctx);
      expect(await readSummary(join(root, "warband"), ID)).toBe("second");
      expect(await readSummary(join(root, "warband"), OTHER)).toBe("");
    } finally {
      if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prev;
    }
  });

  it("l'outil note choisit le code de raison selon le drapeau de la cible (ADR 0015)", async () => {
    const run = (blocked?: "invalid" | "readFailed") => {
      const targets = createExegolTargets();
      targets.note("essaie", [], null, blocked);
      const note = exegolToolSpecs({} as DockerClient, targets).find((s) => s.name === "note");
      return note?.run(
        { kind: "host", label: "h", state: "confirmed" },
        { parentId: null, correlation: undefined, signal: undefined },
      );
    };
    await expect(run(undefined)).rejects.toMatchObject({ code: "project.absent" });
    await expect(run("invalid")).rejects.toMatchObject({ code: "project.invalid" });
    await expect(run("readFailed")).rejects.toMatchObject({ code: "project.readFailed" });
  });
});

it("note : titre borné dans le schéma, erreur dédiée et réessai sans perte", async () => {
  const d = await dir();
  const root = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = d;
  try {
    const targets = createExegolTargets();
    targets.note("observation", [], ID);
    const note = exegolToolSpecs({} as DockerClient, targets).find((spec) => spec.name === "note");
    if (!note) throw new Error("outil note absent");
    const ctx = { parentId: null, correlation: undefined, signal: undefined };
    const input = { kind: "step", label: "a".repeat(201), state: "confirmed" };
    expect(z.object(note.input).safeParse(input).success).toBe(false);
    await expect(note.run(input, ctx)).rejects.toMatchObject({
      code: "finding.labelInvalid",
      params: { max: 200 },
    });
    expect(await readdir(d)).toEqual([]);
    await note.run({ ...input, label: "a".repeat(200) }, ctx);
    const saved = await readFindings(join(d, "warband"), ID);
    expect(saved).toHaveLength(1);
    await expect(
      appendFinding(join(d, "warband"), ID, {
        kind: "step",
        label: "b".repeat(201),
        state: "confirmed",
      }),
    ).rejects.toMatchObject({ code: "finding.labelInvalid" });
    expect(await readFindings(join(d, "warband"), ID)).toEqual(saved);
    await note.run(
      { ...input, label: "Sous-domaines — résultats dans /workspace/subfinder_cesi.fr.txt" },
      ctx,
    );
    expect(await readFindings(join(d, "warband"), ID)).toHaveLength(2);
  } finally {
    if (root === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = root;
  }
});

describe("modification des trouvailles", () => {
  it("conserve id et champs omis, modifie les parents et efface les métadonnées", async () => {
    const d = await dir();
    const a = await appendFinding(d, ID, { kind: "host", label: "h", state: "confirmed" });
    const b = await appendFinding(d, ID, {
      kind: "step",
      label: "b",
      state: "hypothesis",
      tactic: "TA0006",
      technique: "T1110",
      from: [a.id],
    });
    expect(await updateFinding(d, ID, b.id, { label: " nouveau " })).toEqual({
      ...b,
      label: "nouveau",
    });
    const saved = await updateFinding(d, ID, b.id, { tactic: null, technique: null, from: [] });
    expect(saved).toEqual({ id: b.id, kind: "step", label: "nouveau", state: "hypothesis" });
    expect((await updateFinding(d, ID, b.id, { from: [a.id] })).from).toEqual([a.id]);
    expect(await readFindings(d, ID)).toEqual([a, { ...saved, from: [a.id] }]);
    expect(
      (await readdir(join(d, "projects", ID))).filter((file) => file.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("refuse références inconnues, soi-même et cycles, puis réessaie sans perte", async () => {
    const d = await dir();
    const a = await appendFinding(d, ID, { kind: "host", label: "a", state: "confirmed" });
    const b = await appendFinding(d, ID, {
      kind: "step",
      label: "b",
      state: "confirmed",
      from: [a.id],
    });
    const before = await readFindings(d, ID);
    for (const from of [["absent"], [a.id], [b.id]]) {
      await expect(updateFinding(d, ID, a.id, { from })).rejects.toMatchObject({
        code: "finding.invalidLinks",
      });
    }
    await expect(updateFinding(d, ID, a.id, { label: "a".repeat(201) })).rejects.toMatchObject({
      code: "finding.labelInvalid",
    });
    await expect(updateFinding(d, OTHER, a.id, { label: "forgé" })).rejects.toMatchObject({
      code: "finding.notFound",
    });
    expect(await readFindings(d, ID)).toEqual(before);
    expect(await updateFinding(d, ID, a.id, { label: "corrigé" })).toEqual({
      ...a,
      label: "corrigé",
    });
    await expect(updateFinding(d, "../", a.id, {})).rejects.toMatchObject({
      code: "project.invalid",
    });
  });

  it("les outils lisent et modifient uniquement le projet actif malgré un projectId forgé", async () => {
    const root = await dir();
    const prev = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = root;
    try {
      const d = join(root, "warband");
      const a = await appendFinding(d, ID, { kind: "host", label: "a", state: "confirmed" });
      const foreign = await appendFinding(d, OTHER, {
        kind: "host",
        label: "secret",
        state: "confirmed",
      });
      const targets = createExegolTargets();
      const specs = exegolToolSpecs({} as DockerClient, targets);
      const list = specs.find((spec) => spec.name === "list_notes");
      const update = specs.find((spec) => spec.name === "update_note");
      if (!list || !update) throw new Error("outils de trouvailles absents");
      const ctx = { parentId: null, correlation: undefined, signal: undefined };
      expect(list.readOnly).toBe(true);
      await expect(list.run({ projectId: OTHER }, ctx)).rejects.toMatchObject({
        code: "project.absent",
      });
      targets.note("observé", [], ID);
      expect(JSON.parse(await list.run({ projectId: OTHER }, ctx))).toEqual([a]);
      await expect(
        update.run({ id: foreign.id, patch: { label: "forgé" }, projectId: OTHER }, ctx),
      ).rejects.toMatchObject({ code: "finding.notFound" });
      await expect(
        update.run({ id: a.id, patch: { label: "a".repeat(201) } }, ctx),
      ).rejects.toMatchObject({ code: "finding.labelInvalid" });
      await update.run({ id: a.id, patch: { label: "corrigé" }, projectId: OTHER }, ctx);
      expect((await readFindings(d, ID))[0]?.label).toBe("corrigé");
      expect(await readFindings(d, OTHER)).toEqual([foreign]);
    } finally {
      if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prev;
    }
  });
});

describe("suppression des trouvailles", () => {
  it("retire un nœud et ses liens directs, conserve les autres parents et l’ordre", async () => {
    const d = await dir();
    const a = { ...base, id: "a" };
    const b = { ...base, id: "b", from: ["a"] };
    const c = { ...base, id: "c", from: ["a", "b"] };
    const e = { ...base, id: "e", from: ["b"] };
    const f = { ...base, id: "f", from: ["e"] };
    await write(d, [a, b, c, e, f]);
    expect(await deleteFinding(d, ID, "b")).toEqual({ removed: b, detachedFrom: ["c", "e"] });
    expect(await readFindings(d, ID)).toEqual([a, { ...c, from: ["a"] }, baseWithId("e"), f]);
    for (const id of ["a", "c", "e", "f"]) await deleteFinding(d, ID, id);
    expect(await readFindings(d, ID)).toEqual([]);
    expect(await readdir(join(d, "projects", ID))).toEqual([USER_FINDINGS_FILE]);
  });

  it("refuse un id absent, ambigu, étranger ou un fichier invalide sans l’altérer", async () => {
    const d = await dir();
    await write(d, [base], OTHER);
    await expect(deleteFinding(d, ID, base.id)).rejects.toMatchObject({ code: "finding.notFound" });
    expect(await readFindings(d, OTHER)).toEqual([base]);
    for (const rows of [[base], [base, base], { invalide: true }]) {
      await write(d, rows);
      const path = join(d, "projects", ID, USER_FINDINGS_FILE);
      const before = await readFile(path, "utf8");
      await expect(
        deleteFinding(d, ID, Array.isArray(rows) && rows.length === 1 ? "../a" : "a"),
      ).rejects.toMatchObject({
        code: Array.isArray(rows) && rows.length === 1 ? "finding.notFound" : "project.invalid",
      });
      expect(await readFile(path, "utf8")).toBe(before);
      expect(await readdir(join(d, "projects", ID))).toEqual([USER_FINDINGS_FILE]);
    }
    await expect(deleteFinding(d, "../", "a")).rejects.toMatchObject({ code: "project.invalid" });
  });

  it("respecte un verrou existant, attend au plus trois secondes et ne le vole pas", async () => {
    const d = await dir();
    await write(d, [base]);
    const lock = join(d, "projects", ID, `${USER_FINDINGS_FILE}.lock`);
    await writeFile(lock, "verrou détenu ailleurs");
    const start = Date.now();
    await expect(deleteFinding(d, ID, "a")).rejects.toMatchObject({ code: "finding.busy" });
    expect(Date.now() - start).toBeLessThan(4_000);
    expect(await readFile(lock, "utf8")).toBe("verrou détenu ailleurs");
    expect(await readFindings(d, ID)).toEqual([base]);
    await unlink(lock);
    await deleteFinding(d, ID, "a");
    expect(await readdir(join(d, "projects", ID))).toEqual([USER_FINDINGS_FILE]);
  });

  it("annule l’attente et la revalidation sans écrire et libère son propre verrou", async () => {
    const d = await dir();
    await write(d, [base]);
    const lock = join(d, "projects", ID, `${USER_FINDINGS_FILE}.lock`);
    await writeFile(lock, "ailleurs");
    const controller = new AbortController();
    const pending = deleteFinding(d, ID, "a", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(await readFile(lock, "utf8")).toBe("ailleurs");
    await unlink(lock);
    await expect(
      deleteFinding(d, ID, "a", {
        beforeCommit: () => {
          throw new Error("contexte changé");
        },
      }),
    ).rejects.toThrow("contexte changé");
    const aborted = new AbortController();
    await expect(
      deleteFinding(d, ID, "a", {
        signal: aborted.signal,
        beforeCommit: async () => {
          expect(
            (await readdir(join(d, "projects", ID))).some((file) => file.endsWith(".tmp")),
          ).toBe(true);
          aborted.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await readFindings(d, ID)).toEqual([base]);
    expect(await readdir(join(d, "projects", ID))).toEqual([USER_FINDINGS_FILE]);
  });

  it("delete_note revalide le projet après l’attente et ne suit jamais une nouvelle cible", async () => {
    const root = await dir();
    const prev = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = root;
    try {
      const d = join(root, "warband");
      await write(d, [base]);
      await write(d, [base], OTHER);
      const targets = createExegolTargets();
      const remove = exegolToolSpecs({} as DockerClient, targets).find(
        (spec) => spec.name === "delete_note",
      );
      if (!remove) throw new Error("outil delete_note absent");
      const lock = join(d, "projects", ID, `${USER_FINDINGS_FILE}.lock`);
      for (const [project, blocked, code] of [
        [OTHER, undefined, "project.invalid"],
        [null, undefined, "project.absent"],
        [null, "invalid", "project.invalid"],
        [null, "readFailed", "project.readFailed"],
      ] as const) {
        targets.note("observé", [], ID);
        await writeFile(lock, "ailleurs");
        const pending = remove.run(
          { id: "a" },
          { parentId: null, correlation: undefined, signal: undefined },
        );
        targets.note("changé", [], project, blocked);
        await unlink(lock);
        await expect(pending).rejects.toMatchObject({ code });
        expect(await readFindings(d, ID)).toEqual([base]);
        expect(await readFindings(d, OTHER)).toEqual([base]);
      }
    } finally {
      if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prev;
    }
  });

  it("propage l’annulation aux trois mutations MCP avant toute écriture", async () => {
    const root = await dir();
    const prev = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = root;
    try {
      const d = join(root, "warband");
      await write(d, [base]);
      const targets = createExegolTargets();
      targets.note("observé", [], ID);
      const specs = exegolToolSpecs({} as DockerClient, targets);
      const controller = new AbortController();
      controller.abort();
      for (const [name, args] of [
        ["note", { kind: "host", label: "nouveau", state: "confirmed" }],
        ["update_note", { id: "a", patch: { label: "modifié" } }],
        ["delete_note", { id: "a" }],
      ] as const) {
        const spec = specs.find((spec) => spec.name === name);
        if (!spec) throw new Error(`outil ${name} absent`);
        await expect(
          spec.run(args, { parentId: null, correlation: undefined, signal: controller.signal }),
        ).rejects.toMatchObject({ name: "AbortError" });
      }
      expect(await readFindings(d, ID)).toEqual([base]);
      expect(await readdir(join(d, "projects", ID))).toEqual([USER_FINDINGS_FILE]);
    } finally {
      if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prev;
    }
  });

  it("delete_note n’accepte que l’id et reste borné au projet actif", async () => {
    const root = await dir();
    const prev = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = root;
    try {
      const d = join(root, "warband");
      await write(d, [base]);
      await write(d, [base], OTHER);
      const targets = createExegolTargets();
      const remove = exegolToolSpecs({} as DockerClient, targets).find(
        (spec) => spec.name === "delete_note",
      );
      if (!remove) throw new Error("outil delete_note absent");
      expect(Object.keys(remove.input)).toEqual(["id"]);
      expect(remove.readOnly).not.toBe(true);
      const ctx = { parentId: null, correlation: undefined, signal: undefined };
      for (const [blocked, code] of [
        [undefined, "project.absent"],
        ["invalid", "project.invalid"],
        ["readFailed", "project.readFailed"],
      ] as const) {
        targets.note("observé", [], null, blocked);
        await expect(remove.run({ id: "a", projectId: OTHER }, ctx)).rejects.toMatchObject({
          code,
        });
      }
      targets.note("observé", [], ID);
      expect(
        JSON.parse(await remove.run({ id: "a", projectId: OTHER, path: "/tmp/forgé" }, ctx)),
      ).toEqual({ removed: base, detachedFrom: [] });
      expect(await readFindings(d, ID)).toEqual([]);
      expect(await readFindings(d, OTHER)).toEqual([base]);
      await expect(remove.run({ id: "a" }, ctx)).rejects.toMatchObject({
        code: "finding.notFound",
      });
    } finally {
      if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prev;
    }
  });
});

function baseWithId(id: string) {
  return { ...base, id };
}
