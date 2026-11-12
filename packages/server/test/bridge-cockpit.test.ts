import { mkdir, readdir, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExegolPort } from "../src/bridge/cockpit.js";
import { isOpenWindowMessage } from "../src/bridge/shell-messages.js";
import type { ViewBackends } from "../src/bridge/views.js";
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
import { fakeDocker } from "./docker-fake.js";

const ctx = useStorage();
const settle = () => new Promise((r) => setTimeout(r, 40));

type Cockpit = ViewBackends["cockpit"];

/** Coquille + cockpit abonné sur le même socket (émetteur des dialogues et des ouvertures). */
async function cockpitOf(t: ReturnType<typeof setup>) {
  const s = shellOf(t);
  s.say("cockpit", "ck", { type: "ready" });
  await vi.waitFor(() => expect(s.of("cockpit", "view")).toHaveLength(1));
  return s;
}

const operations = (s: FakeSocket) => s.of("cockpit", "operation").map((e) => e.msg);
const lastOperation = (s: FakeSocket): Msg | undefined => operations(s).at(-1);

const container = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  short: name,
  image: "img",
  state: "running",
  family: "exegol",
  linked: true,
  primary: false,
  canLink: false,
  ...over,
});

function backend(over: Partial<Cockpit> = {}, containers: unknown[] = []): ViewBackends {
  return emptyBackends({
    cockpit: {
      ...emptyBackends().cockpit,
      load: async () => ({ type: "view", containers }) as never,
      ...over,
    },
  });
}

describe("cockpit : gestes simples", () => {
  it("rendered et openWorkspace : ignorés proprement ; openProgram et openEngagement : openWindow", async () => {
    const t = setup(ctx, { backends: backend() });
    const s = await cockpitOf(t);
    s.say("cockpit", "ck", { type: "rendered" });
    s.say("cockpit", "ck", { type: "openWorkspace" });
    s.say("cockpit", "ck", { type: "openProgram" });
    s.say("cockpit", "ck", { type: "openEngagement" });
    await vi.waitFor(() => expect(s.of("shell", "openWindow")).toHaveLength(2));
    expect(s.of("shell", "openWindow").map((e) => e.msg)).toEqual([
      { type: "openWindow", view: "program", frame: "program" },
      { type: "openWindow", view: "engagement", frame: "engagement" },
    ]);
    expect(s.of("shell", "dialog")).toHaveLength(0);
  });

  it("listImages : liste du backend renvoyée à l'émetteur", async () => {
    const t = setup(ctx, { backends: backend({ images: async () => ["a:1", "b:2"] }) });
    const s = await cockpitOf(t);
    s.say("cockpit", "ck", { type: "listImages" });
    await vi.waitFor(() =>
      expect(s.of("cockpit", "images")[0]?.msg).toEqual({ type: "images", images: ["a:1", "b:2"] }),
    );
  });

  it("terminal : un seul conteneur lié en cours → openWindow term ; plusieurs → ui.pick ; aucun → rien", async () => {
    const one = setup(ctx, {
      backends: backend({}, [
        container("exegol-web"),
        container("exegol-off", { state: "stopped" }),
        container("exegol-libre", { linked: false }),
      ]),
    });
    const s1 = await cockpitOf(one);
    s1.say("cockpit", "ck", { type: "terminal" });
    await vi.waitFor(() => expect(s1.of("shell", "openWindow")).toHaveLength(1));
    const w = s1.of("shell", "openWindow")[0]?.msg as Msg;
    expect(isOpenWindowMessage(w)).toBe(true);
    expect(w).toMatchObject({ view: "term", container: "exegol-web" });
    expect(String(w.frame)).toMatch(/^t-[0-9a-f]{8}$/);
    expect(s1.of("shell", "dialog")).toHaveLength(0);
    ctx.hub?.dispose();

    const many = setup(ctx, {
      backends: backend({}, [container("exegol-a"), container("exegol-b", { primary: true })]),
    });
    const s2 = await cockpitOf(many);
    s2.say("cockpit", "ck", { type: "terminal" });
    const d = await nthDialog(s2, 1);
    expect(d.kind).toBe("pick");
    // Le primary est en tête ; seuls les conteneurs liés et démarrés sont proposés.
    expect((d.items as { id: string }[]).map((i) => i.id)).toEqual(["exegol-b", "exegol-a"]);
    await settle();
    expect(s2.of("shell", "openWindow")).toHaveLength(0);
    replyDialog(s2, d, "exegol-a");
    await vi.waitFor(() =>
      expect(s2.of("shell", "openWindow")[0]?.msg).toMatchObject({
        view: "term",
        container: "exegol-a",
      }),
    );
    ctx.hub?.dispose();

    const none = setup(ctx, {
      backends: backend({}, [container("exegol-libre", { linked: false })]),
    });
    const s3 = await cockpitOf(none);
    s3.say("cockpit", "ck", { type: "terminal" });
    await settle();
    expect(s3.of("shell", "openWindow")).toHaveLength(0);
    expect(s3.of("shell", "dialog")).toHaveLength(0);
  });
});

