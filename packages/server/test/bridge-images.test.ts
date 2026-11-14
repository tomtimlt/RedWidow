import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodedError } from "@warband/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultExegol, type ExegolPort } from "../src/bridge/cockpit.js";
import { createImageOps, type ImageOps } from "../src/bridge/images.js";
import { parseShellControl } from "../src/bridge/shell-messages.js";
import {
  emptyBackends,
  type FakeSocket,
  type Msg,
  nthDialog,
  replyDialog,
  setup,
  shellOf,
  useStorage,
} from "./bridge-helpers.js";
import { fakeDocker } from "./docker-fake.js";

const ctx = useStorage();
const KALI = "warband/kali:complete-1";

const progress = (s: FakeSocket) => s.of("shell", "imageProgress").map((e) => e.msg);
const lastProgress = (s: FakeSocket): Msg | undefined => progress(s).at(-1);
const lastOperation = (s: FakeSocket): Msg | undefined => s.of("cockpit", "operation").at(-1)?.msg;
const exegolOf = (s: FakeSocket, n: number) =>
  (s.of("shell", "images")[n]?.msg ?? {}).exegol as { installed: unknown; eulaAccepted: boolean };

/** Faux client `docker` : `image inspect` répond selon un marqueur ; `build` enregistre ses arguments et son entrée. */
async function fakeDockerBinary(dir: string) {
  const marker = join(dir, "built");
  const file = join(dir, "docker");
  await writeFile(
    file,
    `#!/usr/bin/env node
const fs = require("node:fs");
const a = process.argv.slice(2);
if (a[0] === "image" && a[1] === "inspect") process.exit(fs.existsSync(${JSON.stringify(marker)}) ? 0 : 1);
if (a[0] === "build") {
  let d = "";
  process.stdin.on("data", (c) => (d += c)).on("end", () => {
    fs.writeFileSync(${JSON.stringify(marker)}, a.join(" ") + "\\n" + d);
    process.exit(0);
  });
} else process.exit(2);
`,
  );
  await chmod(file, 0o755);
  return { file, marker };
}

function fakeExegol(over: Partial<ExegolPort> = {}) {
  const state = { accepted: false, accept: 0, prepare: 0, run: 0 };
  const port: ExegolPort = {
    installed: () => true,
    eulaAccepted: async () => state.accepted,
    acceptEula: async () => {
      state.accept++;
      state.accepted = true;
      return 0;
    },
    prepare: async (o) => (
      state.prepare++, { shellPath: "/usr/bin/exegol", shellArgs: ["start", o.name] }
    ),
    run: (_p, _a, signal) =>
      new Promise((done) => {
        state.run++;
        signal.addEventListener("abort", () => done(null), { once: true });
      }),
    pollMs: 10,
    ...over,
  };
  return { port, state };
}

/** Opérations injectées : enregistrent les appels ; `pull` ajoute l'image au faux démon. */
function fakeOps(docker: Awaited<ReturnType<typeof fakeDocker>>, over: Partial<ImageOps> = {}) {
  const calls = { pull: [] as string[], build: 0 };
  const ops: ImageOps = {
    dockerPresent: () => true,
    pull: async (image, o) => {
      calls.pull.push(image);
      o.onProgress({ stage: "pull", status: "x", layers: [], complete: true });
      docker.images.push({ tags: [image], size: 1 });
    },
    buildKali: async (o) => {
      calls.build++;
      o.onProgress({ stage: "build", status: "build", layers: [], complete: false });
      docker.images.push({ tags: [KALI], size: 5 });
    },
    ...over,
  };
  return { ops, calls };
}

