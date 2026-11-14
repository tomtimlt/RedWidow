import { randomUUID } from "node:crypto";
import { mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { appendFinding, createProject, type EngineEvent } from "@warband/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ATTACH_ACCEPT, ATTACH_MAX_BYTES } from "../src/bridge/attachments.js";
import {
  buildChatDeps,
  HISTORY_INDEX_KEY,
  PROVIDER_CATALOG_KEY,
  SETTINGS_KEY,
} from "../src/bridge/deps.js";
import {
  allowedSegment,
  fuzzyScore,
  listProjectFiles,
  MENTION_FILE_LIMIT,
  mentionRoot,
  resolveProjectFile,
} from "../src/bridge/mentions.js";
import { isOpenWindowMessage, openWindowMessage } from "../src/bridge/shell-messages.js";
import {
  createLinkedProject,
  emptyBackends,
  type FakeSocket,
  type Msg,
  setup,
  shellOf,
  useStorage,
} from "./bridge-helpers.js";
import { fakeDocker } from "./docker-fake.js";

const ctx = useStorage();
const settle = (ms = 100) => new Promise((ok) => setTimeout(ok, ms));
type T = ReturnType<typeof setup>;

const configDir = () => join(ctx.dir, "config");

/** Projet actif dont le dossier est sous la racine projets du serveur, avec quelques fichiers. */
async function project(name = "Mission", files: Record<string, string> = {}) {
  await mkdir(configDir(), { recursive: true });
  const workspace = join(ctx.storage.paths.containers, "box", name);
  await mkdir(workspace, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(workspace, path, ".."), { recursive: true });
    await writeFile(join(workspace, path), content);
  }
  const p = await createLinkedProject(configDir(), { name, workspace });
  return { p, workspace };
}

/** Chat vivant : coquille et chat sur le même socket (émetteur des dialogues et des ouvertures). */
function chatOf(t: T, frame = "c1") {
  const s = shellOf(t);
  s.say("chat", frame, { type: "ready" });
  return s;
}

/** Dernière vue du chat reçue (objet vide tant qu'il n'y en a pas). */
const lastChatView = (s: FakeSocket): Msg =>
  (s.of("chat", "view").at(-1)?.msg.view ?? {}) as unknown as Msg;
/** Premier argument du premier prompt reçu par le moteur factice. */
const firstPrompt = (t: T): string => String(((t.engine()?.prompts ?? [])[0] ?? [])[0]);

const chatMsgs = (s: FakeSocket, type: string) => s.of("chat", type).map((e) => e.msg);

async function ask(s: FakeSocket, frame: string, msg: Msg, type: string, count = 1) {
  const before = s.of("chat", type).length;
  s.say("chat", frame, msg);
  await vi.waitFor(() => expect(s.of("chat", type).length).toBeGreaterThanOrEqual(before + count));
  return s.of("chat", type).at(-1)?.msg as Msg;
}

describe("mentions `@` : fichiers du projet", () => {
  it("liste bornée, filtre flou, jamais .git / node_modules / cachés ni lien symbolique", async () => {
    const { workspace } = await project("Fichiers", {
      "notes.md": "n",
      "src/app.ts": "a",
      "src/lib/util.ts": "u",
      ".git/config": "git",
      "node_modules/x/index.js": "n",
      ".secret": "s",
      "docs/.cache/x": "c",
    });
    await symlink("/etc", join(workspace, "etc-link"));
    await writeFile(join(ctx.dir, "dehors.txt"), "hors racine");
    await symlink(join(ctx.dir, "dehors.txt"), join(workspace, "fuite.txt"));
    const root = (await mentionRoot(workspace, ctx.storage.paths.containers)) as string;
    const all = (await listProjectFiles(root, "")).map((f) => f.path);
    expect(all).toEqual(expect.arrayContaining(["notes.md", "src/app.ts", "src/lib/util.ts"]));
    for (const bad of [".git/config", "node_modules/x/index.js", ".secret", "docs/.cache/x"])
      expect(all).not.toContain(bad);
    expect(all.some((p) => p.startsWith("etc-link") || p === "fuite.txt")).toBe(false);
    // Flou : « sapp » retrouve src/app.ts ; rien ne correspond à « zzz ».
    expect((await listProjectFiles(root, "sapp")).map((f) => f.path)).toEqual(["src/app.ts"]);
    expect(await listProjectFiles(root, "zzz")).toEqual([]);
  });

  it("au plus 50 fichiers", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 80; i++) files[`f${String(i).padStart(2, "0")}.txt`] = "x";
    const { workspace } = await project("Beaucoup", files);
    const root = (await mentionRoot(workspace, ctx.storage.paths.containers)) as string;
    expect(await listProjectFiles(root, "")).toHaveLength(MENTION_FILE_LIMIT);
  });

  it("mentionQuery : seul le dossier d'un projet sous la racine des projets est proposé", async () => {
    await project("Mission", { "a.txt": "a" });
    const t = setup(ctx, { backends: emptyBackends() });
    const s = chatOf(t);
    const res = await ask(s, "c1", { type: "mentionQuery", query: "" }, "mentionResults");
    expect(res.files).toEqual([{ path: "a.txt", label: "a.txt" }]);
    expect(res.killchain).toEqual({ available: false, why: "empty" });
    expect(res.sortie).toEqual({ available: false, why: "empty" });
  });

  it("projet hors de la racine des projets : aucune mention", async () => {
    await mkdir(configDir(), { recursive: true });
    const outside = join(ctx.dir, "ailleurs");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "secret.txt"), "x");
    await createProject(configDir(), { name: "Hors", workspace: outside });
    const t = setup(ctx, { backends: emptyBackends() });
    const s = chatOf(t);
    const res = await ask(s, "c1", { type: "mentionQuery", query: "" }, "mentionResults");
    expect(res.files).toEqual([]);
    const refused = await ask(
      s,
      "c1",
      { type: "mentionAttach", requestId: "r1", kind: "file", path: "secret.txt" },
      "mentionRefused",
    );
    expect(refused).toMatchObject({ requestId: "r1", reason: "path" });
  });

  it("killchain : disponible quand le projet a des notes ; sans projet, indisponible", async () => {
    const t0 = setup(ctx, { backends: emptyBackends() });
    const none = await ask(chatOf(t0), "c1", { type: "mentionQuery", query: "" }, "mentionResults");
    expect(none.killchain).toEqual({ available: false, why: "no-project" });
    t0.hub.dispose();

    const { p } = await project("Notes");
    await appendFinding(configDir(), p.id, {
      kind: "host",
      state: "confirmed",
      label: "Hôte 10.0.0.9",
    });
    const t = setup(ctx, { backends: emptyBackends() });
    const s = chatOf(t, "c2");
    const res = await ask(s, "c2", { type: "mentionQuery", query: "" }, "mentionResults");
    expect(res.killchain).toEqual({ available: true });
    const att = await ask(
      s,
      "c2",
      { type: "mentionAttach", requestId: "k1", kind: "killchain" },
      "mentionAttached",
    );
    expect(att).toMatchObject({ requestId: "k1", kind: "killchain", name: "killchain.txt" });
    expect(String(att.text)).toContain("Hôte 10.0.0.9");
  });
});

