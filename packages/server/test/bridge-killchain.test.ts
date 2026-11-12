import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  appendFinding,
  attachEvidence,
  createEvidence,
  createProject,
  readFindings,
  setActiveProject,
} from "@warband/core";
import { describe, expect, it, vi } from "vitest";
import { exportFilename } from "../src/bridge/killchain.js";
import {
  emptyBackends,
  type FakeSocket,
  type Msg,
  setup,
  shellOf,
  useStorage,
} from "./bridge-helpers.js";

const ctx = useStorage();
/** Premier message de la liste, ou objet vide (les assertions échouent alors sur leur contenu). */
const first = (list: { msg: Msg }[]): Msg => list[0]?.msg ?? {};
const settle = (ms = 80) => new Promise((ok) => setTimeout(ok, ms));
const SECRET_LABEL = "motdepasse-admin-SECRET-9f3";
const SECRET_TEXT = "preuve-secrete-texte-complet";

type T = ReturnType<typeof setup>;

/** Projet actif avec un hôte (et sa preuve), un site lié, une étape confirmée liée, un identifiant et du loot. */
async function fixture() {
  const configDir = join(ctx.dir, "config");
  await mkdir(configDir, { recursive: true });
  const project = await createProject(configDir, { name: "Mission Éclair", workspace: ctx.dir });
  const evidence = await createEvidence(configDir, project.id, {
    label: "Capture nmap",
    text: SECRET_TEXT,
    source: { kind: "tool", reference: "nmap/scan.txt" },
  });
  const host = await appendFinding(configDir, project.id, {
    kind: "host",
    state: "confirmed",
    label: "Hôte 10.0.0.5",
  });
  await attachEvidence(configDir, project.id, host.id, evidence.id);
  const site = await appendFinding(configDir, project.id, {
    kind: "site",
    state: "hypothesis",
    label: "Site admin",
    from: [host.id],
  });
  const step = await appendFinding(configDir, project.id, {
    kind: "step",
    state: "confirmed",
    label: "Pivot confirmé",
    from: [host.id],
  });
  await appendFinding(configDir, project.id, {
    kind: "credential",
    state: "confirmed",
    label: SECRET_LABEL,
    from: [host.id],
  });
  await appendFinding(configDir, project.id, {
    kind: "loot",
    state: "confirmed",
    label: SECRET_LABEL,
  });
  return { configDir, project, evidence, host, site, step };
}

const connect = (t: T, frame = "kc") => {
  const s = shellOf(t);
  s.say("killchain", frame, { type: "ready" });
  return s;
};
const views = (s: FakeSocket) => s.of("killchain", "view");
const setupKc = () => setup(ctx, { backends: emptyBackends(), killchainPollMs: 20 });

async function answerConfirm(s: FakeSocket, accepted: boolean | null) {
  await vi.waitFor(() => expect(s.of("shell", "dialog").length).toBeGreaterThan(0));
  const d = s.of("shell", "dialog").at(-1)?.msg as Msg;
  s.say("shell", "shell", { type: "dialogResult", id: d.id, value: accepted });
  return d;
}

