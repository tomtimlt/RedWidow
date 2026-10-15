import { afterEach, describe, expect, it } from "vitest";
import {
  activeSandboxId,
  createApprovalGate,
  createRecorder,
  createSandbox,
  createSandboxContext,
  pruneSandboxes,
  removeAllSandboxes,
  removeAllSandboxesSync,
  type SandboxContext,
  SandboxRegistry,
  sandboxToolSpecs,
} from "../src/index.js";
import { fakeSandboxDocker, goodInspect, FAKE_SANDBOX_ID as ID } from "./helpers.js";

const RUN = "run1";
const IMAGE = "alpine:3.20";
const EXEC = "mcp__sandbox__exec";

const contexts: SandboxContext[] = [];
afterEach(() => {
  for (const c of contexts.splice(0)) c.registry.drain();
});

const setup = async () => {
  const fake = await fakeSandboxDocker();
  await fake.control({ container: [goodInspect(RUN)] });
  const ctx = createSandboxContext({
    recorder: createRecorder({ runId: RUN }),
    binary: fake.bin,
    argsPrefix: fake.argsPrefix,
  });
  contexts.push(ctx);
  await createSandbox(ctx, { image: IMAGE });
  const [exec] = sandboxToolSpecs(ctx);
  if (!exec) throw new Error("outil exec absent");
  const call = (args: unknown, signal?: AbortSignal) =>
    exec.run(args, { parentId: null, correlation: undefined, signal });
  return { fake, ctx, exec, call };
};

describe("toolset sandbox : exec", () => {
  it("expose exec seulement (ni put ni get), sans paramètre de conteneur", async () => {
    const { ctx, exec } = await setup();
    expect(sandboxToolSpecs(ctx).map((s) => s.name)).toEqual(["exec"]);
    expect(Object.keys(exec.input).sort()).toEqual(["argv", "cwd", "timeoutSec"]);
  });

  it("l'identifiant vient du registre : un conteneur fourni dans l'entrée est ignoré", async () => {
    const { fake, call } = await setup();
    const out = await call({
      argv: ["id"],
      container: "b".repeat(64),
      containerId: "c".repeat(64),
    });
    expect(out).toContain("code de sortie : 0");
    const execs = (await fake.calls()).filter((c) => c.startsWith("exec|--user"));
    expect(execs).toEqual([`exec|--user|65534:65534|--workdir|/work|${ID}|id|`]);
  });

  it("rend le code de sortie et les sorties étiquetées", async () => {
    const { fake, call } = await setup();
    await fake.control({
      container: [goodInspect(RUN)],
      execStdout: "bonjour\n",
      execStderr: "oups\n",
    });
    expect(await call({ argv: ["x"] })).toBe(
      "code de sortie : 0\n[stdout]\nbonjour\n[stderr]\noups",
    );
  });

  it("sans bac à sable actif : sandbox.unavailable", async () => {
    const { ctx, call } = await setup();
    await removeAllSandboxes(ctx);
    await expect(call({ argv: ["id"] })).rejects.toMatchObject({ code: "sandbox.unavailable" });
  });

  it("sérialise les exécutions : la seconde attend la fin (et le redémarrage) de la première", async () => {
    const { fake, call } = await setup();
    await fake.control({ container: [goodInspect(RUN)], execStdout: "p\n" });
    const first = call({ argv: ["hang"], timeoutSec: 1 }).catch((e) => e);
    const second = call({ argv: ["echo"] });
    expect(await first).toMatchObject({ code: "sandbox.execTimeout" });
    await second;
    const calls = await fake.calls();
    const restart = calls.findIndex((c) => c.startsWith("restart|"));
    const hang = calls.findIndex((c) => c.includes("|hang|"));
    const echo = calls.findIndex((c) => c.includes("|echo|"));
    expect(hang).toBeGreaterThan(-1);
    expect(restart).toBeGreaterThan(hang);
    expect(echo).toBeGreaterThan(restart);
    // Plusieurs faux docker (processus Node) enchaînés : marge pour Windows sous charge.
  }, 30_000);

  it("délai : restart appelé, sortie partielle rendue, sandbox.execTimeout", async () => {
    const { fake, call } = await setup();
    await fake.control({ container: [goodInspect(RUN)], execStdout: "partiel\n" });
    const err = await call({ argv: ["hang"], timeoutSec: 1 }).catch((e) => e);
    expect(err).toMatchObject({
      code: "sandbox.execTimeout",
      params: { seconds: 1, restarted: 1 },
    });
    expect(err.params.output).toContain("partiel");
    expect((await fake.calls()).some((c) => c === `restart|-t|2|${ID}|`)).toBe(true);
  });

  it("annulation : sandbox.execAborted avec sortie partielle, puis conteneur supprimé en fin de run", async () => {
    const { fake, ctx, call } = await setup();
    await fake.control({ container: [goodInspect(RUN)], execStdout: "avant\n" });
    const abort = new AbortController();
    const pending = call({ argv: ["hang"] }, abort.signal).catch((e) => e);
    await new Promise((r) => setTimeout(r, 1500));
    abort.abort(new Error("Ctrl-C"));
    const err = await pending;
    expect(err).toMatchObject({ code: "sandbox.execAborted", params: { restarted: 1 } });
    expect(err.params.output).toContain("avant");

    await removeAllSandboxes(ctx, "abort");
    expect((await fake.calls()).some((c) => c === `rm|--force|${ID}|`)).toBe(true);
    expect(ctx.registry.has(ID)).toBe(false);
    expect(activeSandboxId(ctx)).toBeUndefined();
  });

  it("annulation avant le tour dans la file : aucune exécution", async () => {
    const { fake, call } = await setup();
    const abort = new AbortController();
    abort.abort(new Error("Ctrl-C"));
    await expect(call({ argv: ["id"] }, abort.signal)).rejects.toMatchObject({
      code: "sandbox.execAborted",
    });
    expect((await fake.calls()).some((c) => c.startsWith("exec|--user"))).toBe(false);
  });

  it("rejette une entrée invalide (argv vide, hors /work)", async () => {
    const { call } = await setup();
    await expect(call({ argv: [] })).rejects.toThrow();
    await expect(call({ argv: ["ls"], cwd: "/etc" })).rejects.toMatchObject({
      code: "sandbox.invalidArgument",
    });
  });
});

