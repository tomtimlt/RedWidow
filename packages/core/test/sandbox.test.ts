import { afterEach, describe, expect, it } from "vitest";
import {
  createRecorder,
  createSandbox,
  createSandboxContext,
  type EngineEvent,
  execInSandbox,
  inspectSandbox,
  removeAllSandboxesSync,
  removeSandbox,
  restartSandbox,
  SandboxRegistry,
} from "../src/index.js";
import { fakeSandboxDocker, goodInspect, FAKE_SANDBOX_ID as ID } from "./helpers.js";

const RUN = "run1";
const IMAGE = "alpine:3.20";

const RUN_CALL = [
  "run|-d|--pull|never|--init|--label|io.john-studio.sandbox=run1|--name|john-sbx-run1",
  "--user|65534:65534|--cap-drop|ALL|--security-opt|no-new-privileges|--network|none",
  "--pids-limit|512|--memory|2g|--memory-swap|2g|--cpus|2|--restart|no|--stop-timeout|2",
  `--log-driver|none|--workdir|/work|--entrypoint|sleep|${IMAGE}|infinity|`,
].join("|");

const contexts: { registry: SandboxRegistry }[] = [];
// Chaque test repart d'un filet de sortie vide (les conteneurs de test sont fictifs).
afterEach(() => {
  for (const c of contexts.splice(0)) c.registry.drain();
});

const setup = async (maxTimeoutSec?: number) => {
  const fake = await fakeSandboxDocker();
  await fake.control({ container: [goodInspect(RUN)] });
  const recorder = createRecorder({ runId: RUN });
  const events: EngineEvent[] = [];
  recorder.subscribe((e) => events.push(e));
  const ctx = createSandboxContext({
    recorder,
    binary: fake.bin,
    argsPrefix: fake.argsPrefix,
    ...(maxTimeoutSec !== undefined && { maxTimeoutSec }),
  });
  contexts.push(ctx);
  return { fake, ctx, events };
};

const sandboxEvents = (events: EngineEvent[]) =>
  events.filter((e) => e.kind === "sandbox.started" || e.kind === "sandbox.stopped");

