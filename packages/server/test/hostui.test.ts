import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HostUi, MAX_PENDING_DIALOGS, safeExternalUrl } from "../src/bridge/hostui.js";
import type { Sink } from "../src/bridge/hub.js";
import { parseShellControl } from "../src/bridge/shell-messages.js";
import { UploadStore } from "../src/uploads.js";
import { approval, setup, shellOf, useStorage } from "./bridge-helpers.js";

type Msg = Record<string, unknown>;
const sink = () => {
  const sent: Msg[] = [];
  const s: Sink = { send: (_v, _f, m) => void sent.push(m) };
  return { s, sent, last: (type: string) => sent.filter((m) => m.type === type).at(-1) };
};
const flush = () => new Promise((ok) => setTimeout(ok, 5));

let dir = "";
let uploads: UploadStore;
let shell: Set<Sink>;
let ui: HostUi;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rw-hostui-"));
  uploads = new UploadStore({ dir: join(dir, "uploads"), sweepMs: 0 });
  shell = new Set();
  ui = new HostUi({ shell: () => shell, uploads });
});
afterEach(async () => {
  ui.dispose();
  await uploads.dispose();
  await rm(dir, { recursive: true, force: true });
});

const pendingOf = (s: ReturnType<typeof sink>) => s.last("dialog") as Msg;

