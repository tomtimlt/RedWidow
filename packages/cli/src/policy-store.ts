import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { type Policy, type PolicyRule, parsePolicy, USER_POLICY_FILE } from "@john-studio/core";

/** Renommage atomique ; sous win32, 3 nouveaux essais sur EPERM/EBUSY/EACCES (antivirus, indexeur) puis échec. */
export async function renameWithRetry(
  from: string,
  to: string,
  io: {
    platform?: NodeJS.Platform;
    rename?: (from: string, to: string) => Promise<void>;
    wait?: (ms: number) => Promise<void>;
  } = {},
): Promise<void> {
  const { platform = process.platform, rename: doRename = rename, wait = sleep } = io;
  const attempts = platform === "win32" ? 4 : 1;
  for (let attempt = 1; ; attempt++) {
    try {
      return await doRename(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= attempts || !(code === "EPERM" || code === "EBUSY" || code === "EACCES"))
        throw err;
      await wait(50 * attempt);
    }
  }
}

const sameTarget = (a: PolicyRule, b: PolicyRule) =>
  a.tool === b.tool && (a.command ?? null) === (b.command ?? null);

/**
 * Ajoute une règle à la politique utilisateur `<configDir>/policy.json`. Si le
 * fichier n'existe pas, il est créé à partir de la politique effective du run
 * (pour ne pas perdre ses règles), puis la règle y est ajoutée. Une règle
 * identique déjà présente n'est pas dupliquée. Écriture par fichier temporaire
 * + renommage, pour ne jamais laisser une politique tronquée.
 */
export async function appendUserRule(
  configDir: string,
  rule: PolicyRule,
  effective: Policy,
): Promise<string> {
  const path = join(configDir, USER_POLICY_FILE);
  let base: Policy;
  try {
    base = parsePolicy(JSON.parse(await readFile(path, "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    base = effective;
  }
  if (base.rules.some((r) => r.decision === rule.decision && sameTarget(r, rule))) return path;
  const next: Policy = { ...base, rules: [...base.rules, rule] };
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await renameWithRetry(temp, path);
  return path;
}
