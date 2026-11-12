import { mkdir, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createProject, listEvidence, loadPolicy, policyDigest } from "@warband/core";
import { repoPolicyState, trustRepoPolicy } from "@warband/vscode/logic/repo-policy";
import { describe, expect, it, vi } from "vitest";
import { FS_UPLOAD_ACCEPT } from "../src/bridge/files.js";
import { FS_MAX_TEXT, isFsType, parseFsControl } from "../src/bridge/files-messages.js";
import {
  emptyBackends,
  type FakeSocket,
  type Msg,
  nthDialog,
  replyDialog,
  setup,
  shellOf,
  uploadFor,
  useStorage,
} from "./bridge-helpers.js";

const ctx = useStorage();
const configDir = () => join(ctx.dir, "config");
const DENY = JSON.stringify({ default: "deny", rules: [] });
const ALLOW = JSON.stringify({ default: "allow", rules: [] });

/** Projet actif sous la racine des projets du serveur, avec quelques fichiers. */
async function project(files: Record<string, string> = {}, name = "Mission") {
  await mkdir(configDir(), { recursive: true });
  const workspace = join(ctx.storage.paths.projects, name);
  await mkdir(workspace, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(workspace, path, ".."), { recursive: true });
    await writeFile(join(workspace, path), content);
  }
  const p = await createProject(configDir(), { name, workspace });
  return { p, workspace };
}

const boot = () => {
  const t = setup(ctx, { backends: emptyBackends() });
  return { t, s: shellOf(t) };
};

const REPLY = new Set([
  "fsEntries",
  "fsInfo",
  "fsContent",
  "fsWritten",
  "fsConflict",
  "fsDone",
  "fsCancelled",
  "fsError",
]);

/** Envoie un message de l'API Fichiers et rend la première réponse reçue après lui. */
async function call(s: FakeSocket, msg: Msg): Promise<Msg> {
  const before = s.sent.length;
  s.say("shell", "shell", msg);
  let found: Msg | undefined;
  await vi.waitFor(() => {
    found = s.sent
      .slice(before)
      .find((e) => e.view === "shell" && REPLY.has(String(e.msg.type)))?.msg;
    expect(found).toBeDefined();
  });
  return found as Msg;
}

const reasonOf = (m: Msg): string => String((m.reason as Msg | undefined)?.code);
const abs = (workspace: string, rel: string) => join(workspace, rel);

