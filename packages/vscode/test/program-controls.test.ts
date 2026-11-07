import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  importProgramDraft,
  projectPaceHaltedPath,
  projectProgramApprovalPath,
  readProgram,
} from "@warband/core";
import { describe, expect, it } from "vitest";
import { buildProgramView, createProgramControls } from "../src/logic/program-controls.js";

const ID = "11111111-1111-4111-8111-111111111111";

const cited = <T>(value: T, verified = true) => ({
  value,
  quote: "Scope: *.example.com",
  url: "https://example.com/program",
  retrievedAt: "2026-11-07T10:00:00Z",
  verified,
});

const sheet = (over: Record<string, unknown> = {}) => ({
  version: 1,
  inScope: cited(["*.example.com"]),
  outOfScope: cited(["admin.example.com"], false),
  userAgentSuffix: cited("bb-alice"),
  pace: cited({ preset: "careful" }),
  ...over,
});

const setup = async () => {
  const dir = await mkdtemp(join(tmpdir(), "warband-pctl-"));
  return { dir, controls: createProgramControls(dir, ID) };
};

describe("contrôles de la fiche programme : vue", () => {
  it("none : aucune donnée, aucun geste possible", async () => {
    const { controls } = await setup();
    const v = await controls.view();
    expect(v).toMatchObject({
      state: "none",
      inScope: null,
      pace: null,
      canValidate: false,
      canSuspend: false,
      haltedHosts: [],
    });
    expect(v.digest).toBeUndefined();
  });

  it("draft : périmètre, hors périmètre, suffixe, rythme, citations et empreinte", async () => {
    const { dir, controls } = await setup();
    await importProgramDraft(dir, ID, JSON.stringify(sheet()));
    const v = await controls.view();
    expect(v.state).toBe("draft");
    expect(v.inScope?.values).toEqual(["*.example.com"]);
    expect(v.inScope?.citation).toEqual({
      quote: "Scope: *.example.com",
      url: "https://example.com/program",
      retrievedAt: "2026-11-07T10:00:00Z",
      verified: true,
    });
    expect(v.outOfScope?.citation.verified).toBe(false);
    expect(v.userAgentSuffix?.value).toBe("bb-alice");
    expect(v.pace?.value).toEqual({ preset: "careful" });
    expect(v.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(v.canValidate).toBe(true);
    expect(v.canSuspend).toBe(false);
  });

  it("approved, suspended, invalidated : états et gestes", async () => {
    const { dir, controls } = await setup();
    await importProgramDraft(dir, ID, JSON.stringify(sheet()));
    const digest = (await controls.view()).digest as string;
    const approved = await controls.validate(digest);
    expect(approved).toMatchObject({ state: "approved", canValidate: false, canSuspend: true });
    expect(approved.approvedAt).toBeDefined();
    const suspended = await controls.suspend();
    expect(suspended).toMatchObject({ state: "suspended", canValidate: true, canSuspend: false });
    expect(suspended.suspendedAt).toBeDefined();
    await controls.validate(digest);
    await importProgramDraft(
      dir,
      ID,
      JSON.stringify(sheet({ inScope: cited(["*.autre.example.com"]) })),
    );
    const inv = await controls.view();
    expect(inv).toMatchObject({ state: "invalidated", canValidate: true, canSuspend: false });
  });

  it("unreadable : approbation illisible, rien à valider ni suspendre", async () => {
    const { dir, controls } = await setup();
    await importProgramDraft(dir, ID, JSON.stringify(sheet()));
    await controls.validate((await controls.view()).digest as string);
    writeFileSync(projectProgramApprovalPath(dir, ID), "{pas du json");
    const v = await controls.view();
    expect(v.state).toBe("unreadable");
    expect(v.canSuspend).toBe(false);
  });

  it("rythme explicite et suffixe absent", () => {
    const v = buildProgramView(
      {
        state: "draft",
        digest: "a".repeat(64),
        draft: {
          version: 1,
          inScope: cited(["a.example.com"]),
          outOfScope: cited([]),
          pace: cited({ maxRequestsPerSecond: 3 }),
        },
      },
      ["h.example.com"],
    );
    expect(v.userAgentSuffix).toBeNull();
    expect(v.pace?.value).toEqual({ maxRequestsPerSecond: 3 });
    expect(v.haltedHosts).toEqual(["h.example.com"]);
  });
});

describe("contrôles de la fiche programme : gestes", () => {
  it("validation avec empreinte périmée : rejet, rien n'est écrit", async () => {
    const { dir, controls } = await setup();
    await importProgramDraft(dir, ID, JSON.stringify(sheet()));
    const stale = (await controls.view()).digest as string;
    await importProgramDraft(
      dir,
      ID,
      JSON.stringify(sheet({ inScope: cited(["*.evil.example.com"]) })),
    );
    await expect(controls.validate(stale)).rejects.toMatchObject({
      code: "program.digestMismatch",
    });
    expect((await readProgram(dir, ID)).state).toBe("draft");
    await expect(controls.validate("")).rejects.toMatchObject({ code: "program.digestRequired" });
  });

  it("suspend sans approbation : rejet", async () => {
    const { controls } = await setup();
    await expect(controls.suspend()).rejects.toMatchObject({ code: "program.absent" });
  });

  it("resume retire l'hôte arrêté ; un hôte inconnu n'est pas repris", async () => {
    const { dir, controls } = await setup();
    const path = projectPaceHaltedPath(dir, ID);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(["a.example.com", "b.example.com"]));
    expect((await controls.view()).haltedHosts).toEqual(["a.example.com", "b.example.com"]);
    const r = await controls.resume("A.example.com");
    expect(r.resumed).toBe(true);
    expect(r.view.haltedHosts).toEqual(["b.example.com"]);
    expect((await controls.resume("zzz.example.com")).resumed).toBe(false);
  });
});

describe("contrôles de la fiche programme : import", () => {
  it("importer un fichier valide crée un brouillon sans rien approuver", async () => {
    const { controls } = await setup();
    const v = await controls.importDraft(JSON.stringify(sheet()));
    expect(v.state).toBe("draft");
    expect(v.canValidate).toBe(true);
    expect(v.approvedAt).toBeUndefined();
  });

  it("importer un contenu différent invalide l'approbation existante, jamais l'inverse", async () => {
    const { controls } = await setup();
    const first = await controls.importDraft(JSON.stringify(sheet()));
    expect((await controls.validate(first.digest ?? "")).state).toBe("approved");
    const changed = await controls.importDraft(
      JSON.stringify(sheet({ inScope: cited(["*.autre.example.com"]) })),
    );
    expect(changed.state).toBe("invalidated");
    expect(changed.canSuspend).toBe(false);
  });

  it("un fichier invalide est refusé et n'écrit rien", async () => {
    const { controls } = await setup();
    await expect(controls.importDraft("pas du json")).rejects.toMatchObject({
      code: "program.invalid",
    });
    expect((await controls.view()).state).toBe("none");
  });
});

describe("frontière : engine/ n'atteint jamais les contrôles de la fiche", () => {
  it("aucun fichier de src/engine n'importe program-controls", () => {
    const engine = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "engine");
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".ts") ? [join(d, e.name)] : [],
      );
    const fautifs = walk(engine).filter((f) => /program-controls/.test(readFileSync(f, "utf8")));
    expect(fautifs).toEqual([]);
  });
});