describe("messages shell des images : validation", () => {
  it("étiquettes Exegol : seules les étiquettes simples passent ; formes exactes", () => {
    const ok = (tag: unknown) =>
      parseShellControl({ type: "imageInstall", kind: "exegol", tag }) !== null;
    for (const good of ["free", "full", "nightly", "4.3.1", "web", "a_b-c.d"])
      expect(ok(good)).toBe(true);
    for (const bad of [
      "../x",
      "a b",
      "a;b",
      "a".repeat(65),
      "Free",
      "-x",
      ".x",
      "",
      "x/y",
      "x:y",
      "$(id)",
      3,
      null,
    ])
      expect(ok(bad)).toBe(false);
    expect(parseShellControl({ type: "imageInstall", kind: "exegol" })).toBeNull();
    expect(
      parseShellControl({ type: "imageInstall", kind: "exegol", tag: "free", x: 1 }),
    ).toBeNull();
    expect(parseShellControl({ type: "imageInstall", kind: "kali" })).toEqual({
      type: "imageInstall",
      kind: "kali",
      rebuild: false,
    });
    expect(parseShellControl({ type: "imageInstall", kind: "kali", rebuild: "oui" })).toBeNull();
    expect(parseShellControl({ type: "imageInstall", kind: "autre" })).toBeNull();
    expect(parseShellControl({ type: "imageCancel", id: "0123456789abcdef" })).not.toBeNull();
    expect(parseShellControl({ type: "imageCancel", id: "../x" })).toBeNull();
    expect(parseShellControl({ type: "imagesStatus" })).toEqual({ type: "imagesStatus" });
    expect(parseShellControl({ type: "exegolEula" })).toEqual({ type: "exegolEula" });
    expect(parseShellControl({ type: "exegolEula", accept: true })).toBeNull();
  });
});

