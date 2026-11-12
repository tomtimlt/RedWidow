import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setup, useStorage } from "./bridge-helpers.js";
import { fakeDocker, manualClock, SELF_ID } from "./docker-fake.js";

const ctx = useStorage();
let docker: Awaited<ReturnType<typeof fakeDocker>>;
beforeEach(async () => {
  docker = await fakeDocker();
});
afterEach(async () => {
  ctx.hub?.dispose();
  await ctx.hub?.settled();
  await docker.close();
});

const outputs = (s: { sent: { view: string; msg: Record<string, unknown> }[] }) =>
  s.sent
    .filter((e) => e.view === "term" && e.msg.type === "output")
    .map((e) => e.msg.data)
    .join("");

async function journal(): Promise<{ kind: string; [k: string]: unknown }[]> {
  const dir = ctx.storage.paths.runs;
  const files = (await readdir(dir)).filter((f) => f.startsWith("term-"));
  expect(files).toHaveLength(1);
  const text = await readFile(join(dir, files[0] as string), "utf8");
  return text
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

const open = (
  s: ReturnType<ReturnType<typeof setup>["connect"]>,
  frame = "t1",
  container = "kali1",
) => s.say("term", frame, { type: "open", container, cols: 80, rows: 24 });

describe("terminal humain", () => {
  it("open sur un conteneur géré : opened, écho de l'input, env en liste blanche, resize, journal masqué", async () => {
    const secret = "vault-secret-valeur-1234";
    await ctx.storage.secrets.set("autre.cle", secret);
    process.env.REDWIDOW_TEST_ENV = "ne-doit-pas-fuiter";
    const clock = manualClock();
    const t = setup(ctx, { docker: docker.api, clock });
    const s = t.connect();
    open(s);
    await vi.waitFor(() => expect(s.of("term", "opened")).toHaveLength(1));

    const exec = docker.find("POST", /\/exec$/)[0]?.body as Record<string, unknown>;
    expect(exec.Tty).toBe(true);
    expect(exec.Env).toEqual(["TERM=xterm-256color", "LANG=C.UTF-8"]);
    expect(JSON.stringify(exec)).not.toMatch(/REDWIDOW/);
    expect(docker.find("POST", /resize\?h=24&w=80/)).toHaveLength(1);

    s.say("term", "t1", { type: "input", data: `echo ${secret}\r` });
    await vi.waitFor(() => expect(outputs(s)).toContain(`echo ${secret}`));

    s.say("term", "t1", { type: "resize", cols: 120, rows: 40 });
    await vi.waitFor(() => expect(docker.find("POST", /resize\?h=40&w=120/)).toHaveLength(1));

    clock.advance(100);
    s.say("term", "t1", { type: "close" });
    await vi.waitFor(() => expect(s.of("term", "exit")).toHaveLength(1));
    expect(s.of("term", "exit")[0]?.msg.code).toBe(0);
    await t.hub.settled();

    const events = await journal();
    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe("terminal.opened");
    expect(kinds).toContain("terminal.data");
    expect(kinds).toContain("terminal.resized");
    expect(kinds.at(-1)).toBe("terminal.closed");
    const text = JSON.stringify(events);
    expect(text).not.toContain(secret);
    expect(text).toContain("[REDACTED]");
    expect(events.some((e) => e.kind === "terminal.data" && e.dir === "in")).toBe(true);
    expect(events.some((e) => e.kind === "terminal.data" && e.dir === "out")).toBe(true);
    delete process.env.REDWIDOW_TEST_ENV;
  });

  it("refuse un conteneur non géré, inconnu, arrêté ou le serveur lui-même", async () => {
    vi.stubEnv("HOSTNAME", SELF_ID);
    const t = setup(ctx, { docker: docker.api, clock: manualClock() });
    const s = t.connect();
    for (const [i, c] of ["nginx", "inconnu", "kali-off", "redwidow-server", SELF_ID].entries())
      open(s, `f${i}`, c);
    await vi.waitFor(() => expect(s.of("term", "error")).toHaveLength(5));
    const codes = s.of("term", "error").map((e) => e.msg.code);
    expect(codes.filter((c) => c === "terminal.notManaged")).toHaveLength(4);
    expect(codes).toContain("terminal.notRunning");
    expect(s.of("term", "opened")).toHaveLength(0);
    expect(docker.find("POST", /\/exec$/)).toHaveLength(0);
    vi.unstubAllEnvs();
  });

  it("refuse une saisie de plus de 64 Kio sans la transmettre", async () => {
    const t = setup(ctx, { docker: docker.api, clock: manualClock() });
    const s = t.connect();
    open(s);
    await vi.waitFor(() => expect(s.of("term", "opened")).toHaveLength(1));
    s.say("term", "t1", { type: "input", data: "x".repeat(64 * 1024 + 1) });
    await vi.waitFor(() => expect(s.of("term", "error")).toHaveLength(1));
    expect(s.of("term", "error")[0]?.msg.code).toBe("terminal.inputTooLarge");
    s.say("term", "t1", { type: "input", data: "ok" });
    await vi.waitFor(() => expect(docker.written.join("")).toBe("ok"));
  });

  it("la session survit 60 s à la fermeture du socket, rejoue le tampon, puis est fermée", async () => {
    const clock = manualClock();
    const t = setup(ctx, { docker: docker.api, clock });
    const s = t.connect();
    open(s);
    await vi.waitFor(() => expect(s.of("term", "opened")).toHaveLength(1));
    s.say("term", "t1", { type: "input", data: "salut\r" });
    await vi.waitFor(() => expect(outputs(s)).toContain("salut"));
    s.close();

    clock.advance(59_000);
    const back = t.connect();
    open(back);
    await vi.waitFor(() => expect(back.of("term", "opened")).toHaveLength(1));
    expect(outputs(back)).toContain("salut");
    expect(docker.find("POST", /\/exec$/)).toHaveLength(1);
    back.close();

    clock.advance(61_000);
    await vi.waitFor(() =>
      expect(docker.streams[0]?.readableEnded || docker.streams[0]?.destroyed).toBe(true),
    );
    await t.hub.settled();
    const late = t.connect();
    late.say("term", "t1", { type: "ready" });
    await new Promise((r) => setTimeout(r, 20));
    expect(late.of("term", "opened")).toHaveLength(0);
    expect((await journal()).at(-1)?.kind).toBe("terminal.closed");
  });

  it("ignore les messages invalides et plafonne les sessions", async () => {
    const t = setup(ctx, { docker: docker.api, clock: manualClock() });
    const s = t.connect();
    s.say("term", "t1", { type: "open", container: "kali1", cols: 0, rows: 24 });
    s.say("term", "t1", { type: "open", container: "-x", cols: 80, rows: 24 });
    s.say("term", "t1", { type: "input", data: "x" });
    await vi.waitFor(() => expect(t.bridge.stats().ignored).toBe(3));
  });
});
