import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DEFAULT_POLICY, type Policy, parsePolicy } from "@john-studio/core";

export const DEFAULT_POLICY_PATH = ".john-studio/policy.json";

export interface LoadedPolicy {
  policy: Policy;
  source: string;
}

/**
 * Chemin explicite → doit exister. Sinon `.john-studio/policy.json` s'il
 * existe, sinon la politique intégrée.
 */
export async function loadPolicy(explicit: string | undefined, cwd: string): Promise<LoadedPolicy> {
  const path = resolve(cwd, explicit ?? DEFAULT_POLICY_PATH);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if (explicit === undefined && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return { policy: DEFAULT_POLICY, source: "intégrée" };
    }
    throw err;
  }
  return { policy: parsePolicy(JSON.parse(text)), source: path };
}
