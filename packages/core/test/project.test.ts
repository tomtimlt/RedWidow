import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  activeProject,
  appendFinding,
  associateContainer,
  CodedError,
  createDockerClient,
  createProject,
  createRecorder,
  dissociateContainer,
  link,
  readFindings,
  readProjects,
  removeProject,
  setActiveProject,
  status,
  USER_FINDINGS_FILE,
  USER_PROJECT_FILE,
  unlink,
} from "../src/index.js";
import { fakeDocker } from "./helpers.js";

const FIXED = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const setup = async () => {
  const fake = await fakeDocker();
  const recorder = createRecorder({ runId: "r" });
  const docker = createDockerClient({ recorder, binary: fake.bin, argsPrefix: fake.argsPrefix });
  const configDir = await mkdtemp(join(tmpdir(), "warband-project-"));
  return { fake, docker, configDir };
};

const textOf = (configDir: string) => readFile(join(configDir, USER_PROJECT_FILE), "utf8");

const row = (
  name: string,
  extra: {
    state?: "running" | "stopped";
    family?: "exegol" | "kali";
    workspace?: string;
  } = {},
) => ({
  state: extra.state ?? ("running" as const),
  name,
  image: "img",
  family: extra.family ?? ("exegol" as const),
  ...(extra.workspace !== undefined && { workspace: extra.workspace }),
});