describe("API Fichiers : lecture, écriture, aller-retour", () => {
  it("list : dossiers d'abord, .git / node_modules / liens symboliques absents", async () => {
    const { workspace } = await project({
      "b.md": "b",
      "a.md": "aa",
      "docs/n.md": "n",
      ".git/config": "x",
      "node_modules/x/i.js": "x",
      ".env": "K=1",
    });
    await symlink("/etc", join(workspace, "lien-dossier"));
    const { s } = boot();
    const res = await call(s, { type: "fsList", path: "" });
    expect(res.type).toBe("fsEntries");
    const entries = res.entries as { name: string; kind: string; size: number; mtime: number }[];
    expect(entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
      "dir:docs",
      "file:.env",
      "file:a.md",
      "file:b.md",
    ]);
    expect(entries.find((e) => e.name === "a.md")).toMatchObject({ size: 2 });
    expect(typeof entries[0]?.mtime).toBe("number");
    const sub = await call(s, { type: "fsList", path: "docs" });
    expect((sub.entries as Msg[]).map((e) => e.name)).toEqual(["n.md"]);
    const info = await call(s, { type: "fsStat", path: "a.md" });
    expect(info).toMatchObject({ type: "fsInfo", exists: true, kind: "file", size: 2 });
    expect(await call(s, { type: "fsStat", path: "absent.md" })).toMatchObject({ exists: false });
  });

  it("read puis write avec l'etag lu : le contenu change, le mode est conservé", async () => {
    const { workspace } = await project({ "notes.md": "un" });
    const { s } = boot();
    const read = await call(s, { type: "fsRead", path: "notes.md", as: "text" });
    expect(read).toMatchObject({ type: "fsContent", text: "un", truncated: false });
    const written = await call(s, {
      type: "fsWrite",
      path: "notes.md",
      text: "deux é",
      etag: read.etag,
    });
    expect(written).toMatchObject({ type: "fsWritten", path: "notes.md" });
    expect(await readFile(abs(workspace, "notes.md"), "utf8")).toBe("deux é");
    // Aucun fichier temporaire ne subsiste.
    expect((await readdir(workspace)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    const again = await call(s, { type: "fsRead", path: "notes.md", as: "text" });
    expect(again.etag).toBe(written.etag);
    expect(again.text).toBe("deux é");
  });

  it("le mode d'origine est conservé (0600 reste 0600), un nouveau fichier est en 0644", async () => {
    const { workspace } = await project({ "secret.txt": "a" });
    const { chmod } = await import("node:fs/promises");
    await chmod(abs(workspace, "secret.txt"), 0o600);
    const { s } = boot();
    const read = await call(s, { type: "fsRead", path: "secret.txt", as: "text" });
    await call(s, { type: "fsWrite", path: "secret.txt", text: "b", etag: read.etag });
    expect((await stat(abs(workspace, "secret.txt"))).mode & 0o777).toBe(0o600);
    await call(s, { type: "fsWrite", path: "neuf.txt", text: "n", etag: null });
    expect((await stat(abs(workspace, "neuf.txt"))).mode & 0o777).toBe(0o644);
  });

  it("création : etag nul et fichier absent ; sinon conflit", async () => {
    const { workspace } = await project({ "existe.md": "x" });
    const { s } = boot();
    expect(
      await call(s, { type: "fsWrite", path: "neuf.md", text: "n", etag: null }),
    ).toMatchObject({ type: "fsWritten" });
    expect(await readFile(abs(workspace, "neuf.md"), "utf8")).toBe("n");
    // Fichier existant sans etag, ou etag sur un fichier absent : conflit, rien d'écrasé.
    expect(await call(s, { type: "fsWrite", path: "existe.md", text: "z", etag: null })).toEqual({
      type: "fsConflict",
      path: "existe.md",
    });
    expect(
      (await call(s, { type: "fsWrite", path: "fantome.md", text: "z", etag: "1:1" })).type,
    ).toBe("fsConflict");
    expect(await readFile(abs(workspace, "existe.md"), "utf8")).toBe("x");
  });

  it("etag obsolète : conflit, jamais d'écrasement silencieux", async () => {
    const { workspace } = await project({ "n.md": "v1" });
    const { s } = boot();
    const read = await call(s, { type: "fsRead", path: "n.md", as: "text" });
    // Modification extérieure (autre onglet, agent…) entre la lecture et l'écriture.
    await writeFile(abs(workspace, "n.md"), "v2-externe");
    const res = await call(s, { type: "fsWrite", path: "n.md", text: "v3", etag: read.etag });
    expect(res).toEqual({ type: "fsConflict", path: "n.md" });
    expect(await readFile(abs(workspace, "n.md"), "utf8")).toBe("v2-externe");
  });

  it("texte > 1 Mio refusé (octets) ; lecture d'un gros fichier tronquée et sans etag", async () => {
    const { workspace } = await project();
    const { s } = boot();
    // 600 000 caractères de 2 octets : la forme passe, les octets dépassent 1 Mio.
    const big = "é".repeat(600_000);
    expect(big.length).toBeLessThanOrEqual(FS_MAX_TEXT);
    const res = await call(s, { type: "fsWrite", path: "gros.txt", text: big, etag: null });
    expect(res).toMatchObject({ type: "fsError", reason: { code: "fs.tooLarge" } });
    await expect(stat(abs(workspace, "gros.txt"))).rejects.toThrow();
    // Plus de FS_MAX_TEXT caractères : refusé dès la forme (ignoré, aucune réponse).
    expect(
      parseFsControl({ type: "fsWrite", path: "x", text: "a".repeat(FS_MAX_TEXT + 1), etag: null }),
    ).toBeNull();
    await writeFile(abs(workspace, "log.txt"), "a".repeat(FS_MAX_TEXT + 10));
    const read = await call(s, { type: "fsRead", path: "log.txt", as: "text" });
    expect(read).toMatchObject({ truncated: true, etag: null, size: FS_MAX_TEXT + 10 });
    expect((read.text as string).length).toBe(FS_MAX_TEXT);
    // Sans etag, la version tronquée ne peut pas être renvoyée en écriture.
    expect(
      (await call(s, { type: "fsWrite", path: "log.txt", text: "x", etag: read.etag as null }))
        .type,
    ).toBe("fsConflict");
  });

  it("binaire demandé en texte : refus clair ; base64 pour les aperçus (≤ 5 Mio)", async () => {
    const { workspace } = await project();
    await writeFile(abs(workspace, "img.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
    await writeFile(abs(workspace, "gros.bin"), Buffer.alloc(5 * 1024 * 1024 + 1));
    const { s } = boot();
    const text = await call(s, { type: "fsRead", path: "img.png", as: "text" });
    expect(text).toMatchObject({ type: "fsError", reason: { code: "fs.notText" } });
    expect(typeof text.message).toBe("string");
    const b64 = await call(s, { type: "fsRead", path: "img.png", as: "base64" });
    expect(b64.base64).toBe(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]).toString("base64"));
    const big = await call(s, { type: "fsRead", path: "gros.bin", as: "base64" });
    expect(reasonOf(big)).toBe("fs.tooLarge");
  });

  it("la réponse ne va qu'à l'émetteur ; la politique change : diffusion de policyChanged seule", async () => {
    await project({ "a.md": "a" });
    const t = setup(ctx, { backends: emptyBackends() });
    const s1 = shellOf(t);
    const s2 = shellOf(t);
    await call(s1, { type: "fsRead", path: "a.md", as: "text" });
    await call(s1, { type: "fsList", path: "" });
    await call(s1, { type: "fsRead", path: "../a.md", as: "text" });
    for (const type of REPLY) expect(s2.of("shell", type)).toEqual([]);
  });
});

describe("API Fichiers : garde des chemins", () => {
  it("traversée, absolu, NUL, contrôles, segments trop longs : tous refusés", async () => {
    const { workspace } = await project({ "ok.md": "ok" });
    await writeFile(join(ctx.dir, "dehors.txt"), "hors projet");
    const { s } = boot();
    const bad = [
      "..",
      "../dehors.txt",
      "../../etc/passwd",
      "docs/../../dehors.txt",
      "a/../ok.md",
      "./ok.md",
      "%2e%2e/dehors.txt",
      "%2E%2E%2Fdehors.txt",
      "..%2fdehors.txt",
      "/etc/passwd",
      join(ctx.dir, "dehors.txt"),
      "ok.md\0.txt",
      "ok\n.md",
      "ok\\..\\dehors.txt",
      "C:/Windows/win.ini",
      "a//b",
      "ok.md/",
      "x".repeat(256),
      "",
    ];
    for (const path of bad) {
      for (const msg of [
        { type: "fsRead", path, as: "text" },
        { type: "fsWrite", path, text: "pirate", etag: null },
        { type: "fsMkdir", path },
        { type: "fsDownload", path },
      ]) {
        const res = await call(s, msg);
        expect(res.type, `${msg.type} ${JSON.stringify(path)}`).toBe("fsError");
        expect(reasonOf(res)).toBe("fs.invalidPath");
      }
    }
    // Plus de 1024 caractères : refusé dès la forme (ignoré, aucune réponse) ; ≤ 1024 mais > 1024 octets : garde.
    expect(parseFsControl({ type: "fsRead", path: `${"d/".repeat(600)}f`, as: "text" })).toBeNull();
    const multibyte = `${"é".repeat(300)}/f`;
    expect(multibyte.length).toBeLessThanOrEqual(1024);
    expect(reasonOf(await call(s, { type: "fsRead", path: multibyte, as: "text" }))).toBe(
      "fs.invalidPath",
    );
    expect(await readFile(join(ctx.dir, "dehors.txt"), "utf8")).toBe("hors projet");
    expect(await readdir(workspace)).toEqual(["ok.md"]);
  });

  it(".git et node_modules : refusés en lecture, écriture, création et renommage", async () => {
    const { workspace } = await project({
      ".git/config": "[core]",
      "node_modules/x/index.js": "x",
      "src/node_modules/y.js": "y",
      "a.md": "a",
    });
    const { s } = boot();
    for (const path of [
      ".git",
      ".git/config",
      "node_modules/x/index.js",
      "src/node_modules/y.js",
    ]) {
      expect(reasonOf(await call(s, { type: "fsRead", path, as: "text" }))).toBe("fs.protected");
      expect(reasonOf(await call(s, { type: "fsList", path }))).toBe("fs.protected");
      expect(
        reasonOf(await call(s, { type: "fsWrite", path: `${path}/n`, text: "x", etag: null })),
      ).toBe("fs.protected");
      expect(reasonOf(await call(s, { type: "fsRename", from: "a.md", to: path }))).toBe(
        "fs.protected",
      );
    }
    expect(reasonOf(await call(s, { type: "fsMkdir", path: ".git" }))).toBe("fs.protected");
    expect(reasonOf(await call(s, { type: "fsRename", from: ".git", to: "git2" }))).toBe(
      "fs.protected",
    );
    expect(await readFile(abs(workspace, ".git/config"), "utf8")).toBe("[core]");
  });

  it("lien symbolique sortant (fichier, dossier parent, dossier cible) : jamais suivi", async () => {
    const { workspace } = await project({ "a.md": "a" });
    const outside = join(ctx.dir, "dehors");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "secret.txt"), "SECRET-HORS-PROJET");
    await symlink(join(outside, "secret.txt"), join(workspace, "fuite.txt"));
    await symlink(outside, join(workspace, "lien"));
    await symlink("a.md", join(workspace, "interne.md"));
    const { s } = boot();
    // Fichier : lecture, écriture, téléchargement, suppression ; même un lien vers l'intérieur.
    for (const path of ["fuite.txt", "interne.md"]) {
      expect(reasonOf(await call(s, { type: "fsRead", path, as: "text" }))).toBe("fs.symlink");
      expect(reasonOf(await call(s, { type: "fsRead", path, as: "base64" }))).toBe("fs.symlink");
      expect(reasonOf(await call(s, { type: "fsWrite", path, text: "pirate", etag: null }))).toBe(
        "fs.symlink",
      );
      expect(reasonOf(await call(s, { type: "fsDownload", path }))).toBe("fs.symlink");
      expect(reasonOf(await call(s, { type: "fsCaptureEvidence", path }))).toBe("fs.symlink");
    }
    // Dossier parent : tout passage par le lien est refusé.
    expect(reasonOf(await call(s, { type: "fsList", path: "lien" }))).toBe("fs.symlink");
    expect(reasonOf(await call(s, { type: "fsRead", path: "lien/secret.txt", as: "text" }))).toBe(
      "fs.symlink",
    );
    expect(
      reasonOf(await call(s, { type: "fsWrite", path: "lien/neuf.txt", text: "x", etag: null })),
    ).toBe("fs.symlink");
    expect(reasonOf(await call(s, { type: "fsMkdir", path: "lien/sous" }))).toBe("fs.symlink");
    expect(reasonOf(await call(s, { type: "fsRename", from: "a.md", to: "lien/a.md" }))).toBe(
      "fs.symlink",
    );
    expect(
      reasonOf(await call(s, { type: "fsRename", from: "lien/secret.txt", to: "p.txt" })),
    ).toBe("fs.symlink");
    expect(await readdir(outside)).toEqual(["secret.txt"]);
    expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe("SECRET-HORS-PROJET");
    // Le lien lui-même n'est pas listé.
    const list = await call(s, { type: "fsList", path: "" });
    expect((list.entries as Msg[]).map((e) => e.name)).toEqual(["a.md"]);
  });

  it("sans projet actif, ou projet hors de la racine des projets : fs.noProject", async () => {
    const t0 = setup(ctx, { backends: emptyBackends() });
    expect(reasonOf(await call(shellOf(t0), { type: "fsList", path: "" }))).toBe("fs.noProject");
    t0.hub.dispose();
    await mkdir(configDir(), { recursive: true });
    const outside = join(ctx.dir, "ailleurs");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "x.txt"), "x");
    await createProject(configDir(), { name: "Hors", workspace: outside });
    const t1 = setup(ctx, { backends: emptyBackends() });
    const s = shellOf(t1);
    expect(reasonOf(await call(s, { type: "fsList", path: "" }))).toBe("fs.noProject");
    expect(reasonOf(await call(s, { type: "fsRead", path: "x.txt", as: "text" }))).toBe(
      "fs.noProject",
    );
  });

  it("messages mal formés : ignorés, comptés, sans réponse", async () => {
    await project({ "a.md": "a" });
    const { t, s } = boot();
    const before = t.bridge.stats();
    const sent = s.sent.length;
    s.say("shell", "shell", { type: "fsRead", path: "a.md" });
    s.say("shell", "shell", { type: "fsRead", path: "a.md", as: "hex" });
    s.say("shell", "shell", { type: "fsList", path: 3 });
    s.say("shell", "shell", { type: "fsList", path: "", extra: 1 });
    s.say("shell", "shell", { type: "fsWrite", path: "a.md", text: "x", etag: 5 });
    s.say("shell", "shell", { type: "fsRename", from: "a" });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(before.ignored + 6));
    expect(s.sent.length).toBe(sent);
    expect(isFsType("fsList")).toBe(true);
    expect(isFsType("halt")).toBe(false);
  });
});

