import { randomUUID } from "node:crypto";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { appendFinding, createProject, type EngineEvent } from "@warband/core";
import { describe, expect, it, vi } from "vitest";
import { HISTORY_INDEX_KEY } from "../src/bridge/deps.js";
import { MAX_REPLAY_EVENTS, parseViewerMessage } from "../src/bridge/viewer.js";
import {
  emptyBackends,
  type FakeSocket,
  type Msg,
  setup,
  shellOf,
  useStorage,
} from "./bridge-helpers.js";

const ctx = useStorage();
const settle = (ms = 200) => new Promise((ok) => setTimeout(ok, ms));
const SECRET_LABEL = "identifiant-admin-SECRET-77";

type T = ReturnType<typeof setup>;
type Item = Msg & { kind: string; toolUseId?: string; text?: string; output?: string };
const itemsOf = (m: Msg | undefined) => ((m?.view as Msg | undefined)?.items ?? []) as Item[];
const viewers = (s: FakeSocket) => s.of("viewer", "view");

let seq = 0;
const ev = (runId: string, payload: Record<string, unknown>): EngineEvent =>
  ({
    v: 1,
    id: `e${++seq}`,
    seq,
    ts: "2026-03-04T10:00:00.000Z",
    runId,
    parentId: null,
    ...payload,
  }) as unknown as EngineEvent;

const setupViewer = () => setup(ctx, { backends: emptyBackends(), killchainPollMs: 0 });

/** Chat vivant `frame` avec un moteur factice (le test joue les événements). */
async function liveChat(t: T, frame: string) {
  const chat = t.connect();
  chat.say("chat", frame, { type: "ready" });
  chat.say("chat", frame, { type: "send", text: "bonjour" });
  await vi.waitFor(() => expect(t.engine()?.prompts).toHaveLength(1));
  return chat;
}

const toolEvents = (runId: string, toolUseId: string, output: string) => [
  ev(runId, {
    kind: "tool.requested",
    toolUseId,
    tool: "mcp__kali__exec",
    input: { command: `echo ${toolUseId}` },
  }),
  ev(runId, {
    kind: "approval.decided",
    toolUseId,
    decision: "allow",
    source: "user",
    reason: { code: "bash.noRule" },
  }),
  ev(runId, {
    kind: "tool.result",
    toolUseId,
    isError: false,
    output,
    truncated: false,
    bytes: output.length,
  }),
];

const viewerOf = (t: T, frame: string, mode?: string) => {
  const s = shellOf(t);
  s.say("viewer", frame, mode === undefined ? { type: "ready" } : { type: "ready", mode });
  return s;
};

describe("parseViewerMessage", () => {
  it("accepte les formes exactes et refuse le reste", () => {
    expect(parseViewerMessage({ type: "ready" })).toEqual({ type: "ready", mode: "monitor" });
    expect(parseViewerMessage({ type: "ready", mode: "report" })).toEqual({
      type: "ready",
      mode: "report",
    });
    expect(parseViewerMessage({ type: "watch", toolUseId: "toolu_1" })).toEqual({
      type: "watch",
      toolUseId: "toolu_1",
    });
    expect(parseViewerMessage({ type: "exportText", text: "x" })).toEqual({
      type: "exportText",
      text: "x",
    });
    for (const bad of [
      null,
      [],
      { type: "ready", mode: "autre" },
      { type: "ready", extra: 1 },
      { type: "watch" },
      { type: "watch", toolUseId: "" },
      { type: "watch", toolUseId: "a".repeat(201) },
      { type: "watch", toolUseId: "a\u0000b" },
      { type: "watch", toolUseId: "a", extra: 1 },
      { type: "exportText", text: "" },
      { type: "exportText", text: "x".repeat(2_000_001) },
      { type: "exportReport", projectId: "../x" },
      { type: "exportReport", projectId: "00000000-0000-4000-8000-000000000000", extra: 1 },
      { type: "approve", toolUseId: "a", choice: "once" },
    ])
      expect(parseViewerMessage(bad)).toBeNull();
  });
});