describe("vue killchain : données", () => {
  it("ready : locale puis vue du projet actif (trouvailles et preuves sans texte)", async () => {
    const f = await fixture();
    const t = setupKc();
    const s = connect(t);
    await vi.waitFor(() => expect(views(s)).toHaveLength(1));
    expect(s.of("killchain", "locale")[0]?.msg).toEqual({ type: "locale", locale: "fr" });
    const v = views(s)[0]?.msg as {
      projectId: string;
      findings: { id: string }[];
      evidence: Msg[];
    };
    expect(v).toMatchObject({ type: "view", page: "killchain", projectId: f.project.id });
    expect(v.findings.map((x) => x.id)).toContain(f.host.id);
    expect(v.evidence).toHaveLength(1);
    expect(v.evidence[0]).toMatchObject({ id: f.evidence.id, label: "Capture nmap" });
    expect(JSON.stringify(s.sent)).not.toContain(SECRET_TEXT);
    expect(views(s)[0]?.frame).toBe("kc");
  });

  it("sans projet : vue vide ; une vue identique n'est pas renvoyée, refresh la renvoie", async () => {
    const t = setupKc();
    const s = connect(t);
    await vi.waitFor(() => expect(views(s)).toHaveLength(1));
    expect(views(s)[0]?.msg).toMatchObject({ projectId: null, findings: [], evidence: [] });
    await settle(120);
    expect(views(s)).toHaveLength(1);
    s.say("killchain", "kc", { type: "refresh" });
    await vi.waitFor(() => expect(views(s)).toHaveLength(2));
  });

  it("modification de findings.json : mise à jour poussée aux abonnés, sans renvoi ensuite", async () => {
    const f = await fixture();
    const t = setupKc();
    const a = connect(t);
    const b = connect(t, "kc2");
    await vi.waitFor(() => expect(views(a)).toHaveLength(1));
    await vi.waitFor(() => expect(views(b)).toHaveLength(1));
    const added = await appendFinding(f.configDir, f.project.id, {
      kind: "host",
      state: "hypothesis",
      label: "Nouvel hôte",
    });
    await vi.waitFor(() => expect(views(a)).toHaveLength(2));
    await vi.waitFor(() => expect(views(b)).toHaveLength(2));
    const v = views(a)[1]?.msg as { findings: { id: string }[] };
    expect(v.findings.map((x) => x.id)).toContain(added.id);
    await settle(120);
    expect(views(a)).toHaveLength(2);
    expect(views(b)[1]?.frame).toBe("kc2");
  });

  it("changement de projet actif : vue du nouveau projet", async () => {
    const f = await fixture();
    const other = await createProject(f.configDir, { name: "Autre", workspace: ctx.dir });
    const t = setupKc();
    const s = connect(t);
    await vi.waitFor(() => expect(views(s)).toHaveLength(1));
    await setActiveProject(f.configDir, other.id);
    await vi.waitFor(() => expect(views(s)).toHaveLength(2));
    expect(views(s)[1]?.msg).toMatchObject({ projectId: other.id, findings: [] });
  });

  it("vue sans abonné ou après fermeture du socket : rien n'est envoyé", async () => {
    const f = await fixture();
    const t = setupKc();
    const s = connect(t);
    await vi.waitFor(() => expect(views(s)).toHaveLength(1));
    const n = s.sent.length;
    s.close();
    await appendFinding(f.configDir, f.project.id, {
      kind: "host",
      state: "hypothesis",
      label: "X",
    });
    await settle(120);
    expect(s.sent).toHaveLength(n);
    // Un socket jamais abonné ne reçoit rien et ses messages sont ignorés.
    const idle = shellOf(t);
    idle.say("killchain", "kc", { type: "refresh" });
    await settle();
    expect(idle.of("killchain", "view")).toHaveLength(0);
    expect(t.bridge.stats().ignored).toBeGreaterThan(0);
  });

  it("messages hors liste ou d'un autre cadre : ignorés", async () => {
    await fixture();
    const t = setupKc();
    const s = connect(t);
    await vi.waitFor(() => expect(views(s)).toHaveLength(1));
    const before = t.bridge.stats().ignored;
    s.say("killchain", "kc", { type: "openCockpit" });
    s.say("killchain", "kc", {
      type: "exportAudit",
      projectId: "00000000-0000-4000-8000-000000000000",
    });
    s.say("killchain", "autre", { type: "refresh" });
    s.say("killchain", "kc", {
      type: "openReport",
      projectId: "00000000-0000-4000-8000-000000000000",
    });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(before + 4));
  });
});