describe("createSandbox", () => {
  it("construit l'argv exact de run, vérifie, initialise /work et journalise sandbox.started", async () => {
    const { fake, ctx, events } = await setup();
    expect(await createSandbox(ctx, { image: IMAGE })).toBe(ID);
    expect(await fake.calls()).toEqual([
      `image|inspect|${IMAGE}|`,
      RUN_CALL,
      `container|inspect|${ID}|`,
      `exec|-u|0|${ID}|mkdir|-p|/work|`,
      `exec|-u|0|${ID}|chown|65534:65534|/work|`,
    ]);
    expect(ctx.registry.has(ID)).toBe(true);
    expect(sandboxEvents(events)).toMatchObject([
      {
        kind: "sandbox.started",
        containerId: ID,
        image: IMAGE,
        imageDigest: "alpine@sha256:digest",
        network: "none",
        limits: { pidsLimit: 512, memory: "2g", cpus: 2 },
      },
    ]);
  });

  it("aucune image : sandbox.imageUnsupported sans appeler docker", async () => {
    const { fake, ctx } = await setup();
    for (const image of [undefined, ""])
      await expect(createSandbox(ctx, { image })).rejects.toMatchObject({
        code: "sandbox.imageUnsupported",
        params: { reason: "missing" },
      });
    expect(await fake.calls()).toEqual([]);
  });

  it("image absente (--pull never) : imageUnsupported, aucun run", async () => {
    const { fake, ctx } = await setup();
    await fake.control({ imageMissing: true });
    await expect(createSandbox(ctx, { image: IMAGE })).rejects.toMatchObject({
      code: "sandbox.imageUnsupported",
      params: { reason: "absent" },
    });
    expect((await fake.calls()).some((c) => c.startsWith("run|"))).toBe(false);
  });

  it("image sans sleep : imageUnsupported", async () => {
    const { fake, ctx } = await setup();
    await fake.control({ runFails: 'exec: "sleep": executable file not found in $PATH' });
    await expect(createSandbox(ctx, { image: IMAGE })).rejects.toMatchObject({
      code: "sandbox.imageUnsupported",
      params: { reason: "noSleep" },
    });
    expect(ctx.registry.ids()).toEqual([]);
  });

  it("image sans chown : imageUnsupported, conteneur supprimé et désinscrit", async () => {
    const { fake, ctx, events } = await setup();
    await fake.control({ container: [goodInspect(RUN)], execFailsOn: "chown" });
    await expect(createSandbox(ctx, { image: IMAGE })).rejects.toMatchObject({
      code: "sandbox.imageUnsupported",
      params: { reason: "init" },
    });
    expect((await fake.calls()).at(-1)).toBe(`rm|--force|${ID}|`);
    expect(ctx.registry.ids()).toEqual([]);
    expect(sandboxEvents(events)).toMatchObject([{ kind: "sandbox.stopped", cause: "error" }]);
  });

  it("conteneur mal durci à la création : sandbox.tampered et suppression", async () => {
    const { fake, ctx } = await setup();
    const bad = goodInspect(RUN);
    bad.HostConfig.NetworkMode = "bridge";
    await fake.control({ container: [bad] });
    await expect(createSandbox(ctx, { image: IMAGE })).rejects.toMatchObject({
      code: "sandbox.tampered",
    });
    expect((await fake.calls()).at(-1)).toBe(`rm|--force|${ID}|`);
  });

  it.each(["--privileged", "-v/:/h", "a b", "x;y", "-"])(
    "refuse l'image %j avant tout lancement (aucune option docker issue d'une entrée)",
    async (image) => {
      const { fake, ctx } = await setup();
      await expect(createSandbox(ctx, { image })).rejects.toMatchObject({
        code: "docker.invalidOperand",
      });
      expect(await fake.calls()).toEqual([]);
    },
  );

  it("refuse un runId qui ne convient ni au label ni au nom", async () => {
    const fake = await fakeSandboxDocker();
    const ctx = createSandboxContext({
      recorder: createRecorder({ runId: "--rm x" }),
      binary: fake.bin,
      argsPrefix: fake.argsPrefix,
    });
    await expect(createSandbox(ctx, { image: IMAGE })).rejects.toMatchObject({
      code: "sandbox.invalidArgument",
      params: { field: "runId" },
    });
    expect(await fake.calls()).toEqual([]);
  });

  it("sortie de run qui n'est pas un identifiant complet : unexpectedOutput", async () => {
    const { fake, ctx } = await setup();
    await fake.control({ runOutput: "abc123" });
    await expect(createSandbox(ctx, { image: IMAGE })).rejects.toMatchObject({
      code: "docker.unexpectedOutput",
    });
    expect(ctx.registry.ids()).toEqual([]);
    expect((await fake.calls()).some((c) => c.startsWith("exec|"))).toBe(false);
  });
});