describe("mentions : lecture d'un fichier désigné par le client", () => {
  it("refuse traversée, chemin absolu, .git, caché, lien symbolique sortant ; lit un fichier du projet", async () => {
    const { workspace } = await project("Lecture", {
      "ok.txt": "contenu ok",
      ".git/config": "[core]",
      ".env": "SECRET=1",
    });
    await writeFile(join(ctx.dir, "dehors.txt"), "hors racine");
    await symlink(join(ctx.dir, "dehors.txt"), join(workspace, "lien.txt"));
    await symlink(ctx.dir, join(workspace, "lien-dossier"));
    const root = (await mentionRoot(workspace, ctx.storage.paths.containers)) as string;
    const refusals: Record<string, string> = {
      "../dehors.txt": "path",
      "a/../../dehors.txt": "path",
      "/etc/passwd": "path",
      "..": "path",
      ".git/config": "path",
      ".env": "path",
      "lien.txt": "path",
      "lien-dossier/dehors.txt": "path",
      "a\\b": "path",
      "ok.txt\u0000": "path",
      "absent.txt": "missing",
      "": "invalid",
    };
    for (const [path, reason] of Object.entries(refusals))
      expect(await resolveProjectFile(root, path), path).toEqual({ ok: false, reason });
    expect(await resolveProjectFile(root, 42)).toEqual({ ok: false, reason: "invalid" });
    expect(await resolveProjectFile(root, "ok.txt")).toEqual({
      ok: true,
      attachment: { name: "ok.txt", text: "contenu ok" },
    });
  });

  it("mentionAttach via le pont : mêmes refus, et pièce lue avec le plafond de 64 Kio", async () => {
    await project("Pont", { "ok.txt": "ok", "gros.txt": "x".repeat(70_000), "bin.dat": "\u0000" });
    const t = setup(ctx, { backends: emptyBackends() });
    const s = chatOf(t);
    const attach = (requestId: string, path: string) =>
      ask(s, "c1", { type: "mentionAttach", requestId, kind: "file", path }, "mentionAttached");
    expect(await attach("a1", "ok.txt")).toMatchObject({ name: "ok.txt", text: "ok" });
    const refuse = async (requestId: string, path: string) => {
      s.say("chat", "c1", { type: "mentionAttach", requestId, kind: "file", path });
      await vi.waitFor(() =>
        expect(chatMsgs(s, "mentionRefused").some((m) => m.requestId === requestId)).toBe(true),
      );
      return chatMsgs(s, "mentionRefused").find((m) => m.requestId === requestId)?.reason;
    };
    expect(await refuse("a2", "../x")).toBe("path");
    expect(await refuse("a3", "gros.txt")).toBe("size");
    expect(await refuse("a4", "bin.dat")).toBe("binary");
    expect(chatMsgs(s, "mentionAttached")).toHaveLength(1);
  });

  it("messages invalides ignorés et comptés", async () => {
    await project("Invalides");
    const t = setup(ctx, { backends: emptyBackends() });
    const s = chatOf(t);
    await settle();
    const before = t.bridge.stats();
    s.say("chat", "c1", { type: "mentionQuery", query: "x".repeat(500) });
    s.say("chat", "c1", { type: "mentionAttach", requestId: "r", kind: "file" });
    s.say("chat", "c1", { type: "mentionAttach", requestId: "r", kind: "autre" });
    s.say("chat", "c1", { type: "linkMention", name: "../x" });
    s.say("chat", "c1", { type: "exportChat", extra: 1 });
    s.say("chat", "c1", { type: "openMonitor", extra: 1 });
    s.say("chat", "c1", { type: "watch" });
    s.say("chat", "c1", { type: "attachPick" });
    s.say("chat", "c1", { type: "attachPick", requestId: "a/b" });
    await settle();
    expect(t.bridge.stats().ignored - before.ignored).toBe(9);
    expect(t.bridge.stats().accepted).toBe(before.accepted);
    expect(chatMsgs(s, "mentionResults")).toEqual([]);
  });

  it("unitaires : segments et score flou", () => {
    expect(allowedSegment(".warband")).toBe(true);
    for (const bad of [".git", "node_modules", ".env", "..", ".", "", "a\\b"])
      expect(allowedSegment(bad)).toBe(false);
    expect(fuzzyScore("src/app.ts", "app")).not.toBeNull();
    expect(fuzzyScore("src/app.ts", "zz")).toBeNull();
    expect(fuzzyScore("a.ts", "")).not.toBeNull();
  });
});