describe("vue killchain : preuve", () => {
  it("openEvidence renvoie le texte borné ; preuve ou projet inconnus : erreur sans texte", async () => {
    const f = await fixture();
    const t = setupKc();
    const s = connect(t);
    await vi.waitFor(() => expect(views(s)).toHaveLength(1));
    s.say("killchain", "kc", { type: "openEvidence", projectId: f.project.id, id: f.evidence.id });
    await vi.waitFor(() => expect(s.of("killchain", "evidenceView")).toHaveLength(1));
    expect(s.of("killchain", "evidenceView")[0]?.msg).toMatchObject({
      id: f.evidence.id,
      text: SECRET_TEXT,
      truncated: false,
      source: { kind: "tool", reference: "nmap/scan.txt" },
    });
    s.say("killchain", "kc", { type: "openEvidence", projectId: f.project.id, id: "inconnue" });
    await vi.waitFor(() => expect(s.of("killchain", "evidenceView")).toHaveLength(2));
    const e = s.of("killchain", "evidenceView")[1]?.msg as Msg;
    expect(typeof e.error).toBe("string");
    expect(e.text).toBeUndefined();
  });
});

describe("vue killchain : setPathEdge", () => {
  it("lien valide : annotation écrite, état sans erreur, vue mise à jour", async () => {
    const f = await fixture();
    const t = setupKc();
    const s = connect(t);
    await vi.waitFor(() => expect(views(s)).toHaveLength(1));
    s.say("killchain", "kc", {
      type: "setPathEdge",
      projectId: f.project.id,
      from: f.host.id,
      to: f.site.id,
      retained: true,
    });
    await vi.waitFor(() => expect(s.of("killchain", "pathEdgeState")).toHaveLength(1));
    expect(s.of("killchain", "pathEdgeState")[0]?.msg).toEqual({
      type: "pathEdgeState",
      projectId: f.project.id,
      from: f.host.id,
      to: f.site.id,
    });
    const rows = await readFindings(f.configDir, f.project.id);
    expect(rows.find((r) => r.id === f.site.id)?.pathFrom).toEqual([f.host.id]);
    await vi.waitFor(() => expect(views(s).length).toBeGreaterThanOrEqual(2));
  });

  it("messages invalides ignorés, sans écriture ; lien inexistant : erreur dans l'état", async () => {
    const f = await fixture();
    const t = setupKc();
    const s = connect(t);
    await vi.waitFor(() => expect(views(s)).toHaveLength(1));
    const ok = {
      type: "setPathEdge",
      projectId: f.project.id,
      from: f.host.id,
      to: f.site.id,
      retained: true,
    };
    const before = t.bridge.stats().ignored;
    for (const bad of [
      { ...ok, projectId: "../etc" },
      { ...ok, from: f.site.id },
      { ...ok, retained: "oui" },
      { ...ok, extra: 1 },
      { ...ok, to: "a\u0000b" },
      { ...ok, from: "" },
    ])
      s.say("killchain", "kc", bad);
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(before + 6));
    expect(s.of("killchain", "pathEdgeState")).toHaveLength(0);
    expect((await readFindings(f.configDir, f.project.id)).some((r) => r.pathFrom)).toBe(false);
    s.say("killchain", "kc", { ...ok, from: f.step.id, to: f.site.id });
    await vi.waitFor(() => expect(s.of("killchain", "pathEdgeState")).toHaveLength(1));
    expect(typeof first(s.of("killchain", "pathEdgeState")).error).toBe("string");
  });

  it("un projet qui n'est pas le projet actif est refusé", async () => {
    const f = await fixture();
    const other = await createProject(f.configDir, { name: "Autre", workspace: ctx.dir });
    const t = setupKc();
    const s = connect(t);
    await vi.waitFor(() => expect(views(s)).toHaveLength(1));
    s.say("killchain", "kc", {
      type: "setPathEdge",
      projectId: other.id,
      from: f.host.id,
      to: f.site.id,
      retained: true,
    });
    await vi.waitFor(() => expect(s.of("killchain", "pathEdgeState")).toHaveLength(1));
    expect(typeof first(s.of("killchain", "pathEdgeState")).error).toBe("string");
  });
});

