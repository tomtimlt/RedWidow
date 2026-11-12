import { mkdir, symlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createProject } from "@warband/core";
import { describe, expect, it, vi } from "vitest";
import { HISTORY_INDEX_KEY } from "../src/bridge/deps.js";
import { MAX_TITLE } from "../src/bridge/lists.js";
import { parseShellControl } from "../src/bridge/shell-messages.js";
import { approval, setup, shellOf, useStorage } from "./bridge-helpers.js";

const ctx = useStorage();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SECRET_LINE = "contenu-secret-du-journal";

const conv = (n: number, extra: Record<string, unknown> = {}) => ({
  id: id(n),
  title: `Mission ${n}`,
  createdAt: new Date(2026, 0, n).toISOString(),
  updatedAt: new Date(2026, 0, n).toISOString(),
  provider: "claude",
  sessionId: null,
  runIds: [],
  tools: 0,
  ...extra,
});

describe("listes de la coquille", () => {
  it("validation des messages", () => {
    expect(parseShellControl({ type: "missionsList" })).toEqual({ type: "missionsList" });
    expect(parseShellControl({ type: "runsList", project: "../x" })).toBeNull();
    expect(parseShellControl({ type: "runsList" })).toEqual({ type: "runsList", project: null });
    expect(parseShellControl({ type: "auditTail", limit: 201 })).toBeNull();
    expect(parseShellControl({ type: "auditTail", limit: 5 })).toEqual({
      type: "auditTail",
      limit: 5,
    });
  });

  it("missions : tri décroissant, titre borné, projet, bornes", async () => {
    const rows = [
      conv(1),
      conv(2, { title: "t".repeat(MAX_TITLE + 50), projectId: id(99), runIds: [id(50)] }),
    ];
    ctx.storage.state.set(HISTORY_INDEX_KEY, rows);
    const t = setup(ctx);
    const shell = shellOf(t);
    shell.say("shell", "shell", { type: "missionsList" });
    await vi.waitFor(() => expect(shell.of("shell", "missions")).toHaveLength(1));
    const items = shell.of("shell", "missions")[0]?.msg.items as Record<string, unknown>[];
    expect(items.map((i) => i.id)).toEqual([id(2), id(1)]);
    expect(items[0]).toMatchObject({
      project: id(99),
      runIds: [id(50)],
      live: false,
      state: "idle",
    });
    expect(String(items[0]?.title).length).toBe(MAX_TITLE);
    expect(items[1]?.project).toBeNull();
  });

  it("runs : métadonnées seulement, noms hors motif ignorés, filtre projet", async () => {
    ctx.storage.state.set(HISTORY_INDEX_KEY, [conv(1, { projectId: id(7), runIds: [id(10)] })]);
    const runs = ctx.storage.paths.runs;
    await mkdir(runs, { recursive: true });
    await writeFile(join(runs, `${id(10)}.jsonl`), `${SECRET_LINE}\n`);
    await writeFile(join(runs, `${id(11)}.jsonl`), "x");
    await writeFile(join(runs, `term-${id(12)}.jsonl`), "yy");
    for (const bad of ["../x.jsonl", "abc.jsonl", `${id(13)}.txt`, "term-zz.jsonl", "audit.jsonl"])
      await writeFile(join(runs, bad.replace("/", "_")), "z");
    await symlink(join(runs, `${id(11)}.jsonl`), join(runs, `${id(14)}.jsonl`));
    await utimes(join(runs, `${id(10)}.jsonl`), new Date(2020, 0, 1), new Date(2020, 0, 1));
    const t = setup(ctx);
    const shell = shellOf(t);
    shell.say("shell", "shell", { type: "runsList" });
    await vi.waitFor(() => expect(shell.of("shell", "runs")).toHaveLength(1));
    const msg = shell.of("shell", "runs")[0]?.msg;
    const items = msg?.items as { id: string; kind: string; project: unknown; size: number }[];
    expect(items.map((i) => i.id).sort()).toEqual([id(10), id(11), id(12)].sort());
    expect(items.find((i) => i.id === id(10))).toMatchObject({ kind: "mission", project: id(7) });
    expect(items.find((i) => i.id === id(12))).toMatchObject({ kind: "terminal", project: null });
    expect(items.find((i) => i.id === id(12))?.size).toBe(2);
    expect(JSON.stringify(msg)).not.toContain(SECRET_LINE);
    shell.say("shell", "shell", { type: "runsList", project: id(7) });
    await vi.waitFor(() => expect(shell.of("shell", "runs")).toHaveLength(2));
    expect(
      ((shell.of("shell", "runs")[1]?.msg.items ?? []) as { id: string }[]).map((i) => i.id),
    ).toEqual([id(10)]);
  });

  it("runs : plafonné à 500 éléments ; dossier absent : configError", async () => {
    const runs = ctx.storage.paths.runs;
    await mkdir(runs, { recursive: true });
    for (let i = 0; i < 510; i++) await writeFile(join(runs, `${id(1000 + i)}.jsonl`), "");
    const t = setup(ctx);
    const shell = shellOf(t);
    shell.say("shell", "shell", { type: "runsList" });
    await vi.waitFor(() => expect(shell.of("shell", "runs")).toHaveLength(1));
    expect(shell.of("shell", "runs")[0]?.msg.items).toHaveLength(500);
  });

  it("projets : id et nom ; erreur de lecture : configError", async () => {
    const configDir = join(ctx.dir, "config");
    await mkdir(configDir, { recursive: true });
    const p = await createProject(configDir, { name: "Cible", workspace: ctx.dir });
    const t = setup(ctx);
    const shell = shellOf(t);
    shell.say("shell", "shell", { type: "projectsList" });
    await vi.waitFor(() => expect(shell.of("shell", "projects")).toHaveLength(1));
    expect(shell.of("shell", "projects")[0]?.msg.items).toEqual([{ id: p.id, name: "Cible" }]);
    await writeFile(join(configDir, "project.json"), "{pas du json");
    shell.say("shell", "shell", { type: "projectsList" });
    await vi.waitFor(() => expect(shell.of("shell", "configError")).toHaveLength(1));
  });

  it("audit : dernières entrées, plus récentes d'abord, sans clé secrète, bornées", async () => {
    const lines = [];
    for (let i = 0; i < 300; i++)
      lines.push(JSON.stringify({ ts: `t${i}`, kind: "x", n: i, token: "SECRET" }));
    lines.push("{ligne tronquée");
    await writeFile(join(ctx.dir, "audit.jsonl"), `${lines.join("\n")}\n`);
    const t = setup(ctx);
    const shell = shellOf(t);
    shell.say("shell", "shell", { type: "auditTail", limit: 3 });
    await vi.waitFor(() => expect(shell.of("shell", "audit")).toHaveLength(1));
    const msg = shell.of("shell", "audit")[0]?.msg;
    expect(((msg?.items ?? []) as { n: number }[]).map((i) => i.n)).toEqual([299, 298, 297]);
    expect(JSON.stringify(msg)).not.toContain("SECRET");
    shell.say("shell", "shell", { type: "auditTail", limit: 200 });
    await vi.waitFor(() => expect(shell.of("shell", "audit")).toHaveLength(2));
    expect(shell.of("shell", "audit")[1]?.msg.items).toHaveLength(200);
    // Fichier absent : liste vide.
    await writeFile(join(ctx.dir, "audit.jsonl"), "");
    shell.say("shell", "shell", { type: "auditTail", limit: 5 });
    await vi.waitFor(() => expect(shell.of("shell", "audit")).toHaveLength(3));
    expect(shell.of("shell", "audit")[2]?.msg.items).toEqual([]);
  });

  it("missionState : en cours, attente d'approbation, reprise ; liste des vivantes", async () => {
    const t = setup(ctx);
    const shell = shellOf(t);
    const chat = t.connect();
    chat.say("chat", "f1", { type: "ready" });
    chat.say("chat", "f1", { type: "send", text: "bonjour" });
    await vi.waitFor(() => expect(t.engine()?.prompts).toHaveLength(1));
    const states = () => shell.of("shell", "missionState").map((e) => e.msg.state);
    await vi.waitFor(() => expect(states().at(-1)).toBe("running"));
    t.engine()?.handlers.onApproval?.(approval("a"));
    await vi.waitFor(() => expect(states().at(-1)).toBe("waiting"));
    shell.say("shell", "f1", { type: "approve", toolUseId: "a", choice: "once" });
    await vi.waitFor(() => expect(states().at(-1)).toBe("running"));
    // Pas de doublon consécutif : un envoi par changement d'état.
    const seq = states();
    expect(seq.filter((s, i) => s === seq[i - 1])).toEqual([]);
    const id = shell.of("shell", "missionState").at(-1)?.msg.id;
    expect(id).toBeTruthy();
    // La liste reflète l'état d'un cadre vivant dont la conversation est indexée.
    ctx.storage.state.set(HISTORY_INDEX_KEY, [conv(5, { id })]);
    shell.say("shell", "shell", { type: "missionsList" });
    await vi.waitFor(() => expect(shell.of("shell", "missions")).toHaveLength(1));
    const items = shell.of("shell", "missions")[0]?.msg.items as Record<string, unknown>[];
    expect(items[0]).toMatchObject({ live: true, state: "running" });
  });
});
