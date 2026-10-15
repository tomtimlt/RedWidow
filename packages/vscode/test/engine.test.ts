import { realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRunner, EngineEvent } from "@john-studio/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FAKE_SANDBOX_ID, goodInspect } from "../../core/test/helpers.js";
import { type EngineChannel, runEngine } from "../src/engine/engine.js";
import { type FromEngine, parseToEngine } from "../src/logic/protocol.js";

/** Canal factice : le test joue le rôle du parent. */
function fakeChannel() {
  const sent: FromEngine[] = [];
  let onMessage: (raw: unknown) => void = () => {};
  let onDisconnect: () => void = () => {};
  const channel: EngineChannel = {
    send: async (m) => void sent.push(m),
    onMessage: (h) => {
      onMessage = h;
    },
    onDisconnect: (h) => {
      onDisconnect = h;
    },
  };
  return {
    channel,
    sent,
    receive: (raw: unknown) => onMessage(raw),
    disconnect: () => onDisconnect(),
  };
}

const idleRunner: AgentRunner = {
  run: ({ prompt }) =>
    new Promise((resolve) => {
      // Se termine quand le flux de consignes est clos (dispose, abort ou déconnexion).
      void (async () => {
        for await (const _ of prompt as AsyncIterable<string>) {
          // consignes ignorées
        }
        resolve({ status: "success", turns: 0, costUsd: 0, result: null });
      })();
    }),
};

let cwd: string;
beforeAll(async () => {
  cwd = await mkdtemp(join(tmpdir(), "john-engine-"));
});
afterAll(() => rm(cwd, { recursive: true, force: true }));

const codes = (sent: FromEngine[]) =>
  sent.flatMap((m) => (m.type === "error" ? [m.reason.code] : []));

const engineEvents = (sent: FromEngine[]) =>
  sent.flatMap((m) => (m.type === "event" ? [m.event] : []));

const sandboxLifecycle = (events: EngineEvent[]) =>
  events.filter((e) => e.kind === "sandbox.started" || e.kind === "sandbox.stopped");

/** Faux docker bac à sable : retient le runId du `run` pour le `container inspect` suivant. */
async function fakeEngineSandboxDocker() {
  const dir = await mkdtemp(join(realpathSync.native(tmpdir()), "john-engine-fake-docker-"));
  const script = join(dir, "docker.mjs");
  const log = join(dir, "calls.log");
  const ctl = join(dir, "ctl.json");
  await writeFile(ctl, "{}");
  await writeFile(
    script,
    `import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const [, , ...argv] = process.argv;
appendFileSync(${JSON.stringify(log)}, argv.join("|") + "|\\n");
const c = JSON.parse(readFileSync(${JSON.stringify(ctl)}, "utf8"));
const out = (s) => process.stdout.write(s + "\\n");
const fail = (s) => { process.stderr.write(s + "\\n"); process.exit(1); };
const [a, b] = argv;
const labelKey = "io.john-studio.sandbox";
const readRunId = () => {
  const i = argv.indexOf("--label");
  if (i >= 0 && argv[i + 1] === labelKey && argv[i + 2]) return argv[i + 2];
  const j = argv.findIndex((x) => x.startsWith(labelKey + "="));
  if (j >= 0) return argv[j].slice(labelKey.length + 1);
  return c.runId ?? "missing-run";
};
if (a === "image" && b === "inspect") {
  out(JSON.stringify([{ Id: "sha256:img", RepoDigests: ["alpine@sha256:digest"] }]));
} else if (a === "run") {
  const runId = readRunId();
  writeFileSync(${JSON.stringify(ctl)}, JSON.stringify({ ...c, runId }));
  out(${JSON.stringify(FAKE_SANDBOX_ID)});
} else if (a === "container" && b === "inspect") {
  const runId = c.runId ?? readRunId();
  out(JSON.stringify([${JSON.stringify(goodInspect("RUNID_PLACEHOLDER")).replace(
    '"RUNID_PLACEHOLDER"',
    "runId",
  )}]));
} else if (a === "exec") {
  if (argv.includes("hang")) setInterval(() => {}, 1000);
  else out("exec-ok");
} else if (a === "rm") {
  out(argv[argv.length - 1]);
}
`,
  );
  return {
    bin: process.execPath,
    argsPrefix: [script],
    calls: async () => (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean),
    dir,
  };
}