describe("vue viewer : Monitor et Sortie sur une session vivante", () => {
  it("suit la session du cadre : appels d'outils, sans capacités ni approbations, mises à jour poussées", async () => {
    const t = setupViewer();
    const chat = await liveChat(t, "f1");
    const handlers = t.engine()?.handlers;
    for (const e of toolEvents("r1", "t1", "résultat un")) handlers?.onEvent?.(e);
    const s = viewerOf(t, "f1");
    await vi.waitFor(() => expect(viewers(s)).toHaveLength(1));
    expect(s.of("viewer", "locale")[0]?.msg).toEqual({ type: "locale", locale: "fr" });
    expect(s.of("viewer", "title")[0]?.msg).toEqual({ type: "title", text: "f1" });
    const first = viewers(s)[0]?.msg as Msg;
    expect(first.chatId).toBe("f1");
    expect(itemsOf(first).map((i) => i.toolUseId)).toEqual(["t1"]);
    expect(itemsOf(first)[0]?.output).toBe("résultat un");
    const view = first.view as Msg;
    expect(view.approvals).toEqual([]);
    expect(view.capabilities).toBeUndefined();
    expect(view.controls).toBeNull();
    // Mise à jour du chat : poussée ; sans changement : rien.
    for (const e of toolEvents("r1", "t2", "résultat deux")) handlers?.onEvent?.(e);
    await vi.waitFor(() => expect(viewers(s)).toHaveLength(2));
    expect(itemsOf(viewers(s)[1]?.msg).map((i) => i.toolUseId)).toEqual(["t1", "t2"]);
    await settle();
    expect(viewers(s)).toHaveLength(2);
    chat.close();
  });

  it("watch restreint la vue à un appel d'outil ; un appel inconnu est ignoré", async () => {
    const t = setupViewer();
    await liveChat(t, "f1");
    const handlers = t.engine()?.handlers;
    for (const e of [...toolEvents("r1", "t1", "un"), ...toolEvents("r1", "t2", "deux")])
      handlers?.onEvent?.(e);
    const s = viewerOf(t, "f1", "watch");
    await vi.waitFor(() => expect(viewers(s)).toHaveLength(1));
    s.say("viewer", "f1", { type: "watch", toolUseId: "t2" });
    await vi.waitFor(() => expect(viewers(s)).toHaveLength(2));
    expect(itemsOf(viewers(s)[1]?.msg).map((i) => i.toolUseId)).toEqual(["t2"]);
    const before = t.bridge.stats().ignored;
    s.say("viewer", "f1", { type: "watch", toolUseId: "inconnu" });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(before + 1));
    expect(viewers(s)).toHaveLength(2);
  });

  it("cadre sans session : vue vide, puis la vue arrive quand la session existe", async () => {
    const t = setupViewer();
    const s = viewerOf(t, "m-abc");
    await vi.waitFor(() => expect(viewers(s)).toHaveLength(1));
    expect(itemsOf(viewers(s)[0]?.msg)).toEqual([]);
    await liveChat(t, "m-abc");
    for (const e of toolEvents("r1", "t9", "sortie")) t.engine()?.handlers.onEvent?.(e);
    await vi.waitFor(() =>
      expect(itemsOf(viewers(s).at(-1)?.msg).map((i) => i.toolUseId)).toEqual(["t9"]),
    );
  });

  it("sans abonné, ou après fermeture du socket : rien n'est envoyé ; messages sans ready ignorés", async () => {
    const t = setupViewer();
    await liveChat(t, "f1");
    const s = viewerOf(t, "f1");
    await vi.waitFor(() => expect(viewers(s)).toHaveLength(1));
    const n = s.sent.length;
    s.close();
    for (const e of toolEvents("r1", "t1", "x")) t.engine()?.handlers.onEvent?.(e);
    await settle();
    expect(s.sent).toHaveLength(n);
    const idle = shellOf(t);
    idle.say("viewer", "f1", { type: "watch", toolUseId: "t1" });
    idle.say("viewer", "f1", { type: "exportText", text: "x" });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBeGreaterThanOrEqual(2));
    expect(idle.of("shell", "download")).toHaveLength(0);
    expect(idle.of("viewer", "view")).toHaveLength(0);
  });
});

