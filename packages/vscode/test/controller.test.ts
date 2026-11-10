import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type EngineEvent, type ErrorInfo, type PendingApproval, safeEnv } from "@warband/core";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildEngineEnv,
  createEngineController,
  type EngineHandlers,
} from "../src/logic/controller.js";
import type { EndedSummary } from "../src/logic/protocol.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));
/** Vrai si le processus existe encore. */
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const TOKEN = "oauth-token-0123456789abcdef";

let dir: string; // cwd des runs et scripts temporaires
let engine: string; // moteur de test empaqueté (même chaîne que l'extension : esbuild, ESM)

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "warband-ctl-"));
  engine = join(dir, "engine-fake.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("./fixtures/engine-fake.ts", import.meta.url))],
    outfile: engine,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
    // Les paquets du dépôt sont résolus sur leurs sources (pas de `dist` requis).
    alias: {
      "@warband/core": join(root, "packages/core/src/index.ts"),
      "@warband/agent-sdk": join(root, "packages/agent-sdk/src/index.ts"),
    },
    logLevel: "error",
  });
}, 60_000);

afterAll(() => rm(dir, { recursive: true, force: true }));

/** Enregistre tout ce que le contrôleur relaie. */
function collect() {
  const events: EngineEvent[] = [];
  const approvals: PendingApproval[] = [];
  const errors: ErrorInfo[] = [];
  const logs: string[] = [];
  const ended: EndedSummary[] = [];
  const exits: { code: number | null; signal: NodeJS.Signals | null; stderrTail?: string }[] = [];
  const handlers: EngineHandlers = {
    onEvent: (e) => void events.push(e),
    onApproval: (a) => void approvals.push(a),
    onError: (r) => void errors.push(r),
    onLog: (t) => void logs.push(t),
    onEnded: (s) => void ended.push(s),
    onExit: (i) => void exits.push(i),
  };
  return { events, approvals, errors, logs, ended, exits, handlers };
}

