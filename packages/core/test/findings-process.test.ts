import { type ChildProcess, execFileSync, fork } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appendFinding, readFindings } from "../src/exegol/findings.js";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let compiled: string;
const processes: ChildProcess[] = [];

beforeAll(async () => {
  compiled = await mkdtemp(join(tmpdir(), "findings-process-"));
  await writeFile(join(compiled, "package.json"), '{"type":"module"}');
  const root = fileURLToPath(new URL("..", import.meta.url));
  // Compiler les sources courantes évite de tester un ancien dist du dépôt.
  const compiler = fileURLToPath(new URL("../bin/tsc", import.meta.resolve("typescript")));
  execFileSync(
    process.execPath,
    [
      compiler,
      "--project",
      join(root, "tsconfig.json"),
      "--outDir",
      join(compiled, "src"),
      "--composite",
      "false",
      "--incremental",
      "false",
      "--declaration",
      "false",
      "--declarationMap",
      "false",
    ],
    { encoding: "utf8" },
  );
  const fixture = join(compiled, "test/fixtures/findings-worker.mjs");
  await mkdir(dirname(fixture), { recursive: true });
  await writeFile(fixture, await readFile(join(root, "test/fixtures/findings-worker.mjs"), "utf8"));
}, 60_000);

afterAll(async () => {
  for (const child of processes) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  await rm(compiled, { recursive: true, force: true });
});

interface WorkerMessage {
  kind: string;
  result?: unknown;
  error?: string;
}

function worker(request: Record<string, unknown>) {
  const child = fork(
    join(compiled, "test/fixtures/findings-worker.mjs"),
    [JSON.stringify(request)],
    {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  processes.push(child);
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const received: WorkerMessage[] = [];
  const pending = new Map<string, (message: WorkerMessage) => void>();
  child.on("message", (message: WorkerMessage) => {
    received.push(message);
    pending.get(message.kind)?.(message);
  });
  const done = new Promise<WorkerMessage>((resolve, reject) => {
    pending.set("done", resolve);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!received.some((message) => message.kind === "done")) {
        reject(new Error(`Processus terminé sans résultat (${code}) : ${stderr}`));
      }
    });
  });
  return {
    done,
    received,
    release: () => child.send({ release: true }),
    wait: (kind: string) => {
      const existing = received.find((message) => message.kind === kind);
      if (existing) return Promise.resolve(existing);
      return Promise.race([
        new Promise<WorkerMessage>((resolve) => pending.set(kind, resolve)),
        done.then(() => {
          throw new Error(`Résultat reçu avant ${kind}`);
        }),
      ]);
    },
  };
}

it("sérialise ajout, modification et suppression entre de vrais processus sans perte ni résurrection", async () => {
  const dir = await mkdtemp(join(compiled, "data-"));
  const a = await appendFinding(dir, ID, { kind: "host", label: "a", state: "confirmed" });
  const b = await appendFinding(dir, ID, {
    kind: "step",
    label: "b",
    state: "confirmed",
    from: [a.id],
  });
  const adding = worker({
    dir,
    project: ID,
    action: "append",
    hold: true,
    input: { kind: "loot", label: "c", state: "confirmed" },
  });
  await adding.wait("locked");
  const updating = worker({
    dir,
    project: ID,
    action: "update",
    id: b.id,
    patch: { label: "corrigé" },
  });
  const deleting = worker({ dir, project: ID, action: "delete", id: a.id });
  try {
    await Promise.all([updating.wait("ready"), deleting.wait("ready")]);
    await setTimeout(100);
    expect(updating.received.some((message) => message.kind === "done")).toBe(false);
    expect(deleting.received.some((message) => message.kind === "done")).toBe(false);
  } finally {
    adding.release();
  }
  const results = await Promise.all([adding.done, updating.done, deleting.done]);
  expect(results.every((result) => result.error === undefined)).toBe(true);
  const saved = await readFindings(dir, ID);
  expect(saved.map((finding) => finding.label)).toEqual(["corrigé", "c"]);
  expect(saved[0]).not.toHaveProperty("from");
  expect(saved.some((finding) => finding.id === a.id)).toBe(false);
  expect(await readdir(join(dir, "projects", ID))).toEqual(["findings.json"]);
});

it("revalide les ids et parents après une suppression concurrente", async () => {
  const dir = await mkdtemp(join(compiled, "data-"));
  const a = await appendFinding(dir, ID, { kind: "host", label: "a", state: "confirmed" });
  const deleting = worker({ dir, project: ID, action: "delete", id: a.id, hold: true });
  await deleting.wait("locked");
  const updating = worker({
    dir,
    project: ID,
    action: "update",
    id: a.id,
    patch: { label: "revenu" },
  });
  const adding = worker({
    dir,
    project: ID,
    action: "append",
    input: { kind: "loot", label: "c", state: "confirmed", from: [a.id] },
  });
  try {
    await Promise.all([updating.wait("ready"), adding.wait("ready")]);
    await setTimeout(100);
    expect(updating.received.some((message) => message.kind === "done")).toBe(false);
    expect(adding.received.some((message) => message.kind === "done")).toBe(false);
  } finally {
    deleting.release();
  }
  expect((await deleting.done).error).toBeUndefined();
  expect((await updating.done).error).toBe("finding.notFound");
  expect((await adding.done).error).toBe("project.invalid");
  expect(await readFindings(dir, ID)).toEqual([]);
});