describe("vue viewer : journal d'un run terminé", () => {
  const runFile = (id: string) => join(ctx.storage.paths.runs, `${id}.jsonl`);
  const write = async (id: string, lines: unknown[]) => {
    await mkdir(ctx.storage.paths.runs, { recursive: true });
    await writeFile(
      runFile(id),
      `${lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n")}\n`,
    );
  };

  it("affiche le journal en lecture seule (lignes invalides ignorées, appel sans résultat interrompu)", async () => {
    const run = randomUUID();
    await write(run, [
      ev(run, { kind: "run.started", prompt: "p", cwd: "/w" }),
      ...toolEvents(run, "t1", "sortie terminée"),
      "{pas du json",
      ev(run, {
        kind: "tool.requested",
        toolUseId: "t2",
        tool: "mcp__kali__exec",
        input: { command: "sleep 9" },
      }),
    ]);
    const t = setupViewer();
    const s = viewerOf(t, run);
    await vi.waitFor(() => expect(viewers(s)).toHaveLength(1));
    expect(s.of("viewer", "title")[0]?.msg).toEqual({ type: "title", text: run.slice(0, 8) });
    const items = itemsOf(viewers(s)[0]?.msg);
    expect(items.map((i) => i.toolUseId)).toEqual(["t1", "t2"]);
    expect(items[0]).toMatchObject({ status: "ok", output: "sortie terminée" });
    expect(items[1]).toMatchObject({ status: "interrupted" });
    expect(((viewers(s)[0]?.msg ?? {}).view as Msg).busy).toBe(false);
    // Lecture seule : aucune approbation ni contrôle.
    expect(((viewers(s)[0]?.msg ?? {}).view as Msg).approvals).toEqual([]);
  });

  it("borne à 2000 événements", async () => {
    const run = randomUUID();
    const lines = Array.from({ length: MAX_REPLAY_EVENTS + 100 }, (_, i) =>
      ev(run, {
        kind: "tool.requested",
        toolUseId: `t${i + 1}`,
        tool: "mcp__kali__exec",
        input: {},
      }),
    );
    await write(run, lines);
    const t = setupViewer();
    const s = viewerOf(t, run);
    await vi.waitFor(() => expect(viewers(s)).toHaveLength(1));
    const items = itemsOf(viewers(s)[0]?.msg);
    expect(items.at(-1)?.toolUseId).toBe(`t${MAX_REPLAY_EVENTS}`);
  });

  it("identifiant de conversation : relit les runs de l'index d'historique", async () => {
    const run = randomUUID();
    const conversation = randomUUID();
    await write(run, toolEvents(run, "t1", "via conversation"));
    ctx.storage.state.set(HISTORY_INDEX_KEY, [
      {
        id: conversation,
        title: "Conversation",
        createdAt: "2026-03-04T10:00:00.000Z",
        updatedAt: "2026-03-04T10:00:00.000Z",
        runIds: [run],
        tools: 1,
      },
    ]);
    const t = setupViewer();
    const s = viewerOf(t, conversation);
    await vi.waitFor(() => expect(viewers(s)).toHaveLength(1));
    expect(itemsOf(viewers(s)[0]?.msg)[0]).toMatchObject({
      toolUseId: "t1",
      output: "via conversation",
    });
  });

  it("identifiant hors motif UUID, journal absent ou lien symbolique : vue vide, aucun fichier lu", async () => {
    await mkdir(ctx.storage.paths.runs, { recursive: true });
    const secret = join(ctx.dir, "secret.jsonl");
    const run = randomUUID();
    await writeFile(
      secret,
      `${JSON.stringify(ev(run, { kind: "agent.text", text: "CONTENU-HORS-JOURNAUX" }))}\n`,
    );
    const linked = randomUUID();
    await symlink(secret, runFile(linked));
    const t = setupViewer();
    const frames = [
      "etc-passwd-secret",
      `${randomUUID()}-x`,
      "ABCDEF12-0000-0000-0000-000000000000".toUpperCase(),
      randomUUID(),
      linked,
    ];
    const sockets = frames.map((f) => viewerOf(t, f));
    for (const s of sockets)
      await vi.waitFor(() => expect(viewers(s)).toHaveLength(1), { timeout: 3000 });
    for (const s of sockets) expect(itemsOf(viewers(s)[0]?.msg)).toEqual([]);
    expect(JSON.stringify(sockets.map((s) => s.sent))).not.toContain("CONTENU-HORS-JOURNAUX");
    // Un cadre contenant un séparateur de chemin est refusé dès l'enveloppe.
    const bad = shellOf(t);
    const before = t.bridge.stats().ignored;
    bad.say("viewer", `../${run}`, { type: "ready" });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(before + 1));
    expect(bad.of("viewer", "view")).toHaveLength(0);
  });
});

describe("vue viewer : exportText", () => {
  it("offre le texte en téléchargement à l'émetteur (nom selon le mode)", async () => {
    const t = setupViewer();
    for (const [mode, name] of [
      ["monitor", "monitor-warband.txt"],
      ["watch", "sortie-warband.txt"],
    ] as const) {
      const s = viewerOf(t, "f1", mode);
      await vi.waitFor(() => expect(viewers(s)).toHaveLength(1));
      s.say("viewer", "f1", { type: "exportText", text: "ligne un\nligne deux" });
      await vi.waitFor(() => expect(s.of("shell", "download")).toHaveLength(1));
      const d = s.of("shell", "download")[0]?.msg as { id: string; filename: string };
      expect(d.filename).toBe(name);
      const file = t.hub.context.downloads.take(d.id);
      expect(file?.body.toString("utf8")).toBe("ligne un\nligne deux");
      expect(file?.mime).toBe("text/plain");
    }
  });

  it("texte vide ou trop long : ignoré ; mode rapport : ignoré", async () => {
    const t = setupViewer();
    const s = viewerOf(t, "f1", "watch");
    await vi.waitFor(() => expect(viewers(s)).toHaveLength(1));
    const before = t.bridge.stats().ignored;
    s.say("viewer", "f1", { type: "exportText", text: "" });
    s.say("viewer", "f1", { type: "exportText", text: "x".repeat(2_000_001) });
    const r = viewerOf(t, "f1", "report");
    await vi.waitFor(() => expect(viewers(r)).toHaveLength(1));
    r.say("viewer", "f1", { type: "exportText", text: "ok" });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(before + 3));
    expect(s.of("shell", "download")).toHaveLength(0);
    expect(r.of("shell", "download")).toHaveLength(0);
  });
});

