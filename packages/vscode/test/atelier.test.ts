import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_PROFILES,
  DEFAULT_POLICY,
  deskInstructions,
  deskToolSpecs,
  evaluatePolicy,
  integrationToolSpecs,
  isRememberable,
  MCP_CATALOG,
  parseIntegrations,
} from "@warband/core";
import { afterEach, expect, it } from "vitest";
import { projectFileSpecs } from "../src/engine/project-files.js";
import { prepareMissionFolder } from "../src/logic/mission-folder.js";
import { projectIntegrations } from "../src/logic/project-integrations.js";
import { parseToEngine } from "../src/logic/protocol.js";
import { resolveSettings } from "../src/logic/settings.js";

const config = { id: "playwright", port: 9877, transport: "http", path: "/mcp" } as const;
const dirs: string[] = [];
const temp = async () => {
  const path = await mkdtemp(join(tmpdir(), "warband-desk-"));
  dirs.push(path);
  return path;
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
it("catalogue borné, sans commandes ni destination externe", () => {
  expect(MCP_CATALOG.length).toBeGreaterThan(5);
  expect(parseIntegrations([config])).toEqual([config]);
  for (const patch of [
    { id: "evil" },
    { port: 0 },
    { port: 65536 },
    { path: "http://evil" },
    { path: "//evil" },
    { path: "/../secret" },
    { command: "sh" },
    { transport: "stdio" },
  ])
    expect(parseIntegrations([{ ...config, ...patch }])).toBeNull();
  expect(parseIntegrations([config, config])).toBeNull();
  expect(parseIntegrations(Array(5).fill(config))).toBeNull();
  expect(
    resolveSettings((k) => (k === "integrations" ? [config] : undefined)).integrations,
  ).toEqual([config]);
  expect(
    parseToEngine({ v: 1, type: "start", cwd: "/tmp", integrations: [config], mode: "learning" })
      .ok,
  ).toBe(false);
});
it("les appels des services ne sont pas mémorisables ni autorisés par une règle globale", () => {
  for (const entry of MCP_CATALOG) {
    const request = {
      toolUseId: "t",
      tool: `mcp__${entry.id}__call_tool`,
      input: { name: "action", arguments: {} },
    };
    const verdict = evaluatePolicy(
      { ...DEFAULT_POLICY, default: "allow", rules: [{ tool: "*", decision: "allow" }] },
      request.tool,
      request.input,
    );
    expect(verdict.decision).toBe("ask");
    expect(isRememberable(request, verdict)).toBe(false);
  }
});
it("les outils sont découverts et leurs sorties bornées", async () => {
  let calls = 0;
  const backend = {
    list: async () => ({ tools: [{ name: "test" }] }),
    call: async () => {
      calls++;
      return { content: [{ type: "text", text: "a".repeat(100000) }] };
    },
  };
  const specs = integrationToolSpecs(config, backend);
  const ctx = { parentId: null, correlation: undefined, signal: undefined };
  expect(JSON.parse(await specs[0]!.run({}, ctx)).tools[0].name).toBe("test");
  expect(calls).toBe(0);
  const out = JSON.parse(await specs[1]!.run({ name: "test", arguments: {} }, ctx));
  expect(out.truncated).toBe(true);
  expect(out.text.length).toBeLessThanOrEqual(32768);
});
it("les profils ne chargent pas toutes les sources dans le prompt initial", async () => {
  expect(Object.keys(AGENT_PROFILES)).toHaveLength(5);
  const start = deskInstructions("htb");
  expect(start.length).toBeLessThan(2500);
  expect(start).not.toContain("Systematic Debugging");
  const skill = deskToolSpecs()[0];
  if (!skill) throw new Error("load_skill absent");
  const source = JSON.parse(
    await skill.run(
      { profile: "out-of-box" },
      { parentId: null, correlation: undefined, signal: undefined },
    ),
  );
  expect(source.upstream.source).toMatch(/github.com.*[a-f0-9]{40}/);
  expect(source.upstream.license).toBe("MIT");
  expect(source.upstream.text).toBe("");
  expect(source.upstream.loaded).toBe(false);
  const upstream = JSON.parse(
    await skill.run(
      { profile: "out-of-box", source: "upstream" },
      { parentId: null, correlation: undefined, signal: undefined },
    ),
  );
  expect(upstream.upstream.text).toContain("Systematic Debugging");
});
it("prépare les répertoires sans écraser les notes et lit les gros fichiers par extraits", async () => {
  const root = await temp();
  await prepareMissionFolder(root);
  await writeFile(join(root, "notes", "preuve.txt"), "A".repeat(200000));
  await prepareMissionFolder(root);
  const specs = projectFileSpecs(root);
  const ctx = { parentId: null, correlation: undefined, signal: undefined };
  const page = JSON.parse(
    await specs[1]!.run({ path: "notes/preuve.txt", offset: 32768, length: 100 }, ctx),
  );
  expect(page.text).toBe("A".repeat(100));
  expect(page.nextOffset).toBe(32868);
  expect((await readFile(join(root, "notes", "preuve.txt"))).length).toBe(200000);
  await expect(specs[1]!.run({ path: "../secret" }, ctx)).rejects.toThrow();
  const outside = await temp();
  await writeFile(join(outside, "secret"), "secret");
  await symlink(outside, join(root, "escape"));
  await expect(specs[1]!.run({ path: "escape/secret" }, ctx)).rejects.toThrow("hors");
});

it("isole les services par projet et ne récupère aucune connexion d’un autre UUID", () => {
  const a = "11111111-1111-4111-8111-111111111111",
    b = "22222222-2222-4222-8222-222222222222";
  expect(projectIntegrations({ [a]: [config] }, a)).toEqual([config]);
  expect(projectIntegrations({ [a]: [config] }, b)).toEqual([]);
  expect(projectIntegrations({ [a]: [config] }, null)).toEqual([]);
  expect(() => projectIntegrations({ bad: [config] }, a)).toThrow();
});