const startWithSandbox = (cwd: string) => ({
  v: 1,
  type: "start" as const,
  cwd,
  sandbox: {
    image: "alpine:3.20",
    timeoutSec: 600,
    network: "none" as const,
    memory: "2g",
    cpus: 2,
  },
});

describe("moteur : bac à sable (session unique)", () => {
  it("un seul run docker pour deux consignes ; dispose nettoie avec runEnd", async () => {
    const fake = await fakeEngineSandboxDocker();
    const t = fakeChannel();
    const done = runEngine({
      channel: t.channel,
      createRunner: () => idleRunner,
      docker: { binary: fake.bin, argsPrefix: fake.argsPrefix },
    });
    t.receive(startWithSandbox(cwd));
    await vi.waitFor(() => expect(t.sent.some((m) => m.type === "started")).toBe(true));
    t.receive({ v: 1, type: "prompt", text: "première" });
    t.receive({ v: 1, type: "prompt", text: "deuxième" });
    await vi.waitFor(() =>
      expect(sandboxLifecycle(engineEvents(t.sent)).some((e) => e.kind === "sandbox.started")).toBe(
        true,
      ),
    );
    const started = sandboxLifecycle(engineEvents(t.sent)).filter(
      (e) => e.kind === "sandbox.started",
    );
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ containerId: FAKE_SANDBOX_ID });

    const callsBeforeEnd = await fake.calls();
    expect(callsBeforeEnd.filter((c) => c.startsWith("run|"))).toHaveLength(1);

    t.receive({ v: 1, type: "dispose" });
    expect(await done).toBe(0);

    const calls = await fake.calls();
    expect(calls.filter((c) => c.startsWith("run|"))).toHaveLength(1);
    const rmCall = calls.find((c) => c.startsWith("rm|"));
    expect(rmCall).toContain("--force");
    expect(rmCall).toContain(FAKE_SANDBOX_ID);
    expect(sandboxLifecycle(engineEvents(t.sent))).toMatchObject([
      { kind: "sandbox.started", containerId: FAKE_SANDBOX_ID },
      { kind: "sandbox.stopped", cause: "runEnd" },
    ]);
    await rm(fake.dir, { recursive: true, force: true });
  });

  it("abort nettoie le conteneur et journalise sandbox.stopped cause abort", async () => {
    const fake = await fakeEngineSandboxDocker();
    const t = fakeChannel();
    const done = runEngine({
      channel: t.channel,
      createRunner: () => idleRunner,
      docker: { binary: fake.bin, argsPrefix: fake.argsPrefix },
    });
    t.receive(startWithSandbox(cwd));
    await vi.waitFor(() =>
      expect(sandboxLifecycle(engineEvents(t.sent)).some((e) => e.kind === "sandbox.started")).toBe(
        true,
      ),
    );
    t.receive({ v: 1, type: "prompt", text: "x" });
    t.receive({ v: 1, type: "abort" });
    expect(await done).toBeTypeOf("number");

    const calls = await fake.calls();
    const rmCall = calls.find((c) => c.startsWith("rm|"));
    expect(rmCall).toContain("--force");
    expect(rmCall).toContain(FAKE_SANDBOX_ID);
    expect(sandboxLifecycle(engineEvents(t.sent))).toMatchObject([
      { kind: "sandbox.started", containerId: FAKE_SANDBOX_ID },
      { kind: "sandbox.stopped", cause: "abort" },
    ]);
    await rm(fake.dir, { recursive: true, force: true });
  });

  it("rejette docker dans le message start (hors protocole)", () => {
    const parsed = parseToEngine({
      v: 1,
      type: "start",
      cwd,
      docker: { binary: process.execPath },
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason.code).toBe("ipc.invalidMessage");
  });
});

