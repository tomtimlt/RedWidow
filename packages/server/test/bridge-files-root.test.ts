/**
 * Fichiers créés en root par le conteneur : suppression normale refusée (droits) → suppression en root dans le
 * conteneur démarré, seulement après une seconde confirmation humaine (ADR 0056). Le refus de droits est simulé par
 * le crochet `fsRemove` (les tests ne tournent pas en root, aucun `chown` réel).
 */
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createProject } from "@warband/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { removeAsContainerRoot } from "../src/bridge/rootfs.js";
import { moveProjectIntoFolder } from "../src/bridge/workspaces.js";
import {
  createLinkedProject,
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
const configDir = () => join(ctx.dir, "config");
const ERR = (code: string) => Object.assign(new Error(code), { code });

let docker: Awaited<ReturnType<typeof fakeDocker>>;
let denied = true;
let removed: string[] = [];

const box = (running: boolean) => ({
  id: "a".repeat(64),
  name: "box",
  image: "redwidow-kali:local",
  running,
  labels: { "io.warband.runtime": "kali", "io.warband.workspace": "box" },
});

/** Projet « Mission » dans le dossier partagé `box`, avec `scans/out2/sub/a.txt` (propriété de root, simulée). */
async function boot(running = true) {
  docker = await fakeDocker([box(running)]);
  await mkdir(configDir(), { recursive: true });
  const workspace = join(ctx.storage.paths.containers, "box", "Mission");
  await mkdir(join(workspace, "scans/out2/sub"), { recursive: true });
  await writeFile(join(workspace, "scans/out2/sub/a.txt"), "x");
  await writeFile(join(workspace, "n.md"), "n");
  await createLinkedProject(configDir(), { name: "Mission", workspace });
  denied = true;
  removed = [];
  const t = setup(ctx, {
    backends: emptyBackends(),
    docker: docker.api,
    fsRemove: async (path, recursive) => {
      if (denied && path.endsWith("/scans/out2")) throw ERR("EACCES");
      removed.push(path);
      await rm(path, { recursive, force: false });
    },
  });
  return { t, s: shellOf(t), workspace };
}

const execStarts = () => docker.find("POST", /^\/exec\/[^/]+\/start/);
const execCreates = () => docker.find("POST", /^\/containers\/[^/]+\/exec$/);

async function fsDelete(s: FakeSocket, path: string): Promise<void> {
  s.say("shell", "shell", { type: "fsDelete", path });
}

const reasonOf = (m: Msg | undefined): string => String((m?.reason as Msg | undefined)?.code);
const lastError = (s: FakeSocket): Msg | undefined => s.of("shell", "fsError").at(-1)?.msg;

beforeEach(() => {
  docker = undefined as never;
});
afterEach(async () => {
  await docker?.close();
});

describe("suppression de fichiers créés par root", () => {
  it("suppression normale : aucun exec, aucune seconde question", async () => {
    const { s, workspace } = await boot();
    await fsDelete(s, "n.md");
    replyDialog(s, await nthDialog(s, 1), true);
    await vi.waitFor(() => expect(s.of("shell", "fsDone")).toHaveLength(1));
    await expect(stat(join(workspace, "n.md"))).rejects.toThrow();
    expect(execCreates()).toEqual([]);
    expect(s.of("shell", "dialog")).toHaveLength(1);
  });

  it("refus de droits + conteneur démarré + confirmation : rm -rf en root, sans shell, avec audit", async () => {
    const { t, s, workspace } = await boot();
    docker.ctl.onExec = async (cmd) => {
      const target = cmd.at(-1) ?? "";
      await rm(join(workspace, target.replace("/workspace/Mission/", "")), {
        recursive: true,
      });
    };
    await fsDelete(s, "scans/out2");
    replyDialog(s, await nthDialog(s, 1), true);
    const second = await nthDialog(s, 2);
    expect(second).toMatchObject({ kind: "confirm", danger: true });
    expect(String(second.text)).toContain("appartiennent à root");
    expect(String(second.text)).toContain("box");
    expect(execCreates()).toEqual([]); // rien avant le oui
    replyDialog(s, second, true);
    await vi.waitFor(() => expect(s.of("shell", "fsDone")).toHaveLength(1));
    const [create] = execCreates();
    expect(create?.body).toMatchObject({
      User: "root",
      Tty: false,
      Cmd: ["rm", "-rf", "--", "/workspace/Mission/scans/out2"],
    });
    expect(JSON.stringify(create?.body)).not.toContain("Privileged");
    expect(execStarts()).toHaveLength(1);
    await expect(stat(join(workspace, "scans/out2"))).rejects.toThrow();
    expect(t.audit).toContainEqual({
      kind: "fs.deleteAsRoot",
      container: "box",
      relPath: "Mission/scans/out2",
    });
  });

  it("refus de la seconde confirmation : rien n'est exécuté, message clair", async () => {
    const { s, workspace } = await boot();
    await fsDelete(s, "scans/out2");
    replyDialog(s, await nthDialog(s, 1), true);
    replyDialog(s, await nthDialog(s, 2), false);
    await vi.waitFor(() => expect(lastError(s)).toBeDefined());
    expect(reasonOf(lastError(s))).toBe("fs.rootOwned");
    expect(String(lastError(s)?.message)).toContain("Fichiers créés par le conteneur (root)");
    expect(String(lastError(s)?.message)).not.toContain("opération impossible");
    expect(execCreates()).toEqual([]);
    expect((await stat(join(workspace, "scans/out2"))).isDirectory()).toBe(true);
  });

  it("conteneur arrêté : fs.rootOwned, pas de seconde question ni d'exec", async () => {
    const { s } = await boot(false);
    await fsDelete(s, "scans/out2");
    replyDialog(s, await nthDialog(s, 1), true);
    await vi.waitFor(() => expect(lastError(s)).toBeDefined());
    expect(reasonOf(lastError(s))).toBe("fs.rootOwned");
    expect(String(lastError(s)?.message)).toContain("démarrez le conteneur box");
    expect(s.of("shell", "dialog")).toHaveLength(1);
    expect(execCreates()).toEqual([]);
  });

  it("code de sortie ≠ 0 : erreur claire, rien n'est annoncé comme fait", async () => {
    const { s, t } = await boot();
    docker.ctl.exitCode = 1;
    await fsDelete(s, "scans/out2");
    replyDialog(s, await nthDialog(s, 1), true);
    replyDialog(s, await nthDialog(s, 2), true);
    await vi.waitFor(() => expect(lastError(s)).toBeDefined());
    expect(reasonOf(lastError(s))).toBe("fs.rootRemoveFailed");
    expect(s.of("shell", "fsDone")).toHaveLength(0);
    expect(t.audit.filter((e) => e.kind === "fs.deleteAsRoot")).toEqual([]);
  });
});

describe("removeAsContainerRoot : garde du chemin", () => {
  it.each(["", ".", "..", "../x", "a/../b", "/etc", "a//b", "a/.", "a\\b", "a\nb"])(
    "chemin refusé avant tout appel au démon : %j",
    async (relPath) => {
      docker = await fakeDocker([box(true)]);
      await expect(
        removeAsContainerRoot({ docker: docker.api, container: "box", relPath }),
      ).rejects.toMatchObject({ code: "fs.invalidPath" });
      expect(docker.calls).toEqual([]);
    },
  );

  it("conteneur non géré : refusé ; arrêté : fs.rootOwned, sans exec", async () => {
    docker = await fakeDocker([
      box(false),
      { id: "d".repeat(64), name: "nginx", image: "nginx:latest", running: true },
    ]);
    await expect(
      removeAsContainerRoot({ docker: docker.api, container: "nginx", relPath: "p/x" }),
    ).rejects.toMatchObject({ code: "terminal.notManaged" });
    await expect(
      removeAsContainerRoot({ docker: docker.api, container: "box", relPath: "p/x" }),
    ).rejects.toMatchObject({ code: "fs.rootOwned" });
    expect(execCreates()).toEqual([]);
  });

  it("exec : Cmd en tableau (jamais de shell), root, environnement fixe", async () => {
    docker = await fakeDocker([box(true)]);
    await removeAsContainerRoot({ docker: docker.api, container: "box", relPath: "p/a b;rm" });
    const body = execCreates()[0]?.body as { Cmd: string[]; Env: string[]; User: string };
    expect(body.Cmd).toEqual(["rm", "-rf", "--", "/workspace/p/a b;rm"]);
    expect(body.User).toBe("root");
    expect(body.Env.every((e) => /^(PATH|LANG)=/.test(e))).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/\/bin\/sh|"-c"|Privileged/);
  });
});

describe("déplacement d'un projet : fichiers root", () => {
  it("rename refusé pour droits : fs.rootOwned, jamais de passage en root", async () => {
    docker = await fakeDocker([box(true)]);
    const legacy = join(ctx.dir, "legacy");
    const containers = ctx.storage.paths.containers;
    await mkdir(join(containers, "box"), { recursive: true });
    await mkdir(join(legacy, "P"), { recursive: true });
    await mkdir(configDir(), { recursive: true });
    const project = await createProject(configDir(), { name: "P", workspace: join(legacy, "P") });
    await expect(
      moveProjectIntoFolder({
        configDir: configDir(),
        roots: { containers, legacy },
        project,
        folder: "box",
        container: "box",
        io: {
          rename: async () => {
            throw ERR("EACCES");
          },
        },
      }),
    ).rejects.toMatchObject({ code: "fs.rootOwned" });
    expect(execCreates()).toEqual([]);
  });
});