describe("vue killchain : deleteFinding", () => {
  const del = (f: Awaited<ReturnType<typeof fixture>>, id = f.site.id) => ({
    type: "deleteFinding",
    projectId: f.project.id,
    id,
  });
  const ids = async (f: Awaited<ReturnType<typeof fixture>>) =>
    (await readFindings(f.configDir, f.project.id)).map((r) => r.id);

  it("sans réponse humaine, rien n'est supprimé (la demande reste en attente)", async () => {
    const f = await fixture();
    const t = setupKc();
    const s = connect(t);
    await vi.waitFor(() => expect(views(s)).toHaveLength(1));
    s.say("killchain", "kc", del(f));
    const d = await vi.waitFor(() => {
      const dialog = s.of("shell", "dialog")[0]?.msg as Msg;
      expect(dialog).toMatchObject({ kind: "confirm", danger: true });
      return dialog;
    });
    expect(String(d.text)).toContain("Site admin");
    await settle(120);
    expect(await ids(f)).toContain(f.site.id);
    expect(s.of("killchain", "findingDeleteState").map((m) => m.msg.busy)).toEqual([true]);
  });

  it("refus ou annulation : rien n'est supprimé, état sans erreur", async () => {
    const f = await fixture();
    const t = setupKc();
    const s = connect(t);
    await vi.waitFor(() => expect(views(s)).toHaveLength(1));
    s.say("killchain", "kc", del(f));
    await answerConfirm(s, false);
    await vi.waitFor(() => expect(s.of("killchain", "findingDeleteState")).toHaveLength(2));
    expect(s.of("killchain", "findingDeleteState")[1]?.msg).toEqual({
      type: "findingDeleteState",
      projectId: f.project.id,
      id: f.site.id,
      busy: false,
    });
    expect(await ids(f)).toContain(f.site.id);
  });

  it("acceptation : trouvailles supprimée, vue mise à jour, audit sans contenu", async () => {
    const f = await fixture();
    const t = setupKc();
    const s = connect(t);
    await vi.waitFor(() => expect(views(s)).toHaveLength(1));
    s.say("killchain", "kc", del(f));
    await answerConfirm(s, true);
    await vi.waitFor(() => expect(s.of("killchain", "findingDeleteState")).toHaveLength(2));
    expect(await ids(f)).not.toContain(f.site.id);
    await vi.waitFor(() => expect(views(s).length).toBeGreaterThanOrEqual(2));
    const last = views(s).at(-1)?.msg as { findings: { id: string }[] };
    expect(last.findings.map((x) => x.id)).not.toContain(f.site.id);
    expect(t.audit.some((e) => e.kind === "killchain.deleteFinding" && e.id === f.site.id)).toBe(
      true,
    );
    expect(JSON.stringify(t.audit)).not.toContain("Site admin");
  });

  it("projet inactif ou trouvaille inconnue : erreur, aucune confirmation demandée", async () => {
    const f = await fixture();
    const other = await createProject(f.configDir, { name: "Autre", workspace: ctx.dir });
    const t = setupKc();
    const s = connect(t);
    await vi.waitFor(() => expect(views(s)).toHaveLength(1));
    s.say("killchain", "kc", { ...del(f), projectId: other.id });
    s.say("killchain", "kc", del(f, "absente"));
    await vi.waitFor(() =>
      expect(
        s.of("killchain", "findingDeleteState").filter((m) => typeof m.msg.error === "string"),
      ).toHaveLength(2),
    );
    expect(s.of("shell", "dialog")).toHaveLength(0);
    expect(await ids(f)).toContain(f.site.id);
  });
});