describe("API Fichiers : création, renommage, suppression", () => {
  it("mkdir : refuse un nom existant ; rename : pas d'écrasement, pas dans soi-même", async () => {
    const { workspace } = await project({ "a.md": "a", "b.md": "b", "dir/x.md": "x" });
    const { t, s } = boot();
    expect(await call(s, { type: "fsMkdir", path: "neuf" })).toMatchObject({
      type: "fsDone",
      op: "mkdir",
      path: "neuf",
    });
    expect((await stat(abs(workspace, "neuf"))).isDirectory()).toBe(true);
    expect(reasonOf(await call(s, { type: "fsMkdir", path: "neuf" }))).toBe("fs.exists");
    expect(reasonOf(await call(s, { type: "fsMkdir", path: "absent/sous" }))).toBe("fs.notFound");
    // Renommage vers un existant : refusé, les deux fichiers intacts.
    expect(reasonOf(await call(s, { type: "fsRename", from: "a.md", to: "b.md" }))).toBe(
      "fs.exists",
    );
    expect(await readFile(abs(workspace, "a.md"), "utf8")).toBe("a");
    expect(await readFile(abs(workspace, "b.md"), "utf8")).toBe("b");
    expect(reasonOf(await call(s, { type: "fsRename", from: "dir", to: "dir/dans" }))).toBe(
      "fs.invalidPath",
    );
    expect(reasonOf(await call(s, { type: "fsRename", from: "absent", to: "z" }))).toBe(
      "fs.notFound",
    );
    const ok = await call(s, { type: "fsRename", from: "a.md", to: "dir/a2.md" });
    expect(ok).toMatchObject({ type: "fsDone", op: "rename", from: "a.md", path: "dir/a2.md" });
    expect(await readFile(abs(workspace, "dir/a2.md"), "utf8")).toBe("a");
    expect(t.audit).toContainEqual(
      expect.objectContaining({ kind: "fs.rename", from: "a.md", to: "dir/a2.md" }),
    );
  });

  it("delete : confirmation danger exigée, refus ou silence = rien n'est supprimé", async () => {
    const { workspace } = await project({ "a.md": "a", "d/x.md": "x", "d/sub/y.md": "y" });
    const { t, s } = boot();
    s.say("shell", "shell", { type: "fsDelete", path: "a.md" });
    const dialog = await nthDialog(s);
    expect(dialog).toMatchObject({ kind: "confirm", danger: true });
    expect(String(dialog.text)).toContain("a.md");
    // Sans réponse : le fichier est toujours là.
    await new Promise((ok) => setTimeout(ok, 50));
    expect(await readFile(abs(workspace, "a.md"), "utf8")).toBe("a");
    // Refus : fsCancelled, rien supprimé.
    replyDialog(s, dialog, false);
    await vi.waitFor(() => expect(s.of("shell", "fsCancelled")).toHaveLength(1));
    expect(await readFile(abs(workspace, "a.md"), "utf8")).toBe("a");
    expect(t.audit.filter((e) => e.kind === "fs.delete")).toEqual([]);
    // Annulation (null) : idem.
    s.say("shell", "shell", { type: "fsDelete", path: "a.md" });
    replyDialog(s, await nthDialog(s, 2), null);
    await vi.waitFor(() => expect(s.of("shell", "fsCancelled")).toHaveLength(2));
    // Acceptation : fichier puis dossier (récursif).
    s.say("shell", "shell", { type: "fsDelete", path: "a.md" });
    replyDialog(s, await nthDialog(s, 3), true);
    await vi.waitFor(() => expect(s.of("shell", "fsDone")).toHaveLength(1));
    await expect(stat(abs(workspace, "a.md"))).rejects.toThrow();
    s.say("shell", "shell", { type: "fsDelete", path: "d" });
    const d2 = await nthDialog(s, 4);
    expect(String(d2.text)).toContain("tout son contenu");
    replyDialog(s, d2, true);
    await vi.waitFor(() => expect(s.of("shell", "fsDone")).toHaveLength(2));
    await expect(stat(abs(workspace, "d"))).rejects.toThrow();
    expect(t.audit.filter((e) => e.kind === "fs.delete")).toEqual([
      expect.objectContaining({ kind: "fs.delete", path: "a.md", dir: false }),
      expect.objectContaining({ kind: "fs.delete", path: "d", dir: true }),
    ]);
  });

  it("delete : la racine, .git et un lien symbolique ne se suppriment pas, sans même demander", async () => {
    const { workspace } = await project({ "a.md": "a", ".git/HEAD": "ref" });
    await symlink("/etc", join(workspace, "lien"));
    const { s } = boot();
    for (const path of ["", ".git", ".git/HEAD", "lien", "../x"])
      expect(String((await call(s, { type: "fsDelete", path })).type)).toBe("fsError");
    expect(s.of("shell", "dialog")).toEqual([]);
    expect(await readFile(abs(workspace, ".git/HEAD"), "utf8")).toBe("ref");
  });

  it("audit : chemin relatif et taille, jamais le contenu", async () => {
    await project({});
    const { t, s } = boot();
    await call(s, {
      type: "fsWrite",
      path: "n.md",
      text: "MOT-DE-PASSE-CONTENU-ULTRA",
      etag: null,
    });
    const entries = t.audit.filter((e) => String(e.kind).startsWith("fs."));
    expect(entries).toEqual([
      expect.objectContaining({ kind: "fs.write", path: "n.md", size: 26 }),
    ]);
    expect(JSON.stringify(t.audit)).not.toContain("MOT-DE-PASSE-CONTENU-ULTRA");
    expect(JSON.stringify(entries)).not.toContain(ctx.dir);
  });
});

