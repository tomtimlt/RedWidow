import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { createSdkRunner } from "@john-studio/agent-sdk";
import { matchesFingerprint } from "../logic/integrity.js";

/**
 * Point d'entrée du spike (processus enfant forké par l'extension) : vérifie
 * l'empreinte du binaire `claude` empaqueté, puis lance `claude --version`.
 * Argument : dossier de l'extension (contient `bin/claude(.exe)` et `bin/claude.sha256`).
 */
async function main(root: string): Promise<void> {
  const exe = join(root, "bin", process.platform === "win32" ? "claude.exe" : "claude");
  const expected = (await readFile(join(root, "bin", "claude.sha256"), "utf8")).trim();
  if (!(await matchesFingerprint(exe, expected))) {
    throw new Error("extension.binaryMismatch");
  }
  // Le runner reçoit le chemin fixé par le code (jamais un réglage) : ici on vérifie seulement qu'il se construit.
  createSdkRunner({ executable: exe });
  const { stdout } = await promisify(execFile)(exe, ["--version"]);
  process.stdout.write(`binaire vérifié, version : ${stdout.trim()}\n`);
}

main(process.argv[2] ?? ".").catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
