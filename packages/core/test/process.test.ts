import { readFileSync, realpathSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDockerClient,
  createRecorder,
  type EngineEvent,
  LineSplitter,
  parseDockerPs,
  runProcess,
  safeEnv,
} from "../src/index.js";

const collect = () => {
  const recorder = createRecorder({ runId: "r" });
  const events: EngineEvent[] = [];
  recorder.subscribe((e) => events.push(e));
  return { recorder, events };
};

describe("LineSplitter", () => {
  it("recolle les lignes coupées entre chunks, y compris en plein UTF-8", () => {
    const lines: string[] = [];
    const s = new LineSplitter((l) => lines.push(l));
    const bytes = Buffer.from("héllo\r\nwor");
    s.push(bytes.subarray(0, 2)); // coupe au milieu de « é »
    s.push(bytes.subarray(2));
    s.push(Buffer.from("ld\nprogress 10%\rprogress 100%\nfin"));
    s.end();
    expect(lines).toEqual(["héllo", "world", "progress 100%", "fin"]);
  });
});

describe("LineSplitter : longueur maximale", () => {
  const split = (max: number, ...chunks: string[]) => {
    const lines: [string, boolean][] = [];
    const s = new LineSplitter((l, t) => lines.push([l, t]), { maxLineLength: max });
    for (const c of chunks) s.push(c);
    s.end();
    return lines;
  };

  it("coupe une ligne trop longue et signale truncated", () => {
    expect(split(5, "abcdefghij\nok\n")).toEqual([
      ["abcde", true],
      ["ok", false],
    ]);
  });

  it("jette le reste d'une ligne coupée même répartie sur plusieurs chunks", () => {
    expect(split(4, "abcdefg", "hijkl", "mn\nfin\n")).toEqual([
      ["abcd", true],
      ["fin", false],
    ]);
  });

  it("n'altère pas une ligne de longueur exactement égale au maximum", () => {
    expect(split(4, "abcd\nabcd")).toEqual([
      ["abcd", false],
      ["abcd", false],
    ]);
  });

  it("borne la mémoire : pas de ligne en attente après un flot sans saut de ligne", () => {
    const lines: [string, boolean][] = [];
    const s = new LineSplitter((l, t) => lines.push([l, t]), { maxLineLength: 100 });
    for (let i = 0; i < 1000; i++) s.push("x".repeat(1000));
    s.end();
    expect(lines).toEqual([["x".repeat(100), true]]);
  });

  it("applique 16 384 caractères par défaut", () => {
    const lines: [string, boolean][] = [];
    const s = new LineSplitter((l, t) => lines.push([l, t]));
    s.push(`${"y".repeat(20_000)}\n`);
    expect(lines[0]?.[0]).toHaveLength(16_384);
    expect(lines[0]?.[1]).toBe(true);
  });
});