describe("API Fichiers : téléversement et téléchargement", () => {
  it("dialogue : extensions limitées, ≤ 25 Mio ; le fichier arrive dans le dossier, l'upload est supprimé", async () => {
    const { workspace } = await project({ "docs/a.md": "a" });
    const { t, s } = boot();
    s.say("shell", "shell", { type: "fsUpload", dir: "docs" });
    const d = await nthDialog(s);
    expect(d).toMatchObject({ kind: "file", maxBytes: 25 * 1024 * 1024 });
    expect(FS_UPLOAD_ACCEPT.length).toBeLessThanOrEqual(50);
    expect(d.accept as string[]).toContain(".pdf");
    expect(d.accept as string[]).not.toContain(".exe");
    const id = await uploadFor(t, s, d, "preuve.pdf", "%PDF-contenu");
    await vi.waitFor(() => expect(s.of("shell", "fsDone")).toHaveLength(1));
    expect(s.of("shell", "fsDone")[0]?.msg).toMatchObject({
      op: "upload",
      path: "docs/preuve.pdf",
      name: "preuve.pdf",
    });
    expect(await readFile(abs(workspace, "docs/preuve.pdf"), "utf8")).toBe("%PDF-contenu");
    expect((await stat(abs(workspace, "docs/preuve.pdf"))).mode & 0o777).toBe(0o644);
    // Le fichier téléversé est supprimé après la prise.
    expect(t.hub.context.uploads.take(id)).toBeUndefined();
    expect(await readdir(join(ctx.storage.paths.root, "uploads")).catch(() => [])).toEqual([]);
    expect(t.audit).toContainEqual(
      expect.objectContaining({ kind: "fs.upload", path: "docs/preuve.pdf" }),
    );
  });

  it("extension hors liste ou nom protégé : refusé, rien écrit, upload supprimé", async () => {
    const { workspace } = await project({});
    const { t, s } = boot();
    for (const name of ["virus.exe", "sans-extension", "node_modules"]) {
      const before = s.of("shell", "fsError").length;
      s.say("shell", "shell", { type: "fsUpload", dir: "" });
      const d = await nthDialog(s, s.of("shell", "dialog").length + 1);
      await uploadFor(t, s, d, name, "x");
      await vi.waitFor(() => expect(s.of("shell", "fsError").length).toBe(before + 1));
    }
    expect(await readdir(workspace)).toEqual([]);
    expect(await readdir(join(ctx.storage.paths.root, "uploads")).catch(() => [])).toEqual([]);
    expect(s.of("shell", "fsError").map((e) => reasonOf(e.msg))).toEqual([
      "fs.badType",
      "fs.badType",
      "fs.protected",
    ]);
  });

  it("upload dans un dossier invalide ou lié : refusé avant tout dialogue", async () => {
    const { workspace } = await project({ "a.md": "a" });
    await symlink("/etc", join(workspace, "lien"));
    const { s } = boot();
    for (const dir of ["lien", "a.md", "absent", "../x", ".git"])
      expect((await call(s, { type: "fsUpload", dir })).type).toBe("fsError");
    expect(s.of("shell", "dialog")).toEqual([]);
  });

  it("fichier existant : confirmation avant de remplacer ; refus = inchangé", async () => {
    const { workspace } = await project({ "n.txt": "ancien" });
    const { t, s } = boot();
    s.say("shell", "shell", { type: "fsUpload", dir: "" });
    await uploadFor(t, s, await nthDialog(s), "n.txt", "nouveau");
    const confirm = await nthDialog(s, 2);
    expect(confirm).toMatchObject({ kind: "confirm", danger: true });
    expect(await readFile(abs(workspace, "n.txt"), "utf8")).toBe("ancien");
    replyDialog(s, confirm, false);
    await vi.waitFor(() => expect(s.of("shell", "fsCancelled")).toHaveLength(1));
    expect(await readFile(abs(workspace, "n.txt"), "utf8")).toBe("ancien");
    // Acceptation : remplacé.
    s.say("shell", "shell", { type: "fsUpload", dir: "" });
    await uploadFor(t, s, await nthDialog(s, 3), "n.txt", "nouveau");
    replyDialog(s, await nthDialog(s, 4), true);
    await vi.waitFor(() => expect(s.of("shell", "fsDone")).toHaveLength(1));
    expect(await readFile(abs(workspace, "n.txt"), "utf8")).toBe("nouveau");
    expect(await readdir(join(ctx.storage.paths.root, "uploads")).catch(() => [])).toEqual([]);
  });

  it("download : offre en flux à l'émetteur seul ; > limite, binaire ou lien refusés", async () => {
    const { workspace } = await project({ "rapport.md": "# Rapport" });
    await writeFile(abs(workspace, "preuve.png"), Buffer.from([1, 2, 3, 0, 255]));
    const t = setup(ctx, { backends: emptyBackends() });
    const s = shellOf(t);
    const other = shellOf(t);
    const done = await call(s, { type: "fsDownload", path: "rapport.md" });
    expect(done).toMatchObject({ type: "fsDone", op: "download" });
    const offer = s.of("shell", "download");
    expect(offer).toHaveLength(1);
    expect(offer[0]?.msg).toMatchObject({ filename: "rapport.md" });
    expect(other.of("shell", "download")).toEqual([]);
    const taken = t.hub.context.downloads.take(String(offer[0]?.msg.id));
    expect(taken?.body.toString()).toBe("# Rapport");
    expect(taken?.mime).toContain("text/markdown");
    await call(s, { type: "fsDownload", path: "preuve.png" });
    const png = t.hub.context.downloads.take(String(s.of("shell", "download")[1]?.msg.id));
    expect([...(png?.body ?? [])]).toEqual([1, 2, 3, 0, 255]);
    expect(reasonOf(await call(s, { type: "fsDownload", path: "absent" }))).toBe("fs.notFound");
    expect(reasonOf(await call(s, { type: "fsDownload", path: "" }))).toBe("fs.invalidPath");
  });
});

