import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY,
  evaluatePolicy,
  extractPaths,
  globBase,
  type PathPlatform,
  type Policy,
  type PolicyContext,
} from "../src/index.js";

/** Faux `realpath` : table de chemins existants, ENOENT sinon ; `fail` simule une autre erreur. */
function fakeFs(
  entries: Record<string, string>,
  fail: Record<string, string> = {},
): (p: string) => string {
  return (p) => {
    const code = fail[p];
    if (code !== undefined) throw Object.assign(new Error(code), { code });
    const hit = entries[p];
    if (hit !== undefined) return hit;
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  };
}

const allowAll: Policy = { default: "allow", rules: [{ tool: "*", decision: "allow" }] };

const WIN_ENV = {
  USERPROFILE: "C:\\Users\\x",
  APPDATA: "C:\\Users\\x\\AppData\\Roaming",
  LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local",
  SystemRoot: "C:\\Windows",
  ProgramData: "C:\\ProgramData",
};

const win = (
  realpath: (p: string) => string = fakeFs({
    "C:\\": "C:\\",
    "C:\\w": "C:\\w",
    "C:\\w\\src": "C:\\w\\src",
  }),
): PolicyContext => ({
  cwd: "C:\\w",
  platform: "win32",
  env: WIN_ENV,
  home: "C:\\Users\\x",
  realpath,
});

const verdict = (
  ctx: PolicyContext,
  tool: string,
  input: Record<string, unknown>,
  policy = DEFAULT_POLICY,
) => evaluatePolicy(policy, tool, input, ctx);

describe("win32 : formes non analysables", () => {
  const cases: [string, string, string][] = [
    ["unc", "\\\\server\\share\\f.txt", "unc"],
    ["unc (barres obliques)", "//server/share/f.txt", "unc"],
    ["unc wsl", "\\\\wsl$\\Ubuntu\\etc\\passwd", "unc"],
    ["device \\\\?\\", "\\\\?\\C:\\w\\a.ts", "device"],
    ["device \\\\.\\", "\\\\.\\pipe\\x", "device"],
    ["ads", "C:\\w\\a.ts:secret", "ads"],
    ["ads sans lecteur", "a.ts:secret", "ads"],
    ["lecteur relatif", "C:foo.txt", "drive-relative"],
    ["lecteur seul", "C:", "drive-relative"],
    ["point final", "C:\\w\\src.\\a.ts", "trailing-dot-space"],
    ["espace finale", "C:\\w\\src \\a.ts", "trailing-dot-space"],
    ["réservé CON", "C:\\w\\CON", "reserved-name"],
    ["réservé nul.txt", "C:\\w\\nul.txt", "reserved-name"],
    ["réservé com1 casse", "C:\\w\\Com1.log", "reserved-name"],
    ["réservé COM¹", "C:\\w\\COM\u00b9", "reserved-name"],
    ["réservé LPT9", "lpt9", "reserved-name"],
    ["variable", "%TEMP%\\x", "env-var"],
    ["nom court non résolu", "C:\\w\\PROGRA~1\\x.txt", "short-name"],
  ];
  for (const [name, path, form] of cases) {
    it(name, () => {
      const v = verdict(win(), "Read", { file_path: path }, allowAll);
      expect(v.decision).toBe("deny");
      expect(v.reason).toEqual({ code: "path.unsupported", params: { path, form } });
    });
  }

  it("un nom court dans la partie résolue par realpath est accepté", () => {
    const ctx = win(
      fakeFs({ "C:\\": "C:\\", "C:\\w": "C:\\w", "C:\\w\\RUNNER~1": "C:\\w\\runneradmin" }),
    );
    expect(verdict(ctx, "Read", { file_path: "C:\\w\\RUNNER~1" }, allowAll).decision).toBe("allow");
  });

  it("un préfixe \\\\?\\ dans un résultat de realpath est retiré", () => {
    const ctx = win(
      fakeFs({ "C:\\": "C:\\", "C:\\w": "\\\\?\\C:\\w", "C:\\w\\src": "\\\\?\\C:\\w\\src" }),
    );
    expect(verdict(ctx, "Read", { file_path: "src\\a.ts" }, allowAll).decision).toBe("allow");
  });

  it("un résultat UNC de realpath est refusé", () => {
    const ctx = win(
      fakeFs({ "C:\\": "C:\\", "C:\\w": "C:\\w", "C:\\w\\link": "\\\\?\\UNC\\srv\\share" }),
    );
    const v = verdict(ctx, "Read", { file_path: "link\\f" }, allowAll);
    expect(v.decision).toBe("deny");
    expect(v.reason.code).toBe("path.unsupported");
    const plain = win(
      fakeFs({ "C:\\": "C:\\", "C:\\w": "C:\\w", "C:\\w\\link": "\\\\srv\\share" }),
    );
    expect(verdict(plain, "Read", { file_path: "link\\f" }, allowAll).reason.params?.form).toBe(
      "unc",
    );
  });

  it("une erreur de realpath autre que ENOENT/ENOTDIR est un refus (unresolvable)", () => {
    for (const code of ["EACCES", "EPERM", "EINVAL", "ELOOP"]) {
      const ctx = win(fakeFs({ "C:\\": "C:\\", "C:\\w": "C:\\w" }, { "C:\\w\\src\\a.ts": code }));
      const v = verdict(ctx, "Read", { file_path: "src\\a.ts" }, allowAll);
      expect(v.decision).toBe("deny");
      expect(v.reason).toEqual({
        code: "path.unsupported",
        params: { path: "src\\a.ts", form: "unresolvable" },
      });
    }
  });

  it("ENOENT remonte à l'ancêtre existant", () => {
    expect(verdict(win(), "Write", { file_path: "C:\\w\\src\\new\\b.ts" }, allowAll).decision).toBe(
      "allow",
    );
  });
});

