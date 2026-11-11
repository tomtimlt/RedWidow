import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { policyDigest, trustPolicy } from "@warband/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { repoPolicyPath, repoPolicyState, trustRepoPolicy } from "../src/logic/repo-policy.js";

const deny = JSON.stringify({ default: "deny", rules: [] });
const allow = JSON.stringify({ default: "allow", rules: [] });

let cwd: string;
let configDir: string;

const deps = (over: Partial<Parameters<typeof trustRepoPolicy>[1]> = {}) => ({
  configDir,
  isWorkspaceTrusted: () => true,
  show: vi.fn(async () => {}),
  confirm: vi.fn(async () => true),
  ...over,
});

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "rp-cwd-"));
  configDir = await mkdtemp(join(tmpdir(), "rp-cfg-"));
  await mkdir(join(cwd, ".warband"));
});

describe("état de la politique du dépôt", () => {
  it("absente", async () => {
    expect(await repoPolicyState(cwd, configDir)).toEqual({ state: "absent" });
  });
  it("non approuvée, approuvée, modifiée depuis l'approbation", async () => {
    await writeFile(repoPolicyPath(cwd), deny);
    const digest = policyDigest(deny).slice(0, 12);
    expect(await repoPolicyState(cwd, configDir)).toEqual({ state: "untrusted", digest });
    await trustPolicy(repoPolicyPath(cwd), configDir);
    expect(await repoPolicyState(cwd, configDir)).toEqual({ state: "trusted", digest });
    await writeFile(repoPolicyPath(cwd), allow);
    expect(await repoPolicyState(cwd, configDir)).toEqual({
      state: "modified",
      digest: policyDigest(allow).slice(0, 12),
    });
  });
});

describe("approbation depuis l'extension", () => {
  it("refuse sans confiance d'espace de travail, sans rien lire ni afficher", async () => {
    await writeFile(repoPolicyPath(cwd), deny);
    const d = deps({ isWorkspaceTrusted: () => false });
    expect(await trustRepoPolicy(cwd, d)).toEqual({ status: "untrustedWorkspace" });
    expect(d.show).not.toHaveBeenCalled();
    expect(d.confirm).not.toHaveBeenCalled();
  });

  it("fichier absent : rien à approuver", async () => {
    const d = deps();
    expect(await trustRepoPolicy(cwd, d)).toEqual({ status: "absent" });
    expect(d.confirm).not.toHaveBeenCalled();
  });

  it("fichier invalide : erreur claire, pas de modale, rien d'écrit", async () => {
    await writeFile(repoPolicyPath(cwd), "{ pas du json");
    const d = deps();
    expect(await trustRepoPolicy(cwd, d)).toMatchObject({ status: "invalid" });
    expect(d.confirm).not.toHaveBeenCalled();
    await writeFile(repoPolicyPath(cwd), JSON.stringify({ default: "bof", rules: [] }));
    expect(await trustRepoPolicy(cwd, d)).toMatchObject({ status: "invalid" });
    // Non approuvée : `loadPolicy` ne l'analyse pas, l'état reste « non approuvée ».
    expect(await repoPolicyState(cwd, configDir)).toMatchObject({ state: "untrusted" });
  });

  it("annulation : rien n'est écrit", async () => {
    await writeFile(repoPolicyPath(cwd), deny);
    const d = deps({ confirm: vi.fn(async () => false) });
    expect(await trustRepoPolicy(cwd, d)).toEqual({ status: "cancelled" });
    expect(d.show).toHaveBeenCalledWith(repoPolicyPath(cwd));
    expect(await repoPolicyState(cwd, configDir)).toMatchObject({ state: "untrusted" });
  });

  it("succès : fichier montré avant la modale (chemin et empreinte), puis approuvé", async () => {
    await writeFile(repoPolicyPath(cwd), deny);
    const order: string[] = [];
    const d = deps({
      show: vi.fn(async () => void order.push("show")),
      confirm: vi.fn(async (text: string) => {
        order.push("confirm");
        expect(text).toContain(repoPolicyPath(cwd));
        expect(text).toContain(policyDigest(deny).slice(0, 12));
        return true;
      }),
    });
    expect(await trustRepoPolicy(cwd, d)).toEqual({
      status: "trusted",
      digest: policyDigest(deny).slice(0, 12),
    });
    expect(order).toEqual(["show", "confirm"]);
    expect(await repoPolicyState(cwd, configDir)).toMatchObject({ state: "trusted" });
  });

  it("fichier modifié pendant la modale : refus, magasin inchangé", async () => {
    await writeFile(repoPolicyPath(cwd), deny);
    const d = deps({
      confirm: vi.fn(async () => {
        await writeFile(repoPolicyPath(cwd), allow);
        return true;
      }),
    });
    expect(await trustRepoPolicy(cwd, d)).toEqual({ status: "changed" });
    expect(await repoPolicyState(cwd, configDir)).toMatchObject({ state: "untrusted" });
  });
});