describe("images depuis le web", () => {
  let docker: Awaited<ReturnType<typeof fakeDocker>>;
  let dir: string;
  beforeEach(async () => {
    docker = await fakeDocker([], []);
    dir = await mkdtemp(join(tmpdir(), "rw-img-"));
  });
  afterEach(async () => {
    ctx.hub?.dispose();
    await ctx.hub?.settled();
    await docker.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("imagesStatus : démon, Kali absent, Exegol (CLI, contrat, images locales avec taille, étiquettes proposées)", async () => {
    docker.images.push({ tags: ["nwodtuhs/exegol:full", "nwodtuhs/exegol:full-4.3"], size: 42 });
    const e = fakeExegol();
    const o = fakeOps(docker);
    const t = setup(ctx, {
      docker: docker.api,
      exegol: e.port,
      images: o.ops,
      backends: emptyBackends(),
    });
    const s = shellOf(t);
    s.say("shell", "shell", { type: "imagesStatus" });
    await vi.waitFor(() => expect(s.of("shell", "images")).toHaveLength(1));
    expect(s.of("shell", "images")[0]?.msg).toEqual({
      type: "images",
      docker: { present: true, daemon: true },
      kali: { image: KALI, installed: false },
      exegol: {
        cli: true,
        eulaAccepted: false,
        installed: [
          { tag: "full", size: 42 },
          { tag: "full-4.3", size: 42 },
        ],
        available: ["free", "full", "light", "web", "osint", "ad", "nightly"],
      },
    });
  });

  it("Kali absent : pull de la base par l'API Engine (couches) puis docker build du Dockerfile du cœur, progression diffusée", async () => {
    const bin = await fakeDockerBinary(dir);
    const ops = createImageOps({ socketPath: docker.socketPath, dockerBinary: bin.file });
    const t = setup(ctx, {
      docker: docker.api,
      exegol: fakeExegol().port,
      images: ops,
      backends: emptyBackends(),
    });
    const s = shellOf(t);
    s.say("shell", "shell", { type: "imageInstall", kind: "kali", rebuild: false });
    await vi.waitFor(() => expect(lastProgress(s)).toMatchObject({ busy: false, done: true }));
    expect(
      docker.find("POST", /^\/images\/create\?fromImage=kalilinux%2Fkali-rolling%3Alatest$/),
    ).toHaveLength(1);
    const built = await readFile(bin.marker, "utf8");
    expect(built).toMatch(/^build --progress plain --pull=false -t warband\/kali:complete-1 -\n/);
    expect(built).toContain("FROM kalilinux/kali-rolling:latest");
    const rows = progress(s);
    expect(rows.some((r) => r.phase === "pull" && (r.layers as unknown[]).length > 0)).toBe(true);
    expect(rows.some((r) => r.phase === "build" && r.busy === true)).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    expect(t.audit).toContainEqual({ kind: "imageInstall", image: KALI });
  });

  it("Kali déjà présent : ni pull ni build", async () => {
    const bin = await fakeDockerBinary(dir);
    await writeFile(bin.marker, "déjà là");
    const ops = createImageOps({ socketPath: docker.socketPath, dockerBinary: bin.file });
    const t = setup(ctx, {
      docker: docker.api,
      exegol: fakeExegol().port,
      images: ops,
      backends: emptyBackends(),
    });
    const s = shellOf(t);
    s.say("shell", "shell", { type: "imageInstall", kind: "kali", rebuild: false });
    await vi.waitFor(() => expect(lastProgress(s)).toMatchObject({ busy: false, done: true }));
    expect(docker.find("POST", /images\/create/)).toHaveLength(0);
    expect(await readFile(bin.marker, "utf8")).toBe("déjà là");
  });

  it("Kali : « Reconstruire » retire l'image locale (jamais forcé) puis la reconstruit ; image utilisée : refus clair", async () => {
    docker.images.push({ tags: [KALI], size: 1 });
    const o = fakeOps(docker);
    const t = setup(ctx, {
      docker: docker.api,
      exegol: fakeExegol().port,
      images: o.ops,
      backends: emptyBackends(),
    });
    const s = shellOf(t);
    s.say("shell", "shell", { type: "imageInstall", kind: "kali", rebuild: true });
    await vi.waitFor(() => expect(lastProgress(s)).toMatchObject({ busy: false, done: true }));
    expect(docker.find("DELETE", /^\/images\/warband\/kali:complete-1$/)).toHaveLength(1);
    expect(docker.find("DELETE", /force/)).toHaveLength(0);
    expect(o.calls.build).toBe(1);
  });

  it("Exegol : contrat non accepté → refus (rien n'est téléchargé) ; accepté → pull de nwodtuhs/exegol:<tag>, image listée", async () => {
    const e = fakeExegol();
    const bin = await fakeDockerBinary(dir);
    const ops = createImageOps({ socketPath: docker.socketPath, dockerBinary: bin.file });
    const t = setup(ctx, {
      docker: docker.api,
      exegol: e.port,
      images: ops,
      backends: emptyBackends(),
    });
    const s = shellOf(t);
    s.say("shell", "shell", { type: "imageInstall", kind: "exegol", tag: "full" });
    await vi.waitFor(() =>
      expect(lastProgress(s)).toMatchObject({ busy: false, code: "exegol.eulaRequired" }),
    );
    expect(docker.find("POST", /images\/create/)).toHaveLength(0);

    e.state.accepted = true;
    s.say("shell", "shell", { type: "imageInstall", kind: "exegol", tag: "full" });
    await vi.waitFor(() => expect(lastProgress(s)).toMatchObject({ busy: false, done: true }));
    expect(
      docker.find("POST", /^\/images\/create\?fromImage=nwodtuhs%2Fexegol%3Afull$/),
    ).toHaveLength(1);
    s.say("shell", "shell", { type: "imagesStatus" });
    await vi.waitFor(() => expect(s.of("shell", "images")).toHaveLength(1));
    expect(exegolOf(s, 0).installed).toEqual([{ tag: "full", size: 1_000_000 }]);
  });

  it("tag invalide ou second install : refus clairs, aucun pull", async () => {
    const e = fakeExegol();
    e.state.accepted = true;
    docker.ctl.pull = "hang";
    const pulls: string[] = [];
    const o = fakeOps(docker, {
      pull: (image, x) =>
        new Promise((_ok, ko) => {
          pulls.push(image);
          x.signal.addEventListener("abort", () => ko(new Error("stop")));
        }),
    });
    o.calls.pull = pulls;
    const t = setup(ctx, {
      docker: docker.api,
      exegol: e.port,
      images: o.ops,
      backends: emptyBackends(),
    });
    const s = shellOf(t);
    const before = t.bridge.stats().ignored;
    s.say("shell", "shell", { type: "imageInstall", kind: "exegol", tag: "../x" });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(before + 1));
    expect(o.calls.pull).toEqual([]);

    s.say("shell", "shell", { type: "imageInstall", kind: "exegol", tag: "free" });
    await vi.waitFor(() => expect(lastProgress(s)).toMatchObject({ busy: true, kind: "exegol" }));
    s.say("shell", "shell", { type: "imageInstall", kind: "exegol", tag: "full" });
    await vi.waitFor(() => expect(s.of("shell", "imageError")).toHaveLength(1));
    expect(s.of("shell", "imageError")[0]?.msg).toMatchObject({ code: "image.busy" });
    expect(String(s.of("shell", "imageError")[0]?.msg.text)).toContain("déjà en cours");

    // Le cockpit est refusé de la même façon pendant l'installation.
    s.say("cockpit", "ck", { type: "ready" });
    await vi.waitFor(() => expect(s.of("cockpit", "view")).toHaveLength(1));
    s.say("cockpit", "ck", { type: "createKali", image: "x", name: "k1" });
    await vi.waitFor(() =>
      expect(lastOperation(s)).toMatchObject({ busy: false, code: "image.busy" }),
    );
    expect(docker.ctl.created).toHaveLength(0);
    await vi.waitFor(() => expect(o.calls.pull).toEqual(["nwodtuhs/exegol:free"]));

    // Annulation : arrêt propre, et la place est libérée.
    const id = String(lastProgress(s)?.id);
    s.say("shell", "shell", { type: "imageCancel", id });
    await vi.waitFor(() => expect(lastProgress(s)).toMatchObject({ busy: false, cancelled: true }));
    s.say("shell", "shell", { type: "imageInstall", kind: "exegol", tag: "full" });
    await vi.waitFor(() =>
      expect(o.calls.pull).toEqual(["nwodtuhs/exegol:free", "nwodtuhs/exegol:full"]),
    );
  });

  it("annulation d'un vrai pull (flux ouvert) : requête abandonnée, annulation diffusée", async () => {
    docker.ctl.pull = "hang";
    const e = fakeExegol();
    e.state.accepted = true;
    const bin = await fakeDockerBinary(dir);
    const ops = createImageOps({ socketPath: docker.socketPath, dockerBinary: bin.file });
    const t = setup(ctx, {
      docker: docker.api,
      exegol: e.port,
      images: ops,
      backends: emptyBackends(),
    });
    const s = shellOf(t);
    s.say("shell", "shell", { type: "imageInstall", kind: "exegol", tag: "free" });
    await vi.waitFor(() =>
      expect(progress(s).some((r) => (r.layers as unknown[]).length > 0)).toBe(true),
    );
    s.say("shell", "shell", { type: "imageCancel", id: String(lastProgress(s)?.id) });
    await vi.waitFor(() => expect(lastProgress(s)).toMatchObject({ busy: false, cancelled: true }));
    expect(lastProgress(s)?.error).toBeUndefined();
    // Un identifiant inconnu n'annule rien.
    const before = t.bridge.stats().ignored;
    s.say("shell", "shell", { type: "imageCancel", id: "0123456789abcdef" });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(before + 1));
  });

  it("erreur 429 de Docker Hub (statut ou flux) : message clair, sans détail brut", async () => {
    const e = fakeExegol();
    e.state.accepted = true;
    const bin = await fakeDockerBinary(dir);
    const ops = createImageOps({ socketPath: docker.socketPath, dockerBinary: bin.file });
    const t = setup(ctx, {
      docker: docker.api,
      exegol: e.port,
      images: ops,
      backends: emptyBackends(),
    });
    const s = shellOf(t);
    for (const mode of ["http429", "stream429"] as const) {
      docker.ctl.pull = mode;
      s.say("shell", "shell", { type: "imageInstall", kind: "exegol", tag: "free" });
      await vi.waitFor(() =>
        expect(lastProgress(s)).toMatchObject({ busy: false, code: "image.rateLimited" }),
      );
      expect(String(lastProgress(s)?.error)).toMatch(/429.*Docker Hub|Docker Hub.*429/);
      progress(s).length = 0;
      s.sent.length = 0;
    }
  });

  it("sortie d'erreur masquée et bornée avant diffusion", async () => {
    const secret = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef";
    const e = fakeExegol();
    e.state.accepted = true;
    docker.ctl.pull = "streamError";
    docker.ctl.pullError = `échec avec ${secret} ${"x".repeat(5000)}`;
    const bin = await fakeDockerBinary(dir);
    const ops = createImageOps({ socketPath: docker.socketPath, dockerBinary: bin.file });
    const t = setup(ctx, {
      docker: docker.api,
      exegol: e.port,
      images: ops,
      backends: emptyBackends(),
    });
    const s = shellOf(t);
    s.say("shell", "shell", { type: "imageInstall", kind: "exegol", tag: "free" });
    await vi.waitFor(() =>
      expect(lastProgress(s)).toMatchObject({ busy: false, code: "docker.failed" }),
    );
    const text = String(lastProgress(s)?.error);
    expect(text).not.toContain(secret);
    expect(text).not.toContain("ABCDEFGHIJKLMNOP");
    expect(text.length).toBeLessThan(700);
  });

  it("exegolEula : sans confirmation humaine, aucune acceptation ; avec, une seule exécution, lien officiel proposé", async () => {
    const e = fakeExegol();
    const t = setup(ctx, {
      docker: docker.api,
      exegol: e.port,
      images: fakeOps(docker).ops,
      backends: emptyBackends(),
    });
    const s = shellOf(t);
    s.say("shell", "shell", { type: "exegolEula" });
    const link = await nthDialog(s, 1);
    expect(link).toMatchObject({ kind: "external", url: "https://docs.exegol.com/legal/eula" });
    replyDialog(s, link, false);
    const confirm = await nthDialog(s, 2);
    expect(confirm).toMatchObject({ kind: "confirm", danger: false });
    expect(String(confirm.text)).toContain("https://docs.exegol.com/legal/eula");
    expect(String(confirm.text)).toContain("contrat d'utilisation d'Exegol");
    replyDialog(s, confirm, false);
    await vi.waitFor(() =>
      expect(s.of("shell", "dialogClosed").length + 0).toBeGreaterThanOrEqual(0),
    );
    await new Promise((r) => setTimeout(r, 40));
    expect(e.state.accept).toBe(0);
    expect(t.audit.filter((a) => a.kind === "exegolEula")).toHaveLength(0);

    s.say("shell", "shell", { type: "exegolEula" });
    replyDialog(s, await nthDialog(s, 3), false);
    replyDialog(s, await nthDialog(s, 4), true);
    await vi.waitFor(() => expect(e.state.accept).toBe(1));
    await vi.waitFor(() => expect(s.of("shell", "images")).toHaveLength(2));
    expect(exegolOf(s, 1).eulaAccepted).toBe(true);
    expect(t.audit).toContainEqual({ kind: "exegolEula" });
  });

  it("CLI Exegol réelle (faux binaire) : version sans acceptation → non ; --accept-eula exact → oui", async () => {
    const state = join(dir, "accepted");
    const log = join(dir, "argv.log");
    const bindir = join(dir, "bin");
    await mkdir(bindir);
    await writeFile(
      join(bindir, "exegol"),
      `#!/usr/bin/env node
const fs = require("node:fs");
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + "\\n");
if (a.includes("--accept-eula")) fs.writeFileSync(${JSON.stringify(state)}, "1");
if (!fs.existsSync(${JSON.stringify(state)})) {
  console.log("[?] I confirm that I've read and accepted the EULA (https://docs.exegol.com/legal/eula) [y/N]:");
  process.exit(1);
}
console.log("[*] Exegol Community is currently in version v6.0.2");
`,
    );
    await chmod(join(bindir, "exegol"), 0o755);
    const old = process.env.PATH;
    process.env.PATH = `${bindir}:${old}`;
    try {
      const port = defaultExegol();
      const signal = new AbortController().signal;
      expect(port.installed()).toBe(true);
      expect(await port.eulaAccepted(signal)).toBe(false);
      expect(await port.acceptEula(signal)).toBe(0);
      expect(await port.eulaAccepted(signal)).toBe(true);
      const calls = (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      expect(calls).toEqual([["version"], ["version", "--accept-eula"], ["version"]]);
    } finally {
      process.env.PATH = old;
    }
  });

  it("createKali (cockpit) sans image : installation avec progression, puis création ; image présente : aucune installation", async () => {
    const o = fakeOps(docker);
    const t = setup(ctx, {
      docker: docker.api,
      exegol: fakeExegol().port,
      images: o.ops,
      backends: emptyBackends(),
    });
    const s = shellOf(t);
    s.say("cockpit", "ck", { type: "ready" });
    await vi.waitFor(() => expect(s.of("cockpit", "view")).toHaveLength(1));
    s.say("cockpit", "ck", { type: "createKali", image: "x", name: "k1" });
    await vi.waitFor(() => expect(lastOperation(s)).toMatchObject({ busy: false }));
    expect(lastOperation(s)?.error).toBeUndefined();
    expect(o.calls.build).toBe(1);
    expect(docker.ctl.created).toHaveLength(1);
    const ops = s.of("cockpit", "operation").map((e) => e.msg);
    expect(
      ops.some((m) => m.busy === true && String(m.stage).includes("Installation des outils Kali")),
    ).toBe(true);
    // La coquille suit la même installation.
    expect(progress(s).some((m) => m.kind === "kali" && m.done === true)).toBe(true);

    s.say("cockpit", "ck", { type: "createKali", image: "x", name: "k2" });
    await vi.waitFor(() => expect(docker.ctl.created).toHaveLength(2));
    expect(o.calls.build).toBe(1);
  });

  it("createKali : l'installation échoue → rien n'est créé, ni dossier partagé", async () => {
    const o = fakeOps(docker, {
      buildKali: async () => {
        throw new CodedError("image.rateLimited");
      },
    });
    const t = setup(ctx, {
      docker: docker.api,
      exegol: fakeExegol().port,
      images: o.ops,
      backends: emptyBackends(),
    });
    const s = shellOf(t);
    s.say("cockpit", "ck", { type: "ready" });
    await vi.waitFor(() => expect(s.of("cockpit", "view")).toHaveLength(1));
    s.say("cockpit", "ck", { type: "createKali", image: "x", name: "k1" });
    await vi.waitFor(() =>
      expect(lastOperation(s)).toMatchObject({ busy: false, code: "image.rateLimited" }),
    );
    expect(docker.ctl.created).toHaveLength(0);
    await expect(readFile(join(ctx.storage.paths.containers, "k1", "notes"))).rejects.toThrow();
  });

  it("createExegol sans contrat : dialogue d'acceptation ; refus → rien n'est lancé ; acceptation → la création continue", async () => {
    docker.images.push({ tags: ["nwodtuhs/exegol:free"], size: 1 });
    const e = fakeExegol();
    const t = setup(ctx, {
      docker: docker.api,
      exegol: e.port,
      images: fakeOps(docker).ops,
      backends: emptyBackends(),
    });
    const s = shellOf(t);
    s.say("cockpit", "ck", { type: "ready" });
    await vi.waitFor(() => expect(s.of("cockpit", "view")).toHaveLength(1));
    s.say("cockpit", "ck", { type: "createExegol", name: "web", network: "nat" });
    replyDialog(s, await nthDialog(s, 1), false); // lien
    replyDialog(s, await nthDialog(s, 2), false); // refus du contrat
    await vi.waitFor(() =>
      expect(lastOperation(s)).toMatchObject({ busy: false, code: "exegol.eulaRequired" }),
    );
    expect(e.state.accept).toBe(0);
    expect(e.state.prepare).toBe(0);
    expect(e.state.run).toBe(0);

    s.say("cockpit", "ck", { type: "createExegol", name: "web", network: "nat" });
    replyDialog(s, await nthDialog(s, 3), false);
    replyDialog(s, await nthDialog(s, 4), true);
    await vi.waitFor(() => expect(e.state.prepare).toBe(1));
    expect(e.state.accept).toBe(1);
  });

  it("createExegol, image absente : proposition d'installation ; refus → rien lancé ; accord → pull puis création", async () => {
    const e = fakeExegol();
    e.state.accepted = true;
    const o = fakeOps(docker);
    const t = setup(ctx, {
      docker: docker.api,
      exegol: e.port,
      images: o.ops,
      backends: emptyBackends(),
    });
    const s = shellOf(t);
    s.say("cockpit", "ck", { type: "ready" });
    await vi.waitFor(() => expect(s.of("cockpit", "view")).toHaveLength(1));
    s.say("cockpit", "ck", { type: "createExegol", name: "web", image: "full", network: "nat" });
    const ask = await nthDialog(s, 1);
    expect(ask).toMatchObject({ kind: "confirm" });
    expect(String(ask.text)).toContain("full");
    replyDialog(s, ask, false);
    await vi.waitFor(() => expect(lastOperation(s)).toMatchObject({ busy: false }));
    expect(String(lastOperation(s)?.message)).toContain("annulée");
    expect(o.calls.pull).toEqual([]);
    expect(e.state.prepare).toBe(0);

    s.say("cockpit", "ck", { type: "createExegol", name: "web", image: "full", network: "nat" });
    replyDialog(s, await nthDialog(s, 2), true);
    await vi.waitFor(() => expect(e.state.prepare).toBe(1));
    expect(o.calls.pull).toEqual(["nwodtuhs/exegol:full"]);
  });
});
