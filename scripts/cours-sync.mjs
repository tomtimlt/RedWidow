#!/usr/bin/env node
// Synchronisation manuelle des sources de cours libres (manifeste : cours/sources.json) vers
// <dossier de configuration>/cours/<nom>/. Jamais lancée automatiquement. Aucune dépendance.
// Usage : node scripts/cours-sync.mjs [--racine <dossier>] [--manifeste <fichier>]
// (par défaut : <dossier de configuration>/cours et cours/sources.json)
import { execFile } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { validerManifeste } from "./cours-validation.mjs";

const execFileP = promisify(execFile);
const MANIFESTE_DEFAUT = fileURLToPath(new URL("../cours/sources.json", import.meta.url));
const LICENCE = /^(licen[cs]e|copying)/i;
const TEXTE = /\.(md|txt)$/i;

// Même calcul que defaultConfigDir() (packages/core/src/approval/source.ts) : le script est un
// .mjs sans build, on ne dépend pas du paquet construit.
function dossierConfig(env = process.env, platform = process.platform) {
  if (platform === "win32")
    return join(env.APPDATA || join(homedir(), "AppData", "Roaming"), "john-studio");
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "john-studio");
}

const git = (args, cwd) =>
  execFileP("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });

// Copie récursive des .md/.txt ; ignore liens symboliques et tout ce qui n'est pas régulier.
async function copierTextes(src, dest, base) {
  for (const e of await readdir(src, { withFileTypes: true })) {
    if (e.name === ".git") continue;
    const s = join(src, e.name);
    const st = await lstat(s);
    if (st.isDirectory()) await copierTextes(s, join(dest, e.name), base);
    else if (st.isFile() && TEXTE.test(e.name)) {
      await mkdir(dest, { recursive: true });
      await copyFile(s, join(dest, e.name));
    }
  }
}

// Premier fichier de licence régulier : d'abord dans le sous-dossier, puis à la racine du dépôt.
async function trouverLicence(dirs) {
  for (const d of dirs) {
    let noms = [];
    try {
      noms = await readdir(d);
    } catch {
      continue;
    }
    for (const n of noms.sort()) {
      if (LICENCE.test(n) && (await lstat(join(d, n))).isFile()) return join(d, n);
    }
  }
  return null;
}

async function synchroniser(entree, racine) {
  const tmp = await mkdtemp(join(tmpdir(), "cours-"));
  try {
    const depot = join(tmp, "depot");
    await mkdir(depot);
    await git(["init", "-q"], depot);
    await git(["fetch", "-q", "--depth", "1", entree.url, entree.ref], depot);
    await git(["checkout", "-q", "FETCH_HEAD"], depot);
    const sha = (await git(["rev-parse", "HEAD"], depot)).stdout.trim();

    const source = entree.sousDossier ? resolve(depot, entree.sousDossier) : depot;
    if (source !== depot && !source.startsWith(depot + sep))
      throw new Error("sousDossier hors du dépôt");
    const st = await lstat(source).catch(() => null);
    if (!st?.isDirectory()) throw new Error(`sousDossier introuvable « ${entree.sousDossier} »`);

    const licence = await trouverLicence([source, depot]);
    if (licence === null)
      throw new Error("aucun fichier de licence (LICENSE*, LICENCE*, COPYING*)");

    // Préparation dans un dossier voisin puis remplacement : jamais d'état partiel.
    const prep = join(tmp, "sortie");
    await copierTextes(source, prep, source);
    await mkdir(prep, { recursive: true });
    const cible = join(prep, licence.slice(licence.lastIndexOf(sep) + 1));
    await copyFile(licence, cible);
    await writeFile(
      join(prep, "SOURCE.md"),
      `# Source\n\n- nom : ${entree.nom}\n- url : ${entree.url}\n- ref : ${entree.ref} (${sha})\n- licence : ${entree.licence}\n`,
    );

    const dest = resolve(racine, entree.nom);
    if (relative(racine, dest).startsWith("..") || dirname(dest) !== resolve(racine))
      throw new Error("destination hors de la racine");
    await rm(dest, { recursive: true, force: true });
    await mkdir(racine, { recursive: true });
    try {
      await rename(prep, dest);
    } catch {
      // Autre volume que le dossier temporaire : copie récursive.
      await copierTextes(prep, dest, prep);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const option = (nom) => {
    const i = args.indexOf(nom);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const racine = resolve(option("--racine") ?? join(dossierConfig(), "cours"));
  const fichier = resolve(option("--manifeste") ?? MANIFESTE_DEFAUT);
  const manifeste = validerManifeste(JSON.parse(await readFile(fichier, "utf8")));
  if (manifeste.length === 0) {
    console.log("cours-sync : manifeste vide, rien à faire.");
    return;
  }
  let echecs = 0;
  for (const entree of manifeste) {
    try {
      await synchroniser(entree, racine);
      console.log(`cours-sync : ${entree.nom} synchronisé.`);
    } catch (error) {
      echecs++;
      console.error(`cours-sync : ${entree.nom} refusé : ${error.message}`);
    }
  }
  if (echecs > 0) process.exit(1);
}

main().catch((error) => {
  console.error(`cours-sync : ${error.message}`);
  process.exit(2);
});
