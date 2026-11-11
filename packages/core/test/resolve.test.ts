import { describe, expect, it } from "vitest";
import { resolveBinary, safeEnv } from "../src/index.js";

const fsOf = (...files: string[]) => {
  const set = new Set(files);
  return (path: string) => set.has(path);
};
const win = (env: NodeJS.ProcessEnv, ...files: string[]) => ({
  platform: "win32" as const,
  env,
  isFile: fsOf(...files),
});

describe("resolveBinary (win32 simulé)", () => {
  it("renvoie toujours un chemin absolu .exe trouvé dans PATH", () => {
    const o = win({ Path: "C:\\Tools;C:\\Bin" }, "C:\\Bin\\docker.exe");
    expect(resolveBinary("docker", o)).toBe("C:\\Bin\\docker.exe");
    expect(resolveBinary("docker.exe", o)).toBe("C:\\Bin\\docker.exe");
  });

  it("ignore les entrées PATH vides ou relatives : jamais le cwd", () => {
    const o = win(
      { PATH: ";.;bin;..\\x;C:\\Bin" },
      "docker.exe",
      ".\\docker.exe",
      "bin\\docker.exe",
    );
    expect(resolveBinary("docker", o)).toBeNull();
  });

  it("refuse un chemin relatif et un nom avec séparateur relatif", () => {
    const o = win({ PATH: "C:\\Bin" }, ".\\docker.exe", "C:\\Bin\\docker.exe");
    expect(resolveBinary(".\\docker.exe", o)).toBeNull();
    expect(resolveBinary("sub\\docker", o)).toBeNull();
  });

  it("n'exécute pas les autres extensions (PATHEXT inutilisé)", () => {
    const o = win(
      { PATH: "C:\\Bin", PATHEXT: ".COM;.EXE" },
      "C:\\Bin\\docker.com",
      "C:\\Bin\\docker.ps1",
    );
    expect(resolveBinary("docker", o)).toBeNull();
    expect(resolveBinary("docker.com", o)).toBeNull();
  });

  it("sonde l'.exe du paquet npm derrière un shim opencode.cmd", () => {
    const exe = "C:\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe";
    const o = win({ PATH: "C:\\npm" }, "C:\\npm\\opencode.cmd", exe);
    expect(resolveBinary("opencode", o)).toBe(exe);
    expect(resolveBinary("C:\\npm\\opencode.cmd", o)).toBe(exe);
  });

  it("refuse un shim sans .exe voisin : binary.shimUnsupported", () => {
    const o = win({ PATH: "C:\\npm" }, "C:\\npm\\opencode.cmd", "C:\\npm\\autre.bat");
    expect(() => resolveBinary("opencode", o)).toThrowError(
      expect.objectContaining({
        code: "binary.shimUnsupported",
        params: { binary: "opencode", shim: "C:\\npm\\opencode.cmd" },
      }),
    );
    expect(() => resolveBinary("autre.bat", o)).toThrowError(
      expect.objectContaining({ code: "binary.shimUnsupported" }),
    );
  });

  it("l'.exe prime sur un shim du même répertoire", () => {
    const o = win({ PATH: "C:\\Bin" }, "C:\\Bin\\opencode.exe", "C:\\Bin\\opencode.cmd");
    expect(resolveBinary("opencode", o)).toBe("C:\\Bin\\opencode.exe");
  });
});

describe("resolveBinary (POSIX)", () => {
  const o = (env: NodeJS.ProcessEnv, ...files: string[]) => ({
    platform: "linux" as const,
    env,
    isFile: fsOf(...files),
  });
  it("cherche dans PATH en ignorant entrées vides et relatives", () => {
    expect(resolveBinary("docker", o({ PATH: ":.:bin:/usr/bin" }, "/usr/bin/docker"))).toBe(
      "/usr/bin/docker",
    );
    expect(
      resolveBinary("docker", o({ PATH: ":.:bin" }, "docker", "./docker", "bin/docker")),
    ).toBeNull();
  });
  it("accepte un chemin explicite, sinon null", () => {
    expect(resolveBinary("/opt/x", o({}, "/opt/x"))).toBe("/opt/x");
    expect(resolveBinary("/opt/y", o({}, "/opt/x"))).toBeNull();
  });
});

describe("safeEnv (plateforme simulée)", () => {
  it("garde la liste Windows et une seule occurrence par clé sans casse", () => {
    const env = safeEnv(
      {
        Path: "C:\\a",
        PATH: "C:\\b",
        SystemRoot: "C:\\Windows",
        "ProgramFiles(x86)": "C:\\P86",
        NUMBER_OF_PROCESSORS: "8",
        OS: "Windows_NT",
        USERNAME: "u",
        GITHUB_TOKEN: "t",
        ANTHROPIC_API_KEY: "k",
      },
      "win32",
    );
    expect(env).toEqual({
      Path: "C:\\a",
      SystemRoot: "C:\\Windows",
      "ProgramFiles(x86)": "C:\\P86",
      NUMBER_OF_PROCESSORS: "8",
      OS: "Windows_NT",
      USERNAME: "u",
    });
  });
});

describe("macOS : emplacements d'installation de Docker", () => {
  it("trouve docker hors du PATH sur darwin", () => {
    const found = resolveBinary("docker", {
      platform: "darwin",
      env: { PATH: "/usr/bin:/bin", HOME: "/Users/dev" },
      isFile: (p) => p === "/Users/dev/.docker/bin/docker",
    });
    expect(found).toBe("/Users/dev/.docker/bin/docker");
  });
  it("sonde /opt/homebrew/bin sur darwin et pas sur linux", () => {
    const isFile = (p: string) => p === "/opt/homebrew/bin/docker";
    expect(resolveBinary("docker", { platform: "darwin", env: { PATH: "" }, isFile })).toBe(
      "/opt/homebrew/bin/docker",
    );
    expect(resolveBinary("docker", { platform: "linux", env: { PATH: "" }, isFile })).toBeNull();
  });
});