describe("mentions `#` : terminaux web", () => {
  let docker: Awaited<ReturnType<typeof fakeDocker>>;
  beforeEach(async () => {
    docker = await fakeDocker();
  });
  afterEach(async () => {
    ctx.hub?.dispose();
    await ctx.hub?.settled();
    await docker.close();
  });

  const openTerm = async (s: FakeSocket, frame = "t1", container = "kali1") => {
    s.say("term", frame, { type: "open", container, cols: 80, rows: 24 });
    await vi.waitFor(() => expect(s.of("term", "opened").length).toBeGreaterThan(0));
  };

  it("refreshTerminals : jeton, libellé et dernière commande des terminaux ouverts", async () => {
    const t = setup(ctx, { docker: docker.api, backends: emptyBackends() });
    const s = chatOf(t);
    const empty = await ask(s, "c1", { type: "refreshTerminals" }, "terminals");
    expect(empty.items).toEqual([]);
    await openTerm(s);
    s.say("term", "t1", { type: "input", data: "nmap -sV 10.0.0.5\r" });
    await vi.waitFor(() => expect(docker.written.join("")).toContain("nmap"));
    await settle();
    const res = await ask(s, "c1", { type: "refreshTerminals" }, "terminals");
    expect(res.items).toEqual([
      { token: "kali1", label: "kali1", hint: expect.stringContaining("nmap") },
    ]);
  });

  it("send avec #jeton : sortie masquée et bornée ajoutée au prompt ; jeton inconnu ignoré", async () => {
    const secret = "vault-secret-valeur-1234";
    await ctx.storage.secrets.set("autre.cle", secret);
    const t = setup(ctx, { docker: docker.api, backends: emptyBackends() });
    const s = chatOf(t);
    await openTerm(s);
    s.say("term", "t1", { type: "input", data: `echo ${secret} marqueur-visible\r` });
    await vi.waitFor(() => expect(docker.written.join("")).toContain("marqueur-visible"));
    await settle();
    s.say("chat", "c1", { type: "send", text: "analyse #kali1 et #inconnu" });
    await vi.waitFor(() => expect(t.engine()?.prompts).toHaveLength(1));
    const prompt = JSON.stringify(t.engine()?.prompts[0]);
    expect(prompt).toContain("<<<sortie-terminal>>>");
    expect(prompt).toContain("Terminal #kali1, shell du conteneur kali1.");
    expect(prompt).toContain("marqueur-visible");
    expect(prompt).not.toContain(secret);
    expect(prompt).not.toContain("#inconnu, shell");
  });

  it("send avec #jeton : la sortie est tronquée à 16 Kio", async () => {
    const t = setup(ctx, { docker: docker.api, backends: emptyBackends() });
    const s = chatOf(t);
    await openTerm(s);
    s.say("term", "t1", { type: "input", data: `${"A".repeat(40_000)}FIN\r` });
    await vi.waitFor(() => expect(docker.written.join("")).toContain("FIN"));
    await settle();
    s.say("chat", "c1", { type: "send", text: "lis #kali1" });
    await vi.waitFor(() => expect(t.engine()?.prompts).toHaveLength(1));
    const sent = firstPrompt(t);
    const tail = sent.slice(sent.indexOf("<<<sortie-terminal>>>"));
    expect(tail).toContain("FIN");
    expect(tail.length).toBeLessThan(17_000);
    expect(tail.length).toBeGreaterThan(15_000);
  });
});

