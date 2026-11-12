import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyBackends, setup, shellOf, useStorage } from "./bridge-helpers.js";
import { fakeDocker, SELF_ID } from "./docker-fake.js";

const ctx = useStorage();
let docker: Awaited<ReturnType<typeof fakeDocker>>;
beforeEach(async () => {
  docker = await fakeDocker();
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

  it("containerCreate : Kali étiqueté, sans Privileged, Binds ni socket Docker", async () => {
    vi.stubEnv("REDWIDOW_TOOLS_NETWORK", "outils");
    vi.stubEnv("REDWIDOW_KALI_IMAGE", "kali:test");
    const t = setup(ctx, { docker: docker.api });
    const s = shellOf(t);
    s.say("shell", "shell", { type: "containerCreate", kind: "kali", name: "mon-kali" });
    await vi.waitFor(() => expect(s.of("shell", "containers")).toHaveLength(1));
    const created = docker.ctl.created[0] as { url: string; body: Record<string, unknown> };
    expect(created.url).toContain("name=mon-kali");
    expect(created.body.Image).toBe("kali:test");
    expect(created.body.Labels).toEqual({ "io.warband.runtime": "kali" });
    const text = JSON.stringify(created.body);
    expect(text).not.toMatch(/Privileged|Binds|docker\.sock|Mounts|Devices/);
    expect(created.body.HostConfig).toEqual({ NetworkMode: "outils" });
    vi.unstubAllEnvs();
  });

  it("refuse un message de création invalide", async () => {
    const t = setup(ctx, { docker: docker.api });
    const s = shellOf(t);
    s.say("shell", "shell", { type: "containerCreate", kind: "exegol", name: "x" });
    s.say("shell", "shell", { type: "containerCreate", kind: "kali", name: "../x" });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(2));
  });
});
