import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Policy, type PolicyRule, parsePolicy, USER_POLICY_FILE } from "@john-studio/core";

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
  await rename(temp, path);
  return path;
}