describe("pièces jointes par dialogue", () => {
  const dialogOf = async (s: FakeSocket) => {
    await vi.waitFor(() => expect(s.of("shell", "dialog").length).toBeGreaterThan(0));
    return s.of("shell", "dialog").at(-1)?.msg as Msg;
  };
  /** Téléverse `content` sous `name` pour le dialogue puis le valide, comme la coquille. */
  async function upload(t: T, s: FakeSocket, d: Msg, name: string, content: Buffer | string) {
    const info = await t.hub.context.uploads.receive(Readable.from([Buffer.from(content)]), {
      dialog: d.id as string,
      name,
      maxBytes: d.maxBytes as number,
    });
    s.say("shell", "shell", { type: "dialogResult", id: d.id, value: info.id });
  }

  it("dialogue file (types et taille de attachments.ts), upload, contenu renvoyé, fichier supprimé", async () => {
    const t = setup(ctx, { backends: emptyBackends() });
    const s = chatOf(t);
    s.say("chat", "c1", { type: "attachPick", requestId: "p1" });
    const d = await dialogOf(s);
    expect(d.kind).toBe("file");
    expect(d.accept).toEqual(ATTACH_ACCEPT);
    expect(d.accept).not.toContain(".pdf");
    expect(d.maxBytes).toBe(ATTACH_MAX_BYTES);
    // Sans réponse humaine : rien n'est renvoyé ni envoyé.
    await settle();
    expect(chatMsgs(s, "attachmentPicked")).toEqual([]);
    expect(t.engine()).toBeUndefined();
    await upload(t, s, d, "notes.md", "# Notes\nrésultat");
    await vi.waitFor(() => expect(chatMsgs(s, "attachmentPicked")).toHaveLength(1));
    expect(chatMsgs(s, "attachmentPicked")[0]).toEqual({
      type: "attachmentPicked",
      requestId: "p1",
      attachment: { name: "notes.md", text: "# Notes\nrésultat" },
    });
    expect(await readdir(join(ctx.dir, "uploads"))).toEqual([]);
    // Toujours rien envoyé à l'agent : la pièce n'est qu'un brouillon dans la page.
    expect(t.engine()).toBeUndefined();
  });

  it("la pièce jointe renvoyée part avec un send ordinaire, jusqu'au contrôleur", async () => {
    const t = setup(ctx, { backends: emptyBackends() });
    const s = chatOf(t);
    s.say("chat", "c1", { type: "attachPick", requestId: "p1" });
    await upload(t, s, await dialogOf(s), "log.txt", "ligne secrète du fichier");
    await vi.waitFor(() => expect(chatMsgs(s, "attachmentPicked")).toHaveLength(1));
    const attachment = chatMsgs(s, "attachmentPicked")[0]?.attachment;
    const view = t.hub as unknown as { dispatch: unknown };
    expect(view).toBeDefined();
    const conversation = lastChatView(s).conversation as string;
    s.say("chat", "c1", {
      type: "send",
      text: "résume",
      attachments: [attachment],
      requestId: "send-1",
      conversation,
    });
    await vi.waitFor(() => expect(t.engine()?.prompts).toHaveLength(1));
    const prompt = firstPrompt(t);
    expect(prompt).toContain("résume");
    expect(prompt).toContain("ligne secrète du fichier");
    expect(prompt).toContain("donnée non fiable");
  });

  it("send sans texte mais avec pièce : consigne par défaut ; pièce hors bornes : message ignoré", async () => {
    const t = setup(ctx, { backends: emptyBackends() });
    const s = chatOf(t);
    await settle();
    const conversation = lastChatView(s).conversation as string;
    const before = t.bridge.stats();
    s.say("chat", "c1", {
      type: "send",
      text: "x",
      attachments: [{ name: "gros.txt", text: "x".repeat(70_000) }],
      requestId: "r1",
      conversation,
    });
    s.say("chat", "c1", {
      type: "send",
      text: "x",
      attachments: [{ name: "a.pdf", text: "%PDF-1.4" }],
      requestId: "r2",
      conversation,
    });
    await settle();
    expect(t.bridge.stats().ignored - before.ignored).toBe(2);
    expect(t.engine()).toBeUndefined();
  });

  it("image png : signature contrôlée, base64 renvoyé ; faux png : refusé", async () => {
    const t = setup(ctx, { backends: emptyBackends() });
    const s = chatOf(t);
    const png = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.from("fausse-image-mais-signature-valide"),
    ]);
    s.say("chat", "c1", { type: "attachPick", requestId: "i1" });
    await upload(t, s, await dialogOf(s), "capture.png", png);
    await vi.waitFor(() => expect(chatMsgs(s, "attachmentPicked")).toHaveLength(1));
    expect(chatMsgs(s, "attachmentPicked")[0]?.attachment).toEqual({
      name: "capture.png",
      mimeType: "image/png",
      data: png.toString("base64"),
    });
    s.say("chat", "c1", { type: "attachPick", requestId: "i2" });
    await vi.waitFor(() => expect(s.of("shell", "dialog")).toHaveLength(2));
    await upload(t, s, s.of("shell", "dialog")[1]?.msg as Msg, "faux.png", "pas une image");
    await vi.waitFor(() => expect(chatMsgs(s, "attachmentRefused")).toHaveLength(1));
    expect(chatMsgs(s, "attachmentRefused")[0]).toEqual({
      type: "attachmentRefused",
      requestId: "i2",
      reason: "binary",
    });
  });

  it("texte trop gros, binaire, annulation : refus sans contenu ; un seul dialogue par cadre", async () => {
    const t = setup(ctx, { backends: emptyBackends() });
    const s = chatOf(t);
    const before = t.bridge.stats().ignored;
    s.say("chat", "c1", { type: "attachPick", requestId: "g1" });
    const d1 = await dialogOf(s);
    // Une seconde demande pendant le dialogue : ignorée et comptée.
    s.say("chat", "c1", { type: "attachPick", requestId: "g2" });
    await settle();
    expect(t.bridge.stats().ignored - before).toBe(1);
    expect(s.of("shell", "dialog")).toHaveLength(1);
    await upload(t, s, d1, "gros.txt", "x".repeat(70_000));
    await vi.waitFor(() => expect(chatMsgs(s, "attachmentRefused")).toHaveLength(1));
    expect(chatMsgs(s, "attachmentRefused")[0]?.reason).toBe("size");

    s.say("chat", "c1", { type: "attachPick", requestId: "g3" });
    await vi.waitFor(() => expect(s.of("shell", "dialog")).toHaveLength(2));
    await upload(
      t,
      s,
      s.of("shell", "dialog")[1]?.msg as Msg,
      "bin.txt",
      Buffer.from([0xff, 0xfe, 0x00]),
    );
    await vi.waitFor(() => expect(chatMsgs(s, "attachmentRefused")).toHaveLength(2));
    expect(chatMsgs(s, "attachmentRefused")[1]?.reason).toBe("binary");

    s.say("chat", "c1", { type: "attachPick", requestId: "g4" });
    await vi.waitFor(() => expect(s.of("shell", "dialog")).toHaveLength(3));
    s.say("shell", "shell", {
      type: "dialogResult",
      id: (s.of("shell", "dialog")[2]?.msg ?? {}).id,
      value: null,
    });
    await vi.waitFor(() => expect(chatMsgs(s, "attachmentRefused")).toHaveLength(3));
    expect(chatMsgs(s, "attachmentRefused")[2]?.reason).toBe("cancelled");
    expect(chatMsgs(s, "attachmentPicked")).toEqual([]);
    expect(await readdir(join(ctx.dir, "uploads"))).toEqual([]);
  });

  it("attachPick d'un cadre non annoncé : ignoré", async () => {
    const t = setup(ctx, { backends: emptyBackends() });
    const s = shellOf(t);
    const before = t.bridge.stats().ignored;
    s.say("chat", "jamais", { type: "attachPick", requestId: "z" });
    await settle();
    expect(t.bridge.stats().ignored - before).toBe(1);
    expect(s.of("shell", "dialog")).toEqual([]);
  });
});