describe("inspectSandbox : vérification avant usage", () => {
  const mutations: [
    string,
    (d: ReturnType<typeof goodInspect> & Record<string, unknown>) => void,
  ][] = [
    [
      "Id",
      (d) => {
        d.Id = "b".repeat(64);
      },
    ],
    [
      "Config.Labels",
      (d) => {
        d.Config.Labels = { "io.john-studio.sandbox": "autre" };
      },
    ],
    [
      "Config.Labels",
      (d) => {
        d.Config.Labels = {} as never;
      },
    ],
    [
      "State.Running",
      (d) => {
        d.State.Running = false;
      },
    ],
    [
      "HostConfig.Privileged",
      (d) => {
        d.HostConfig.Privileged = true;
      },
    ],
    [
      "HostConfig.CapAdd",
      (d) => {
        d.HostConfig.CapAdd = ["SYS_ADMIN"] as never;
      },
    ],
    [
      "HostConfig.CapDrop",
      (d) => {
        d.HostConfig.CapDrop = [];
      },
    ],
    [
      "HostConfig.CapDrop",
      (d) => {
        d.HostConfig.CapDrop = ["NET_RAW"];
      },
    ],
    [
      "HostConfig.SecurityOpt",
      (d) => {
        d.HostConfig.SecurityOpt = [];
      },
    ],
    [
      "HostConfig.SecurityOpt",
      (d) => {
        d.HostConfig.SecurityOpt = ["no-new-privileges", "seccomp=unconfined"];
      },
    ],
    [
      "HostConfig.SecurityOpt",
      (d) => {
        d.HostConfig.SecurityOpt = ["no-new-privileges", "apparmor:unconfined"];
      },
    ],
    [
      "HostConfig.Binds",
      (d) => {
        d.HostConfig.Binds = ["/:/host"] as never;
      },
    ],
    [
      "Mounts",
      (d) => {
        d.Mounts = [{ Type: "volume" }] as never;
      },
    ],
    [
      "HostConfig.Devices",
      (d) => {
        d.HostConfig.Devices = [{ PathOnHost: "/dev/kvm" }] as never;
      },
    ],
    [
      "HostConfig.NetworkMode",
      (d) => {
        d.HostConfig.NetworkMode = "bridge";
      },
    ],
    [
      "HostConfig.NetworkMode",
      (d) => {
        d.HostConfig.NetworkMode = "host";
      },
    ],
    [
      "HostConfig.PidsLimit",
      (d) => {
        d.HostConfig.PidsLimit = 0;
      },
    ],
    [
      "HostConfig.Memory",
      (d) => {
        d.HostConfig.Memory = 0;
      },
    ],
    [
      "HostConfig.MemorySwap",
      (d) => {
        d.HostConfig.MemorySwap = -1;
      },
    ],
    [
      "HostConfig.NanoCpus",
      (d) => {
        d.HostConfig.NanoCpus = 0;
      },
    ],
    [
      "HostConfig.DeviceRequests",
      (d) => {
        d.HostConfig.DeviceRequests = [{ Driver: "nvidia" }] as never;
      },
    ],
    [
      "HostConfig.CgroupnsMode",
      (d) => {
        d.HostConfig.CgroupnsMode = "host";
      },
    ],
    [
      "HostConfig.PidMode",
      (d) => {
        d.HostConfig.PidMode = "host";
      },
    ],
    [
      "HostConfig.IpcMode",
      (d) => {
        d.HostConfig.IpcMode = "host";
      },
    ],
    [
      "HostConfig.UTSMode",
      (d) => {
        d.HostConfig.UTSMode = "host";
      },
    ],
    [
      "HostConfig.UsernsMode",
      (d) => {
        d.HostConfig.UsernsMode = "host";
      },
    ],
    [
      "Config.User",
      (d) => {
        d.Config.User = "0";
      },
    ],
    [
      "Config.User",
      (d) => {
        d.Config.User = "";
      },
    ],
    [
      "HostConfig",
      (d) => {
        (d as Record<string, unknown>).HostConfig = null;
      },
    ],
    [
      "HostConfig.CapAdd",
      (d) => {
        d.HostConfig.CapAdd = "SYS_ADMIN" as never;
      },
    ],
  ];

  it.each(mutations)("champ %s altéré : sandbox.tampered", async (field, mutate) => {
    const { fake, ctx } = await setup();
    await createSandbox(ctx, { image: IMAGE });
    const doc = goodInspect(RUN) as ReturnType<typeof goodInspect> & Record<string, unknown>;
    mutate(doc);
    await fake.control({ container: [doc] });
    await expect(inspectSandbox(ctx, ID)).rejects.toMatchObject({
      code: "sandbox.tampered",
      params: { field },
    });
    // Aucune exécution n'a lieu après une altération.
    const before = (await fake.calls()).length;
    await expect(execInSandbox(ctx, ID, { argv: ["id"] })).rejects.toMatchObject({
      code: "sandbox.tampered",
    });
    expect((await fake.calls()).slice(before).some((c) => c.startsWith("exec|"))).toBe(false);
  });

  it.each([null, {}, [], [1], "x", [goodInspect(RUN), goodInspect(RUN)]])(
    "forme inattendue de inspect %j : sandbox.tampered ou unexpectedOutput",
    async (shape) => {
      const { fake, ctx } = await setup();
      await createSandbox(ctx, { image: IMAGE });
      await fake.control({ container: shape });
      await expect(inspectSandbox(ctx, ID)).rejects.toMatchObject({
        code: expect.stringMatching(/^(sandbox\.tampered|docker\.unexpectedOutput)$/),
      });
    },
  );

  it.each([
    "systempaths=unconfined",
    "label=disable",
    "seccomp=/tmp/permissif.json",
    "apparmor=unconfined",
    "no-new-privileges:false",
  ])("SecurityOpt en liste blanche : l'entrée %s est une altération", async (extra) => {
    const { fake, ctx } = await setup();
    await createSandbox(ctx, { image: IMAGE });
    const doc = goodInspect(RUN);
    doc.HostConfig.SecurityOpt = ["no-new-privileges", extra];
    await fake.control({ container: [doc] });
    await expect(inspectSandbox(ctx, ID)).rejects.toMatchObject({ code: "sandbox.tampered" });
  });

  it("accepte les formes équivalentes de Docker (CapAdd [], no-new-privileges:true)", async () => {
    const { fake, ctx } = await setup();
    await createSandbox(ctx, { image: IMAGE });
    const doc = goodInspect(RUN);
    doc.HostConfig.CapAdd = [] as never;
    doc.HostConfig.SecurityOpt = ["no-new-privileges:true"];
    await fake.control({ container: [doc] });
    await expect(inspectSandbox(ctx, ID)).resolves.toBeUndefined();
  });

  it("identifiant hors registre : refusé sans appeler docker (exec, inspect, restart, rm)", async () => {
    const { fake, ctx } = await setup();
    const other = "c".repeat(64);
    const unknown = { code: "sandbox.unknownContainer" };
    await expect(inspectSandbox(ctx, other)).rejects.toMatchObject(unknown);
    await expect(execInSandbox(ctx, other, { argv: ["id"] })).rejects.toMatchObject(unknown);
    await expect(restartSandbox(ctx, other)).rejects.toMatchObject(unknown);
    await expect(removeSandbox(ctx, other)).rejects.toMatchObject(unknown);
    await expect(inspectSandbox(ctx, "--all")).rejects.toMatchObject(unknown);
    expect(await fake.calls()).toEqual([]);
  });

  it("un registre distinct n'autorise pas un conteneur d'un autre registre", async () => {
    const { fake, ctx } = await setup();
    await createSandbox(ctx, { image: IMAGE });
    const foreign = { ...ctx, registry: new SandboxRegistry() };
    await expect(execInSandbox(foreign, ID, { argv: ["id"] })).rejects.toMatchObject({
      code: "sandbox.unknownContainer",
    });
    expect((await fake.calls()).some((c) => c.startsWith("exec|--user"))).toBe(false);
  });
});