describe("HostUi : aller-retour par kind", () => {
  it("pick simple et multiple", async () => {
    const a = sink();
    shell.add(a.s);
    const items = [
      { id: "x", label: "X", detail: "d" },
      { id: "y", label: "Y" },
    ];
    const one = ui.pick({ title: "T", items }, a.s);
    const d = pendingOf(a);
    expect(d).toMatchObject({ kind: "pick", title: "T", multi: false, items });
    expect(ui.answer(d.id as string, "inconnu", a.s)).toBe(false);
    expect(ui.answer(d.id as string, ["x"], a.s)).toBe(false);
    expect(ui.answer(d.id as string, "y", a.s)).toBe(true);
    await expect(one).resolves.toBe("y");
    expect(a.last("dialogClosed")).toEqual({ type: "dialogClosed", id: d.id });

    const many = ui.pick({ title: "T", items, multi: true });
    const d2 = pendingOf(a);
    expect(ui.answer(d2.id as string, ["x", "zz"], a.s)).toBe(false);
    expect(ui.answer(d2.id as string, ["x", "x"], a.s)).toBe(false);
    expect(ui.answer(d2.id as string, ["y", "x"], a.s)).toBe(true);
    await expect(many).resolves.toEqual(["y", "x"]);
  });

  it("pick : liste invalide refusée sans diffusion", async () => {
    const a = sink();
    shell.add(a.s);
    await expect(ui.pick({ title: "T", items: [] })).resolves.toBeNull();
    await expect(
      ui.pick({
        title: "T",
        items: [
          { id: "a", label: "A" },
          { id: "a", label: "B" },
        ],
      }),
    ).resolves.toBeNull();
    expect(a.sent).toEqual([]);
  });

  it("input : valeur bornée à 4 Ko, secret transmis comme indicateur", async () => {
    const a = sink();
    shell.add(a.s);
    const p = ui.input({ title: "T", label: "L", secret: true, value: "v0" });
    const d = pendingOf(a);
    expect(d).toMatchObject({ kind: "input", secret: true, value: "v0" });
    expect(ui.answer(d.id as string, "a".repeat(4097), a.s)).toBe(false);
    expect(ui.answer(d.id as string, true, a.s)).toBe(false);
    expect(ui.answer(d.id as string, "ok", a.s)).toBe(true);
    await expect(p).resolves.toBe("ok");
  });

  it("confirm : booléen seulement, annulation = false", async () => {
    const a = sink();
    shell.add(a.s);
    const p = ui.confirm({ title: "T", text: "Sûr ?", danger: true });
    const d = pendingOf(a);
    expect(d).toMatchObject({ kind: "confirm", danger: true });
    expect(ui.answer(d.id as string, "oui", a.s)).toBe(false);
    expect(ui.answer(d.id as string, true, a.s)).toBe(true);
    await expect(p).resolves.toBe(true);
    const q = ui.confirm({ title: "T", text: "Sûr ?" });
    expect(ui.answer(pendingOf(a).id as string, null, a.s)).toBe(true);
    await expect(q).resolves.toBe(false);
  });

  it("external : http(s) seulement", async () => {
    const a = sink();
    shell.add(a.s);
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "ftp://x.y/",
      "https://x.y/ a",
      `https://x.y/${"a".repeat(2048)}`,
      "",
    ]) {
      await expect(ui.external({ url, label: "L" })).resolves.toBe(false);
    }
    expect(a.sent).toEqual([]);
    expect(safeExternalUrl("http://exemple.fr/a?b=1")).not.toBeNull();
    const p = ui.external({ url: "https://exemple.fr/", label: "Doc" });
    const d = pendingOf(a);
    expect(d).toMatchObject({ kind: "external", url: "https://exemple.fr/", label: "Doc" });
    expect(ui.answer(d.id as string, "x", a.s)).toBe(false);
    expect(ui.answer(d.id as string, true, a.s)).toBe(true);
    await expect(p).resolves.toBe(true);
  });

  it("file : seul un identifiant d'upload créé pour ce dialogue est accepté", async () => {
    const a = sink();
    shell.add(a.s);
    const p = ui.file({ title: "T", accept: ["PDF", ".txt"], maxBytes: 99 * 1024 * 1024 });
    const d = pendingOf(a);
    expect(d).toMatchObject({ kind: "file", accept: [".pdf", ".txt"], maxBytes: 25 * 1024 * 1024 });
    expect(ui.fileSpec(d.id as string)).toEqual({
      accept: [".pdf", ".txt"],
      maxBytes: 25 * 1024 * 1024,
    });
    expect(ui.answer(d.id as string, "up_00000000000000000000000000000000", a.s)).toBe(false);
    expect(ui.answer(d.id as string, "../../etc/passwd", a.s)).toBe(false);
    const info = await uploads.receive(
      (async function* () {
        yield Buffer.from("abc");
      })(),
      { dialog: "autre", name: "a.txt", maxBytes: 10 },
    );
    expect(ui.answer(d.id as string, info.id, a.s)).toBe(false);
    const mine = await uploads.receive(
      (async function* () {
        yield Buffer.from("abc");
      })(),
      { dialog: d.id as string, name: "a.txt", maxBytes: 10 },
    );
    expect(ui.answer(d.id as string, mine.id, a.s)).toBe(true);
    await expect(p).resolves.toBe(mine.id);
    expect(uploads.take(mine.id)?.size).toBe(3);
  });

  it("file : annulation = null et fichier supprimé ; accept vide refusé", async () => {
    const a = sink();
    shell.add(a.s);
    await expect(ui.file({ title: "T", accept: [] })).resolves.toBeNull();
    await expect(ui.file({ title: "T", accept: ["../x"] })).resolves.toBeNull();
    const p = ui.file({ title: "T", accept: ["txt"] });
    const d = pendingOf(a);
    await uploads.receive(
      (async function* () {
        yield Buffer.from("abc");
      })(),
      { dialog: d.id as string, name: "a.txt", maxBytes: 10 },
    );
    expect(ui.answer(d.id as string, null, a.s)).toBe(true);
    await expect(p).resolves.toBeNull();
    await flush();
    expect(await readdir(join(dir, "uploads"))).toEqual([]);
  });
});

