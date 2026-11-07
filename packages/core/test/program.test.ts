import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  approveProgram,
  canonicalProgram,
  createMissionDesk,
  createRecorder,
  DEFAULT_POLICY,
  evaluatePolicy,
  importProgramDraft,
  isValidScopePattern,
  type Policy,
  type ProgramSheet,
  parseProgramSheet,
  programDigest,
  projectProgramApprovalPath,
  projectProgramPath,
  readProgram,
  readProgramSync,
  suspendProgram,
} from "../src/index.js";

const ID = "11111111-1111-4111-8111-111111111111";
const allowAll: Policy = { default: "allow", rules: [{ tool: "*", decision: "allow" }] };

const cited = <T>(value: T, verified = true) => ({
  value,
  quote: "Scope: *.example.com",
  url: "https://example.com/program",
  retrievedAt: "2026-11-07T10:00:00Z",
  verified,
});

const sheet = (over: Record<string, unknown> = {}) => ({
  version: 1,
  inScope: cited(["*.example.com", "10.0.0.0/24"]),
  outOfScope: cited(["admin.example.com"]),
  userAgentSuffix: cited("bb-alice"),
  pace: cited({ preset: "careful" }),
  ...over,
});

const dir = () => mkdtemp(join(tmpdir(), "warband-program-"));
const T = (iso: string) => () => new Date(iso);

describe("validation de la fiche", () => {
  it("accepte une fiche valide et normalise les motifs", () => {
    const parsed = parseProgramSheet(sheet({ inScope: cited([" API.Example.com "]) }));
    expect(parsed.inScope.value).toEqual(["api.example.com"]);
  });

  it.each([
    "example.com",
    "*.example.com",
    "localhost",
    "192.168.1.1",
    "::1",
    "10.0.0.0/8",
    "2001:db8::/32",
  ])("motif valide : %s", (p) => expect(isValidScopePattern(p)).toBe(true));

  it.each([
    "",
    "*",
    "*.com",
    "a.*.example.com",
    "http://example.com",
    "example.com/path",
    "10.0.0.0/33",
    "::1/129",
    "10.0.0.0/",
    "-bad.example.com",
    "exa mple.com",
    "300.1.1.1/8",
  ])("motif refusé : %s", (p) => expect(isValidScopePattern(p)).toBe(false));

  it.each([
    ["clé inconnue", sheet({ extra: 1 })],
    ["version", sheet({ version: 2 })],
    ["url non http", sheet({ inScope: { ...cited(["a.com"]), url: "javascript:alert(1)" } })],
    ["date invalide", sheet({ pace: { ...cited({ preset: "fast" }), retrievedAt: "hier" } })],
    ["rythme inconnu", sheet({ pace: cited({ preset: "turbo" }) })],
    ["rythme nul", sheet({ pace: cited({ maxRequestsPerSecond: 0 }) })],
    ["suffixe avec CRLF", sheet({ userAgentSuffix: cited("a\r\nX-Evil: 1") })],
    ["champ non cité", sheet({ inScope: ["a.com"] })],
    ["verified non booléen", sheet({ inScope: { ...cited(["a.com"]), verified: "yes" } })],
  ])("fiche refusée : %s", (_name, raw) => {
    expect(() => parseProgramSheet(raw)).toThrowError(/program\.invalid/);
  });

  it("le suffixe est facultatif, le rythme explicite est accepté", () => {
    const { userAgentSuffix: _omit, ...rest } = sheet({
      pace: cited({ maxRequestsPerSecond: 2.5 }),
    });
    expect(parseProgramSheet(rest).pace.value).toEqual({ maxRequestsPerSecond: 2.5 });
  });
});