describe("execInSandbox", () => {
  it("argv exact : docker exec --user --workdir <id> <argv…>, vérification d'abord", async () => {
    const { fake, ctx } = await setup();
    await createSandbox(ctx, { image: IMAGE });
    const before = (await fake.calls()).length;
    const result = await execInSandbox(ctx, ID, {
      argv: ["sh", "-c", "echo hi; --privileged"],
      cwd: "/work/sub/",
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toEqual(["exec-ok"]);
    expect(result.restarted).toBeUndefined();
    expect((await fake.calls()).slice(before)).toEqual([
      `container|inspect|${ID}|`,
      `exec|--user|65534:65534|--workdir|/work/sub|${ID}|sh|-c|echo hi; --privileged|`,
    ]);
  });

  it("une option dans argv reste un argument de la commande, placé après l'identifiant", async () => {
    const { fake, ctx } = await setup();
    await createSandbox(ctx, { image: IMAGE });
    const before = (await fake.calls()).length;
    await execInSandbox(ctx, ID, { argv: ["--privileged", "-v", "/:/h", "--user=0"] });
    const [, exec] = (await fake.calls()).slice(before);
    expect(exec).toBe(
      `exec|--user|65534:65534|--workdir|/work|${ID}|--privileged|-v|/:/h|--user=0|`,
    );
  });

  it.each<[string, object, string, string]>([
    ["argv", { argv: [] }, "argv", "empty"],
    ["argv", { argv: [""] }, "argv", "empty"],
    ["argv", { argv: ["a", "b\0c"] }, "argv", "nul"],
    ["argv", { argv: Array(257).fill("x") }, "argv", "tooMany"],
    ["argv", { argv: ["x".repeat(16 * 1024 + 1)] }, "argv", "tooLarge"],
    ["argv", { argv: [1] }, "argv", "notStrings"],
    ["argv", { argv: "ls" }, "argv", "notStrings"],
    ["cwd", { argv: ["ls"], cwd: "relatif" }, "cwd", "notAbsolute"],
    ["cwd", { argv: ["ls"], cwd: "/etc" }, "cwd", "outside"],
    ["cwd", { argv: ["ls"], cwd: "/workspace" }, "cwd", "outside"],
    ["cwd", { argv: ["ls"], cwd: "/work/../etc" }, "cwd", "outside"],
    ["cwd", { argv: ["ls"], cwd: "/work/a/../b" }, "cwd", "outside"],
    ["cwd", { argv: ["ls"], cwd: "/work\0" }, "cwd", "nul"],
    ["timeoutSec", { argv: ["ls"], timeoutSec: 0 }, "timeoutSec", "range"],
    ["timeoutSec", { argv: ["ls"], timeoutSec: 601 }, "timeoutSec", "range"],
    ["timeoutSec", { argv: ["ls"], timeoutSec: Number.NaN }, "timeoutSec", "range"],
  ])("refuse l'entrée invalide (%s) sans lancer docker", async (_n, input, field, why) => {
    const { fake, ctx } = await setup();
    await createSandbox(ctx, { image: IMAGE });
    const before = (await fake.calls()).length;
    await expect(execInSandbox(ctx, ID, input as never)).rejects.toMatchObject({
      code: "sandbox.invalidArgument",
      params: { field, reason: why },
    });
    expect((await fake.calls()).length).toBe(before);
  });

  it("plafond opérateur : refuse au-delà, et au-delà du maximum absolu à la construction", async () => {
    const { ctx } = await setup(1800);
    await createSandbox(ctx, { image: IMAGE });
    await expect(execInSandbox(ctx, ID, { argv: ["ls"], timeoutSec: 1801 })).rejects.toMatchObject({
      params: { field: "timeoutSec" },
    });
    expect(() => createSandboxContext({ recorder: createRecorder(), maxTimeoutSec: 1801 })).toThrow(
      expect.objectContaining({ code: "sandbox.invalidArgument" }),
    );
  });

  it("délai dépassé : docker restart -t 2 appelé, sortie partielle rendue", async () => {
    const { fake, ctx } = await setup();
    await createSandbox(ctx, { image: IMAGE });
    const result = await execInSandbox(ctx, ID, { argv: ["hang"], timeoutSec: 0.3 });
    expect(result.termination).toBe("timeout");
    expect(result.restarted).toBe(true);
    expect((await fake.calls()).at(-1)).toBe(`restart|-t|2|${ID}|`);
    expect(ctx.registry.get(ID)?.unavailable).toBe(false);
  });

  it("annulation : restart appelé", async () => {
    const { fake, ctx } = await setup();
    await createSandbox(ctx, { image: IMAGE });
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 300);
    const result = await execInSandbox(ctx, ID, { argv: ["hang"] }, { signal: abort.signal });
    expect(result.termination).toBe("abort");
    expect(result.restarted).toBe(true);
    expect((await fake.calls()).at(-1)).toBe(`restart|-t|2|${ID}|`);
  });

  it("annulation : le restart n'hérite pas du signal annulé (il dure et réussit)", async () => {
    const { fake, ctx } = await setup();
    await createSandbox(ctx, { image: IMAGE });
    await fake.control({ container: [goodInspect(RUN)], restartDelayMs: 500 });
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 300);
    const result = await execInSandbox(ctx, ID, { argv: ["hang"] }, { signal: abort.signal });
    expect(result.termination).toBe("abort");
    expect(result.restarted).toBe(true);
    expect(ctx.registry.has(ID)).toBe(true);
  });

  it("redémarrage impossible : conteneur supprimé, hors service, exécutions refusées", async () => {
    const { fake, ctx } = await setup();
    await createSandbox(ctx, { image: IMAGE });
    await fake.control({ container: [goodInspect(RUN)], restartFails: true });
    const result = await execInSandbox(ctx, ID, { argv: ["hang"], timeoutSec: 0.3 });
    expect(result.restarted).toBe(false);
    expect((await fake.calls()).at(-1)).toBe(`rm|--force|${ID}|`);
    // `rm` a réussi : l'identifiant n'est plus au registre.
    await expect(execInSandbox(ctx, ID, { argv: ["id"] })).rejects.toMatchObject({
      code: "sandbox.unknownContainer",
    });
  });

  it("redémarrage et suppression impossibles : reste inscrit mais sandbox.unavailable", async () => {
    const { fake, ctx } = await setup();
    await createSandbox(ctx, { image: IMAGE });
    await fake.control({ container: [goodInspect(RUN)], restartFails: true, rmFails: true });
    await expect(restartSandbox(ctx, ID)).rejects.toMatchObject({ code: "sandbox.unavailable" });
    await expect(execInSandbox(ctx, ID, { argv: ["id"] })).rejects.toMatchObject({
      code: "sandbox.unavailable",
    });
    expect(ctx.registry.has(ID)).toBe(true);
  });
});