describe("moteur : validation des messages reçus", () => {
  it("signale et ignore messages inconnus, mal formés ou d'une autre version", async () => {
    const t = fakeChannel();
    const done = runEngine({ channel: t.channel, createRunner: () => idleRunner });
    t.receive({ v: 1, type: "rm -rf" });
    t.receive({ v: 2, type: "abort" });
    t.receive("garbage");
    t.receive({ v: 1, type: "start", cwd: "relatif" });
    t.receive({ v: 1, type: "dispose", env: { ANTHROPIC_API_KEY: "x" } });
    expect(codes(t.sent)).toEqual([
      "ipc.invalidMessage",
      "ipc.unsupportedVersion",
      "ipc.invalidMessage",
      "ipc.invalidMessage",
      "ipc.invalidMessage",
    ]);
    // Rien n'a démarré ni terminé : seul un dispose valide clôt le moteur.
    t.receive({ v: 1, type: "dispose" });
    expect(await done).toBe(0);
  });

  it("answer sur un toolUseId inconnu est sans effet et signalé ; prompt avant start refusé", async () => {
    const t = fakeChannel();
    const done = runEngine({ channel: t.channel, createRunner: () => idleRunner });
    t.receive({
      v: 1,
      type: "answer",
      toolUseId: "inconnu",
      decision: "allow",
      remember: "always",
    });
    t.receive({ v: 1, type: "prompt", text: "trop tôt" });
    expect(codes(t.sent)).toEqual(["ipc.invalidMessage", "ipc.invalidMessage"]);
    t.receive({ v: 1, type: "dispose" });
    await done;
  });

  it("un échec du runner (ex. binaire altéré) est signalé par un code et termine le moteur", async () => {
    const t = fakeChannel();
    const done = runEngine({
      channel: t.channel,
      createRunner: async () => {
        const { CodedError } = await import("@john-studio/core");
        throw new CodedError("extension.binaryMismatch");
      },
    });
    t.receive({ v: 1, type: "start", cwd });
    expect(await done).toBe(1);
    expect(t.sent.find((m) => m.type === "error")).toMatchObject({
      reason: { code: "extension.binaryMismatch" },
    });
    expect(t.sent.some((m) => m.type === "ended")).toBe(false);
  });

  it("une déconnexion annule le run et termine le moteur", async () => {
    const t = fakeChannel();
    const done = runEngine({ channel: t.channel, createRunner: () => idleRunner });
    t.receive({ v: 1, type: "start", cwd });
    await new Promise((r) => setTimeout(r, 200));
    t.disconnect();
    // Le run s'achève (flux de consignes clos) : le moteur rend la main sans attendre le délai de grâce.
    expect(await done).toBeTypeOf("number");
  });

  it("déconnexion sans réponse du run : arbre de processus tué à la fin du délai de grâce", async () => {
    const t = fakeChannel();
    const killTree = vi.fn();
    const stuck: AgentRunner = { run: () => new Promise(() => {}) };
    const done = runEngine({
      channel: t.channel,
      createRunner: () => stuck,
      disconnectGraceMs: 50,
      killTree,
    });
    t.receive({ v: 1, type: "start", cwd });
    await new Promise((r) => setTimeout(r, 200));
    t.disconnect();
    expect(await done).toBe(1);
    expect(killTree).toHaveBeenCalledOnce();
  });
});

describe("moteur : journal de l'extension (F4)", () => {
  it("écrit dans journalDir (hors du dépôt) et consigne chaque consigne en user.message", async () => {
    const { readFile, readdir } = await import("node:fs/promises");
    const journalDir = await mkdtemp(join(tmpdir(), "john-journal-"));
    const repo = await mkdtemp(join(tmpdir(), "john-repo-"));
    try {
      const t = fakeChannel();
      const done = runEngine({ channel: t.channel, createRunner: () => idleRunner });
      t.receive({ v: 1, type: "start", cwd: repo, journalDir });
      t.receive({ v: 1, type: "prompt", text: "bonjour" });
      await vi.waitFor(() => expect(t.sent.some((m) => m.type === "started")).toBe(true));
      await vi.waitFor(async () => {
        const [name] = await readdir(journalDir);
        expect(await readFile(join(journalDir, name ?? "x"), "utf8")).toContain("user.message");
      });
      t.receive({ v: 1, type: "dispose" });
      t.receive({ v: 1, type: "abort" });
      await done;
      const files = await readdir(journalDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^[0-9a-f-]{36}\.jsonl$/);
      // Rien n'a été écrit dans le dépôt.
      await expect(readdir(join(repo, ".john-studio"))).rejects.toThrow();
    } finally {
      await rm(journalDir, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });
});