describe("câblage de sandboxContainerId (registre → gate)", () => {
  it("l'identifiant du registre sert à la clé de session ; sans bac à sable, exec est refusé", async () => {
    const { ctx } = await setup();
    const asked: string[] = [];
    const gate = createApprovalGate({
      policy: { default: "ask", rules: [] },
      recorder: createRecorder({ runId: "r" }),
      ask: async (r) => {
        asked.push(JSON.stringify(r.input));
        return { decision: "allow", remember: "session" };
      },
      sandboxContainerId: () => activeSandboxId(ctx),
    });
    const decide = (argv: string[]) =>
      gate.decide({ toolUseId: "t", tool: EXEC, input: { argv } }, new AbortController().signal);

    expect((await decide(["npm", "test"])).decision).toBe("allow");
    expect((await decide(["npm", "test"])).reason.code).toBe("approval.remembered");
    expect(asked).toHaveLength(1);

    await removeAllSandboxes(ctx);
    const outcome = await decide(["npm", "test"]);
    expect(outcome.decision).toBe("deny");
    expect(outcome.reason.code).toBe("sandbox.unavailable");
    expect(asked).toHaveLength(1);
  });
});

describe("registre et prune", () => {
  it("le registre s'inscrit au filet de sortie à l'ajout et s'en retire quand il est vide", () => {
    const removed: string[] = [];
    const record = (id: string) => ({
      id,
      runId: "r",
      network: "none" as const,
      memory: "2g",
      cpus: 2,
      unavailable: false,
      removeSync: () => {
        removed.push(id);
      },
    });
    const registry = new SandboxRegistry();
    removeAllSandboxesSync(); // jamais ajouté : rien
    registry.add(record("x"));
    registry.delete("x"); // vidé : retiré du filet
    const other = new SandboxRegistry();
    other.add(record("y"));
    removeAllSandboxesSync();
    expect(removed).toEqual(["y"]);
  });

  const other = "d".repeat(64);
  const PS =
    "ps|--all|--no-trunc|--filter|label=io.john-studio.sandbox|--filter|name=^john-sbx-|--format|{{.ID}}\t{{.Names}}|";
  const prune = async (psOut: string[], remove: boolean, extra: { rmFailsOn?: string } = {}) => {
    const fake = await fakeSandboxDocker();
    await fake.control({ psOut, ...extra });
    const ctx = createSandboxContext({
      recorder: createRecorder({ runId: "p" }),
      binary: fake.bin,
      argsPrefix: fake.argsPrefix,
    });
    return { fake, result: await pruneSandboxes(ctx, { remove }) };
  };

  it("prune sans confirmation : liste seulement, filtre label et nom", async () => {
    const { fake, result } = await prune(
      [`${ID}\tjohn-sbx-run1`, `${other}\tautre-nom`, "pas-un-id\tjohn-sbx-x"],
      false,
    );
    expect(result).toEqual({ found: [{ id: ID, name: "john-sbx-run1" }], removed: [], failed: [] });
    expect(await fake.calls()).toEqual([PS]);
  });

  it("prune confirmé : un rm en échec n'arrête pas les suivants et est signalé", async () => {
    const { fake, result } = await prune([`${ID}\tjohn-sbx-a`, `${other}\tjohn-sbx-b`], true, {
      rmFailsOn: ID,
    });
    expect(result.removed).toEqual([other]);
    expect(result.failed).toEqual([ID]);
    expect(await fake.calls()).toEqual([PS, `rm|--force|${ID}|`, `rm|--force|${other}|`]);
  });
});