describe("HostUi : attente, arrêt, plafond, cibles", () => {
  it("sans réponse : en attente, puis null/false à l'arrêt", async () => {
    const a = sink();
    shell.add(a.s);
    let settled = false;
    const p = ui.input({ title: "T", label: "L" }).then((v) => {
      settled = true;
      return v;
    });
    const c = ui.confirm({ title: "T", text: "x" });
    await flush();
    expect(settled).toBe(false);
    ui.dispose();
    await expect(p).resolves.toBeNull();
    await expect(c).resolves.toBe(false);
    // Après l'arrêt : refus immédiat, aucune diffusion.
    const before = a.sent.length;
    await expect(ui.confirm({ title: "T", text: "x" })).resolves.toBe(false);
    expect(a.sent.length).toBe(before);
  });

  it("plafond de 32 dialogues : null sans diffusion", async () => {
    const a = sink();
    shell.add(a.s);
    for (let i = 0; i < MAX_PENDING_DIALOGS; i++) void ui.input({ title: "T", label: "L" });
    expect(a.sent.filter((m) => m.type === "dialog")).toHaveLength(MAX_PENDING_DIALOGS);
    await expect(ui.input({ title: "T", label: "L" })).resolves.toBeNull();
    await expect(ui.confirm({ title: "T", text: "x" })).resolves.toBe(false);
    expect(a.sent.filter((m) => m.type === "dialog")).toHaveLength(MAX_PENDING_DIALOGS);
  });

  it("deux sockets : la première réponse valide gagne, la seconde est ignorée", async () => {
    const a = sink();
    const b = sink();
    shell.add(a.s);
    shell.add(b.s);
    const p = ui.confirm({ title: "T", text: "x" });
    const id = pendingOf(a).id as string;
    expect(pendingOf(b).id).toBe(id);
    expect(ui.answer(id, true, b.s)).toBe(true);
    expect(ui.answer(id, false, a.s)).toBe(false);
    await expect(p).resolves.toBe(true);
    expect(a.last("dialogClosed")).toBeDefined();
    expect(b.last("dialogClosed")).toBeDefined();
  });

  it("ciblé : seul le socket émetteur reçoit et peut répondre ; repli si fermé", async () => {
    const a = sink();
    const b = sink();
    shell.add(a.s);
    shell.add(b.s);
    const p = ui.confirm({ title: "T", text: "x" }, a.s);
    const id = pendingOf(a).id as string;
    expect(b.last("dialog")).toBeUndefined();
    expect(ui.answer(id, true, b.s)).toBe(false);
    // Le socket émetteur se ferme : l'autre reçoit la question.
    shell.delete(a.s);
    ui.detach(a.s);
    expect(pendingOf(b).id).toBe(id);
    expect(ui.answer(id, true, b.s)).toBe(true);
    await expect(p).resolves.toBe(true);
  });

  it("une coquille qui se connecte plus tard reçoit les dialogues en attente", () => {
    const a = sink();
    void ui.confirm({ title: "T", text: "x" });
    shell.add(a.s);
    ui.attach(a.s);
    expect(a.last("dialog")).toBeDefined();
  });

  it("réponse d'un socket inconnu ou pour un id inconnu : ignorée", () => {
    const a = sink();
    const z = sink();
    shell.add(a.s);
    void ui.confirm({ title: "T", text: "x" });
    expect(ui.answer(pendingOf(a).id as string, true, z.s)).toBe(false);
    expect(ui.answer("nope", true, a.s)).toBe(false);
  });
});

describe("dialogResult : validation de forme", () => {
  it("accepte les valeurs bornées, refuse le reste", () => {
    expect(parseShellControl({ type: "dialogResult", id: "a-b_1", value: null })).toEqual({
      type: "dialogResult",
      id: "a-b_1",
      value: null,
    });
    expect(parseShellControl({ type: "dialogResult", id: "a", value: ["x"] })).not.toBeNull();
    expect(parseShellControl({ type: "dialogResult", id: "a", value: true })).not.toBeNull();
    expect(parseShellControl({ type: "dialogResult", id: "a/b", value: null })).toBeNull();
    expect(parseShellControl({ type: "dialogResult", id: "a", value: 3 })).toBeNull();
    expect(parseShellControl({ type: "dialogResult", id: "a", value: { x: 1 } })).toBeNull();
    expect(parseShellControl({ type: "dialogResult", id: "a", value: [1] })).toBeNull();
    expect(parseShellControl({ type: "dialogResult", id: "a" })).toBeNull();
    expect(parseShellControl({ type: "dialogResult", id: "a", value: null, extra: 1 })).toBeNull();
    expect(
      parseShellControl({ type: "dialogResult", id: "a", value: "a".repeat(4097) }),
    ).toBeNull();
  });
});