describe("link", () => {
  it("écrit un projet actif pour un conteneur en cours avec workspace", async () => {
    const { docker, configDir } = await setup();
    await link(configDir, "with-ws", docker);
    const file = await readProjects(configDir);
    const active = file === null ? null : activeProject(file);
    expect(active).toMatchObject({
      name: "with-ws",
      workspace: "/host/ws",
      containers: ["with-ws"],
    });
    expect(file?.activeId).toBe(active?.id);
    const mode = (await stat(join(configDir, USER_PROJECT_FILE))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("refuse un conteneur arrêté", async () => {
    const { docker, configDir } = await setup();
    await expect(link(configDir, "paused", docker)).rejects.toMatchObject({
      code: "project.notRunning",
      params: { name: "paused" },
    });
    expect(await readdir(configDir)).toEqual([]);
  });

  it("refuse un conteneur sans workspace", async () => {
    const { docker, configDir } = await setup();
    await expect(link(configDir, "no-ws", docker)).rejects.toMatchObject({
      code: "project.noWorkspace",
      params: { name: "no-ws" },
    });
    expect(await readdir(configDir)).toEqual([]);
  });

  it("refuse un montage qui n'est pas absolu", async () => {
    const { configDir } = await setup();
    const docker = { listLabelPrefix: async () => [row("box", { workspace: "rel/ws" })] };
    await expect(link(configDir, "box", docker)).rejects.toMatchObject({
      code: "project.noWorkspace",
      params: { name: "box" },
    });
    expect(await readdir(configDir)).toEqual([]);
  });

  it("refuse un nom inconnu", async () => {
    const { docker, configDir } = await setup();
    await expect(link(configDir, "missing", docker)).rejects.toMatchObject({
      code: "project.notFound",
      params: { name: "missing" },
    });
  });

  it("écrit le nom réel d'un Kali en cours avec workspace", async () => {
    const { configDir } = await setup();
    const docker = {
      listLabelPrefix: async () => [row("kali-box", { family: "kali", workspace: "/host/kali" })],
    };
    await link(configDir, "kali-box", docker);
    const file = await readProjects(configDir);
    expect(file).not.toBeNull();
    if (file === null) return;
    expect(activeProject(file)).toMatchObject({
      name: "kali-box",
      workspace: "/host/kali",
      containers: ["kali-box"],
    });
  });

  it("n'écrit pas pour un Kali arrêté", async () => {
    const { configDir } = await setup();
    const docker = {
      listLabelPrefix: async () => [
        row("kali-box", { state: "stopped", family: "kali", workspace: "/host/ws" }),
      ],
    };
    await expect(link(configDir, "kali-box", docker)).rejects.toMatchObject({
      code: "project.notRunning",
      params: { name: "kali-box" },
    });
    expect(await readdir(configDir)).toEqual([]);
  });

  it("n'écrit pas pour un Kali sans montage", async () => {
    const { configDir } = await setup();
    const docker = {
      listLabelPrefix: async () => [
        {
          state: "running" as const,
          name: "kali-box",
          image: "kalilinux/kali-rolling",
          family: "kali" as const,
        },
      ],
    };
    await expect(link(configDir, "kali-box", docker)).rejects.toMatchObject({
      code: "project.noWorkspace",
      params: { name: "kali-box" },
    });
    expect(await readdir(configDir)).toEqual([]);
  });

  it("refuse une famille qui n'est ni Exegol ni Kali et n'écrit rien", async () => {
    const { configDir } = await setup();
    const docker = {
      listLabelPrefix: async () => [
        {
          state: "running" as const,
          name: "other",
          image: "debian",
          workspace: "/host/ws",
          family: "debian" as "exegol",
        },
      ],
    };
    await expect(link(configDir, "other", docker)).rejects.toMatchObject({
      code: "project.notExegol",
      params: { name: "other" },
    });
    expect(await readdir(configDir)).toEqual([]);
  });

  it("un second lien garde le premier nom et le premier workspace", async () => {
    const { configDir } = await setup();
    const docker = {
      listLabelPrefix: async () => [
        row("exegol-a", { workspace: "/host/a" }),
        row("exegol-b", { workspace: "/host/b" }),
      ],
    };
    await link(configDir, "exegol-a", docker);
    await link(configDir, "exegol-b", docker);
    const file = await readProjects(configDir);
    expect(file).not.toBeNull();
    if (file === null) return;
    expect(activeProject(file)).toMatchObject({
      name: "a",
      workspace: "/host/a",
      containers: ["exegol-a", "exegol-b"],
    });
  });
});

describe("readProjects", () => {
  it("renvoie null si le fichier est absent", async () => {
    const { configDir } = await setup();
    expect(await readProjects(configDir)).toBeNull();
  });

  it("migre l'ancien objet, même id à la seconde lecture, et déplace les trouvailles", async () => {
    const { configDir } = await setup();
    const legacy = `${JSON.stringify({ container: "exegol-htb1", workspace: "/host/ws" }, null, 2)}\n`;
    await writeFile(join(configDir, USER_PROJECT_FILE), legacy, "utf8");
    const global = "{\n  pas du json de trouvailles\n";
    await writeFile(join(configDir, USER_FINDINGS_FILE), global, "utf8");
    const first = await readProjects(configDir);
    const second = await readProjects(configDir, () => {
      throw new Error("nouvel id");
    });
    expect(second).toEqual(first);
    const active = first === null ? null : activeProject(first);
    expect(active).toMatchObject({
      name: "htb1",
      workspace: "/host/ws",
      containers: ["exegol-htb1"],
    });
    expect(first?.activeId).toBe(active?.id);
    const dest = join(configDir, "projects", active?.id ?? "x", USER_FINDINGS_FILE);
    expect(await readFile(dest, "utf8")).toBe(global);
    await expect(readFile(join(configDir, USER_FINDINGS_FILE), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("laisse le fichier global si la destination existe déjà", async () => {
    const { configDir } = await setup();
    await mkdir(join(configDir, "projects", FIXED), { recursive: true });
    await writeFile(join(configDir, "projects", FIXED, USER_FINDINGS_FILE), "DEST", "utf8");
    await writeFile(join(configDir, USER_FINDINGS_FILE), "GLOBAL", "utf8");
    await writeFile(
      join(configDir, USER_PROJECT_FILE),
      JSON.stringify({ container: "box", workspace: "/host/ws" }),
      "utf8",
    );
    const file = await readProjects(configDir, () => FIXED);
    expect(file?.activeId).toBe(FIXED);
    expect(await readFile(join(configDir, USER_FINDINGS_FILE), "utf8")).toBe("GLOBAL");
    expect(await readFile(join(configDir, "projects", FIXED, USER_FINDINGS_FILE), "utf8")).toBe(
      "DEST",
    );
  });

  it("activeId null avec une liste est valide et n'est pas réécrit", async () => {
    const { configDir } = await setup();
    const body = `${JSON.stringify(
      {
        activeId: null,
        projects: [{ id: FIXED, name: "n", workspace: "/host/ws", containers: [] }],
      },
      null,
      2,
    )}\n`;
    await writeFile(join(configDir, USER_PROJECT_FILE), body, "utf8");
    const file = await readProjects(configDir, () => {
      throw new Error("nouvel id");
    });
    expect(file === null ? null : activeProject(file)).toBeNull();
    expect(await textOf(configDir)).toBe(body);
  });

  it.each([
    ["{pas json", "json tronqué"],
    ['{"container":"","workspace":"/x"}', "container vide"],
    ['{"container":"a","workspace":""}', "workspace vide"],
    ['{"container":"a"}', "clé manquante"],
    ['{"container":"a","workspace":"rel"}', "workspace relatif ancien"],
    ['{"container":"a","workspace":"/w","extra":1}', "clé en trop ancien"],
    [
      JSON.stringify({
        activeId: FIXED,
        projects: [{ id: FIXED, name: "n", workspace: "rel", containers: [] }],
      }),
      "workspace relatif",
    ],
    [
      JSON.stringify({
        activeId: OTHER,
        projects: [{ id: FIXED, name: "n", workspace: "/w", containers: [] }],
      }),
      "activeId inconnu",
    ],
    [
      JSON.stringify({
        activeId: null,
        projects: [{ id: FIXED, name: "n", workspace: "/w", containers: [] }],
        extra: 1,
      }),
      "clé en trop",
    ],
  ])("project.invalid sans réécriture (%s)", async (body) => {
    const { configDir } = await setup();
    await writeFile(join(configDir, USER_PROJECT_FILE), body, "utf8");
    await expect(readProjects(configDir)).rejects.toMatchObject({
      code: "project.invalid",
      params: { reason: "json" },
    });
    expect(await textOf(configDir)).toBe(body);
  });
});

describe("écriture des projets", () => {
  it("createProject active le premier et laisse l'actif inchangé ensuite", async () => {
    const { configDir } = await setup();
    const a = await createProject(configDir, { name: "un", workspace: "/host/un" });
    const b = await createProject(configDir, { name: "deux", workspace: "/host/deux" });
    const file = await readProjects(configDir);
    expect(file?.activeId).toBe(a.id);
    expect(file?.projects.map((p) => p.id)).toEqual([a.id, b.id]);
    expect(b.containers).toEqual([]);
  });

  it("refuse un nom ou un workspace illégal sans écrire", async () => {
    const { configDir } = await setup();
    await expect(
      createProject(configDir, { name: "a\nb", workspace: "/host/ok" }),
    ).rejects.toMatchObject({ code: "project.invalid" });
    await expect(createProject(configDir, { name: "ok", workspace: "rel" })).rejects.toMatchObject({
      code: "project.invalid",
    });
    await expect(
      createProject(configDir, { name: "x".repeat(81), workspace: "/host/ok" }),
    ).rejects.toMatchObject({ code: "project.invalid" });
    expect(await readdir(configDir)).toEqual([]);
  });

  it("setActiveProject refuse un id inconnu", async () => {
    const { configDir } = await setup();
    const a = await createProject(configDir, { name: "un", workspace: "/host/un" });
    const before = await textOf(configDir);
    await expect(setActiveProject(configDir, OTHER)).rejects.toMatchObject({
      code: "project.absent",
    });
    expect(await textOf(configDir)).toBe(before);
    await setActiveProject(configDir, a.id);
    expect((await readProjects(configDir))?.activeId).toBe(a.id);
  });

  it("removeProject du dernier supprime le fichier et garde les trouvailles", async () => {
    const { configDir } = await setup();
    const a = await createProject(configDir, { name: "un", workspace: "/host/un" });
    await appendFinding(configDir, a.id, { kind: "host", label: "h", state: "confirmed" });
    await removeProject(configDir, a.id);
    expect(await readProjects(configDir)).toBeNull();
    expect(await readFindings(configDir, a.id)).toHaveLength(1);
  });

  it("unlink retire l'actif sans en activer un autre", async () => {
    const { configDir } = await setup();
    const a = await createProject(configDir, { name: "un", workspace: "/host/un" });
    const b = await createProject(configDir, { name: "deux", workspace: "/host/deux" });
    await unlink(configDir);
    const file = await readProjects(configDir);
    expect(file?.activeId).toBeNull();
    expect(file?.projects.map((p) => p.id)).toEqual([b.id]);
    await unlink(configDir);
    expect((await readProjects(configDir))?.projects.map((p) => p.id)).toEqual([b.id]);
    await expect(removeProject(configDir, a.id)).rejects.toMatchObject({ code: "project.absent" });
  });

  it("unlink sans fichier ne fait rien", async () => {
    const { configDir } = await setup();
    await unlink(configDir);
    expect(await readdir(configDir)).toEqual([]);
  });

  it("associateContainer stocke le nom réel, y compris un Kali", async () => {
    const { configDir } = await setup();
    const project = await createProject(configDir, { name: "p", workspace: "/host/p" });
    const docker = {
      listLabelPrefix: async () => [row("exegol-htb1", { family: "kali", workspace: "/host/k" })],
    };
    await associateContainer(configDir, project.id, "htb1", docker);
    const again = await textOf(configDir);
    await associateContainer(configDir, project.id, "htb1", docker);
    expect(await textOf(configDir)).toBe(again);
    expect((await readProjects(configDir))?.projects[0]?.containers).toEqual(["exegol-htb1"]);
  });

  it("associateContainer refuse un projet inconnu, un nom ambigu, et le 33e nom", async () => {
    const { configDir } = await setup();
    const project = await createProject(configDir, { name: "p", workspace: "/host/p" });
    const ambiguous = {
      listLabelPrefix: async () => [row("exegol-htb1"), row("htb1")],
    };
    const before = await textOf(configDir);
    await expect(associateContainer(configDir, OTHER, "htb1", ambiguous)).rejects.toMatchObject({
      code: "project.absent",
    });
    await expect(
      associateContainer(configDir, project.id, "htb1", ambiguous),
    ).rejects.toMatchObject({
      code: "project.notFound",
      params: { name: "htb1" },
    });
    expect(await textOf(configDir)).toBe(before);
    const names = Array.from({ length: 32 }, (_, i) => `c${i}`);
    await writeFile(
      join(configDir, USER_PROJECT_FILE),
      JSON.stringify({
        activeId: project.id,
        projects: [{ id: project.id, name: "p", workspace: "/host/p", containers: names }],
      }),
      "utf8",
    );
    const full = await textOf(configDir);
    const docker = { listLabelPrefix: async () => [row("extra")] };
    await expect(associateContainer(configDir, project.id, "extra", docker)).rejects.toMatchObject({
      code: "project.invalid",
    });
    expect(await textOf(configDir)).toBe(full);
  });

  it("dissociateContainer retire un nom stocké", async () => {
    const { configDir } = await setup();
    const project = await createProject(configDir, { name: "p", workspace: "/host/p" });
    const docker = { listLabelPrefix: async () => [row("box")] };
    await associateContainer(configDir, project.id, "box", docker);
    await dissociateContainer(configDir, project.id, "box");
    expect((await readProjects(configDir))?.projects[0]?.containers).toEqual([]);
    await dissociateContainer(configDir, project.id, "box");
    await expect(dissociateContainer(configDir, OTHER, "box")).rejects.toMatchObject({
      code: "project.absent",
    });
  });
});

describe("status", () => {
  it("refuse si aucun projet", async () => {
    const { docker, configDir } = await setup();
    await expect(status(configDir, docker)).rejects.toMatchObject({ code: "project.absent" });
  });

  it("reflète un conteneur en cours", async () => {
    const { docker, configDir } = await setup();
    await link(configDir, "with-ws", docker);
    expect(await status(configDir, docker)).toEqual({
      container: "with-ws",
      workspace: "/host/ws",
      image: "img:1",
      state: "running",
    });
  });

  it("signale absent si le conteneur n'est plus listé", async () => {
    const { docker, configDir } = await setup();
    await writeFile(
      join(configDir, USER_PROJECT_FILE),
      `${JSON.stringify(
        {
          activeId: FIXED,
          projects: [{ id: FIXED, name: "g", workspace: "/host/ws", containers: ["gone"] }],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    expect(await status(configDir, docker)).toEqual({
      container: "gone",
      workspace: "/host/ws",
      image: null,
      state: "absent",
    });
  });

  it("reflète un conteneur arrêté encore listé", async () => {
    const { docker, configDir } = await setup();
    const project = await createProject(configDir, { name: "p", workspace: "/host/ws" });
    await associateContainer(configDir, project.id, "paused", docker);
    expect(await status(configDir, docker)).toEqual({
      container: "paused",
      workspace: "/host/ws",
      image: "img:3",
      state: "stopped",
    });
  });

  it("refuse s'il n'y a pas exactement un nom", async () => {
    const { docker, configDir } = await setup();
    await createProject(configDir, { name: "p", workspace: "/host/ws" });
    await expect(status(configDir, docker)).rejects.toMatchObject({ code: "project.absent" });
  });
});

describe("link erreurs typées", () => {
  it("lève CodedError", async () => {
    const { docker, configDir } = await setup();
    try {
      await link(configDir, "missing", docker);
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CodedError);
    }
  });
});
