import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSafeConfig,
  forcedPermission,
  HARDENING_ENV,
  isUnevaluable,
  normalizeInput,
  policyToolName,
  resolveBinary,
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
    const dir = mkdtempSync(join(tmpdir(), "oc-bin-"));
    const bin = join(dir, "opencode");
    writeFileSync(bin, "#!/bin/sh\n");
    expect(resolveBinary("opencode", { PATH: dir })).toBeNull(); // non exécutable
    chmodSync(bin, 0o755);
    expect(resolveBinary("opencode", { PATH: `/nulle/part:${dir}` })).toBe(bin);
    expect(resolveBinary(bin, {})).toBe(bin);
    expect(resolveBinary("absent", { PATH: dir })).toBeNull();
  });
});
