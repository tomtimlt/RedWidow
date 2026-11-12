import { randomBytes } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CodedError } from "@warband/core";
import { AUTH_FILE, hashPassword, MIN_PASSWORD_LENGTH } from "./password.js";

/** Entrées/sorties de la commande (injectables pour les tests). */
export interface SetPasswordIo {
  /** Lit une ligne sans écho (terminal interactif). */
  readHidden(prompt: string): Promise<string>;
  /** Lit une ligne sur l'entrée standard non interactive. */
  readLine(): Promise<string>;
  readonly isTTY: boolean;
  out(line: string): void;
  err(line: string): void;
}

export interface SetPasswordOptions {
  dataDir: string;
  stdin: boolean;
  print: boolean;
}

/** Écrit `<dataDir>/auth.json` en 0600, de façon atomique (fichier temporaire puis renommage). */
export async function writeAuthFile(dataDir: string, passwordHash: string): Promise<void> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const target = join(dataDir, AUTH_FILE);
  const tmp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify({ passwordHash })}\n`, { mode: 0o600, flag: "wx" });
    await chmod(tmp, 0o600);
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/**
 * Commande `set-password` : lit le mot de passe (deux saisies identiques au terminal, une ligne
 * avec `--stdin`), puis écrit `auth.json` ou, avec `--print`, affiche seulement l'empreinte.
 * Le mot de passe n'est jamais affiché ni journalisé.
 */
export async function runSetPassword(opts: SetPasswordOptions, io: SetPasswordIo): Promise<void> {
  let password: string;
  if (opts.stdin) {
    password = await io.readLine();
  } else if (io.isTTY) {
    password = await io.readHidden("Mot de passe : ");
    const again = await io.readHidden("Confirmation : ");
    if (password !== again) throw new CodedError("server.passwordMismatch");
  } else {
    throw new CodedError("server.passwordNeedsStdin");
  }
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    throw new CodedError("server.passwordTooShort", { min: MIN_PASSWORD_LENGTH });
  }
  const hash = await hashPassword(password);
  if (opts.print) {
    io.out(hash);
    return;
  }
  await writeAuthFile(opts.dataDir, hash);
  io.err(`Mot de passe enregistré dans ${join(opts.dataDir, AUTH_FILE)}`);
}