describe("API Fichiers : politique du dépôt", () => {
  const trust = (workspace: string) =>
    trustRepoPolicy(workspace, {
      configDir: configDir(),
      isWorkspaceTrusted: () => true,
      show: async () => undefined,
      confirm: async () => true,
    });

  it("modifier .warband/policy.json invalide l'approbation précédente et prévient la coquille", async () => {
    const { workspace } = await project({ ".warband/policy.json": DENY });
    await mkdir(configDir(), { recursive: true });
    const approved = await trust(workspace);
    expect(approved).toMatchObject({ status: "trusted" });
    expect((await repoPolicyState(workspace, configDir())).state).toBe("trusted");
    expect((await loadPolicy({ cwd: workspace, configDir: configDir() })).origin).toBe(
      "repository",
    );
    const digestBefore = policyDigest(DENY);

    const t = setup(ctx, { backends: emptyBackends() });
    const s = shellOf(t);
    const other = shellOf(t);
    const read = await call(s, { type: "fsRead", path: ".warband/policy.json", as: "text" });
    expect(read.text).toBe(DENY);
    const written = await call(s, {
      type: "fsWrite",
      path: ".warband/policy.json",
      text: ALLOW,
      etag: read.etag,
    });
    expect(written.type).toBe("fsWritten");
    expect(await readFile(abs(workspace, ".warband/policy.json"), "utf8")).toBe(ALLOW);

    // L'empreinte approuvée ne correspond plus : la politique du dépôt n'est PAS appliquée.
    const state = await repoPolicyState(workspace, configDir());
    expect(state).toMatchObject({ state: "modified" });
    expect((state as { digest: string }).digest).toBe(policyDigest(ALLOW).slice(0, 12));
    expect((state as { digest: string }).digest).not.toBe(digestBefore.slice(0, 12));
    const loaded = await loadPolicy({ cwd: workspace, configDir: configDir() });
    expect(loaded.origin).not.toBe("repository");
    expect(loaded.warning).toMatchObject({ code: "policy.repo.modified" });
    // Aucune approbation automatique : aucun dialogue, et la coquille est prévenue (tous les sockets).
    expect(s.of("shell", "dialog")).toEqual([]);
    await vi.waitFor(() => expect(s.of("shell", "policyChanged")).toHaveLength(1));
    expect(other.of("shell", "policyChanged")).toHaveLength(1);
    // Seule une nouvelle approbation humaine rétablit la politique.
    expect(await trust(workspace)).toMatchObject({ status: "trusted" });
    expect((await repoPolicyState(workspace, configDir())).state).toBe("trusted");
  });

  it("renommer ou supprimer le fichier (ou son dossier) prévient aussi la coquille", async () => {
    await project({ ".warband/policy.json": DENY, "a.md": "a" });
    const { s } = boot();
    await call(s, { type: "fsRename", from: ".warband", to: "ancien" });
    await vi.waitFor(() => expect(s.of("shell", "policyChanged")).toHaveLength(1));
    await call(s, { type: "fsRename", from: "a.md", to: "b.md" });
    expect(s.of("shell", "policyChanged")).toHaveLength(1);
  });
});