describe("runProcess", () => {
  const node = process.execPath;

  it("publie start/output/exit avec les bons parents", async () => {
    const { recorder, events } = collect();
    const result = await runProcess(
      [node, "-e", "console.log('a');console.error('b');console.log('c');process.exit(3)"],
      { recorder, parentId: "p" },
    );
    expect(result).toMatchObject({ code: 3, stdout: ["a", "c"], stderr: ["b"] });

    const start = events.find((e) => e.kind === "process.started");
    expect(start).toMatchObject({ parentId: "p" });
    const children = events.filter((e) => e.parentId === start?.id);
    expect(children.map((e) => e.kind).sort()).toEqual([
      "process.exited",
      "process.output",
      "process.output",
      "process.output",
    ]);
    expect(events.at(-1)).toMatchObject({ kind: "process.exited", code: 3 });
  });

  it("marque truncated les lignes coupées dans process.output", async () => {
    const { recorder, events } = collect();
    await runProcess([node, "-e", "console.log('x'.repeat(50))"], {
      recorder,
      maxLineLength: 10,
    });
    expect(events.find((e) => e.kind === "process.output")).toMatchObject({
      line: "x".repeat(10),
      truncated: true,
    });
  });

  it("plafonne les lignes journalisées et compte les autres dans droppedLines", async () => {
    const { recorder, events } = collect();
    const result = await runProcess(
      [node, "-e", "for (let i=0;i<10;i++) console.log('o'+i); console.error('e')"],
      { recorder, maxJournaledLines: 3 },
    );
    expect(events.filter((e) => e.kind === "process.output")).toHaveLength(3);
    expect(events.at(-1)).toMatchObject({ kind: "process.exited", droppedLines: 8 });
    // Le résultat en mémoire n'est pas concerné par le plafond du journal.
    expect(result.stdout).toHaveLength(10);
    expect(result.stderr).toEqual(["e"]);
  });

  it("n'ajoute ni droppedLines ni truncated quand rien n'est perdu", async () => {
    const { recorder, events } = collect();
    await runProcess([node, "-e", "console.log('a')"], { recorder });
    expect(events.find((e) => e.kind === "process.output")).not.toHaveProperty("truncated");
    expect(events.at(-1)).not.toHaveProperty("droppedLines");
    expect(events[0]).not.toHaveProperty("correlation");
  });

  it("consigne la fiabilité de la corrélation dans process.started", async () => {
    const { recorder, events } = collect();
    await runProcess([node, "-e", ""], { recorder, correlation: "inferred" });
    expect(events[0]).toMatchObject({ kind: "process.started", correlation: "inferred" });
  });

  it("n'interprète pas les arguments via un shell", async () => {
    const { recorder } = collect();
    const result = await runProcess(
      [node, "-e", "console.log(process.argv[1])", "$(echo pwned); rm -rf /"],
      { recorder },
    );
    expect(result.stdout).toEqual(["$(echo pwned); rm -rf /"]);
  });

  it("ne transmet pas les secrets du parent à l'enfant", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-parent-secret";
    process.env.JOHN_TEST_TOKEN = "tok-parent-secret";
    try {
      const { recorder } = collect();
      const r = await runProcess(
        [
          node,
          "-e",
          "console.log(JSON.stringify({ key: process.env.ANTHROPIC_API_KEY ?? null, tok: process.env.JOHN_TEST_TOKEN ?? null, path: Boolean(process.env.PATH) }))",
        ],
        { recorder },
      );
      expect(JSON.parse(r.stdout[0] as string)).toEqual({ key: null, tok: null, path: true });
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.JOHN_TEST_TOKEN;
    }
  });

  it("safeEnv ne garde que la liste blanche", () => {
    expect(
      safeEnv({
        PATH: "/bin",
        LC_ALL: "C",
        DOCKER_HOST: "tcp://x",
        SystemRoot: "C:\\Windows",
        ANTHROPIC_API_KEY: "k",
        AWS_SECRET_ACCESS_KEY: "k",
      }),
    ).toEqual({ PATH: "/bin", LC_ALL: "C", DOCKER_HOST: "tcp://x", SystemRoot: "C:\\Windows" });
  });

  it("rejette si le binaire est introuvable", async () => {
    const { recorder } = collect();
    await expect(runProcess(["john-binaire-inexistant"], { recorder })).rejects.toMatchObject({
      code: "process.notFound",
      params: { binary: "john-binaire-inexistant" },
    });
    await expect(runProcess([], { recorder })).rejects.toMatchObject({ code: "process.emptyArgv" });
  });

  it("respecte l'annulation", async () => {
    const { recorder } = collect();
    const ac = new AbortController();
    const pending = runProcess([node, "-e", "setTimeout(()=>{},10000)"], {
      recorder,
      signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 50);
    const result = await pending;
    expect(result.signal).toBe("SIGTERM");
  });
});