async function until(cond: () => boolean, what: string, ms = 15_000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`délai dépassé : ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const hasText = (events: EngineEvent[], text: string) =>
  events.some((e) => JSON.stringify(e).includes(text));

describe("contrôleur + moteur enfant (processus forké, QueryFn factice)", () => {
  it("reconstitue stderr avant masquage, puis conserve les 20 dernières lignes", async () => {
    const fake = join(dir, "stderr-fragments.mjs");
    await writeFile(
      fake,
      `process.send({v:1,type:"ready"}); process.on("message",()=>{
      const b=Buffer.from(${JSON.stringify(Array.from({ length: 25 }, (_, i) => `ligne ${i}`).join("\n") + "\nété " + TOKEN + "\nBearer abcdefghijklmnop\n-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----\n")});
      for(let i=0;i<b.length;i+=3) process.stderr.write(b.subarray(i,i+3)); process.exitCode=1; process.disconnect();
    });`,
    );
    const c = collect();
    const ctl = createEngineController({
      enginePath: fake,
      auth: { name: "OPENAI_API_KEY", value: TOKEN },
      handlers: c.handlers,
    });
    await ctl.start({ cwd: dir });
    await ctl.exited;
    const tail = c.exits[0]?.stderrTail ?? "";
    expect(tail).not.toContain("ligne 0");
    expect(tail).toContain("été [REDACTED]");
    expect(tail).not.toContain(TOKEN);
    expect(tail).not.toContain("abcdefghijklmnop");
    expect(tail).not.toContain("PRIVATE KEY");
    expect(c.logs.join("")).not.toContain(TOKEN);
  });

  it("rejette tout stderr en cas de dépassement du plafond", async () => {
    const fake = join(dir, "stderr-volumineux.mjs");
    await writeFile(
      fake,
      `process.send({v:1,type:"ready"}); process.on("message",()=>{process.stderr.write("x".repeat(70000),()=>{process.exitCode=1; process.disconnect();});});`,
    );
    const c = collect();
    const ctl = createEngineController({ enginePath: fake, handlers: c.handlers });
    await ctl.start({ cwd: dir });
    await ctl.exited;
    expect(c.exits[0]?.stderrTail).toBe("[stderr trop volumineux : diagnostic ignoré]");
    expect(c.logs.join("")).not.toContain("xxxxxxxx");
  });

  it("termine malgré un descendant qui conserve stderr, sans publier le bloc incomplet", async () => {
    const fake = join(dir, "stderr-descendant.mjs");
    await writeFile(
      fake,
      `import {spawn} from "node:child_process";
      process.send({v:1,type:"ready"}); process.on("message",()=>{
        process.stderr.write("fragment-confidentiel");
        spawn(process.execPath,["-e","setTimeout(()=>{},700)"],{stdio:["ignore","ignore",2]});
        process.exit(1);
      });`,
    );
    const c = collect();
    const ctl = createEngineController({ enginePath: fake, handlers: c.handlers });
    await ctl.start({ cwd: dir });
    await ctl.exited;
    expect(c.exits[0]?.stderrTail).toBe("[stderr incomplet : diagnostic ignoré]");
    expect(c.logs.join("")).not.toContain("fragment-confidentiel");
  });

  it("masque les comptes de test dans stderr du moteur", async () => {
    const fake = join(dir, "stderr-comptes.mjs");
    await writeFile(
      fake,
      `process.send({ v: 1, type: "ready" }); process.on("message", () => { process.stderr.write("alice@example.com xy1234"); setTimeout(() => process.exit(0), 50); });`,
    );
    const c = collect();
    const ctl = createEngineController({ enginePath: fake, cwd: dir, handlers: c.handlers });
    await ctl.start({
      cwd: dir,
      testAccounts: [
        {
          label: "A",
          host: "",
          identifier: "alice@example.com",
          secret: "xy1234",
          kind: "password",
        },
      ],
    });
    await ctl.exited;
    expect(c.logs.join("")).not.toContain("alice@example.com");
    expect(c.logs.join("")).not.toContain("xy1234");
    expect(c.logs.join("")).toContain("[REDACTED]");
  });

  it("conserve le diagnostic structuré d'un sondage de modèles sans utiliser son message brut", async () => {
    const failing = join(dir, "catalogue-erreur.mjs");
    await writeFile(
      failing,
      'process.on("message", () => {process.send({v:1,type:"error",reason:{code:"opencode.serverFailed",params:{detail:"code 7"}}});}); process.send({v:1,type:"ready"});',
    );
    const ctl = createEngineController({ enginePath: failing, killGraceMs: 50 });
    await expect(ctl.models({ cwd: dir })).rejects.toMatchObject({
      message: "opencode.serverFailed",
      reason: { code: "opencode.serverFailed", params: { detail: "code 7" } },
    });
    await ctl.exited;
  }, 15_000);
  it("accepte un grand catalogue et relaie tous les fournisseurs", async () => {
    const file = join(dir, "large-catalog.mjs");
    await writeFile(
      file,
      'process.on("message",()=>{process.send({v:1,type:"models",models:Array.from({length:1600},(_,i)=>({value:"opencode/m"+i,displayName:"Model "+i})),providers:[{id:"opencode",name:"OpenCode",connected:true},{id:"github-copilot",name:"GitHub Copilot",connected:false}]});});process.send({v:1,type:"ready"});',
    );
    const onProviders = vi.fn();
    const ctl = createEngineController({ enginePath: file, handlers: { onProviders } });
    expect(await ctl.models({ cwd: dir })).toHaveLength(1600);
    expect(onProviders).toHaveBeenCalledWith([
      { id: "opencode", name: "OpenCode", connected: true },
      { id: "github-copilot", name: "GitHub Copilot", connected: false },
    ]);
    await ctl.exited;
  });
  it("une réponse invalide garde son erreur IPC plutôt qu’un arrêt code 0", async () => {
    const file = join(dir, "invalid-catalog.mjs");
    await writeFile(
      file,
      'process.on("message",()=>process.send({v:1,type:"models",models:[{value:"bad",displayName:"bad",secret:"forged"}]}));process.send({v:1,type:"ready"});',
    );
    const ctl = createEngineController({ enginePath: file });
    await expect(ctl.models({ cwd: dir })).rejects.toMatchObject({
      reason: { code: "ipc.invalidMessage" },
    });
    await ctl.exited;
  });
  it("arrête un moteur qui ne répond pas à la demande de modèles", async () => {
    const hanging = join(dir, "catalogue-suspendu.mjs");
    await writeFile(
      hanging,
      'process.on("message", () => {}); process.send({v:1,type:"ready"}); setInterval(() => {}, 1000);',
    );
    const ctl = createEngineController({ enginePath: hanging });
    await expect(
      ctl.models({ cwd: dir, provider: "opencode", timeoutMs: 300 }),
    ).rejects.toMatchObject({ code: "ipc.startTimeout" });
    await ctl.exited;
  }, 15_000);
  it("run complet de bout en bout via l'IPC", async () => {
    const c = collect();
    const ctl = createEngineController({ enginePath: engine, handlers: c.handlers });
    await ctl.start({ cwd: dir });
    ctl.prompt("bonjour");
    await until(() => c.ended.length > 0, "fin du run");
    expect(c.ended[0]).toMatchObject({ status: "success", turns: 1, result: "fini" });
    expect(c.events.map((e) => e.kind)).toContain("run.started");
    expect(hasText(c.events, "ECHO bonjour")).toBe(true);
    await ctl.exited;
    expect(c.exits[0]).toMatchObject({ code: 0 });
    expect(c.errors).toEqual([]);
  }, 30_000);

  it("environnement de l'enfant : pas de clé API héritée, jeton masqué partout", async () => {
    const c = collect();
    const ctl = createEngineController({
      enginePath: engine,
      handlers: c.handlers,
      auth: { name: "CLAUDE_CODE_OAUTH_TOKEN", value: TOKEN },
      baseEnv: {
        ...process.env,
        ANTHROPIC_API_KEY: "sk-ant-api-0123456789abcdef",
        WARBAND_TEST_AUTRE: "ne-doit-pas-passer",
      },
    });
    await ctl.start({ cwd: dir });
    ctl.prompt("env");
    await until(() => c.ended.length > 0, "fin du run");
    const envLine = c.events.map((e) => JSON.stringify(e)).find((s) => s.includes("ENV "));
    const keys = /ENV ([^"\\]*)/.exec(envLine ?? "")?.[1]?.split(",") ?? [];
    expect(keys).toContain("ELECTRON_RUN_AS_NODE");
    expect(keys).toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(keys.map((k) => k.toUpperCase())).not.toContain("ANTHROPIC_API_KEY");
    expect(keys).not.toContain("WARBAND_TEST_AUTRE");
    // Le jeton existe dans l'enfant (l'événement TOKEN le prouve) mais n'en sort jamais en clair.
    expect(hasText(c.events, "TOKEN ")).toBe(true);
    const everything = JSON.stringify([c.events, c.approvals, c.errors, c.logs, c.ended]);
    expect(everything).not.toContain(TOKEN);
    expect(everything).toContain("[REDACTED]");
    await ctl.exited;
  }, 30_000);

  it.each(["allow", "deny"] as const)(
    "approbation « %s » relayée",
    async (decision) => {
      const c = collect();
      const ctl = createEngineController({
        enginePath: engine,
        handlers: {
          ...c.handlers,
          // L'UI répond à la demande reçue ; l'entrée de l'outil arrive masquée.
          onApproval: (a) => {
            c.approvals.push(a);
            ctl.answer(a.toolUseId, decision);
          },
        },
        auth: { name: "CLAUDE_CODE_OAUTH_TOKEN", value: TOKEN },
      });
      await ctl.start({ cwd: dir });
      ctl.prompt(`tool ${decision}`);
      await until(() => c.ended.length > 0, "fin du run");
      expect(c.approvals).toHaveLength(1);
      expect(c.approvals[0]).toMatchObject({ tool: "Write", verdict: { decision: "ask" } });
      expect(JSON.stringify(c.approvals)).not.toContain(TOKEN);
      expect(hasText(c.events, `DECISION ${decision}`)).toBe(true);
      await ctl.exited;
    },
    30_000,
  );

  it("l'abort annule le run : l'enfant observe le signal puis sort", async () => {
    const marker = join(dir, "abort.marker");
    const c = collect();
    const ctl = createEngineController({ enginePath: engine, handlers: c.handlers });
    await ctl.start({ cwd: dir });
    ctl.prompt(`hang ${marker}`);
    await until(() => hasText(c.events, "run.started"), "début du run");
    ctl.abort();
    await ctl.exited;
    expect(existsSync(marker)).toBe(true);
  }, 30_000);

  it("coupure d'IPC : run annulé et enfant terminé", async () => {
    const marker = join(dir, "disconnect.marker");
    const child = fork(engine, [], {
      env: buildEngineEnv(),
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    const exited = new Promise<number | null>((resolve) =>
      child.on("exit", (code) => resolve(code)),
    );
    const received: unknown[] = [];
    child.on("message", (m) => void received.push(m));
    await until(() => received.length > 0, "ready");
    child.send({ v: 1, type: "start", cwd: dir });
    child.send({ v: 1, type: "prompt", text: `hang ${marker}` });
    await until(
      () => received.some((m) => JSON.stringify(m).includes("run.started")),
      "début du run",
    );
    child.disconnect();
    await exited;
    expect(existsSync(marker)).toBe(true);
  }, 30_000);
});

describe("contrôleur : messages rejetés, démarrage, environnement", () => {
  const script = async (name: string, source: string) => {
    const path = join(dir, name);
    await writeFile(path, source);
    return path;
  };

  it("rejette les messages mal formés du moteur et continue", async () => {
    const rogue = await script(
      "rogue.mjs",
      `process.send({ v: 1, type: "nope" });
       process.send({ v: 1, type: "event", event: { kind: "run.started" } });
       process.send({ v: 7, type: "ready" });
       process.send({ v: 1, type: "ready" });
       setInterval(() => {}, 1000);`,
    );
    const c = collect();
    const ctl = createEngineController({ enginePath: rogue, handlers: c.handlers });
    await ctl.start({ cwd: dir });
    expect(c.errors.map((e) => e.code)).toEqual([
      "ipc.invalidMessage",
      "ipc.invalidMessage",
      "ipc.unsupportedVersion",
    ]);
    expect(c.events).toEqual([]);
    ctl.kill();
    await ctl.exited;
  });

  it("kill : un petit-enfant long et un moteur sourd à abort sont tués (arbre entier)", async () => {
    const pidFile = join(dir, "grandchild.pid");
    const deaf = await script(
      "deaf.mjs",
      `import { spawn } from "node:child_process";
       import { writeFileSync } from "node:fs";
       const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
       writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));
       process.send({ v: 1, type: "ready" });
       process.on("message", () => {});
       setInterval(() => {}, 1000);`,
    );
    const ctl = createEngineController({ enginePath: deaf, killGraceMs: 100 });
    await ctl.start({ cwd: dir });
    const grandchild = Number(await readFile(pidFile, "utf8"));
    expect(alive(grandchild)).toBe(true);
    ctl.kill();
    await ctl.exited;
    for (let i = 0; i < 50 && alive(grandchild); i++) await new Promise((r) => setTimeout(r, 100));
    expect(alive(grandchild)).toBe(false);
  }, 20_000);

  it("délai de démarrage : enfant tué et échec codé", async () => {
    const mute = await script("mute.mjs", "setInterval(() => {}, 1000);");
    const c = collect();
    const ctl = createEngineController({
      enginePath: mute,
      handlers: c.handlers,
      startTimeoutMs: 300,
    });
    await expect(ctl.start({ cwd: dir })).rejects.toMatchObject({ code: "ipc.startTimeout" });
    await ctl.exited;
  });

  it("enfant mort au démarrage : échec codé", async () => {
    const dead = await script("dead.mjs", "process.exit(3);");
    const ctl = createEngineController({ enginePath: dead });
    await expect(ctl.start({ cwd: dir })).rejects.toMatchObject({
      code: "ipc.engineExited",
      params: { code: 3 },
    });
  });

  it("script introuvable : échec codé, pas d'exception non gérée", async () => {
    const ctl = createEngineController({ enginePath: join(dir, "absent.mjs") });
    await expect(ctl.start({ cwd: dir })).rejects.toMatchObject({ code: "ipc.engineExited" });
  });

  it("buildEngineEnv : liste blanche exacte + ELECTRON_RUN_AS_NODE + une seule variable d'auth", () => {
    const base = {
      PATH: "/bin",
      HOME: "/home/test",
      XDG_DATA_HOME: "/data/opencode",
      HTTPS_PROXY: "http://proxy.example:8080",
      OPENAI_API_KEY: "sk-openai-0123456789abcdef0123456789",
      ANTHROPIC_API_KEY: "sk-ant-api-0123456789abcdef",
      CLAUDE_CODE_OAUTH_TOKEN: "autre-jeton-0123456789",
      GITHUB_TOKEN: "ghp_0123456789abcdef0123456789",
    };
    expect(buildEngineEnv(undefined, base)).toEqual({
      ...safeEnv(base),
      XDG_DATA_HOME: "/data/opencode",
      HTTPS_PROXY: "http://proxy.example:8080",
      ELECTRON_RUN_AS_NODE: "1",
    });
    const withAuth = buildEngineEnv({ name: "CLAUDE_CODE_OAUTH_TOKEN", value: TOKEN }, base);
    expect(withAuth.CLAUDE_CODE_OAUTH_TOKEN).toBe(TOKEN);
    expect(withAuth.ANTHROPIC_API_KEY).toBeUndefined();
    expect(withAuth.GITHUB_TOKEN).toBeUndefined();
    expect(withAuth.OPENAI_API_KEY).toBeUndefined();
    expect(buildEngineEnv({ name: "OPENAI_API_KEY", value: TOKEN }, base).OPENAI_API_KEY).toBe(
      TOKEN,
    );
    expect(() => buildEngineEnv({ name: "PATH" as never, value: "x" }, base)).toThrow();
    expect(() => buildEngineEnv({ name: "ANTHROPIC_API_KEY", value: "" }, base)).toThrow();
  });
});

describe("Bypass : accusés et environnement du moteur (ADR 0006)", () => {
  it("bypass : seq croissant par moteur (1, 2…) et accusé relayé avec l'état retenu", async () => {
    const c = collect();
    const acks: { seq: number; state: { since: number; expiresAt: number } | null }[] = [];
    const ctl = createEngineController({
      enginePath: engine,
      handlers: { ...c.handlers, onBypassAck: (a) => void acks.push(a) },
    });
    await ctl.start({ cwd: dir });
    const since = Date.now();
    const state = { since, expiresAt: since + 60_000 };
    expect(ctl.bypass(state)).toBe(1);
    await until(() => acks.length === 1, "accusé seq 1");
    expect(acks[0]).toEqual({ seq: 1, state });
    expect(ctl.bypass(null)).toBe(2);
    await until(() => acks.length === 2, "accusé seq 2");
    expect(acks[1]).toEqual({ seq: 2, state: null });
    ctl.kill();
    await ctl.exited;
    expect(c.errors).toEqual([]);
  }, 30_000);

  it("(w) buildEngineEnv et safeEnv ne transmettent jamais NODE_CHANNEL_*", () => {
    const base = {
      PATH: "/bin",
      NODE_CHANNEL_FD: "3",
      NODE_CHANNEL_SERIALIZATION_MODE: "json",
    } as NodeJS.ProcessEnv;
    const channelKeys = (env: NodeJS.ProcessEnv) =>
      Object.keys(env).filter((k) => k.startsWith("NODE_CHANNEL_"));
    expect(channelKeys(safeEnv(base, "linux"))).toEqual([]);
    expect(channelKeys(buildEngineEnv(undefined, base))).toEqual([]);
    expect(buildEngineEnv(undefined, base).PATH).toBe("/bin");
  });

  it("kill : l'état nul du Bypass part avant abort, et son accusé arrive avant la sortie (lot 2c)", async () => {
    const c = collect();
    const order: string[] = [];
    const ctl = createEngineController({
      enginePath: engine,
      handlers: {
        ...c.handlers,
        onBypassAck: (a) => void order.push(`ack:${a.seq}:${a.state === null ? "off" : "on"}`),
        onExit: () => void order.push("exit"),
      },
    });
    await ctl.start({ cwd: dir });
    const since = Date.now();
    ctl.bypass({ since, expiresAt: since + 60_000 });
    await until(() => order.includes("ack:1:on"), "accusé seq 1");
    ctl.kill();
    await ctl.exited;
    expect(order).toEqual(["ack:1:on", "ack:2:off", "exit"]);
    expect(c.errors).toEqual([]);
  }, 30_000);

  it("(w) processus forké : pas de NODE_CHANNEL_* dans son environnement, canal IPC en FD_CLOEXEC (POSIX)", async () => {
    const probeEngine = join(dir, "env-probe.mjs");
    const out = join(dir, "env-probe-out.json");
    await writeFile(probeEngine, ENV_PROBE_SOURCE);
    const ctl = createEngineController({ enginePath: probeEngine, args: [out] });
    await ctl.start({ cwd: dir });
    ctl.kill();
    await ctl.exited;
    const seen = JSON.parse(await readFile(out, "utf8")) as {
      channelKeys: string[];
      fds: { link: string; cloexec: boolean | null }[];
    };
    expect(seen.channelKeys).toEqual([]);
    if (process.platform !== "win32" && existsSync("/proc/self/fdinfo")) {
      // Le canal IPC est un socket Unix : il ne doit pas survivre à un `exec` des petits-enfants.
      const channel = seen.fds.filter((f) => f.link.startsWith("socket:"));
      expect(channel.length).toBeGreaterThan(0);
      expect(channel.every((f) => f.cloexec === true)).toBe(true);
    }
  }, 30_000);
});

/** Sonde forkée : relève les variables `NODE_CHANNEL_*` et les drapeaux des descripteurs, puis répond `ready`. */
const ENV_PROBE_SOURCE = `import { readFileSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
const out = process.argv[2];
const channelKeys = Object.keys(process.env).filter((k) => k.startsWith("NODE_CHANNEL_"));
let names = [];
try {
  names = readdirSync("/proc/self/fd");
} catch {
  // Pas de /proc (Windows, macOS) : aucun descripteur à relever.
}
const fds = names
  .map(Number)
  .filter((n) => n > 2)
  .flatMap((fd) => {
    try {
      const flags = Number(/flags:\\s*(\\d+)/.exec(readFileSync("/proc/self/fdinfo/" + fd, "utf8"))?.[1] ?? 0);
      return [{ link: readlinkSync("/proc/self/fd/" + fd), cloexec: (flags & 0o2000000) !== 0 }];
    } catch {
      return [];
    }
  });
writeFileSync(out, JSON.stringify({ channelKeys, fds }));
process.send({ v: 1, type: "ready" });
process.on("message", () => process.exit(0));
`;
