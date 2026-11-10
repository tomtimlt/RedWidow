import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openAiSubscriptionReady } from "../src/logic/provider-auth.js";

it("l’abonnement OpenAI exige un cache OAuth natif ; API, cache absent et contenu invalide restent déconnectés", async () => {
  const root = await mkdtemp(join(tmpdir(), "warband-oauth-"));
  const env = { XDG_DATA_HOME: root };
  const path = join(root, "opencode", "auth.json");
  try {
    expect(await openAiSubscriptionReady(env, root)).toBe(false);
    await mkdir(join(root, "opencode"));
    for (const value of [
      "{",
      "null",
      "[]",
      JSON.stringify({ openai: { type: "api", key: "secret-not-returned" } }),
    ]) {
      await writeFile(path, value, { mode: 0o600 });
      expect(await openAiSubscriptionReady(env, root)).toBe(false);
    }
    await writeFile(
      path,
      JSON.stringify({
        openai: { type: "oauth", access: "secret-not-returned", refresh: "also-private" },
      }),
      { mode: 0o600 },
    );
    expect(await openAiSubscriptionReady(env, root)).toBe(true);
    const home = join(root, "home");
    await mkdir(join(home, ".local", "share", "opencode"), { recursive: true });
    await writeFile(
      join(home, ".local", "share", "opencode", "auth.json"),
      JSON.stringify({ openai: { type: "oauth" } }),
    );
    expect(await openAiSubscriptionReady({ HOME: home }, root)).toBe(true);
    await writeFile(path, " ".repeat(1024 * 1024 + 1));
    expect(await openAiSubscriptionReady(env, root)).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