describe("win32 : chemins sensibles et espace de travail", () => {
  it.each([
    "C:\\Users\\x\\.SSH\\id_rsa",
    "C:\\Users\\x\\.ssh.\\id_rsa",
    "~\\.claude\\.credentials.json",
    "~/.claude.json",
    "%USERPROFILE%\\.ssh",
    "C:\\Users\\x\\NTUSER.DAT",
    "C:\\Users\\x\\AppData\\Roaming\\Microsoft\\Protect\\s",
    "C:\\Users\\x\\AppData\\Roaming\\Microsoft\\Credentials\\c",
    "C:\\Users\\x\\AppData\\Local\\Microsoft\\Vault\\v",
    "C:\\Users\\x\\AppData\\Roaming\\gcloud\\creds.db",
    "C:\\Users\\x\\AppData\\Roaming\\GitHub CLI\\hosts.yml",
    "C:\\Users\\x\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Login Data",
    "C:\\Windows\\System32\\config\\SAM",
    "C:\\Windows\\NTDS\\ntds.dit",
    "C:\\ProgramData\\ssh\\ssh_host_rsa_key",
    "c:\\users\\X\\.AWS\\credentials",
  ])("deny : %s", (path) => {
    expect(verdict(win(), "Read", { file_path: path }, allowAll).decision).toBe("deny");
  });

  it("~\\ est développé comme ~/", () => {
    const v = verdict(win(), "Read", { file_path: "~\\.ssh\\id_rsa" }, allowAll);
    expect(v.reason.code).toBe("path.sensitive");
  });

  it("le dossier de configuration sous %APPDATA% est sensible", () => {
    const ctx: PolicyContext = { ...win(), home: "D:\\other" };
    expect(
      verdict(ctx, "Read", { file_path: `${WIN_ENV.APPDATA}\\john-studio\\policy.json` }, allowAll)
        .decision,
    ).toBe("deny");
  });

  it("espace de travail : allow, casse ignorée", () => {
    expect(verdict(win(), "Read", { file_path: "C:\\w\\src\\a.ts" }).decision).toBe("allow");
    expect(verdict(win(), "Read", { file_path: "c:\\W\\SRC\\a.ts" }).decision).toBe("allow");
    expect(verdict(win(), "Read", { file_path: "src/a.ts" }).decision).toBe("allow");
  });

  it("autre lecteur : ask (comme hors de l'espace de travail)", () => {
    const v = verdict(win(), "Read", { file_path: "D:\\data\\f.txt" });
    expect(v.decision).toBe("ask");
    expect(v.reason.code).toBe("path.outside");
    expect(verdict(win(), "Read", { file_path: "..\\x.txt" }).decision).toBe("ask");
  });

  it("un dossier dont le nom commence par .. n'est pas pris pour le parent", () => {
    expect(verdict(win(), "Read", { file_path: "C:\\w\\..data\\f" }).decision).toBe("allow");
  });

  it("Glob : motif en lecteur absolu ou avec variable", () => {
    expect(verdict(win(), "Glob", { pattern: "C:\\Users\\x\\.ssh\\*" }, allowAll).decision).toBe(
      "deny",
    );
    expect(
      verdict(win(), "Glob", { pattern: "%USERPROFILE%\\.ssh\\*" }, allowAll).reason.params?.form,
    ).toBe("env-var");
    expect(verdict(win(), "Glob", { pattern: "C:\\*" }, allowAll).decision).toBe("ask");
    expect(
      verdict(win(), "Glob", { pattern: "\\\\srv\\share\\*" }, allowAll).reason.params?.form,
    ).toBe("unc");
  });
});

