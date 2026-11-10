import { homedir } from "node:os";
import { join } from "node:path";

/** Chemin du cache recherché par OpenCode, sans lecture de son contenu. */
export function opencodeAuthFile(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return join(
    env.XDG_DATA_HOME || join(env.HOME || home, ".local", "share"),
    "opencode",
    "auth.json",
  );
}