describe("UploadStore", () => {
  const body = (...parts: string[]) =>
    (async function* () {
      for (const p of parts) yield Buffer.from(p);
    })();

  it("écrit sous le dossier, en 0600, nom client jamais utilisé comme chemin", async () => {
    for (const name of ["../x", "a\0b.txt", "..\\..\\etc\\passwd", "/etc/passwd", ".."]) {
      const info = await uploads.receive(body("hé"), { dialog: "d", name, maxBytes: 100 });
      expect(info.id).toMatch(/^up_[0-9a-f]{32}$/);
      expect(info.name).not.toMatch(/[\\/\0]|^\./);
      const taken = uploads.take(info.id);
      expect(taken?.path).toBe(join(dir, "uploads", info.id));
      expect((await stat(taken?.path ?? "")).mode & 0o777).toBe(0o600);
      expect(await readFile(taken?.path ?? "", "utf8")).toBe("hé");
    }
    expect((await readdir(dir)).sort()).toEqual(["uploads"]);
  });

  it("trop gros : flux interrompu, aucun fichier restant", async () => {
    await expect(
      uploads.receive(body("aaaa", "bbbb", "cccc"), { dialog: "d", name: "a.txt", maxBytes: 6 }),
    ).rejects.toThrow();
    expect(await readdir(join(dir, "uploads"))).toEqual([]);
  });

  it("usage unique, release supprime", async () => {
    const info = await uploads.receive(body("x"), { dialog: "d", name: "a.txt", maxBytes: 5 });
    const t = uploads.take(info.id);
    expect(t).toMatchObject({ name: "a.txt", size: 1 });
    expect(uploads.take(info.id)).toBeUndefined();
    await t?.release();
    expect(await readdir(join(dir, "uploads"))).toEqual([]);
  });

  it("expiration à 15 min (horloge simulée), prise comprise", async () => {
    let t = 1_000;
    const u = new UploadStore({ dir: join(dir, "u2"), now: () => t, sweepMs: 0 });
    const a = await u.receive(body("x"), { dialog: "d", name: "a.txt", maxBytes: 5 });
    t += 14 * 60_000;
    expect(u.owns(a.id, "d")).toBe(true);
    t += 2 * 60_000;
    expect(u.take(a.id)).toBeUndefined();
    await u.sweep();
    await flush();
    expect(await readdir(join(dir, "u2"))).toEqual([]);
    const b = await u.receive(body("x"), { dialog: "d", name: "a.txt", maxBytes: 5 });
    expect(u.take(b.id)).toBeDefined();
    t += 16 * 60_000;
    await u.sweep();
    await flush();
    expect(await readdir(join(dir, "u2"))).toEqual([]);
    await u.dispose();
  });

  it("un nouvel envoi remplace le précédent du dialogue ; purge vide le dossier", async () => {
    const a = await uploads.receive(body("1"), { dialog: "d", name: "a.txt", maxBytes: 5 });
    const b = await uploads.receive(body("2"), { dialog: "d", name: "b.txt", maxBytes: 5 });
    expect(uploads.owns(a.id, "d")).toBe(false);
    expect(uploads.owns(b.id, "d")).toBe(true);
    await uploads.purge();
    expect(await readdir(join(dir, "uploads"))).toEqual([]);
    expect(uploads.owns(b.id, "d")).toBe(false);
  });
});

describe("pont : dialogResult via la WebSocket de la coquille", () => {
  const ctx = useStorage();

  it("aller-retour, réponse invalide ignorée, hors coquille ignorée", async () => {
    const t = setup(ctx);
    const s = shellOf(t);
    const other = t.connect(); // jamais annoncé comme coquille
    const p = t.hub.context.ui.confirm({ title: "T", text: "x" });
    const d = s.of("shell", "dialog")[0]?.msg as Msg;
    expect(d).toMatchObject({ kind: "confirm" });
    expect(other.of("shell", "dialog")).toEqual([]);
    other.say("shell", "shell", { type: "dialogResult", id: d.id, value: true });
    s.say("shell", "shell", { type: "dialogResult", id: d.id, value: "oui" });
    await flush();
    expect(t.bridge.stats().ignored).toBeGreaterThanOrEqual(2);
    s.say("shell", "shell", { type: "dialogResult", id: d.id, value: true });
    await expect(p).resolves.toBe(true);
    expect(s.of("shell", "dialogClosed")).toHaveLength(1);
    // Réponse tardive ignorée sans configError.
    s.say("shell", "shell", { type: "dialogResult", id: d.id, value: false });
    await flush();
    expect(s.of("shell", "configError")).toEqual([]);
  });

  it("arrêt du hub : dialogue refusé, jamais accepté", async () => {
    const t = setup(ctx);
    shellOf(t);
    const p = t.hub.context.ui.confirm({ title: "T", text: "x" });
    t.hub.dispose();
    await expect(p).resolves.toBe(false);
  });

  it("n'interfère pas avec les approbations", async () => {
    const t = setup(ctx);
    const s = shellOf(t);
    void approval("x");
    expect(s.of("shell", "dialog")).toEqual([]);
  });
});