describe("vue viewer : Rapport", () => {
  async function project() {
    const configDir = join(ctx.dir, "config");
    await mkdir(configDir, { recursive: true });
    const p = await createProject(configDir, { name: "Mission Rapport", workspace: ctx.dir });
    await appendFinding(configDir, p.id, {
      kind: "host",
      state: "confirmed",
      label: "Hôte 10.0.0.9",
    });
    await appendFinding(configDir, p.id, {
      kind: "credential",
      state: "confirmed",
      label: SECRET_LABEL,
    });
    await appendFinding(configDir, p.id, { kind: "loot", state: "confirmed", label: SECRET_LABEL });
    return { configDir, project: p };
  }

  it("aperçu du projet actif, sans identifiants ni loot", async () => {
    const f = await project();
    const t = setupViewer();
    const s = viewerOf(t, "m-1", "report");
    await vi.waitFor(() => expect(viewers(s)).toHaveLength(1));
    expect(s.of("viewer", "title")).toHaveLength(0);
    const [report] = itemsOf(viewers(s)[0]?.msg) as unknown as {
      kind: string;
      projectId: string;
      findings: { label: string }[];
    }[];
    expect(report).toMatchObject({ kind: "report", projectId: f.project.id });
    expect(report?.findings.map((x) => x.label)).toEqual(["Hôte 10.0.0.9"]);
    expect(JSON.stringify(s.sent)).not.toContain(SECRET_LABEL);
  });

  it("sans projet actif : aperçu vide", async () => {
    const t = setupViewer();
    const s = viewerOf(t, "m-1", "report");
    await vi.waitFor(() => expect(viewers(s)).toHaveLength(1));
    expect(itemsOf(viewers(s)[0]?.msg)).toEqual([]);
  });

  it("exportReport : Markdown du projet actif en téléchargement, sans identifiants ni loot", async () => {
    const f = await project();
    const t = setupViewer();
    const s = viewerOf(t, "m-1", "report");
    await vi.waitFor(() => expect(viewers(s)).toHaveLength(1));
    s.say("viewer", "m-1", { type: "exportReport", projectId: f.project.id });
    await vi.waitFor(() => expect(s.of("shell", "download")).toHaveLength(1));
    const d = s.of("shell", "download")[0]?.msg as { id: string; filename: string };
    expect(d.filename).toMatch(/^rapport-Mission-Rapport-\d{4}-\d{2}-\d{2}\.md$/);
    const file = t.hub.context.downloads.take(d.id);
    expect(file?.mime).toBe("text/markdown");
    const body = file?.body.toString("utf8") ?? "";
    expect(body).toContain("Hôte 10.0.0.9");
    expect(body).not.toContain(SECRET_LABEL);
  });

  it("exportReport d'un autre projet que l'actif, ou depuis le Monitor : aucun téléchargement", async () => {
    const f = await project();
    const other = await createProject(f.configDir, { name: "Autre", workspace: ctx.dir });
    const t = setupViewer();
    const s = viewerOf(t, "m-1", "report");
    await vi.waitFor(() => expect(viewers(s)).toHaveLength(1));
    s.say("viewer", "m-1", { type: "exportReport", projectId: other.id });
    await vi.waitFor(() => expect(s.of("viewer", "error")).toHaveLength(1));
    expect(s.of("viewer", "error")[0]?.msg).toEqual({ type: "error", code: "project.absent" });
    const m = viewerOf(t, "m-1", "monitor");
    await vi.waitFor(() => expect(viewers(m)).toHaveLength(1));
    const before = t.bridge.stats().ignored;
    m.say("viewer", "m-1", { type: "exportReport", projectId: f.project.id });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(before + 1));
    expect(s.of("shell", "download")).toHaveLength(0);
    expect(m.of("shell", "download")).toHaveLength(0);
  });
});