describe("forme canonique et empreinte", () => {
  it("indifférente à l'ordre des listes, des clés et à la casse des motifs", () => {
    const a = parseProgramSheet(sheet({ inScope: cited(["b.example.com", "A.example.com"]) }));
    const b = parseProgramSheet({
      pace: cited({ preset: "careful" }),
      userAgentSuffix: cited("bb-alice"),
      outOfScope: cited(["admin.example.com"]),
      inScope: cited(["a.example.com", "b.example.com", "b.example.com"]),
      version: 1,
    });
    expect(canonicalProgram(a)).toBe(canonicalProgram(b));
    expect(programDigest(a)).toBe(programDigest(b));
    expect(programDigest(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("change avec tout contenu (périmètre, citation, verified, rythme)", () => {
    const base = programDigest(parseProgramSheet(sheet()));
    const variants = [
      sheet({ inScope: cited(["*.example.com"]) }),
      sheet({ inScope: cited(["*.example.com", "10.0.0.0/24"], false) }),
      sheet({ inScope: { ...cited(["*.example.com", "10.0.0.0/24"]), quote: "autre" } }),
      sheet({ pace: cited({ preset: "fast" }) }),
      sheet({ userAgentSuffix: cited("bb-bob") }),
    ];
    for (const v of variants) expect(programDigest(parseProgramSheet(v))).not.toBe(base);
  });
});

describe("stockage", () => {
  it("id non UUID refusé sans aucune E/S", async () => {
    const d = await dir();
    for (const bad of ["../x", "x", "11111111-1111-1111-1111-111111111111", ""]) {
      expect(() => projectProgramPath(d, bad)).toThrowError(/project\.invalid/);
      await expect(readProgram(d, bad)).rejects.toMatchObject({ code: "project.invalid" });
      await expect(importProgramDraft(d, bad, JSON.stringify(sheet()))).rejects.toMatchObject({
        code: "project.invalid",
      });
      await expect(approveProgram(d, bad)).rejects.toMatchObject({ code: "project.invalid" });
      await expect(suspendProgram(d, bad)).rejects.toMatchObject({ code: "project.invalid" });
    }
    expect(readdirSync(d)).toEqual([]);
  });

  it("aucune fiche : état none", async () => {
    expect((await readProgram(await dir(), ID)).state).toBe("none");
  });

  it("importer ne valide pas : état draft, rien d'appliqué, mode 0o600", async () => {
    const d = await dir();
    const status = await importProgramDraft(d, ID, JSON.stringify(sheet()));
    expect(status.state).toBe("draft");
    expect(status.applied).toBeUndefined();
    expect(status.digest).toBeDefined();
    await expect(readFile(projectProgramApprovalPath(d, ID))).rejects.toMatchObject({
      code: "ENOENT",
    });
    if (process.platform !== "win32")
      expect((await stat(projectProgramPath(d, ID))).mode & 0o777).toBe(0o600);
  });

  it("brouillon invalide refusé, rien d'écrit", async () => {
    const d = await dir();
    await expect(importProgramDraft(d, ID, "pas du json")).rejects.toMatchObject({
      code: "program.invalid",
    });
    await expect(
      importProgramDraft(d, ID, JSON.stringify(sheet({ version: 3 }))),
    ).rejects.toMatchObject({
      code: "program.invalid",
    });
    expect((await readProgram(d, ID)).state).toBe("none");
  });

  it("approuver sans brouillon → program.absent", async () => {
    await expect(approveProgram(await dir(), ID)).rejects.toMatchObject({ code: "program.absent" });
  });

  it("approuver applique la fiche, avec empreinte et date, en 0o600", async () => {
    const d = await dir();
    await importProgramDraft(d, ID, JSON.stringify(sheet()));
    const status = await approveProgram(d, ID, T("2026-11-07T12:00:00Z"));
    expect(status.state).toBe("approved");
    expect(status.applied?.inScope.value).toContain("*.example.com");
    expect(status.approvedAt).toBe("2026-11-07T12:00:00.000Z");
    expect(status.approvedDigest).toBe(status.digest);
    if (process.platform !== "win32")
      expect((await stat(projectProgramApprovalPath(d, ID))).mode & 0o777).toBe(0o600);
  });

  it("brouillon modifié après approbation → invalidated, non appliqué", async () => {
    const d = await dir();
    await importProgramDraft(d, ID, JSON.stringify(sheet()));
    await approveProgram(d, ID);
    // Modification directe du fichier (ce qu'un agent ne devrait pouvoir faire) puis par import.
    const widened = sheet({ inScope: cited(["*.example.com", "*.evil.com"]) });
    await writeFile(projectProgramPath(d, ID), JSON.stringify(widened));
    const direct = await readProgram(d, ID);
    expect(direct.state).toBe("invalidated");
    expect(direct.applied).toBeUndefined();
    expect(direct.digest).not.toBe(direct.approvedDigest);

    await importProgramDraft(d, ID, JSON.stringify(sheet()));
    expect((await readProgram(d, ID)).state).toBe("approved");
    const again = await importProgramDraft(d, ID, JSON.stringify(widened));
    expect(again.state).toBe("invalidated");
    expect(again.applied).toBeUndefined();
  });

  it("une réécriture de même sens (ordre, casse) reste approuvée", async () => {
    const d = await dir();
    await importProgramDraft(d, ID, JSON.stringify(sheet()));
    await approveProgram(d, ID);
    const reordered = sheet({ inScope: cited(["10.0.0.0/24", "*.EXAMPLE.com"]) });
    await writeFile(projectProgramPath(d, ID), JSON.stringify(reordered));
    expect((await readProgram(d, ID)).state).toBe("approved");
  });

  it("suspendre conserve la fiche et l'empreinte ; réapprouver lève la suspension", async () => {
    const d = await dir();
    await expect(suspendProgram(d, ID)).rejects.toMatchObject({ code: "program.absent" });
    await importProgramDraft(d, ID, JSON.stringify(sheet()));
    await approveProgram(d, ID);
    const s = await suspendProgram(d, ID, T("2026-11-07T13:00:00Z"));
    expect(s.state).toBe("suspended");
    expect(s.applied).toBeUndefined();
    expect(s.draft).toBeDefined();
    expect(s.suspendedAt).toBe("2026-11-07T13:00:00.000Z");
    expect((await approveProgram(d, ID)).state).toBe("approved");
  });

  it("approbation illisible ou brouillon disparu → unreadable, non appliqué", async () => {
    const d = await dir();
    await importProgramDraft(d, ID, JSON.stringify(sheet()));
    await approveProgram(d, ID);
    await writeFile(projectProgramPath(d, ID), "{ cassé");
    const broken = await readProgram(d, ID);
    expect(broken.state).toBe("unreadable");
    expect(broken.applied).toBeUndefined();
    expect(broken.problem?.code).toBe("program.unreadable");

    await importProgramDraft(d, ID, JSON.stringify(sheet()));
    await writeFile(projectProgramApprovalPath(d, ID), JSON.stringify({ version: 1, digest: "x" }));
    const bad = await readProgram(d, ID);
    expect(bad.state).toBe("unreadable");
    expect(bad.applied).toBeUndefined();
    expect(readProgramSync(d, ID).state).toBe("unreadable");
  });
});

describe("chemins sensibles", () => {
  const custom = "/srv/wb-config";
  const files = [
    `${custom}/projects/${ID}/program.json`,
    `${custom}/projects/${ID}/program.approval.json`,
    `${custom}/projects/${ID}/program.json.123.tmp`,
  ];
  const ctx = { cwd: "/work", home: "/home/u", platform: "posix" as const, env: {} };

  it.each(files)("Write, Edit et Read refusés : %s", (file_path) => {
    for (const tool of ["Write", "Edit", "Read"]) {
      const v = evaluatePolicy(allowAll, tool, { file_path }, ctx);
      expect(v).toMatchObject({ decision: "deny", reason: { code: "path.sensitive" } });
    }
  });

  it.each(files)("Bash refusé : %s", (file) => {
    for (const command of [`cat ${file}`, `echo '{}' > ${file}`, `sed -i s/a/b/ ${file}`]) {
      const v = evaluatePolicy(allowAll, "Bash", { command }, ctx);
      expect(v.decision).toBe("deny");
    }
  });

  it("shells du conteneur (execute_command, exec) refusés aussi", () => {
    const command = `cat ${files[1]}`;
    for (const tool of ["mcp__kali__execute_command", "mcp__exegol__exec"]) {
      expect(evaluatePolicy(allowAll, tool, { command }, ctx).decision).toBe("deny");
    }
    expect(
      evaluatePolicy(allowAll, "mcp__kali__task_start", { argv: ["cat", files[0]] }, ctx).decision,
    ).toBe("deny");
  });

  it("variante Windows", () => {
    const v = evaluatePolicy(
      allowAll,
      "Write",
      { file_path: `D:\\cfg\\projects\\${ID}\\program.approval.json` },
      {
        cwd: "D:\\w",
        platform: "win32",
        home: "C:\\Users\\x",
        env: { USERPROFILE: "C:\\Users\\x" },
      },
    );
    expect(v.decision).toBe("deny");
  });

  it("les autres fichiers du projet restent régis par la règle générale", () => {
    const v = evaluatePolicy(
      DEFAULT_POLICY,
      "Read",
      { file_path: `${custom}/projects/${ID}/notes.json` },
      ctx,
    );
    expect(v.reason.code).not.toBe("path.sensitive");
  });
});

describe("mission_context", () => {
  const desk = (configDir: string) => {
    const recorder = createRecorder({ runId: "run", redact: false });
    return createMissionDesk({ recorder, program: () => readProgramSync(configDir, ID) });
  };

  it("sans fiche ou brouillon seul : program null", async () => {
    const d = await dir();
    expect(desk(d).context().program).toBeNull();
    await importProgramDraft(d, ID, JSON.stringify(sheet()));
    expect(desk(d).context().program).toBeNull();
  });

  it("fiche validée : injectée dans un bloc marqué non fiable", async () => {
    const d = await dir();
    await importProgramDraft(d, ID, JSON.stringify(sheet()));
    await approveProgram(d, ID);
    const { program } = desk(d).context();
    expect(program?.untrusted).toBe(true);
    expect(program?.notice).toMatch(/non fiables/);
    expect(program?.sheet.inScope.value).toContain("*.example.com");
  });

  it("invalidée, suspendue ou illisible : plus injectée", async () => {
    const d = await dir();
    await importProgramDraft(d, ID, JSON.stringify(sheet()));
    await approveProgram(d, ID);
    await suspendProgram(d, ID);
    expect(desk(d).context().program).toBeNull();
    await approveProgram(d, ID);
    await importProgramDraft(d, ID, JSON.stringify(sheet({ pace: cited({ preset: "fast" }) })));
    expect(desk(d).context().program).toBeNull();
    await writeFile(projectProgramPath(d, ID), "cassé");
    expect(desk(d).context().program).toBeNull();
  });

  it("un fournisseur qui lève n'injecte rien", () => {
    const recorder = createRecorder({ runId: "run", redact: false });
    const throwing = createMissionDesk({
      recorder,
      program: () => {
        throw new Error("boum");
      },
    });
    expect(throwing.context().program).toBeNull();
  });
});

describe("aucun outil d'agent n'approuve", () => {
  it("approveProgram/suspendProgram/importProgramDraft ne sont référencés que par le module et la CLI", () => {
    const root = join(__dirname, "..", "..");
    const hits: string[] = [];
    const walk = (dirPath: string) => {
      for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "test")
          continue;
        const full = join(dirPath, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          /\.(ts|js|mjs)$/.test(entry.name) &&
          !full.includes(`${join("vscode", "media")}`)
        ) {
          if (
            /\b(approveProgram|suspendProgram|importProgramDraft)\b/.test(
              readFileSync(full, "utf8"),
            )
          )
            hits.push(relative(root, full).split("\\").join("/"));
        }
      }
    };
    for (const pkg of readdirSync(root)) walk(join(root, pkg, "src"));
    expect(hits.sort()).toEqual(["cli/src/main.ts", "core/src/program/store.ts"]);
  });
});

// Typage : la fiche validée est bien un ProgramSheet.
const _typed: ProgramSheet = parseProgramSheet(sheet());
void _typed;