describe("capacités (setCapability)", () => {
  const selection = (s: FakeSocket) => (lastChatView(s).capabilities as Msg).selection as Msg;

  it("recherche web : écrite dans chat.webSearch, reflétée par la vue et capabilityState", async () => {
    const t = setup(ctx, { backends: emptyBackends() });
    const s = chatOf(t);
    await vi.waitFor(() => expect(chatMsgs(s, "view").length).toBeGreaterThan(0));
    expect(selection(s).webSearch).toBe(false);
    const on = await ask(
      s,
      "c1",
      { type: "setCapability", kind: "webSearch", enabled: true },
      "capabilityState",
    );
    expect(on).toEqual({ type: "capabilityState", kind: "webSearch", enabled: true, error: false });
    await vi.waitFor(() => expect(selection(s).webSearch).toBe(true));
    // Activée par défaut : rien à écrire. Désactivée : l'écriture part dans `chat.webSearch`.
    const off = await ask(
      s,
      "c1",
      { type: "setCapability", kind: "webSearch", enabled: false },
      "capabilityState",
    );
    expect(off).toMatchObject({ enabled: false, error: false });
    expect((ctx.storage.state.get(SETTINGS_KEY) as Msg)["chat.webSearch"]).toBe(false);
    await vi.waitFor(() => expect(selection(s).webSearch).toBe(false));
    expect(t.audit.some((e) => e.kind === "settings.set")).toBe(true);
    expect(s.of("shell", "settings").at(-1)?.msg.values).toMatchObject({ "chat.webSearch": false });
    await ask(
      s,
      "c1",
      { type: "setCapability", kind: "webSearch", enabled: true },
      "capabilityState",
    );
    expect((ctx.storage.state.get(SETTINGS_KEY) as Msg)["chat.webSearch"]).toBe(true);
    await vi.waitFor(() => expect(selection(s).webSearch).toBe(true));
  });

  it("skill : bascule du profil ; MCP non configuré refusé sans rien écrire", async () => {
    const t = setup(ctx, { backends: emptyBackends() });
    const s = chatOf(t);
    await vi.waitFor(() => expect(chatMsgs(s, "view").length).toBeGreaterThan(0));
    const on = await ask(
      s,
      "c1",
      { type: "setCapability", kind: "skill", id: "mentor", enabled: true },
      "capabilityState",
    );
    expect(on).toMatchObject({ kind: "skill", id: "mentor", enabled: true, error: false });
    await vi.waitFor(() => expect(selection(s).profile).toBe("mentor"));
    const mcp = await ask(
      s,
      "c1",
      { type: "setCapability", kind: "integration", id: "playwright", enabled: true },
      "capabilityState",
    );
    expect(mcp).toMatchObject({
      kind: "integration",
      id: "playwright",
      enabled: true,
      error: true,
    });
    expect(
      (ctx.storage.state.get(SETTINGS_KEY) as Msg | undefined)?.["chat.integrations"],
    ).toBeUndefined();
    const burp = await ask(
      s,
      "c1",
      { type: "setCapability", kind: "burp", enabled: true },
      "capabilityState",
    );
    expect(burp.error).toBe(true);
    // Une fois le serveur MCP configuré dans l'état serveur, la bascule est acceptée et écrite.
    ctx.storage.state.set(SETTINGS_KEY, {
      integrations: [{ id: "playwright", port: 8931, transport: "http", path: "/mcp" }],
    });
    const configured = await ask(
      s,
      "c1",
      { type: "setCapability", kind: "integration", id: "playwright", enabled: true },
      "capabilityState",
    );
    expect(configured).toMatchObject({ id: "playwright", enabled: true, error: false });
    expect((ctx.storage.state.get(SETTINGS_KEY) as Msg)["chat.integrations"]).toEqual([
      "playwright",
    ]);
    await vi.waitFor(() => expect(selection(s).integrations).toEqual(["playwright"]));
  });

  it("paramètres invalides : ignorés et comptés ; session occupée : refus", async () => {
    const t = setup(ctx, { backends: emptyBackends() });
    const s = chatOf(t);
    await vi.waitFor(() => expect(chatMsgs(s, "view").length).toBeGreaterThan(0));
    const before = t.bridge.stats().ignored;
    s.say("chat", "c1", { type: "setCapability", kind: "skill", id: "inconnu", enabled: true });
    s.say("chat", "c1", { type: "setCapability", kind: "webSearch" });
    await settle();
    expect(t.bridge.stats().ignored - before).toBe(2);
    expect(chatMsgs(s, "capabilityState")).toEqual([]);
    s.say("chat", "c1", { type: "send", text: "occupe" });
    await vi.waitFor(() => expect(t.engine()?.prompts).toHaveLength(1));
    const busy = await ask(
      s,
      "c1",
      { type: "setCapability", kind: "webSearch", enabled: true },
      "capabilityState",
    );
    expect(busy.error).toBe(true);
    expect(
      (ctx.storage.state.get(SETTINGS_KEY) as Msg | undefined)?.["chat.webSearch"],
    ).toBeUndefined();
  });

  it("setProvider / addProvider / openSystem : acceptés, sans approbation ni effet de sécurité", async () => {
    const t = setup(ctx, { backends: emptyBackends() });
    const s = chatOf(t);
    await settle();
    const before = t.bridge.stats();
    s.say("chat", "c1", { type: "addProvider" });
    s.say("chat", "c1", { type: "openSystem" });
    s.say("chat", "c1", { type: "setProvider", provider: "claude" });
    await settle();
    expect(t.bridge.stats().accepted - before.accepted).toBe(3);
    expect(t.bridge.stats().ignored).toBe(before.ignored);
    expect(s.of("shell", "dialog")).toEqual([]);
    expect(s.of("shell", "openWindow")).toEqual([]);
  });
});

describe("catalogue des fournisseurs OpenCode annoncé par un chat", () => {
  it("onProviders : écrit dans l'état partagé avec la vue studio ; relu par les réglages du chat", () => {
    const deps = buildChatDeps({
      storage: ctx.storage,
      frame: "c1",
      cwd: ctx.dir,
      enginePath: "moteur.js",
      engineArgs: [],
      ask: async () => false,
      onView: () => undefined,
    });
    deps.onProviders?.([
      { id: "openrouter", name: "OpenRouter", connected: true },
      { id: "Mauvais Id", name: "X", connected: true },
      { id: "sans-nom", name: "", connected: true },
    ]);
    expect(ctx.storage.state.get(PROVIDER_CATALOG_KEY)).toEqual([
      { id: "openrouter", name: "OpenRouter", connected: true },
    ]);
    expect(deps.readSettings().providerCatalog).toEqual([
      { id: "openrouter", name: "OpenRouter", connected: true },
    ]);
    // Un catalogue vide ou illisible n'écrase pas le précédent.
    deps.onProviders?.([]);
    expect(ctx.storage.state.get(PROVIDER_CATALOG_KEY)).toHaveLength(1);
  });
});

