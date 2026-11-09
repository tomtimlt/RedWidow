import { mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDockerClient,
  createExegolTargets,
  createOutputCapture,
  createRecorder,
  type DockerClient,
  type DockerToolContext,
  exegolToolSpecs,
  OUTPUT_HEAD_LINES,
  OUTPUT_TAIL_LINES,
  outputFileSpecs,
  renderCommandResult,
} from "../src/index.js";
import { renderKaliResponse } from "../src/kali/output.js";

const ctx: DockerToolContext = { parentId: null, correlation: undefined, signal: undefined };

/** Faux `docker` : `exec --interactive --workdir /workspace <c> <mode> …`, comportement par mode. */
async function fakeDocker(dir: string) {
  const script = join(dir, "docker.mjs");
  await writeFile(
    script,
    `const [, , , , , , , mode, code] = process.argv;
const out = (n, p) => { let s = ""; for (let i = 1; i <= n; i++) s += p + i + "\\n"; process.stdout.write(s); };
const err = (n, p) => { let s = ""; for (let i = 1; i <= n; i++) s += p + i + "\\n"; process.stderr.write(s); };
if (mode === "short") out(3, "ligne ");
if (mode === "long") { out(1000, "out "); err(2, "warn "); }
if (mode === "noisy") { out(10, "out "); err(5000, "err "); }
if (mode === "fail") { out(5, "ok "); err(1, "boom "); }
if (mode === "failLong") { out(900, "out "); err(1, "boom "); }
process.exitCode = Number(code ?? 0);
`,
  );
  return createDockerClient({
    recorder: createRecorder(),
    binary: process.execPath,
    argsPrefix: [script],
  });
}

async function execTool(root: string | undefined, mode: string, code = "0") {
  const dir = await mkdtemp(join(tmpdir(), "warband-fake-"));
  const real = await fakeDocker(dir);
  const targets = createExegolTargets({ outputRoot: () => root });
  targets.note("go @lab", ["lab"], "11111111-1111-4111-8111-111111111111");
  const docker = {
    ...real,
    listLabelPrefix: async () => [
      { state: "running" as const, name: "lab", image: "exegol", family: "exegol" as const },
    ],
  } as DockerClient;
  const exec = exegolToolSpecs(docker, targets).find((s) => s.name === "exec");
  if (!exec) throw Error("exec absent");
  return exec.run({ container: "lab", argv: [mode, code] }, ctx);
}

const dirs = async (root: string) => readdir(root).catch(() => [] as string[]);

describe("exec : sortie complète sauvegardée", () => {
  it("sortie courte inchangée : texte seul, aucun fichier conservé", async () => {
    const root = join(await mkdtemp(join(tmpdir(), "warband-out-")), "outputs");
    expect(await execTool(root, "short")).toBe("ligne 1\nligne 2\nligne 3");
    expect(await dirs(root)).toEqual([]);
  });

  it("sortie longue : tête, queue, marqueur, fichier identique à la sortie réelle", async () => {
    const root = join(await mkdtemp(join(tmpdir(), "warband-out-")), "outputs");
    const text = await execTool(root, "long");
    const marker = new RegExp(
      `… ${1000 - OUTPUT_HEAD_LINES - OUTPUT_TAIL_LINES} lignes omises ; sortie complète : (/workspace/outputs/warband-exec-[0-9a-f]{32}/stdout\\.txt)`,
    );
    const found = marker.exec(text);
    expect(found).not.toBeNull();
    expect(text).toContain("code de sortie : 0");
    expect(text).toContain("out 1\n");
    expect(text).toContain("out 60\n… ");
    expect(text).toContain("out 1000\nstderr");
    expect(text).not.toContain("out 61\n");
    expect(text).toContain("warn 1\nwarn 2");
    expect(text).toContain("read_output");
    const [dir] = await dirs(root);
    const full = await readFile(join(root, dir ?? "", "stdout.txt"), "utf8");
    expect(full).toBe(Array.from({ length: 1000 }, (_, i) => `out ${i + 1}\n`).join(""));
    // stderr court : pas de fichier superflu.
    expect(await dirs(join(root, dir ?? ""))).toEqual(["stdout.txt"]);
  });

  it("stderr volumineux ne chasse pas stdout", async () => {
    const root = join(await mkdtemp(join(tmpdir(), "warband-out-")), "outputs");
    const text = await execTool(root, "noisy");
    for (let i = 1; i <= 10; i++) expect(text).toContain(`out ${i}\n`);
    expect(text).toContain("stderr (");
    expect(text).toMatch(/lignes omises ; sortie complète : \/workspace\/outputs\/.*stderr\.txt/);
  });

  it("code ≠ 0 : stdout conservé avec stderr, code et tailles", async () => {
    const root = join(await mkdtemp(join(tmpdir(), "warband-out-")), "outputs");
    const text = await execTool(root, "fail", "3");
    expect(text).toContain("code de sortie : 3");
    expect(text).toContain("stdout (");
    expect(text).toContain("ok 1\nok 2\nok 3\nok 4\nok 5");
    expect(text).toContain("boom 1");
    expect(await dirs(root)).toEqual([]);
  });

  it("code ≠ 0 avec stdout long : l'extrait de stdout reste présent", async () => {
    const root = join(await mkdtemp(join(tmpdir(), "warband-out-")), "outputs");
    const text = await execTool(root, "failLong", "1");
    expect(text).toContain("code de sortie : 1");
    expect(text).toContain("out 900\n");
    expect(text).toContain("sortie complète");
  });

  it("sans dossier de projet : extrait et mention explicite de non-sauvegarde", async () => {
    const text = await execTool(undefined, "long");
    expect(text).toContain("sortie non sauvegardée");
    expect(text).toContain("out 1000");
  });
});