describe("cockpit : remove (confirmation, danger)", () => {
  const make = () => {
    const removed: string[] = [];
    const infos: unknown[] = [];
    const remove: Cockpit["remove"] = async (name, { confirm }) => {
      const info = {
        name,
        family: "kali" as const,
        state: "running" as const,
        force: true,
        projects: [{ name: "Projet A" }],
      };
      infos.push(info);
      const ok = await confirm(info as never);
      if (!ok) return { status: "cancelled", name };
      removed.push(name);
      return { status: "removed", name };
    };
    return { removed, infos, remove };
  };

  it("sans réponse : rien ; refusé : rien ; confirmé (danger) : supprimé et audité", async () => {
    const m = make();
    const t = setup(ctx, { backends: backend({ remove: m.remove }) });
    const s = await cockpitOf(t);
    s.say("cockpit", "ck", { type: "remove", name: "kali1" });
    const d1 = await nthDialog(s, 1);
    expect(d1).toMatchObject({ kind: "confirm", danger: true });
    expect(String(d1.text)).toContain("kali1");
    expect(String(d1.text)).toContain("Projet A");
    await settle();
    expect(m.removed).toEqual([]);
    // L'opération est en cours (occupée) : une autre ne démarre pas.
    expect(lastOperation(s)).toMatchObject({ busy: true });
    replyDialog(s, d1, false);
    await vi.waitFor(() => expect(lastOperation(s)).toMatchObject({ busy: false }));
    expect(m.removed).toEqual([]);

    s.say("cockpit", "ck", { type: "remove", name: "kali1" });
    replyDialog(s, await nthDialog(s, 2), true);
    await vi.waitFor(() => expect(m.removed).toEqual(["kali1"]));
    await vi.waitFor(() =>
      expect(t.audit).toContainEqual({ kind: "containerRemove", container: "kali1" }),
    );
    await vi.waitFor(() => expect(lastOperation(s)).toMatchObject({ busy: false }));
    expect(lastOperation(s)?.error).toBeUndefined();
  });

  it("annulation de la boîte (null) et opération annulée : rien n'est supprimé", async () => {
    const m = make();
    const t = setup(ctx, { backends: backend({ remove: m.remove }) });
    const s = await cockpitOf(t);
    s.say("cockpit", "ck", { type: "remove", name: "kali1" });
    replyDialog(s, await nthDialog(s, 1), null);
    await vi.waitFor(() => expect(lastOperation(s)).toMatchObject({ busy: false }));
    expect(m.removed).toEqual([]);
  });
});