describe("vue killchain : exports", () => {
  async function exported(s: FakeSocket, t: T, type: string, projectId: string, count = 1) {
    s.say("killchain", "kc", { type, projectId });
    await vi.waitFor(() => expect(s.of("shell", "download")).toHaveLength(count));
    const d = s.of("shell", "download")[count - 1]?.msg as { id: string; filename: string };
    const file = t.hub.context.downloads.take(d.id);
    expect(file).toBeDefined();
    return { file: file as NonNullable<typeof file>, filename: d.filename };
  }

  it("exportKillchain : SVG autonome, sans identifiant ni loot", async () => {
    const f = await fixture();
    const t = setupKc();
    const s = connect(t);
    await vi.waitFor(() => expect(views(s)).toHaveLength(1));
    const { file, filename } = await exported(s, t, "exportKillchain", f.project.id);
    const body = file.body.toString("utf8");
    expect(file.mime).toBe("image/svg+xml");
    expect(filename).toMatch(/^killchain-Mission-E-clair-\d{4}-\d{2}-\d{2}\.svg$/);
    expect(body).toContain("<svg");
    expect(body).toContain("Hôte 10.0.0.5");
    expect(body).not.toContain(SECRET_LABEL);
    expect(body).not.toContain("<script");
  });

  it("exportAttackFlow : JSON avec les étapes confirmées, sans identifiant ni loot", async () => {
    const f = await fixture();
    const t = setupKc();
    const s = connect(t);
    await vi.waitFor(() => expect(views(s)).toHaveLength(1));
    const { file, filename } = await exported(s, t, "exportAttackFlow", f.project.id);
    const text = file.body.toString("utf8");
    expect(file.mime).toBe("application/json");
    expect(filename).toMatch(/^attack-flow-.*\.json$/);
    const json = JSON.parse(text) as Msg;
    expect(json.x_venator_snapshot).toMatch(/^[0-9a-f]{64}$/);
    expect(text).toContain("Pivot confirmé");
    expect(text).not.toContain(SECRET_LABEL);
  });

  it("exportAttackFlow sans étape confirmée : erreur affichée, aucun téléchargement", async () => {
    const configDir = join(ctx.dir, "config");
    await mkdir(configDir, { recursive: true });
    const project = await createProject(configDir, { name: "Vide", workspace: ctx.dir });
    const t = setupKc();
    const s = connect(t);
    await vi.waitFor(() => expect(views(s)).toHaveLength(1));
    s.say("killchain", "kc", { type: "exportAttackFlow", projectId: project.id });
    await vi.waitFor(() => expect(s.of("killchain", "findingsError")).toHaveLength(1));
    expect(s.of("shell", "download")).toHaveLength(0);
  });

  it("exportReport : Markdown identique au rapport du serveur, sans identifiant ni loot", async () => {
    const f = await fixture();
    const t = setupKc();
    const s = connect(t);
    await vi.waitFor(() => expect(views(s)).toHaveLength(1));
    const { file, filename } = await exported(s, t, "exportReport", f.project.id);
    const body = file.body.toString("utf8");
    expect(file.mime).toBe("text/markdown");
    expect(filename).toMatch(/^rapport-.*\.md$/);
    expect(body).toContain("Hôte 10.0.0.5");
    expect(body).not.toContain(SECRET_LABEL);
    expect(t.audit.some((e) => e.kind === "killchain.exportReport")).toBe(true);
  });

  it("projet inactif : aucun téléchargement, erreur affichée ; chemin client jamais utilisé", async () => {
    const f = await fixture();
    const other = await createProject(f.configDir, { name: "Autre", workspace: ctx.dir });
    const t = setupKc();
    const s = connect(t);
    await vi.waitFor(() => expect(views(s)).toHaveLength(1));
    s.say("killchain", "kc", { type: "exportReport", projectId: other.id });
    await vi.waitFor(() => expect(s.of("killchain", "findingsError")).toHaveLength(1));
    const before = t.bridge.stats().ignored;
    s.say("killchain", "kc", { type: "exportReport", projectId: "../../etc/passwd" });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(before + 1));
    expect(s.of("shell", "download")).toHaveLength(0);
  });

  it("exportFilename : nom réduit à [A-Za-z0-9._-]", () => {
    const d = new Date("2026-03-04T10:00:00Z");
    expect(exportFilename("killchain", '../Mission "x"/é', d, "svg")).toBe(
      "killchain-Mission-x-e-2026-03-04.svg",
    );
    expect(exportFilename("rapport", "///", d, "md")).toBe("rapport-projet-2026-03-04.md");
  });
});