describe("capture : plafond et sécurité", () => {
  it("plafond de sécurité : fichier limité, extrait indiqué", async () => {
    const root = join(await mkdtemp(join(tmpdir(), "warband-out-")), "outputs");
    const capture = createOutputCapture(root, { maxBytes: 100 });
    for (let i = 0; i < 50; i++) capture.write("stdout", `ligne numéro ${i}\n`);
    const out = capture.finish();
    expect(out.stdout.capped).toBe(true);
    const [dir] = await dirs(root);
    expect((await readFile(join(root, dir ?? "", "stdout.txt"))).length).toBe(100);
    expect(renderCommandResult({ code: 0 }, out)).toContain("32 Mio");
  });

  it("dossier outputs lien symbolique : rien n'est écrit, extrait seulement", async () => {
    const base = await mkdtemp(join(tmpdir(), "warband-out-"));
    const target = join(base, "ailleurs");
    await mkdir(target);
    await symlink(target, join(base, "outputs"));
    const capture = createOutputCapture(join(base, "outputs"));
    for (let i = 0; i < 300; i++) capture.write("stdout", `l${i}\n`);
    expect(capture.finish().stdout.unsaved).toBe(true);
    expect(await dirs(target)).toEqual([]);
  });
});

describe("outils Kali : réponse JSON", () => {
  const big = (stdout: string, extra: object = {}) =>
    JSON.stringify({ stdout, stderr: "", return_code: 0, success: true, ...extra });

  it("réponse courte renvoyée telle quelle", () => {
    const raw = big("ok\n");
    expect(renderKaliResponse(raw, undefined)).toBe(raw);
  });

  it("réponse longue : JSON valide, extrait, marqueur et corps complet sauvegardé", async () => {
    const root = join(await mkdtemp(join(tmpdir(), "warband-out-")), "outputs");
    const stdout = Array.from({ length: 5000 }, (_, i) => `hit ${i + 1}`).join("\n");
    const rendered = renderKaliResponse(big(stdout), root);
    const parsed = JSON.parse(rendered) as Record<string, unknown>;
    expect(parsed.return_code).toBe(0);
    expect(String(parsed.stdout)).toContain("hit 1\n");
    expect(String(parsed.stdout)).toContain("hit 5000");
    expect(String(parsed.stdout)).toContain("lignes omises ; sortie complète");
    expect(parsed.stdout_lines).toBe(5000);
    const [dir] = await dirs(root);
    expect(await readFile(join(root, dir ?? "", "stdout.txt"), "utf8")).toBe(stdout);
  });

  it("JSON coupé : texte explicite, corps sauvegardé", async () => {
    const root = join(await mkdtemp(join(tmpdir(), "warband-out-")), "outputs");
    const raw = `{"stdout":"${"x".repeat(40_000)}`;
    const rendered = renderKaliResponse(raw, root);
    expect(rendered).toContain("JSON invalide ou coupé");
    expect(rendered).toContain("corps complet : /workspace/outputs/warband-exec-");
    const [dir] = await dirs(root);
    expect(await readFile(join(root, dir ?? "", "stdout.txt"), "utf8")).toBe(raw);
  });
});