describe("cockpit : VPN téléversé", () => {
  it("fichier .ovpn ≤ 1 Mio stocké sous <données>/vpn en 0600, jamais le chemin client ; supprimé à la fermeture", async () => {
    const t = setup(ctx, { backends: backend() });
    const s = await cockpitOf(t);
    s.say("cockpit", "ck", { type: "pickVpn" });
    const d = await nthDialog(s, 1);
    expect(d).toMatchObject({ kind: "file", accept: [".ovpn"], maxBytes: 1024 * 1024 });
    const id = await uploadFor(
      t,
      s,
      d,
      "../../etc/mon vpn.ovpn",
      "client\nremote vpn.example 1194\n",
    );
    await vi.waitFor(() => expect(s.of("cockpit", "pickedVpn")).toHaveLength(1));
    // Le libellé est le nom assaini du fichier ; aucun chemin dans le message.
    expect(s.of("cockpit", "pickedVpn")[0]?.msg).toEqual({
      type: "pickedVpn",
      label: "mon vpn.ovpn",
    });
    const dir = join(ctx.dir, "vpn");
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{32}\.ovpn$/);
    expect((await stat(join(dir, files[0] as string))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(dir, files[0] as string), "utf8")).toContain("remote vpn.example");
    expect(JSON.stringify(s.sent)).not.toContain(dir);
    // Le téléversement est consommé et supprimé.
    expect(t.hub.context.uploads.take(id)).toBeUndefined();

    // Un second choix remplace le premier (un seul fichier conservé).
    s.say("cockpit", "ck", { type: "pickVpn" });
    await uploadFor(t, s, await nthDialog(s, 2), "b.ovpn", "client\n");
    await vi.waitFor(() => expect(s.of("cockpit", "pickedVpn")).toHaveLength(2));
    expect(await readdir(dir)).toHaveLength(1);

    s.close();
    await vi.waitFor(async () => expect(await readdir(dir)).toHaveLength(0));
  });

  it("fichier binaire ou vide : refusé, rien n'est stocké ; annulation : rien", async () => {
    const t = setup(ctx, { backends: backend() });
    const s = await cockpitOf(t);
    s.say("cockpit", "ck", { type: "pickVpn" });
    await uploadFor(t, s, await nthDialog(s, 1), "x.ovpn", Buffer.from([0x63, 0x00, 0x64]));
    await vi.waitFor(() =>
      expect(s.of("cockpit", "error")[0]?.msg).toEqual({ type: "error", code: "vpn.invalid" }),
    );
    s.say("cockpit", "ck", { type: "pickVpn" });
    replyDialog(s, await nthDialog(s, 2), null);
    await settle();
    expect(await readdir(join(ctx.dir, "vpn")).catch(() => [])).toEqual([]);
    expect(s.of("cockpit", "pickedVpn")).toHaveLength(0);
  });
});

describe("cockpit : dossier partagé", () => {
  it("ne propose que les sous-dossiers réels de <données>/projects (ni fichier, ni lien, ni caché)", async () => {
    const root = ctx.storage.paths.projects;
    await mkdir(join(root, "alpha"));
    await mkdir(join(root, "beta"));
    await mkdir(join(root, ".cache"));
    await writeFile(join(root, "fichier.txt"), "x");
    await symlink("/tmp", join(root, "lien"));
    const t = setup(ctx, { backends: backend() });
    const s = await cockpitOf(t);
    s.say("cockpit", "ck", { type: "pickSharedFolder" });
    const d = await nthDialog(s, 1);
    expect(d.kind).toBe("pick");
    expect((d.items as { id: string }[]).map((i) => i.id)).toEqual(["alpha", "beta"]);
    // Un identifiant hors liste (chemin libre) est refusé par HostUi : le dialogue reste ouvert.
    replyDialog(s, d, "/etc");
    replyDialog(s, d, "../..");
    await settle();
    expect(s.of("cockpit", "pickedSharedFolder")).toHaveLength(0);
    replyDialog(s, d, "beta");
    await vi.waitFor(() =>
      expect(s.of("cockpit", "pickedSharedFolder")[0]?.msg).toEqual({
        type: "pickedSharedFolder",
        path: "beta",
      }),
    );
  });

  it("aucun sous-dossier : erreur claire, pas de dialogue", async () => {
    const t = setup(ctx, { backends: backend() });
    const s = await cockpitOf(t);
    s.say("cockpit", "ck", { type: "pickSharedFolder" });
    await vi.waitFor(() =>
      expect(s.of("cockpit", "error")[0]?.msg).toEqual({ type: "error", code: "folder.none" }),
    );
    expect(s.of("shell", "dialog")).toHaveLength(0);
  });
});