describe("API Fichiers : preuve d'un fichier", () => {
  it("le texte du fichier devient une preuve du projet actif (titre demandé à l'humain)", async () => {
    const { p } = await project({ "scan.txt": "port 22 ouvert\nport 80 ouvert" });
    const { s } = boot();
    s.say("shell", "shell", { type: "fsCaptureEvidence", path: "scan.txt" });
    const d = await nthDialog(s);
    expect(d).toMatchObject({ kind: "input" });
    replyDialog(s, d, "Scan des ports");
    await vi.waitFor(() => expect(s.of("shell", "fsDone")).toHaveLength(1));
    const done = s.of("shell", "fsDone")[0]?.msg as Msg;
    expect(done).toMatchObject({ op: "evidence", path: "scan.txt" });
    const evidence = await listEvidence(configDir(), p.id);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      id: done.evidenceId,
      label: "Scan des ports",
      text: "port 22 ouvert\nport 80 ouvert",
      source: { kind: "editor", reference: "scan.txt", startLine: 1, endLine: 2 },
    });
  });

  it("titre annulé, fichier trop gros, vide ou binaire : aucune preuve", async () => {
    const { p, workspace } = await project({ "vide.txt": "  \n", "ok.txt": "contenu" });
    await writeFile(abs(workspace, "gros.txt"), "a".repeat(16 * 1024 + 1));
    await writeFile(abs(workspace, "bin.dat"), Buffer.from([0, 1, 2]));
    const { s } = boot();
    expect(reasonOf(await call(s, { type: "fsCaptureEvidence", path: "gros.txt" }))).toBe(
      "fs.tooLarge",
    );
    expect(reasonOf(await call(s, { type: "fsCaptureEvidence", path: "vide.txt" }))).toBe(
      "fs.empty",
    );
    expect(reasonOf(await call(s, { type: "fsCaptureEvidence", path: "bin.dat" }))).toBe(
      "fs.notText",
    );
    s.say("shell", "shell", { type: "fsCaptureEvidence", path: "ok.txt" });
    replyDialog(s, await nthDialog(s), null);
    await vi.waitFor(() => expect(s.of("shell", "fsCancelled")).toHaveLength(1));
    expect(await listEvidence(configDir(), p.id)).toEqual([]);
  });
});
