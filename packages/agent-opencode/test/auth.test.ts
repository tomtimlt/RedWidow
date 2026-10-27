import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpencodeRunner } from "../src/index.js";
import * as server from "../src/server.js";
import { fakeOpencode, harness } from "./helpers.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function cache(content?: string) {
  const root = await mkdtemp(join(tmpdir(), "warband-auth-test-"));
  roots.push(root);
  await mkdir(join(root, "opencode"));
  if (content !== undefined) await writeFile(join(root, "opencode", "auth.json"), content);
  return root;
}

describe("identification abonnement OpenAI", () => {
  it("refuse un serveur externe officiel avant toute connexion sans exposer son URL", async () => {
    const createClient = vi.fn(fakeOpencode([]).createClient);
    const runner = createOpencodeRunner({
      provider: "openai",
      baseUrl: "https://secret-test@autre.invalid",
      createClient,
    });
    const message = "Le mode OpenAI officiel nécessite un serveur local isolé lancé par Warband.";
    await expect(runner.listModels?.({ cwd: process.cwd() })).rejects.toThrow(message);
    await expect(harness().run(runner)).rejects.toThrow(message);
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    "invalide",
    JSON.stringify({ openai: { type: "api", key: "secret-test" } }),
    JSON.stringify({ autre: { type: "oauth" } }),
    " ".repeat(1024 * 1024 + 1),
  ])("refuse le cache absent, malformé, API ou trop grand avant le client", async (content) => {
    const data = await cache(content);
    const createClient = vi.fn(fakeOpencode([]).createClient);
    const runner = createOpencodeRunner({
      provider: "openai",
      processEnv: { XDG_DATA_HOME: data },
      createClient,
    });
    await expect(runner.listModels?.({ cwd: process.cwd(), auth: "subscription" })).rejects.toThrow(
      "Connexion ChatGPT requise",
    );
    await expect(harness().run(runner, { auth: "subscription" })).rejects.toThrow(
      "Connexion ChatGPT requise",
    );
    expect(createClient).not.toHaveBeenCalled();
  });

  it("accepte le type oauth sans transmettre de snapshot", async () => {
    const data = await cache(
      JSON.stringify({ openai: { type: "oauth", access: "secret-test", refresh: "secret-test" } }),
    );
    const fake = fakeOpencode([]);
    const createClient = vi.fn((init: Parameters<typeof fake.createClient>[0]) => ({
      ...fake.createClient(init),
      listProviders: async () => ({ all: [], connected: [] }),
    }));
    const runner = createOpencodeRunner({
      provider: "openai",
      processEnv: { XDG_DATA_HOME: data },
      createClient,
    });
    expect(await runner.listModels?.({ cwd: process.cwd(), auth: "subscription" })).toEqual([]);
    expect(JSON.stringify(createClient.mock.calls)).not.toContain("secret-test");
    expect(fake.closed()).toBe(true);
  });

  it("cherche le cache sous HOME si XDG_DATA_HOME est absent", async () => {
    const home = await cache();
    const data = join(home, ".local", "share", "opencode");
    await mkdir(data, { recursive: true });
    await writeFile(join(data, "auth.json"), JSON.stringify({ openai: { type: "oauth" } }));
    const fake = fakeOpencode([]);
    const runner = createOpencodeRunner({
      provider: "openai",
      processEnv: { HOME: home },
      createClient: (init) => ({
        ...fake.createClient(init),
        listProviders: async () => ({ all: [], connected: [] }),
      }),
    });
    await expect(
      runner.listModels?.({ cwd: process.cwd(), auth: "subscription" }),
    ).resolves.toEqual([]);
    await access(join(data, "auth.json"));
  });
});

describe("isolation de la configuration", () => {
  it.each([
    { fail: false, official: true },
    { fail: true, official: true },
    { fail: false, official: false },
    { fail: true, official: false },
  ])(
    "isole la configuration puis retire le dossier, erreur catalogue=$fail, OpenAI=$official",
    async ({ fail, official }) => {
      const root = await cache();
      const script = join(root, "opencode-test.mjs");
      const log = join(root, "env.json");
      await writeFile(
        script,
        `#!${process.execPath}
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(log)}, JSON.stringify({ config: process.env.XDG_CONFIG_HOME, data: process.env.XDG_DATA_HOME, auth: process.env.OPENCODE_AUTH_CONTENT, key: process.env.OPENAI_API_KEY }));
const server = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url.startsWith("/config")) return res.end(process.env.OPENCODE_CONFIG_CONTENT);
  if (${fail}) { res.statusCode = 500; return res.end('{}'); }
  res.end(JSON.stringify({ all: [], connected: [] }));
});
server.listen(0, "127.0.0.1", () => console.log("opencode server listening on http://127.0.0.1:" + server.address().port));
`,
      );
      // Le faux serveur est du JavaScript : Node le lance aussi sous Windows,
      // sans shim shell ni dépendance à la prise en charge POSIX du shebang.
      const launch = server.launchServer;
      vi.spyOn(server, "launchServer").mockImplementation((options) =>
        launch({ ...options, binary: process.execPath, argsPrefix: [script] }),
      );
      const runner = createOpencodeRunner({
        ...(official ? { provider: "openai" } : { isolateConfig: true }),
        binary: process.execPath,
        processEnv: { XDG_CONFIG_HOME: root, XDG_DATA_HOME: root },
        env: { OPENAI_API_KEY: "secret-test" },
      });
      const result = runner.listModels?.({ cwd: root, auth: "api-key" });
      if (fail) await expect(result).rejects.toThrow("provider.list");
      else await expect(result).resolves.toEqual([]);
      const captured = JSON.parse(await readFile(log, "utf8"));
      expect(captured.config).not.toBe(root);
      expect(captured.data).toBe(root);
      expect(captured.auth).toBe(official ? "{}" : undefined);
      expect(captured.key).toBe("secret-test");
      await expect(access(captured.config)).rejects.toThrow();
      await access(root);
    },
  );
});