describe("docker", () => {
  it("parse docker ps --format json", () => {
    const rows = parseDockerPs([
      '{"ID":"abc","Names":"web","Image":"nginx","State":"running","Status":"Up 2m","Ports":"80/tcp"}',
      "",
    ]);
    expect(rows).toEqual([
      {
        id: "abc",
        name: "web",
        image: "nginx",
        state: "running",
        status: "Up 2m",
        ports: "80/tcp",
      },
    ]);
  });

  it("refuse les lignes non JSON au lieu de les ignorer", () => {
    expect(() => parseDockerPs(["WARNING: bruit"])).toThrow(
      expect.objectContaining({ code: "docker.unexpectedOutput" }),
    );
  });

  it("utilise le binaire configuré et lève sur code ≠ 0", async () => {
    const dir = await mkdtemp(join(realpathSync.native(tmpdir()), "john-docker-"));
    const script = join(dir, "docker.mjs");
    await writeFile(
      script,
      `const [, , cmd, flag] = process.argv;
if (cmd === "ps") {
  console.log('{"ID":"1","Names":"db","Image":"postgres","State":"exited","Status":"Exited","Ports":""}');
  if (flag === "--all") process.exit(0);
  console.error("daemon down");
  process.exit(1);
}
`,
    );
    const { recorder, events } = collect();
    const docker = createDockerClient({ recorder, binary: process.execPath, argsPrefix: [script] });

    expect(await docker.ps({ all: true })).toMatchObject([{ name: "db", image: "postgres" }]);
    expect(events[0]).toMatchObject({
      kind: "process.started",
      argv: [process.execPath, script, "ps", "--all", "--format", "{{json .}}"],
    });
    await expect(docker.ps()).rejects.toMatchObject({
      code: "docker.failed",
      params: { stderr: expect.stringContaining("daemon down") },
    });
  });
});

// POSIX seulement : groupes de processus (SIGTERM/SIGKILL du groupe) et lecture de /proc pour
// distinguer un zombie ; l'arbre de processus sous Windows relève de `taskkill` (autre lot).
const posix = describe.skipIf(process.platform === "win32");

/** Faux enfants portables : `process.execPath -e <script>`, sans shell ni `sleep`. */
const NODE = process.execPath;
const HOLD = "setInterval(() => {}, 1000)";
const NODE_SLEEP = [NODE, "-e", HOLD];
const NODE_IGNORE_TERM = [NODE, "-e", `process.on("SIGTERM", () => {}); ${HOLD}`];
// Parent : lance un petit-enfant dans le même groupe, imprime son pid, puis attend.
const grandchild = (child: string, parentTail: string) => [
  NODE,
  "-e",
  `const { spawn } = require("node:child_process");
const c = spawn(process.execPath, ["-e", ${JSON.stringify(child)}], { stdio: ["ignore", "inherit", "inherit"] });
console.log(c.pid);
${parentTail}`,
];
const NODE_GRANDCHILD = grandchild(HOLD, HOLD);
// Le chef sort aussitôt ; le petit-enfant ignore TERM et garde stdout.
const NODE_ORPHAN = grandchild(`process.on("SIGTERM", () => {}); ${HOLD}`, "process.exit(0)");