describe("fenêtres : openMonitor, openKillchain, watch, openCockpit", () => {
  it("openWindow à l'émetteur seul, avec la vue, le mode et le cadre attendus", async () => {
    const t = setup(ctx, { backends: emptyBackends() });
    const s = chatOf(t, "chat-9");
    const other = shellOf(t);
    s.say("chat", "chat-9", { type: "openMonitor" });
    s.say("chat", "chat-9", { type: "openKillchain" });
    s.say("chat", "chat-9", { type: "openCockpit" });
    s.say("chat", "chat-9", { type: "watch", toolUseId: "toolu_42" });
    await vi.waitFor(() => expect(s.of("shell", "openWindow")).toHaveLength(4));
    const got = s.of("shell", "openWindow").map((e) => e.msg);
    expect(got).toEqual([
      openWindowMessage("viewer", "chat-9", { mode: "monitor" }),
      openWindowMessage("killchain"),
      openWindowMessage("cockpit"),
      openWindowMessage("viewer", "chat-9", { mode: "watch", toolUseId: "toolu_42" }),
    ]);
    expect(got[0]).toEqual({
      type: "openWindow",
      view: "viewer",
      frame: "chat-9",
      mode: "monitor",
    });
    expect(got.every(isOpenWindowMessage)).toBe(true);
    expect(other.of("shell", "openWindow")).toEqual([]);
  });

  it("watch avec caractère de contrôle : refusé", async () => {
    const t = setup(ctx, { backends: emptyBackends() });
    const s = chatOf(t);
    await settle();
    const before = t.bridge.stats().ignored;
    s.say("chat", "c1", { type: "watch", toolUseId: "a\nb" });
    await settle();
    expect(t.bridge.stats().ignored - before).toBe(1);
    expect(s.of("shell", "openWindow")).toEqual([]);
  });

  it("openWindow : formes valides et invalides (viewer + mode, term, champs inconnus)", () => {
    const ok = [
      { type: "openWindow", view: "viewer", frame: "f", mode: "report" },
      { type: "openWindow", view: "viewer", frame: "f", mode: "watch", toolUseId: "t1" },
      { type: "openWindow", view: "term", frame: "t1" },
      { type: "openWindow", view: "cockpit", frame: "cockpit" },
      { type: "openWindow", view: "chat", frame: "m-0a1b2c" },
      { type: "openWindow", view: "chat", frame: "m-0a1b2c", draft: "Ligne 1\nLigne 2" },
      { type: "openWindow", view: "term", frame: "t-0a1b2c3d", container: "exegol-web" },
    ];
    for (const m of ok) expect(isOpenWindowMessage(m), JSON.stringify(m)).toBe(true);
    const bad = [
      { type: "openWindow", view: "viewer", frame: "f", mode: "autre" },
      { type: "openWindow", view: "cockpit", frame: "f", mode: "watch" },
      { type: "openWindow", view: "viewer", frame: "f", mode: "monitor", toolUseId: "t" },
      { type: "openWindow", view: "viewer", frame: "f", mode: "watch", toolUseId: "" },
      { type: "openWindow", view: "viewer", frame: "f", mode: "watch", toolUseId: "a\u0000" },
      { type: "openWindow", view: "term", frame: "a/b" },
      { type: "openWindow", view: "chat", frame: "a/b" },
      { type: "openWindow", view: "chat", frame: "f", draft: "" },
      { type: "openWindow", view: "chat", frame: "f", draft: "x".repeat(4001) },
      { type: "openWindow", view: "chat", frame: "f", draft: "a\u0000b" },
      { type: "openWindow", view: "chat", frame: "f", draft: 12 },
      { type: "openWindow", view: "cockpit", frame: "f", draft: "x" },
      { type: "openWindow", view: "chat", frame: "f", container: "exegol-web" },
      { type: "openWindow", view: "term", frame: "f", container: "--privileged" },
      { type: "openWindow", view: "term", frame: "f", container: "a b" },
      { type: "openWindow", view: "term", frame: "f", draft: "x" },
      { type: "openWindow", view: "term", frame: "f", path: "/etc" },
    ];
    for (const m of bad) expect(isOpenWindowMessage(m), JSON.stringify(m)).toBe(false);
  });
});

