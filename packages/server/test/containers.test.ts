import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyBackends, setup, shellOf, useStorage } from "./bridge-helpers.js";
import { fakeDocker, SELF_ID } from "./docker-fake.js";

const ctx = useStorage();
let docker: Awaited<ReturnType<typeof fakeDocker>>;
beforeEach(async () => {
  docker = await fakeDocker();
  // Image Kali des tests de création (`REDWIDOW_KALI_IMAGE`) : présente, donc aucune installation (ADR 0057).
  docker.images.push({ tags: ["kali:test"], size: 1 });
});
afterEach(async () => {
  ctx.hub?.dispose();
  await docker.close();
});

describe("écran Conteneurs", () => {
  it("containersList ne renvoie que les conteneurs gérés, hors serveur", async () => {
    vi.stubEnv("HOSTNAME", SELF_ID);
    const t = setup(ctx, { docker: docker.api, backends: emptyBackends() });
    const s = shellOf(t);
    s.say("shell", "shell", { type: "containersList" });
    await vi.waitFor(() => expect(s.of("shell", "containers")).toHaveLength(1));
    const items = s.of("shell", "containers")[0]?.msg.items as {
      name: string;
      kind: string;
      state: string;
    }[];
    expect(items.map((i) => [i.name, i.kind, i.state])).toEqual([
      ["kali1", "kali", "running"],
      ["exegol-web", "exegol", "running"],
      ["kali-off", "kali", "stopped"],
    ]);
    vi.unstubAllEnvs();
  });

  it("start et stop : refusés hors périmètre, diffusés sinon", async () => {
    const t = setup(ctx, { docker: docker.api });
    const s = shellOf(t);
    s.say("shell", "shell", { type: "containerStop", id: "nginx" });
    await vi.waitFor(() => expect(s.of("shell", "containerError")).toHaveLength(1));
    expect(s.of("shell", "containerError")[0]?.msg.code).toBe("terminal.notManaged");
    expect(docker.find("POST", /\/stop/)).toHaveLength(0);

    s.say("shell", "shell", { type: "containerStart", id: "kali-off" });
    await vi.waitFor(() => expect(s.of("shell", "containers")).toHaveLength(1));
    expect(docker.find("POST", new RegExp(`/containers/${"c".repeat(64)}/start`))).toHaveLength(1);
    expect(t.audit.some((e) => e.kind === "containerStart")).toBe(true);
  });

  it("containerCreate : dossier partagé créé, Kali étiqueté, seul montage <dossier>:/workspace", async () => {
    vi.stubEnv("REDWIDOW_TOOLS_NETWORK", "outils");
    vi.stubEnv("REDWIDOW_KALI_IMAGE", "kali:test");
    const t = setup(ctx, { docker: docker.api });
    const s = shellOf(t);
    s.say("shell", "shell", { type: "containerCreate", kind: "kali", name: "mon-kali" });
    await vi.waitFor(() => expect(s.of("shell", "containers")).toHaveLength(1));
    const folder = join(ctx.storage.paths.containers, "mon-kali");
    // Racine RedWidow dans le dossier partagé, créé en 0700.
    expect((await readdir(folder)).sort()).toEqual([
      "evidence",
      "notes",
      "payloads",
      "reports",
      "scans",
      "scripts",
    ]);
    expect((await stat(folder)).mode & 0o777).toBe(0o700);
    const created = docker.ctl.created[0] as { url: string; body: Record<string, unknown> };
    expect(created.url).toContain("name=mon-kali");
    expect(created.body.Image).toBe("kali:test");
    expect(created.body.Labels).toEqual({
      "io.warband.runtime": "kali",
      "io.warband.workspace": "mon-kali",
    });
    expect(created.body.HostConfig).toEqual({
      Binds: [`${folder}:/workspace`],
      NetworkMode: "outils",
    });
    // Jamais de privilège, de socket Docker, de périphérique ni d'autre montage.
    expect(JSON.stringify(created.body)).not.toMatch(/Privileged|docker\.sock|Mounts|Devices/);
    // Le dossier partagé est annoncé par son nom, jamais par un chemin hôte.
    const items = s.of("shell", "containers")[0]?.msg.items as { name: string; folder?: string }[];
    expect(items.find((i) => i.name === "mon-kali")).toMatchObject({
      folder: "mon-kali",
      projects: [],
    });
    expect(JSON.stringify(s.sent)).not.toContain(ctx.dir);
    vi.unstubAllEnvs();
  });

  it("containerCreate : un dossier partagé déjà présent est refusé, rien n'est créé ni touché", async () => {
    const folder = join(ctx.storage.paths.containers, "pris");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "important.txt"), "garde-moi");
    const t = setup(ctx, { docker: docker.api });
    const s = shellOf(t);
    s.say("shell", "shell", { type: "containerCreate", kind: "kali", name: "pris" });
    await vi.waitFor(() => expect(s.of("shell", "containerError")).toHaveLength(1));
    expect(s.of("shell", "containerError")[0]?.msg.code).toBe("container.folderExists");
    expect(docker.ctl.created).toHaveLength(0);
    expect(await readdir(folder)).toEqual(["important.txt"]);
  });

  it("containerCreate : nom de conteneur Docker déjà pris : refus, le dossier tout juste créé est retiré", async () => {
    const t = setup(ctx, { docker: docker.api });
    const s = shellOf(t);
    s.say("shell", "shell", { type: "containerCreate", kind: "kali", name: "kali1" });
    await vi.waitFor(() => expect(s.of("shell", "containerError")).toHaveLength(1));
    expect(s.of("shell", "containerError")[0]?.msg.code).toBe("container.exists");
    expect(await readdir(ctx.storage.paths.containers)).toEqual([]);
  });

  it("refuse un message de création invalide", async () => {
    const t = setup(ctx, { docker: docker.api });
    const s = shellOf(t);
    s.say("shell", "shell", { type: "containerCreate", kind: "exegol", name: "x" });
    s.say("shell", "shell", { type: "containerCreate", kind: "kali", name: "../x" });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(2));
  });
});
