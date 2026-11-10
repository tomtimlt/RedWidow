import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { opencodeAuthFile } from "@warband/core";

/** Lit uniquement le type de connexion ; aucun jeton du cache n’est renvoyé à l’interface. */
export async function openAiSubscriptionReady(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): Promise<boolean> {
  const file = opencodeAuthFile(env, home);
  try {
    if ((await stat(file)).size > 1024 * 1024) return false;
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const openai = (value as Record<string, unknown>).openai;
    return (
      typeof openai === "object" &&
      openai !== null &&
      !Array.isArray(openai) &&
      (openai as Record<string, unknown>).type === "oauth"
    );
  } catch {
    return false;
  }
}
