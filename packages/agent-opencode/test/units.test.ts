import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { resolveBinary } from "@warband/core";
import { describe, expect, it } from "vitest";
import {
  assertSafeConfig,
  forcedPermission,
  HARDENING_ENV,
  isUnevaluable,
  launchServer,
  normalizeInput,
  policyToolName,
  serverEnv,
} from "../src/index.js";

describe("noms et entrées d'outils", () => {
  it("fait correspondre les outils OpenCode à ceux de la politique", () => {
    expect(
      ["read", "write", "edit", "glob", "grep", "bash", "webfetch", "list"].map((t) =>
        policyToolName(t),
      ),
    ).toEqual(["Read", "Write", "Edit", "Glob", "Grep", "Bash", "WebFetch", "Glob"]);
    expect(policyToolName("docker_ps", ["docker"])).toBe("mcp__docker__ps");
    expect(policyToolName("autre_outil", ["docker"])).toBe("autre_outil");
    expect(policyToolName("docker_", ["docker"])).toBe("docker_");
  });

  it("normalise les champs (filePath → file_path, command, pattern/path)", () => {
    expect(normalizeInput("Read", { filePath: "/a", offset: 2 })).toEqual({
      file_path: "/a",
      offset: 2,
    });
    expect(normalizeInput("Edit", { filePath: "/a", oldString: "x", newString: "y" })).toEqual({
      file_path: "/a",
      old_string: "x",
      new_string: "y",
    });
    expect(normalizeInput("Bash", { command: "ls", description: "d", extra: 1 })).toEqual({
      command: "ls",
      description: "d",
    });
    expect(normalizeInput("Grep", { pattern: "p", path: "/x" })).toEqual({
      pattern: "p",
      path: "/x",
    });
    expect(normalizeInput("Glob", {}, { path: "/m" })).toEqual({ pattern: "*", path: "/m" });
    expect(normalizeInput("Write", {}, { filepath: "/m" })).toEqual({ file_path: "/m" });
  });

  it("ne peut pas évaluer un outil fichier sans chemin, ni un patch", () => {
    expect(isUnevaluable("Read", {})).toBe(true);
    expect(isUnevaluable("Read", { file_path: "/a" })).toBe(false);
    expect(isUnevaluable("Patch", { file_path: "/a" })).toBe(true);
    expect(isUnevaluable("Bash", {})).toBe(false);
  });
});

describe("configuration imposée", () => {
  it("force ask/deny par outil, sans jamais écrire allow", () => {
    const p = forcedPermission(new Set(["read", "glob", "grep"]));
    expect(p).toMatchObject({
      "*": "ask",
      read: "ask",
      bash: "deny",
      edit: "deny",
      external_directory: "ask",
    });
    expect(Object.values(p)).not.toContain("allow");
    expect(forcedPermission(new Set(["bash"])).bash).toBe("ask");
    expect(forcedPermission(new Set(["write"])).edit).toBe("ask");
  });

  it("assertSafeConfig accepte ask/deny et refuse le reste", () => {
    expect(() => assertSafeConfig({ permission: { "*": "ask", bash: "deny" } })).not.toThrow();
    expect(() => assertSafeConfig({ permission: { "*": "deny" }, plugin: [] })).not.toThrow();
    expect(() => assertSafeConfig({})).toThrow(/opencode.unsafeConfig/);
    expect(() => assertSafeConfig({ permission: { "*": "allow" } })).toThrow();
    expect(() =>
      assertSafeConfig({
        permission: { "*": "ask" },
        experimental: { hook: { file_edited: { x: [] } } },
      }),
    ).toThrow();
  });
});

describe("environnement du serveur lancé", () => {
  it("n'hérite que de la liste blanche, des variables réseau et de passEnv", () => {
    const env = serverEnv({
      processEnv: {
        PATH: "/bin",
        HOME: "/h",
        HTTPS_PROXY: "http://p",
        XDG_DATA_HOME: "/d",
        OPENAI_API_KEY: "sk-secret",
        ANTHROPIC_API_KEY: "sk-ant",
        GITHUB_TOKEN: "gh",
      },
      passEnv: ["OPENAI_API_KEY", "ABSENTE"],
      config: { a: 1 },
      password: "pw",
    });
    expect(env).toMatchObject({
      PATH: "/bin",
      HOME: "/h",
      HTTPS_PROXY: "http://p",
      XDG_DATA_HOME: "/d",
      OPENAI_API_KEY: "sk-secret",
      OPENCODE_CONFIG_CONTENT: '{"a":1}',
      OPENCODE_SERVER_PASSWORD: "pw",
      ...HARDENING_ENV,
    });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.ABSENTE).toBeUndefined();
    expect(HARDENING_ENV.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("1");
  });

  it("trouve le binaire dans PATH, ou renvoie null", () => {
    const dir = mkdtempSync(join(realpathSync.native(tmpdir()), "oc-bin-"));
    const exe = process.platform === "win32" ? "opencode.exe" : "opencode";
    const bin = join(dir, exe);
    writeFileSync(bin, "", { mode: 0o644 });
    // Le bit d'exécution n'existe pas sous Windows : ce refus est propre à POSIX.
    if (process.platform !== "win32")
      expect(resolveBinary("opencode", { env: { PATH: dir } })).toBeNull();
    const dirExec = mkdtempSync(join(realpathSync.native(tmpdir()), "oc-bin-"));
    const binExec = join(dirExec, exe);
    writeFileSync(binExec, "", { mode: 0o755 });
    const path = [join(dir, "nulle-part"), dirExec].join(delimiter);
    expect(resolveBinary("opencode", { env: { PATH: path } })).toBe(binExec);
    expect(resolveBinary(binExec, { env: {} })).toBe(binExec);
    expect(resolveBinary("absent", { env: { PATH: dir } })).toBeNull();
  });
});

describe("launchServer : argsPrefix (réservé au code)", () => {
  const launch = (argsPrefix: readonly string[]) =>
    launchServer({
      binary: process.execPath,
      argsPrefix,
      cwd: process.cwd(),
      env: {},
      signal: new AbortController().signal,
      timeoutMs: 5000,
    });
  const invalid = (reason: string) =>
    expect.objectContaining({
      code: "docker.invalidArgument",
      params: { field: "argsPrefix", reason },
    });

  it("lance le faux serveur Node (execPath + script) et le ferme", async () => {
    const dir = mkdtempSync(join(realpathSync.native(tmpdir()), "oc-fake-"));
    const script = join(dir, "opencode.mjs");
    writeFileSync(
      script,
      `console.log("opencode server listening on http://127.0.0.1:" + process.argv[4].split("=")[1]);
setInterval(() => {}, 1000);
`,
    );
    const server = await launch([script]);
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    await server.close();
  });

  it("applique les bornes avant tout lancement", async () => {
    await expect(launch(Array(9).fill("x"))).rejects.toEqual(invalid("tooMany"));
    await expect(launch(["x".repeat(4097)])).rejects.toEqual(invalid("tooLarge"));
    await expect(launch(["a\0b"])).rejects.toEqual(invalid("nul"));
  });
});
