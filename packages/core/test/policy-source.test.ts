import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY,
  defaultConfigDir,
  loadPolicy,
  policyDigest,
  REPO_POLICY_PATH,
  trustPolicy,
} from "../src/index.js";

const allowAll = JSON.stringify({ default: "allow", rules: [] });
const denyAll = JSON.stringify({ default: "deny", rules: [] });

let cwd: string;
let configDir: string;
let repoPolicy: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "john-repo-"));
  configDir = await mkdtemp(join(tmpdir(), "john-cfg-"));
  repoPolicy = join(cwd, REPO_POLICY_PATH);
  await mkdir(join(cwd, ".john-studio"), { recursive: true });
});

describe("loadPolicy", () => {
  it("ignore la politique d'un dépôt non approuvé (allow total embarqué)", async () => {
    await writeFile(repoPolicy, allowAll);
    const loaded = await loadPolicy({ cwd, configDir });
    expect(loaded.policy).toEqual(DEFAULT_POLICY);
    expect(loaded.origin).toBe("builtin");
    expect(loaded.warning).toContain("non approuvée");
    expect(loaded.warning).toContain(policyDigest(allowAll).slice(0, 12));
  });

  it("ne parse pas un fichier de dépôt non approuvé (même invalide)", async () => {
    await writeFile(repoPolicy, "{ pas du json");
    await expect(loadPolicy({ cwd, configDir })).resolves.toMatchObject({ origin: "builtin" });
  });

  it("applique la politique du dépôt une fois approuvée", async () => {
    await writeFile(repoPolicy, denyAll);
    await trustPolicy(repoPolicy, configDir);
    const loaded = await loadPolicy({ cwd, configDir });
    expect(loaded).toMatchObject({ origin: "repository", policy: { default: "deny" } });
    expect(loaded.warning).toBeUndefined();
  });

  it("l'ignore à nouveau dès que son contenu change", async () => {
    await writeFile(repoPolicy, denyAll);
    await trustPolicy(repoPolicy, configDir);
    await writeFile(repoPolicy, allowAll);
    const loaded = await loadPolicy({ cwd, configDir });
    expect(loaded.origin).toBe("builtin");
    expect(loaded.warning).toContain("modifiée");
  });

  it("préfère la politique utilisateur quand le dépôt n'est pas approuvé", async () => {
    await writeFile(repoPolicy, allowAll);
    await writeFile(join(configDir, "policy.json"), denyAll);
    const loaded = await loadPolicy({ cwd, configDir });
    expect(loaded).toMatchObject({ origin: "user", policy: { default: "deny" } });
    expect(loaded.warning).toBeDefined();
  });

  it("lit la politique utilisateur en l'absence de fichier de dépôt", async () => {
    await writeFile(join(configDir, "policy.json"), denyAll);
    const loaded = await loadPolicy({ cwd, configDir });
    expect(loaded).toMatchObject({ origin: "user" });
    expect(loaded.warning).toBeUndefined();
  });

  it("respecte un chemin explicite, qui doit exister", async () => {
    const file = join(cwd, "mine.json");
    await writeFile(file, denyAll);
    await expect(loadPolicy({ cwd, configDir, explicit: "mine.json" })).resolves.toMatchObject({
      origin: "explicit",
      policy: { default: "deny" },
    });
    await expect(loadPolicy({ cwd, configDir, explicit: "absent.json" })).rejects.toThrow();
  });

  it("refuse d'approuver une politique invalide", async () => {
    await writeFile(repoPolicy, '{"default":"peut-être","rules":[]}');
    await expect(trustPolicy(repoPolicy, configDir)).rejects.toThrow(/politique invalide/);
  });
});

describe("defaultConfigDir", () => {
  it("suit XDG, %APPDATA% puis ~/.config", () => {
    expect(defaultConfigDir({ XDG_CONFIG_HOME: "/x" }, "linux", "/h")).toBe(
      join("/x", "john-studio"),
    );
    expect(defaultConfigDir({}, "linux", "/h")).toBe(join("/h", ".config", "john-studio"));
    expect(defaultConfigDir({ APPDATA: "/a" }, "win32", "/h")).toBe(join("/a", "john-studio"));
  });
});