describe("liaison conteneur ↔ projet (linkMention)", () => {
  let docker: Awaited<ReturnType<typeof fakeDocker>>;
  beforeEach(async () => {
    docker = await fakeDocker();
  });
  afterEach(async () => {
    ctx.hub?.dispose();
    await ctx.hub?.settled();
    await docker.close();
  });

  const setupLink = () => {
    const link = vi.fn(async () => ({ type: "view" }) as never);
    const t = setup(ctx, {
      docker: docker.api,
      backends: emptyBackends({
        cockpit: {
          load: async () => ({ type: "view" }) as never,
          link,
          setPrimary: async () => ({ type: "view" }) as never,
          control: async () => undefined,
          images: async () => [],
          remove: async (name) => ({ status: "cancelled", name }),
        },
      }),
    });
    return { t, link };
  };

  it("ready : conteneurs gérés (menu @) avec le nombre de liés", async () => {
    const { p } = await project("Liens");
    const { t } = setupLink();
    const s = chatOf(t);
    await vi.waitFor(() => expect(chatMsgs(s, "containers")).toHaveLength(1));
    const msg = chatMsgs(s, "containers")[0] as Msg;
    expect(msg.linkedCount).toBe(0);
    expect((msg.items as Msg[]).map((i) => i.name)).toEqual(
      expect.arrayContaining(["kali1", "web", "kali-off"]),
    );
    expect((msg.items as Msg[]).map((i) => i.name)).not.toContain("nginx");
    expect(p.id).toBeTruthy();
  });

  it("un @conteneur non lié est proposé ; sans confirmation humaine, aucune liaison", async () => {
    await project("Liens");
    const { t, link } = setupLink();
    const s = chatOf(t);
    s.say("chat", "c1", { type: "send", text: "scanne @kali1" });
    await vi.waitFor(() =>
      expect(
        chatMsgs(s, "containerLinks").some((m) =>
          (m.items as Msg[]).some((i) => i.name === "kali1"),
        ),
      ).toBe(true),
    );
    s.say("chat", "c1", { type: "linkMention", name: "kali1" });
    await vi.waitFor(() =>
      expect(s.of("shell", "dialog").filter((d) => d.msg.kind === "confirm")).toHaveLength(1),
    );
    await settle();
    expect(link).not.toHaveBeenCalled();
    // Refus humain : toujours rien, la proposition reste.
    const d = s.of("shell", "dialog")[0]?.msg as Msg;
    s.say("shell", "shell", { type: "dialogResult", id: d.id, value: false });
    await settle();
    expect(link).not.toHaveBeenCalled();
    expect(t.audit.some((e) => e.kind === "container.link")).toBe(false);
  });

  it("confirmation humaine : liaison par le cockpit, audit, proposition retirée", async () => {
    const { p } = await project("Liens");
    const { t, link } = setupLink();
    const s = chatOf(t);
    s.say("chat", "c1", { type: "send", text: "scanne @kali1" });
    await vi.waitFor(() => expect(chatMsgs(s, "containerLinks").length).toBeGreaterThan(1));
    s.say("chat", "c1", { type: "linkMention", name: "kali1" });
    await vi.waitFor(() => expect(s.of("shell", "dialog")).toHaveLength(1));
    const d = s.of("shell", "dialog")[0]?.msg as Msg;
    expect(d).toMatchObject({ kind: "confirm" });
    expect(String(d.text)).toContain("kali1");
    s.say("shell", "shell", { type: "dialogResult", id: d.id, value: true });
    await vi.waitFor(() => expect(link).toHaveBeenCalledWith("kali1"));
    await vi.waitFor(() =>
      expect(chatMsgs(s, "containerLinks").at(-1)).toEqual({ type: "containerLinks", items: [] }),
    );
    expect(t.audit.find((e) => e.kind === "container.link")).toEqual({
      kind: "container.link",
      container: "kali1",
      project: p.id,
      via: "chat",
    });
  });

  it("nom jamais proposé, ou conteneur non géré : aucune liaison, message ignoré", async () => {
    await project("Liens");
    const { t, link } = setupLink();
    const s = chatOf(t);
    await settle();
    const before = t.bridge.stats().ignored;
    s.say("chat", "c1", { type: "linkMention", name: "kali1" });
    await settle();
    expect(t.bridge.stats().ignored - before).toBe(1);
    // `@nginx` n'est pas un conteneur géré : jamais proposé, donc jamais lié.
    s.say("chat", "c1", { type: "send", text: "vois @nginx" });
    await vi.waitFor(() => expect(t.engine()?.prompts).toHaveLength(1));
    s.say("chat", "c1", { type: "linkMention", name: "nginx" });
    await settle();
    expect(t.bridge.stats().ignored - before).toBe(2);
    expect(s.of("shell", "dialog")).toEqual([]);
    expect(link).not.toHaveBeenCalled();
  });

  it("ignoreLinkMention : retire la proposition", async () => {
    await project("Liens");
    const { t, link } = setupLink();
    const s = chatOf(t);
    s.say("chat", "c1", { type: "send", text: "scanne @kali1" });
    await vi.waitFor(() =>
      expect(chatMsgs(s, "containerLinks").some((m) => (m.items as Msg[]).length === 1)).toBe(true),
    );
    s.say("chat", "c1", { type: "ignoreLinkMention", name: "kali1" });
    await vi.waitFor(() =>
      expect(chatMsgs(s, "containerLinks").at(-1)).toEqual({ type: "containerLinks", items: [] }),
    );
    s.say("chat", "c1", { type: "linkMention", name: "kali1" });
    await settle();
    expect(s.of("shell", "dialog")).toEqual([]);
    expect(link).not.toHaveBeenCalled();
  });
});