describe("cockpit : création d'un Kali (API Engine) et d'un Exegol (CLI du serveur)", () => {
  let docker: Awaited<ReturnType<typeof fakeDocker>>;
  beforeEach(async () => {
    docker = await fakeDocker([]);
  });
  afterEach(async () => {
    ctx.hub?.dispose();
    await ctx.hub?.settled();
    await docker.close();
  });

  const fakeExegol = (over: Partial<ExegolPort> = {}) => {
    const calls = { prepare: [] as unknown[], run: [] as unknown[][] };
    const port: ExegolPort = {
      installed: () => true,
      prepare: async (o) => (
        calls.prepare.push(o), { shellPath: "/usr/bin/exegol", shellArgs: ["start", o.name] }
      ),
      run: (shellPath, argv, signal) =>
        new Promise((done) => {
          calls.run.push([shellPath, [...argv]]);
          signal.addEventListener("abort", () => done(null), { once: true });
        }),
      pollMs: 10,
      ...over,
    };
    return { port, calls };
  };

  it("createKali : conteneur créé par l'API Engine (sans privilège), audité ; nom pris ou invalide refusé", async () => {
    const t = setup(ctx, { docker: docker.api, backends: backend() });
    const s = await cockpitOf(t);
    s.say("cockpit", "ck", { type: "createKali", image: "redwidow-kali:local", name: "mon-kali" });
    await vi.waitFor(() => expect(lastOperation(s)).toMatchObject({ busy: false }));
    expect(lastOperation(s)?.error).toBeUndefined();
    expect(docker.ctl.created).toHaveLength(1);
    const body = (docker.ctl.created[0] as { body: Record<string, unknown> }).body;
    expect(body).not.toHaveProperty("HostConfig.Privileged");
    expect(body).not.toHaveProperty("HostConfig.Binds");
    expect(t.audit).toContainEqual({ kind: "containerCreate", container: "mon-kali" });
    const before = t.bridge.stats().ignored;
    s.say("cockpit", "ck", { type: "createKali", image: "x", name: "mauvais nom" });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(before + 1));
  });

  it("createExegol sans binaire : erreur claire, aucun processus lancé", async () => {
    const e = fakeExegol({ installed: () => false });
    const t = setup(ctx, { docker: docker.api, exegol: e.port, backends: backend() });
    const s = await cockpitOf(t);
    s.say("cockpit", "ck", { type: "createExegol", name: "web" });
    await vi.waitFor(() =>
      expect(lastOperation(s)).toMatchObject({ busy: false, code: "exegol.notInstalled" }),
    );
    expect(lastOperation(s)?.error).toBe("Exegol n’est pas installé dans cette image");
    expect(e.calls.prepare).toEqual([]);
    expect(e.calls.run).toEqual([]);
  });

  it("createExegol : VPN absent, réseau incompatible, dossier non choisi, nom déjà pris : erreurs sans processus", async () => {
    const e = fakeExegol();
    const t = setup(ctx, {
      docker: docker.api,
      exegol: e.port,
      backends: backend({}, [container("exegol-pris", { short: "pris" })]),
    });
    const s = await cockpitOf(t);
    const expectCode = async (msg: Msg, code: string) => {
      const n = operations(s).length;
      s.say("cockpit", "ck", msg);
      await vi.waitFor(() => expect(operations(s).length).toBeGreaterThanOrEqual(n + 2));
      expect(lastOperation(s)).toMatchObject({ busy: false, code });
    };
    await expectCode({ type: "createExegol", name: "web", vpn: true }, "exegol.vpnMissing");
    await expectCode(
      { type: "createExegol", name: "web", desktop: true, network: "host" },
      "exegol.needsNat",
    );
    await expectCode({ type: "createExegol", name: "pris" }, "container.exists");
    await expectCode({ type: "createExegol", name: "web" }, "exegol.folderMissing");
    expect(e.calls.run).toEqual([]);
  });

  it("createExegol : dossier choisi dans la liste, CLI exécutée sans terminal, conteneur détecté, CLI arrêtée", async () => {
    await mkdir(join(ctx.storage.paths.projects, "equipe"));
    const real = await realpath(join(ctx.storage.paths.projects, "equipe"));
    const d2 = await fakeDocker([
      {
        id: "b".repeat(64),
        name: "exegol-web",
        image: "nwodtuhs/exegol:free",
        running: true,
        labels: { "org.exegol.version": "6" },
      },
    ]);
    const e = fakeExegol();
    const t = setup(ctx, { docker: d2.api, exegol: e.port, backends: backend() });
    const s = await cockpitOf(t);
    s.say("cockpit", "ck", { type: "pickSharedFolder" });
    replyDialog(s, await nthDialog(s, 1), "equipe");
    await vi.waitFor(() => expect(s.of("cockpit", "pickedSharedFolder")).toHaveLength(1));
    s.say("cockpit", "ck", { type: "createExegol", name: "web", desktop: false, network: "nat" });
    await vi.waitFor(() => expect(lastOperation(s)).toMatchObject({ busy: false }));
    expect(lastOperation(s)?.error).toBeUndefined();
    expect(String(lastOperation(s)?.message)).toContain("Conteneur créé");
    expect(e.calls.prepare).toEqual([
      expect.objectContaining({
        name: "web",
        workspacePath: real,
        network: "nat",
        desktop: false,
        gui: false,
      }),
    ]);
    expect(e.calls.prepare[0]).not.toHaveProperty("vpnPath");
    expect(e.calls.run).toEqual([["/usr/bin/exegol", ["start", "web"]]]);
    expect(t.audit).toContainEqual({ kind: "exegolCreate", container: "exegol-web" });
    await d2.close();
  });

  it("createExegol : la CLI s'arrête sans conteneur → exegol.createFailed ; VPN stocké supprimé ; cancelOperation sans erreur", async () => {
    await mkdir(join(ctx.storage.paths.projects, "equipe"));
    const e = fakeExegol({ run: async () => 1 });
    const t = setup(ctx, { docker: docker.api, exegol: e.port, backends: backend() });
    const s = await cockpitOf(t);
    s.say("cockpit", "ck", { type: "pickSharedFolder" });
    replyDialog(s, await nthDialog(s, 1), "equipe");
    await vi.waitFor(() => expect(s.of("cockpit", "pickedSharedFolder")).toHaveLength(1));
    s.say("cockpit", "ck", { type: "pickVpn" });
    await uploadFor(t, s, await nthDialog(s, 2), "v.ovpn", "client\n");
    await vi.waitFor(() => expect(s.of("cockpit", "pickedVpn")).toHaveLength(1));
    s.say("cockpit", "ck", { type: "createExegol", name: "web", vpn: true });
    await vi.waitFor(() =>
      expect(lastOperation(s)).toMatchObject({ busy: false, code: "exegol.createFailed" }),
    );
    // Les arguments transmis à la CLI portent le chemin interne du VPN, jamais un chemin du client.
    expect(e.calls.prepare[0]).toMatchObject({
      vpnPath: expect.stringContaining(join(ctx.dir, "vpn")),
    });
    expect(await readdir(join(ctx.dir, "vpn"))).toEqual([]);

    // Annulation pendant l'attente du conteneur.
    const e2 = fakeExegol();
    ctx.hub?.dispose();
    const t2 = setup(ctx, { docker: docker.api, exegol: e2.port, backends: backend() });
    const s2 = await cockpitOf(t2);
    s2.say("cockpit", "ck", { type: "pickSharedFolder" });
    replyDialog(s2, await nthDialog(s2, 1), "equipe");
    await vi.waitFor(() => expect(s2.of("cockpit", "pickedSharedFolder")).toHaveLength(1));
    s2.say("cockpit", "ck", { type: "createExegol", name: "web" });
    await vi.waitFor(() => expect(e2.calls.run).toHaveLength(1));
    s2.say("cockpit", "ck", { type: "cancelOperation" });
    await vi.waitFor(() => expect(lastOperation(s2)).toMatchObject({ busy: false }));
    expect(lastOperation(s2)?.error).toBeUndefined();
  });
});