describe("darwin et posix", () => {
  const fs = fakeFs({ "/": "/", "/w": "/w", "/Users/x": "/Users/x" });
  const ctx = (platform: PathPlatform): PolicyContext => ({
    cwd: "/w",
    platform,
    env: {},
    home: "/Users/x",
    realpath: fs,
  });

  it("darwin : comparaison insensible à la casse", () => {
    expect(verdict(ctx("darwin"), "Read", { file_path: "~/.SSH/id_rsa" }, allowAll).decision).toBe(
      "deny",
    );
    expect(verdict(ctx("darwin"), "Read", { file_path: "/W/a.ts" }).decision).toBe("allow");
  });

  it("posix : casse sensible", () => {
    expect(verdict(ctx("posix"), "Read", { file_path: "~/.SSH/id_rsa" }, allowAll).decision).toBe(
      "ask",
    );
    expect(verdict(ctx("posix"), "Read", { file_path: "/W/a.ts" }).decision).toBe("ask");
    expect(verdict(ctx("posix"), "Read", { file_path: "~/.ssh/id_rsa" }, allowAll).decision).toBe(
      "deny",
    );
  });

  it("posix : les formes Windows n'ont pas de sens particulier", () => {
    expect(verdict(ctx("posix"), "Read", { file_path: "a:b/CON " }).decision).toBe("allow");
    expect(verdict(ctx("posix"), "Read", { file_path: "~\\x" }).decision).toBe("allow");
  });

  it("posix : ELOOP et EACCES ne valent pas « inexistant »", () => {
    for (const code of ["ELOOP", "EACCES"]) {
      const c: PolicyContext = {
        ...ctx("posix"),
        realpath: fakeFs({ "/": "/", "/w": "/w" }, { "/w/x": code }),
      };
      const v = verdict(c, "Read", { file_path: "/w/x" }, allowAll);
      expect(v.decision).toBe("deny");
      expect(v.reason.params?.form).toBe("unresolvable");
    }
  });

  it("ENOENT remonte à l'ancêtre", () => {
    expect(verdict(ctx("posix"), "Write", { file_path: "/w/new/dir/f" }, allowAll).decision).toBe(
      "allow",
    );
  });

  it.each(["posix", "darwin", "win32"] as const)(
    "%s : .claude et .claude.json sont sensibles",
    (platform) => {
      const sep = platform === "win32" ? "\\" : "/";
      const home = platform === "win32" ? "C:\\Users\\x" : "/Users/x";
      const c: PolicyContext = {
        cwd: platform === "win32" ? "C:\\w" : "/w",
        platform,
        env: WIN_ENV,
        home,
        realpath: fakeFs({}),
      };
      for (const p of [`.claude${sep}.credentials.json`, ".claude.json", ".claude"]) {
        const v = verdict(c, "Read", { file_path: `${home}${sep}${p}` }, allowAll);
        expect(v.decision).toBe("deny");
        expect(v.reason.code).toBe("path.sensitive");
      }
    },
  );
});

describe("external_directory (cœur)", () => {
  const ctx: PolicyContext = {
    cwd: "/w",
    platform: "posix",
    env: {},
    home: "/home/x",
    realpath: fakeFs({ "/": "/", "/w": "/w" }),
  };
  const ext = (patterns: string[], policy: Policy = allowAll) =>
    verdict(ctx, "external_directory", { patterns }, policy);

  it("base fixe du motif", () => {
    expect(globBase("/opt/data/**/*.txt")).toBe("/opt/data");
    expect(extractPaths("external_directory", { patterns: ["/opt/data/*"] }, "posix")).toEqual([
      "/opt/data",
    ]);
    expect(globBase("C:\\*")).toBe("C:/");
    expect(globBase("\\\\srv\\share\\*")).toBe("//srv/share");
  });

  it("un répertoire normal donne ask, jamais allow", () => {
    expect(ext(["/opt/data/*"]).decision).toBe("ask");
    expect(ext([]).decision).toBe("ask");
    expect(ext(["/w/src/*"]).decision).toBe("ask");
  });

  it("un chemin sensible donne deny", () => {
    const v = ext(["/home/x/.ssh/*"]);
    expect(v.decision).toBe("deny");
    expect(v.reason.code).toBe("path.sensitive");
    expect(ext(["/opt/ok/*", "~/.claude/*"]).decision).toBe("deny");
  });

  it("une règle deny s'applique", () => {
    const p: Policy = { default: "ask", rules: [{ tool: "external_directory", decision: "deny" }] };
    expect(ext(["/opt/x/*"], p).decision).toBe("deny");
  });

  it("win32 : forme non analysable donne deny", () => {
    const w: PolicyContext = { ...win() };
    const v = evaluatePolicy(
      allowAll,
      "external_directory",
      { patterns: ["\\\\srv\\share\\*"] },
      w,
    );
    expect(v.decision).toBe("deny");
    expect(v.reason.code).toBe("path.unsupported");
  });

  it("le champ externalDirectories d'un autre outil est contrôlé", () => {
    const v = verdict(
      ctx,
      "Read",
      { file_path: "/w/a", externalDirectories: ["/home/x/.aws/*"] },
      allowAll,
    );
    expect(v.decision).toBe("deny");
  });
});
