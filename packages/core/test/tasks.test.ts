import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DockerClient, LabelPrefixContainer } from "../src/docker/client.js";
import {
  createExegolTargets,
  createMissionDesk,
  createRecorder,
  DEFAULT_POLICY,
  evaluatePolicy,
  isRememberable,
  taskToolSpecs,
} from "../src/index.js";
import { TASK_CLIENT_SCRIPT, TASK_SUPERVISOR_SCRIPT } from "../src/tasks/scripts.js";

const ctx = { parentId: null, correlation: undefined, signal: undefined };
const scope = createHash("sha256").update("projet-test").digest("hex");
const terminal = (status: string) => !["starting", "running"].includes(status);
interface State {
  task_id: string;
  status: string;
  exit_code: number | null;
  output_directory: string;
  stdout?: string;
  stderr?: string;
  stdout_bytes?: number;
  stdout_truncated?: boolean;
  tasks?: State[];
  cancellation_requested?: boolean;
}

describe.skipIf(process.platform === "win32")("superviseur Linux réel des tâches longues", () => {
  let root: string;
  let scripts: [string, string];
  const ids = new Set<string>();
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "warband-tasks-"));
    const adapt = (script: string) =>
      script
        .replace('WORKSPACE = "/workspace"', `WORKSPACE = ${JSON.stringify(root)}`)
        .replace(
          'REGISTRY = "/tmp/warband-long-tasks-v1"',
          `REGISTRY = ${JSON.stringify(join(root, "registry"))}`,
        );
    scripts = [adapt(TASK_CLIENT_SCRIPT), adapt(TASK_SUPERVISOR_SCRIPT)];
    ids.clear();
  });
  async function call(
    operation: string,
    extra: Record<string, unknown> = {},
    project = scope,
  ): Promise<State> {
    const { stdout } = await promisify(execFile)(
      "python3",
      ["-c", scripts[0], JSON.stringify({ operation, scope: project, ...extra }), scripts[1]],
      { timeout: 10_000 },
    );
    expect(stdout.split("\n").every((line) => line.length <= 16384)).toBe(true);
    return JSON.parse(stdout) as State;
  }
  async function start(code: string, timeout = 20) {
    const id = randomUUID().replaceAll("-", "");
    ids.add(id);
    return call("start", {
      task_id: id,
      argv: ["python3", "-u", "-c", code],
      timeout_seconds: timeout,
    });
  }
  async function finished(id: string) {
    let result!: State;
    await vi.waitFor(
      async () => {
        result = await call("status", { task_id: id });
        expect(terminal(result.status)).toBe(true);
      },
      { timeout: 8_000, interval: 100 },
    );
    return result;
  }
  afterEach(async () => {
    await Promise.all(
      [...ids].map(async (id) => {
        await call("cancel", { task_id: id }).catch(() => undefined);
        await finished(id).catch(() => undefined);
      }),
    );
    await rm(root, { recursive: true, force: true });
  });

  it("rend la main, survit au client, expose les sorties partielles puis confirme le code final", async () => {
    const first = await start(
      'import sys,time; print("début",flush=True); print("diagnostic",file=sys.stderr,flush=True); time.sleep(1.5); print("fin")',
    );
    expect(first.status).toBe("starting");
    expect((await call("list")).tasks?.map((task) => task.task_id)).toContain(first.task_id);
    const partial = await call("status", { task_id: first.task_id });
    expect(["starting", "running"]).toContain(partial.status);
    expect(partial.exit_code).toBeNull();
    const result = await finished(first.task_id);
    expect(result).toMatchObject({
      status: "completed",
      exit_code: 0,
      stdout: "début\nfin\n",
      stderr: "diagnostic\n",
    });
    const artifact = JSON.parse(
      await readFile(join(result.output_directory, "result.json"), "utf8"),
    );
    expect(artifact).toMatchObject({ status: "completed", exit_code: 0 });
    expect((await call("cancel", { task_id: first.task_id })).status).toBe("completed");
    await expect(call("status", { task_id: first.task_id }, "a".repeat(64))).rejects.toThrow();
  });

  it("conserve un échec et borne l’extrait sans tronquer le fichier complet", async () => {
    const first = await start(
      'import sys; print("x"*12000); print("erreur",file=sys.stderr); sys.exit(7)',
    );
    const result = await finished(first.task_id);
    expect(result).toMatchObject({
      status: "failed",
      exit_code: 7,
      stdout_bytes: 12001,
      stdout_truncated: true,
      stderr: "erreur\n",
    });
    expect(Buffer.byteLength(result.stdout ?? "")).toBe(8192);
    expect((await readFile(join(result.output_directory, "stdout.txt"))).length).toBe(12001);
  });

  it("annule le processus et son descendant dans le même groupe sans effacer les sorties", async () => {
    const first = await start(
      'import subprocess,time; p=subprocess.Popen(["sleep","30"]); print(p.pid,flush=True); time.sleep(30)',
    );
    let pid = 0;
    await vi.waitFor(async () => {
      const result = await call("status", { task_id: first.task_id });
      pid = Number(result.stdout?.trim());
      expect(pid).toBeGreaterThan(0);
    });
    expect(await call("cancel", { task_id: first.task_id })).toMatchObject({
      cancellation_requested: true,
    });
    const result = await finished(first.task_id);
    expect(result.status).toBe("cancelled");
    expect(result.stdout).toContain(String(pid));
    await vi.waitFor(async () => {
      try {
        const stat = await readFile(`/proc/${pid}/stat`, "utf8");
        expect(stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z")).toBe(true);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    });
  });

  it("arrête à l’échéance et distingue le timeout d’une réussite", async () => {
    const first = await start('import time; print("partiel",flush=True); time.sleep(30)', 1);
    expect(await finished(first.task_id)).toMatchObject({
      status: "timed_out",
      stdout: "partiel\n",
    });
  });

  it("arrête une sortie excessive et plafonne le fichier capturé", async () => {
    const first = await start('import os; data=b"x"*65536\nwhile True: os.write(1,data)');
    const result = await finished(first.task_id);
    expect(result.status).toBe("output_limit");
    expect(result.stdout_bytes).toBe(32 * 1024 * 1024);
  });

  it("transporte des flux longs et binaires sans casser les lignes JSON", async () => {
    const first = await start(
      'import sys; sys.stdout.write("x"*9000); sys.stderr.write(chr(1)*9000)',
    );
    const result = await finished(first.task_id);
    expect(result).toMatchObject({
      status: "completed",
      stdout_bytes: 9000,
      stdout_truncated: true,
    });
    expect(result.stdout?.length).toBe(8192);
    expect(result.stderr?.length).toBeGreaterThan(0);
    expect(result.stderr?.length).toBeLessThan(8192);
  });

  it("ne transforme pas un superviseur disparu en réussite et refuse une sortie remplacée par un lien", async () => {
    const first = await start('print("ok")');
    const result = await finished(first.task_id);
    const metadata = join(root, "registry", scope, first.task_id, "state.json");
    const value = JSON.parse(await readFile(metadata, "utf8"));
    await writeFile(
      metadata,
      JSON.stringify({
        ...value,
        status: "running",
        exit_code: null,
        supervisor_pid: 2147483647,
        supervisor_identity: "obsolete",
      }),
    );
    expect(await call("status", { task_id: first.task_id })).toMatchObject({
      status: "interrupted",
      exit_code: null,
    });
    await rm(join(result.output_directory, "stdout.txt"));
    await symlink(metadata, join(result.output_directory, "stdout.txt"));
    await expect(call("status", { task_id: first.task_id })).rejects.toThrow();
    ids.delete(first.task_id);
  });

  it("borne les lancements concurrents à huit et permet le suivi avec attente courte", async () => {
    const launched = await Promise.allSettled(
      Array.from({ length: 9 }, () => start("import time; time.sleep(20)")),
    );
    expect(launched.filter((entry) => entry.status === "fulfilled")).toHaveLength(8);
    const listed = await call("list");
    expect(listed.tasks).toHaveLength(8);
    // Le lancement rejeté ne laisse pas d’état incomplet dans le registre.
    const existing = new Set(listed.tasks?.map((item) => item.task_id));
    for (const id of ids) if (!existing.has(id)) ids.delete(id);
    const first = listed.tasks?.[0];
    expect(await call("status", { task_id: first?.task_id, wait_seconds: 0.1 })).toMatchObject({
      status: "running",
    });
  });

  it("applique un plafond de concurrence choisi avant de lancer un nouveau processus", async () => {
    const first = await start("import time; time.sleep(20)");
    await expect(
      call("start", {
        task_id: randomUUID().replaceAll("-", ""),
        argv: ["true"],
        timeout_seconds: 10,
        max_parallel: 1,
      }),
    ).rejects.toThrow("task.activeLimit");
    expect((await call("list")).tasks?.map((task) => task.task_id)).toEqual([first.task_id]);
  });

  it("refuse les liens symboliques de sortie et les identifiants traversants", async () => {
    await symlink(tmpdir(), join(root, "outputs"));
    const id = randomUUID().replaceAll("-", "");
    await expect(
      call("start", { task_id: id, argv: ["true"], timeout_seconds: 1 }),
    ).rejects.toThrow();
    expect((await call("list")).tasks).toMatchObject([{ task_id: id, status: "failed" }]);
    await expect(call("status", { task_id: "../escape" })).rejects.toThrow();
  });
});

describe("outils de tâches et gate", () => {
  const rows: LabelPrefixContainer[] = [
    { name: "exegol-lab", state: "running", image: "exegol", family: "exegol" },
    { name: "kali-1", state: "running", image: "kali", family: "kali" },
  ];
  it.each(["exegol", "kali"] as const)(
    "revérifie projet, famille, cible et état pour %s",
    async (family) => {
      const targets = createExegolTargets();
      const exec = vi.fn(async () => [
        JSON.stringify({
          task_id: "a".repeat(32),
          status: "running",
          started_at: 1,
          exit_code: null,
          timeout_seconds: 3600,
          output_directory: `/workspace/outputs/warband-task-${"a".repeat(32)}`,
        }),
      ]);
      const docker = {
        listLabelPrefix: vi.fn(async () => rows),
        execWorkspace: exec,
      } as unknown as DockerClient;
      const recorder = createRecorder();
      const desk = createMissionDesk({ recorder });
      const tools = taskToolSpecs(family, docker, targets, recorder);
      const run = (container: string) =>
        tools
          .find((tool) => tool.name === "task_start")
          ?.run({ container, argv: ["sleep", "2"] }, ctx);
      await expect(run(family === "kali" ? "kali-1" : "lab")).rejects.toMatchObject({
        code: "project.absent",
      });
      targets.note("", ["exegol-lab", "kali-1"], "project-A");
      await expect(run(family === "kali" ? "lab" : "kali-1")).rejects.toThrow();
      expect(exec).not.toHaveBeenCalled();
      await run(family === "kali" ? "kali-1" : "lab");
      const argv = exec.mock.calls[0] as unknown as [string, string[], unknown];
      const request = JSON.parse(argv[1][3] ?? "{}");
      expect(request).toMatchObject({
        operation: "start",
        argv: ["sleep", "2"],
        timeout_seconds: 3600,
        scope: createHash("sha256").update("project-A").digest("hex"),
      });
      expect(argv[1][0]).toBe("python3");
      const structured = JSON.parse(
        (await tools
          .find((tool) => tool.name === "task_status_json")
          ?.run(
            {
              container: family === "kali" ? "kali-1" : "lab",
              task_id: "a".repeat(32),
            },
            ctx,
          )) ?? "{}",
      );
      expect(structured).toMatchObject({
        version: 1,
        status: "running",
        exit_code: null,
        objectiveVerified: false,
      });
      expect(desk.context().activeTasks).toContainEqual({
        taskId: "a".repeat(32),
        status: "running",
      });
      desk.dispose();
      expect(tools.find((tool) => tool.name === "task_cancel")?.readOnly).toBeUndefined();
      expect(tools.find((tool) => tool.name === "task_status")?.readOnly).toBe(true);
      targets.note("", ["exegol-lab", "kali-1"], "project-A");
      docker.listLabelPrefix = async () => {
        targets.note("", [], "project-B");
        return rows;
      };
      await expect(run(family === "kali" ? "kali-1" : "lab")).rejects.toMatchObject({
        code: "project.readFailed",
      });
    },
  );

  it.each(["mcp__exegol__task_start", "mcp__kali__task_start"])(
    "ne transforme pas les refus en tâches détachées : %s",
    (tool) => {
      for (const argv of [
        ["rm", "-rf", "/workspace/x"],
        ["sudo", "true"],
      ])
        expect(evaluatePolicy(DEFAULT_POLICY, tool, { argv }).decision).toBe("deny");
      const request = { toolUseId: "t", tool, input: { argv: ["sleep", "1"] } };
      const verdict = evaluatePolicy(
        { default: "allow", rules: [{ tool: "*", decision: "allow" }] },
        tool,
        request.input,
      );
      expect(verdict.decision).toBe("ask");
      expect(isRememberable(request, verdict)).toBe(false);
      const legacy = tool.startsWith("mcp__kali")
        ? "mcp__kali__execute_command"
        : "mcp__exegol__exec";
      expect(
        evaluatePolicy(
          { default: "ask", rules: [{ tool: legacy, decision: "deny" }] },
          tool,
          request.input,
        ).decision,
      ).toBe("deny");
    },
  );
});
