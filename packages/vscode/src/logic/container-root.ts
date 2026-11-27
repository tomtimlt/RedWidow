import { mkdir, readdir, realpath, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CodedError,
  type CommonRoot,
  isInsideShare,
  nextContainerName,
  prepareCommonRoot,
  reserveContainerFolder,
  validateProjectFolder,
} from "@warband/core";

/** Nom proposé pour la racine commune, sous le dossier personnel (ADR 0054, point 1). */
export const DEFAULT_ROOT_NAME = "RedWidow";

/** Nom saisi pour un conteneur : même motif que le parseur du cockpit. */
const CREATE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export interface RootDeps {
  /** Réglage machine `warband.root` (vide ou absent : jamais configuré). */
  readSetting(): string | undefined;
  saveSetting(path: string): Promise<void>;
  home(): string;
  /** Modale de proposition : « use » = dossier proposé, « other » = choisir, `undefined` = annulé. */
  confirmDefault(proposed: string): Promise<"use" | "other" | undefined>;
  /** Sélecteur de dossier natif (dossier seul) ; `undefined` si annulé. */
  pickFolder(): Promise<string | undefined>;
}

/**
 * Racine commune, validée (chemin réel) avec `projets`, `conteneurs` et `ressources` préparés.
 * Réglage vide : proposition puis choix ; le chemin retenu est validé puis enregistré. `undefined`
 * si l'utilisateur annule (rien n'est créé). Jamais de chemin venant de la webview.
 */
export async function ensureRoot(deps: RootDeps): Promise<CommonRoot | undefined> {
  const current = deps.readSetting();
  if (typeof current === "string" && current !== "") return await prepareRoot(current);
  const proposed = join(deps.home(), DEFAULT_ROOT_NAME);
  const choice = await deps.confirmDefault(proposed);
  if (choice === undefined) return undefined;
  let chosen: string | undefined;
  if (choice === "use") {
    try {
      await validateProjectFolder(dirname(proposed));
      await mkdir(proposed, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST")
        throw new CodedError("container.rootInvalid");
    }
    chosen = proposed;
  } else {
    chosen = await deps.pickFolder();
    if (chosen === undefined) return undefined;
  }
  const common = await prepareRoot(chosen);
  await deps.saveSetting(common.root);
  return common;
}

async function prepareRoot(path: string): Promise<CommonRoot> {
  try {
    return await prepareCommonRoot(path);
  } catch {
    throw new CodedError("container.rootInvalid");
  }
}

export interface ContainerPlan {
  /** Valeur de nom pour la création (suffixe pour Exegol, nom complet pour Kali). */
  name: string;
  /** Nom du dossier sous `conteneurs/`, en minuscules ; égal au nom Docker du conteneur. */
  folder: string;
}

export interface PlanDeps {
  /** Noms Docker de tous les conteneurs, quel que soit l'état. */
  listContainerNames(): Promise<string[]>;
  /** Noms des entrées existantes de `conteneurs/`. */
  listRootFolders(root: string): Promise<string[]>;
}

/** Nom suggéré pour l'affichage : le suffixe `N` pour Exegol, `kali-N` pour Kali. */
export function suggestName(kind: "kali" | "exegol", taken: readonly string[]): string {
  const name = nextContainerName(kind, taken);
  return kind === "exegol" ? name.slice("exegol-".length) : name;
}

/**
 * Nom et dossier d'un conteneur à créer. Nom de la webview s'il est valide, sinon le prochain nom
 * libre d'après les conteneurs Docker (tous états) et les dossiers de `conteneurs/` (`root`).
 */
export async function planContainer(
  kind: "kali" | "exegol",
  requested: string | undefined,
  root: string,
  deps: PlanDeps,
): Promise<ContainerPlan> {
  const taken = [...(await deps.listContainerNames()), ...(await deps.listRootFolders(root))];
  const name =
    requested !== undefined && CREATE_NAME.test(requested) ? requested : suggestName(kind, taken);
  return { name, folder: (kind === "exegol" ? `exegol-${name}` : name).toLowerCase() };
}

/** Noms des entrées de `root` ; racine illisible : liste vide (la réservation échouera ensuite). */
export async function listFolderNames(root: string): Promise<string[]> {
  try {
    return await readdir(root);
  } catch {
    return [];
  }
}

/**
 * Supprime `folder` seulement s'il est un dossier réel enfant direct de `root` (`conteneurs/`) et
 * vide. Renvoie vrai si supprimé.
 */
export async function removeReservedFolder(root: string, folder: string): Promise<boolean> {
  try {
    const base = await realpath(root);
    const real = await realpath(folder);
    if (real === base || !(await isInsideShare(base, real))) return false;
    if (dirname(real) !== base) return false;
    if ((await readdir(real)).length > 0) return false;
    await rm(real, { recursive: true, force: false });
    return true;
  } catch {
    return false;
  }
}

export interface ReserveDeps {
  /** Vrai si le conteneur existe (même partiellement créé) : le dossier est alors conservé. */
  containerExists?(): Promise<boolean>;
}

/**
 * Réserve `<root>/<folder>` (`root` = `conteneurs/`), puis exécute `create` avec le chemin réel.
 * Si `create` échoue, le dossier réservé est supprimé s'il est vide (voir `removeReservedFolder`)
 * et l'erreur d'origine est remontée.
 */
export async function createInReservedFolder<T>(
  root: string,
  folder: string,
  create: (path: string) => Promise<T>,
  deps: ReserveDeps = {},
): Promise<T> {
  const real = await reserveContainerFolder(root, folder);
  try {
    return await create(real);
  } catch (error) {
    let keep = false;
    try {
      keep = (await deps.containerExists?.()) === true;
    } catch {
      keep = true;
    }
    if (!keep) await removeReservedFolder(root, real);
    throw error;
  }
}