posix("runProcess : terminaison du groupe", () => {
  // Vivant = signalable et pas zombie (si init ne récupère pas les orphelins, un tué reste « Z »).
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      try {
        return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
      } catch (e) {
        // Récupéré entre `kill(pid, 0)` et la lecture : le processus n'existe plus.
        return (e as NodeJS.ErrnoException).code !== "ENOENT";
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw e;
    }
  };

  // Un processus tué peut rester zombie un court instant avant d'être récupéré par init.
  const gone = async (pid: number) => {
    for (let i = 0; i < 40 && alive(pid); i++) await new Promise((r) => setTimeout(r, 25));
  };

  it("tue par SIGKILL un enfant qui ignore SIGTERM, après la grâce", async () => {
    const { recorder, events } = collect();
    const ac = new AbortController();
    const pending = runProcess(NODE_IGNORE_TERM, {
      recorder,
      signal: ac.signal,
      killGraceMs: 200,
    });
    setTimeout(() => ac.abort(), 100);
    const t0 = Date.now();
    const result = await pending;
    expect(Date.now() - t0).toBeLessThan(200 + 1000);
    expect(result).toMatchObject({ signal: "SIGKILL", forced: true, termination: "abort" });
    expect(events.at(-1)).toMatchObject({
      kind: "process.exited",
      signal: "SIGKILL",
      forced: true,
      termination: "abort",
    });
  });

  it("n'indique pas forced quand SIGTERM suffit", async () => {
    const { recorder } = collect();
    const ac = new AbortController();
    const pending = runProcess(NODE_SLEEP, { recorder, signal: ac.signal });
    setTimeout(() => ac.abort(), 100);
    const result = await pending;
    expect(result).toMatchObject({ signal: "SIGTERM", termination: "abort" });
    expect(result.forced).toBeUndefined();
  });

  it("tue aussi le petit-enfant avec son groupe", async () => {
    const { recorder } = collect();
    const ac = new AbortController();
    const pending = runProcess(NODE_GRANDCHILD, {
      recorder,
      signal: ac.signal,
      killGraceMs: 200,
    });
    setTimeout(() => ac.abort(), 300);
    const result = await pending;
    const grandchild = Number(result.stdout[0]);
    expect(Number.isInteger(grandchild)).toBe(true);
    await gone(grandchild);
    expect(alive(grandchild)).toBe(false);
  });

  it("ne reste pas pendant quand un petit-enfant orphelin garde les tubes ouverts", async () => {
    const { recorder } = collect();
    const ac = new AbortController();
    // Le chef sort aussitôt ; le petit-enfant ignore TERM et garde stdout.
    const pending = runProcess(NODE_ORPHAN, {
      recorder,
      signal: ac.signal,
      killGraceMs: 100,
    });
    setTimeout(() => ac.abort(), 100);
    const result = await pending;
    const grandchild = Number(result.stdout[0]);
    await gone(grandchild);
    expect(alive(grandchild)).toBe(false);
  });

  it("applique timeoutMs avec termination = timeout", async () => {
    const { recorder } = collect();
    const result = await runProcess(NODE_SLEEP, {
      recorder,
      timeoutMs: 100,
      killGraceMs: 200,
    });
    expect(result).toMatchObject({ signal: "SIGTERM", termination: "timeout" });
  });

  it("termine un processus lancé avec un signal déjà annulé", async () => {
    const { recorder } = collect();
    const result = await runProcess(NODE_SLEEP, {
      recorder,
      signal: AbortSignal.abort(),
      killGraceMs: 200,
    });
    expect(result.termination).toBe("abort");
    expect(result.signal).not.toBeNull();
  });
});

describe("DockerClient : timeout", () => {
  it("transmet timeoutMs (client puis appel) à runProcess", async () => {
    const dir = await mkdtemp(join(realpathSync.native(tmpdir()), "john-slow-docker-"));
    const script = join(dir, "docker.mjs");
    await writeFile(script, "setTimeout(() => {}, 30_000);\n");
    const { recorder, events } = collect();
    const base = { recorder, binary: process.execPath, argsPrefix: [script] };
    const docker = createDockerClient({ ...base, timeoutMs: 150 });
    await expect(docker.ps()).rejects.toMatchObject({ code: "docker.failed" });
    expect(events.at(-1)).toMatchObject({ kind: "process.exited", termination: "timeout" });

    const lenient = createDockerClient({ ...base, timeoutMs: 60_000 });
    await expect(lenient.ps({ timeoutMs: 150 })).rejects.toMatchObject({ code: "docker.failed" });
    expect(events.at(-1)).toMatchObject({ kind: "process.exited", termination: "timeout" });
  });
});