describe("exports : exportChat et exportText", () => {
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

  /** Projet actif, conversation indexée avec son journal ; le chat l'ouvre en lecture seule. */
  async function conversation(secret: string) {
    const { p } = await project("Export");
    const run = randomUUID();
    const id = randomUUID();
    const events = [
      ev(run, { kind: "user.message", text: "bonjour agent" }),
      ev(run, { kind: "agent.text", text: `le mot de passe est ${secret}` }),
    ];
    await mkdir(ctx.storage.paths.runs, { recursive: true });
    await writeFile(
      join(ctx.storage.paths.runs, `${run}.jsonl`),
      `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
    );
    ctx.storage.state.set(HISTORY_INDEX_KEY, [
      {
        id,
        title: "Fil exporté",
        createdAt: "2026-03-04T10:00:00.000Z",
        updatedAt: "2026-03-04T10:00:00.000Z",
        provider: "claude",
        model: null,
        effort: null,
        sessionId: null,
        runIds: [run],
        tools: 0,
        projectId: p.id,
      },
    ]);
    return { run, id, p };
  }

  async function downloaded(t: T, s: FakeSocket) {
    await vi.waitFor(() => expect(s.of("shell", "download")).toHaveLength(1));
    const offer = s.of("shell", "download")[0]?.msg as Msg;
    const taken = t.hub.context.downloads.take(offer.id as string);
    expect(taken).toBeDefined();
    return { offer, taken: taken as NonNullable<typeof taken> };
  }

  it("exportChat : Markdown du fil en téléchargement, sans valeur secrète du coffre", async () => {
    const secret = "vault-secret-valeur-9876";
    await ctx.storage.secrets.set("autre.cle", secret);
    const { run, id } = await conversation(secret);
    const t = setup(ctx, { backends: emptyBackends() });
    const s = chatOf(t);
    s.say("chat", "c1", { type: "historyOpen", id });
    await vi.waitFor(() => expect(lastChatView(s).readonly).toBeTruthy());
    s.say("chat", "c1", { type: "exportChat" });
    const { offer, taken } = await downloaded(t, s);
    expect(offer.filename).toBe(`fil-${run}.md`);
    expect(taken.filename).toBe(`fil-${run}.md`);
    expect(taken.mime).toBe("text/markdown");
    const md = taken.body.toString("utf8");
    expect(md).toContain("# Fil de mission");
    expect(md).toContain("Utilisateur : bonjour agent");
    expect(md).toContain("Agent : le mot de passe est");
    expect(md).not.toContain(secret);
    expect(md).toContain("[REDACTED]");
    expect(t.audit.some((e) => e.kind === "chat.export")).toBe(true);
    // Un autre socket n'a pas reçu l'offre.
    const other = shellOf(t);
    await settle();
    expect(other.of("shell", "download")).toEqual([]);
  });

  it("exportChat sans projet actif ou sans conversation : erreur sans détail, rien offert", async () => {
    const t = setup(ctx, { backends: emptyBackends() });
    const s = chatOf(t);
    const noProject = await ask(s, "c1", { type: "exportChat" }, "error");
    expect(noProject).toEqual({ type: "error", code: "project.absent" });
    t.hub.dispose();

    await project("Vide");
    const t2 = setup(ctx, { backends: emptyBackends() });
    const s2 = chatOf(t2, "c2");
    const none = await ask(s2, "c2", { type: "exportChat" }, "error");
    expect(none).toEqual({ type: "error", code: "view.failed" });
    expect(s.of("shell", "download")).toEqual([]);
    expect(s2.of("shell", "download")).toEqual([]);
  });

  it("exportChat : journal manquant ou conversation d'un autre projet : refus, pas d'export partiel", async () => {
    const { run, id } = await conversation("x");
    await mkdir(ctx.storage.paths.runs, { recursive: true });
    const { rm } = await import("node:fs/promises");
    await rm(join(ctx.storage.paths.runs, `${run}.jsonl`));
    const t = setup(ctx, { backends: emptyBackends() });
    const s = chatOf(t);
    s.say("chat", "c1", { type: "historyOpen", id });
    await vi.waitFor(() => expect(lastChatView(s).readonly).toBeTruthy());
    const err = await ask(s, "c1", { type: "exportChat" }, "error");
    expect(err.code).toBe("view.failed");
    expect(s.of("shell", "download")).toEqual([]);
  });

  it("exportText : texte brut remasqué, offert à l'émetteur en text/plain", async () => {
    const secret = "vault-secret-valeur-5555";
    await ctx.storage.secrets.set("autre.cle", secret);
    const t = setup(ctx, { backends: emptyBackends() });
    const s = chatOf(t);
    s.say("chat", "c1", { type: "exportText", text: `sortie visible ${secret} fin` });
    const { taken } = await downloaded(t, s);
    expect(taken.mime).toBe("text/plain");
    expect(taken.filename).toMatch(/^sortie-.*\.txt$/);
    const text = taken.body.toString("utf8");
    expect(text).toContain("sortie visible");
    expect(text).not.toContain(secret);
  });
});

describe("timeline, contexte de mission, historique", () => {
  it("timelineExchange : accepté (la session répond par une vue), identifiant invalide : ignoré", async () => {
    const t = setup(ctx, { backends: emptyBackends() });
    const s = chatOf(t);
    await settle();
    const before = t.bridge.stats();
    s.say("chat", "c1", { type: "timelineExchange", direction: "older", id: 1 });
    s.say("chat", "c1", { type: "timelineExchange", direction: "sideways", id: 1 });
    s.say("chat", "c1", { type: "timelineExchange", direction: "newer", id: 0 });
    await settle();
    expect(t.bridge.stats().accepted - before.accepted).toBe(1);
    expect(t.bridge.stats().ignored - before.ignored).toBe(2);
  });

  it("onMissionContext : diffusé à la coquille (masqué, borné) et rejoué à la connexion suivante", async () => {
    process.env.REDWIDOW_TEST_SECRET_TOKEN = "valeur-env-ultra-secrete";
    try {
      const t = setup(ctx, { backends: emptyBackends() });
      const s = chatOf(t);
      s.say("chat", "c1", { type: "send", text: "x" });
      await vi.waitFor(() => expect(t.engine()).toBeDefined());
      const handlers = t.engine()?.handlers as unknown as {
        onMissionContext?(s: { runId: string; text: string }): void;
      };
      const text = `contexte ${process.env.REDWIDOW_TEST_SECRET_TOKEN} ${"z".repeat(30_000)}`;
      handlers.onMissionContext?.({ runId: "r1", text });
      await vi.waitFor(() => expect(s.of("shell", "missionContext")).toHaveLength(1));
      const msg = s.of("shell", "missionContext")[0]?.msg as Msg;
      expect(msg).toMatchObject({ frame: "c1", runId: "r1" });
      expect(String(msg.text)).not.toContain("valeur-env-ultra-secrete");
      expect(String(msg.text).length).toBeLessThanOrEqual(16 * 1024);
      const later = shellOf(t);
      await vi.waitFor(() => expect(later.of("shell", "missionContext")).toHaveLength(1));
    } finally {
      delete process.env.REDWIDOW_TEST_SECRET_TOKEN;
    }
  });

  it("historique : les conversations portent le projet actif (readHistoryProjects)", async () => {
    const { p } = await project("Histo");
    const t = setup(ctx, { backends: emptyBackends() });
    const s = chatOf(t);
    s.say("chat", "c1", { type: "send", text: "bonjour" });
    await vi.waitFor(() => expect(t.engine()?.prompts).toHaveLength(1));
    await vi.waitFor(() => {
      const index = ctx.storage.state.get(HISTORY_INDEX_KEY) as
        | { projectId?: string }[]
        | undefined;
      expect(index?.some((row) => row.projectId === p.id)).toBe(true);
    });
  });
});

describe("aucune approbation implicite", () => {
  it("aucun des nouveaux messages ne répond à une demande d'outil ni ne lève le Bypass", async () => {
    const t = setup(ctx, { backends: emptyBackends() });
    const s = chatOf(t);
    s.say("chat", "c1", { type: "send", text: "go" });
    await vi.waitFor(() => expect(t.engine()?.prompts).toHaveLength(1));
    for (const m of [
      { type: "openMonitor" },
      { type: "refreshTerminals" },
      { type: "mentionQuery", query: "a" },
      { type: "exportChat" },
      { type: "watch", toolUseId: "t1" },
    ])
      s.say("chat", "c1", m);
    await settle();
    expect(t.engine()?.answers).toEqual([]);
    expect(s.of("shell", "bypass").every((e) => e.msg.active === false)).toBe(true);
  });
});