describe("read_output", () => {
  async function setup() {
    const root = join(await mkdtemp(join(tmpdir(), "warband-out-")), "outputs");
    await mkdir(join(root, "warband-exec-a"), { recursive: true });
    const lines = Array.from(
      { length: 1000 },
      (_, i) => `ligne ${i + 1}${i === 499 ? " SECRET" : ""}`,
    );
    await writeFile(join(root, "warband-exec-a", "stdout.txt"), `${lines.join("\n")}\n`);
    const tool = outputFileSpecs(() => root)[0];
    if (!tool) throw Error("read_output absent");
    const call = async (args: object) =>
      JSON.parse(await tool.run(args, ctx)) as Record<string, unknown>;
    return { root, tool, call };
  }

  it("est en lecture seule", async () => {
    expect((await setup()).tool.readOnly).toBe(true);
  });

  it("tranche d'octets avec nextOffset", async () => {
    const { call } = await setup();
    const r = await call({ path: "warband-exec-a/stdout.txt", offset: 0, length: 20 });
    expect(r.text).toBe("ligne 1\nligne 2\nlign");
    expect(r.nextOffset).toBe(20);
    expect(typeof r.totalBytes).toBe("number");
  });

  it("accepte le chemin /workspace/outputs/… cité au modèle", async () => {
    const { call } = await setup();
    const r = await call({
      path: "/workspace/outputs/warband-exec-a/stdout.txt",
      startLine: 500,
      lineCount: 2,
    });
    expect(r.lines).toBe("ligne 500 SECRET\nligne 501");
    expect(r.nextLine).toBe(502);
  });

  it("plafonne la longueur et les lignes", async () => {
    const { tool } = await setup();
    await expect(
      tool.run({ path: "warband-exec-a/stdout.txt", length: 40_000 }, ctx),
    ).rejects.toThrow();
    await expect(
      tool.run({ path: "warband-exec-a/stdout.txt", startLine: 1, lineCount: 401 }, ctx),
    ).rejects.toThrow();
    await expect(
      tool.run({ path: "warband-exec-a/stdout.txt", pattern: "x", maxMatches: 51 }, ctx),
    ).rejects.toThrow();
  });

  it("recherche avec contexte et plafond de correspondances", async () => {
    const { call } = await setup();
    const r = (await call({
      path: "warband-exec-a/stdout.txt",
      pattern: "SECRET",
      context: 1,
    })) as { matches: { line: number; before: string[]; after: string[] }[] };
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]).toMatchObject({ line: 500, before: ["ligne 499"], after: ["ligne 501"] });
    const many = (await call({
      path: "warband-exec-a/stdout.txt",
      pattern: "ligne",
      maxMatches: 3,
      context: 0,
    })) as { matches: unknown[]; truncated: boolean };
    expect(many.matches).toHaveLength(3);
    expect(many.truncated).toBe(true);
    const re = (await call({
      path: "warband-exec-a/stdout.txt",
      pattern: "^ligne 99\\d$",
      regex: true,
      context: 0,
    })) as { matchCount: number };
    expect(re.matchCount).toBe(10);
  });

  it("refuse les motifs dangereux ou invalides", async () => {
    const { tool } = await setup();
    await expect(
      tool.run({ path: "warband-exec-a/stdout.txt", pattern: "(a+)+$", regex: true }, ctx),
    ).rejects.toMatchObject({ code: "output.patternInvalid" });
    await expect(
      tool.run({ path: "warband-exec-a/stdout.txt", pattern: "(", regex: true }, ctx),
    ).rejects.toMatchObject({ code: "output.patternInvalid" });
  });

  it("refuse .., chemins absolus, fichiers hors dossier et liens sortants", async () => {
    const { root, tool } = await setup();
    await writeFile(join(root, "..", "secret.txt"), "hors sortie");
    await symlink(join(root, "..", "secret.txt"), join(root, "lien.txt"));
    await symlink(join(root, ".."), join(root, "dossier-lien"));
    for (const path of [
      "../secret.txt",
      "warband-exec-a/../../secret.txt",
      "/etc/passwd",
      "/workspace/outputs/../secret.txt",
      "C:\\Windows\\win.ini",
      "lien.txt",
      "dossier-lien/secret.txt",
    ]) {
      await expect(tool.run({ path }, ctx), path).rejects.toMatchObject({
        code: expect.stringMatching(/^output\.(invalidPath|notFound)$/),
      });
    }
    await expect(tool.run({ path: "warband-exec-a" }, ctx)).rejects.toMatchObject({
      code: "output.notFound",
    });
  });

  it("sans projet : introuvable", async () => {
    const tool = outputFileSpecs(() => undefined)[0];
    await expect(tool?.run({ path: "x" }, ctx)).rejects.toMatchObject({ code: "output.notFound" });
  });
});

it("refuse les traversées dans les noms internes de capture", () => {
  expect(() => createOutputCapture(undefined, { prefix: "../escape-" })).toThrow(RangeError);
  expect(() =>
    createOutputCapture(undefined, { files: { stdout: "../../escape.txt", stderr: "stderr.txt" } }),
  ).toThrow(RangeError);
});