describe("restartSandbox / removeSandbox", () => {
  it("argv exacts de restart et de rm ; sandbox.stopped journalisé", async () => {
    const { fake, ctx, events } = await setup();
    await createSandbox(ctx, { image: IMAGE });
    const before = (await fake.calls()).length;
    await restartSandbox(ctx, ID);
    await removeSandbox(ctx, ID, "abort");
    expect((await fake.calls()).slice(before)).toEqual([
      `restart|-t|2|${ID}|`,
      `rm|--force|${ID}|`,
    ]);
    expect(ctx.registry.has(ID)).toBe(false);
    expect(sandboxEvents(events).at(-1)).toMatchObject({
      kind: "sandbox.stopped",
      containerId: ID,
      cause: "abort",
    });
    // Un second appel est refusé : l'identifiant n'est plus au registre.
    await expect(removeSandbox(ctx, ID)).rejects.toMatchObject({
      code: "sandbox.unknownContainer",
    });
  });

  it("rm en échec : l'entrée reste inscrite pour le filet de sortie", async () => {
    const { fake, ctx } = await setup();
    await createSandbox(ctx, { image: IMAGE });
    await fake.control({ container: [goodInspect(RUN)], rmFails: true });
    await expect(removeSandbox(ctx, ID)).rejects.toMatchObject({ code: "docker.failed" });
    expect(ctx.registry.has(ID)).toBe(true);
  });

  it("rm en échec : le bac à sable est hors service, plus exécutable", async () => {
    const { fake, ctx } = await setup();
    await createSandbox(ctx, { image: IMAGE });
    await fake.control({ container: [goodInspect(RUN)], rmFails: true });
    await expect(removeSandbox(ctx, ID)).rejects.toMatchObject({ code: "docker.failed" });
    await expect(execInSandbox(ctx, ID, { argv: ["ls"] })).rejects.toMatchObject({
      code: "sandbox.unavailable",
    });
  });

  it("identifiant renvoyé par run malformé : rm par nom, rien d'inscrit", async () => {
    const { fake, ctx } = await setup();
    await fake.control({ container: [goodInspect(RUN)], runOutput: "pas-un-id" });
    await expect(createSandbox(ctx, { image: IMAGE })).rejects.toMatchObject({
      code: "docker.unexpectedOutput",
    });
    expect((await fake.calls()).at(-1)).toBe("rm|--force|john-sbx-run1|");
    expect(ctx.registry.has("pas-un-id")).toBe(false);
  });
});

describe("filet de sortie synchrone", () => {
  it("removeAllSandboxesSync supprime les bacs à sable inscrits (rm --force) et vide le registre", async () => {
    const { fake, ctx, events } = await setup();
    await createSandbox(ctx, { image: IMAGE });
    removeAllSandboxesSync();
    expect((await fake.calls()).at(-1)).toBe(`rm|--force|${ID}|`);
    expect(ctx.registry.ids()).toEqual([]);
    expect(sandboxEvents(events).at(-1)).toMatchObject({ kind: "sandbox.stopped", cause: "exit" });
  });
});
