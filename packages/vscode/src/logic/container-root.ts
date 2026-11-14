import { mkdir, readdir, realpath, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CONTAINER_ROOT_DIRS,
  CodedError,
  isInsideShare,
  nextContainerName,
  PROJECTS_DIR,
  prepareRedwidowRoot,
  REDWIDOW_DIR,
  reserveContainerFolder,
  validateProjectFolder,
} from "@warband/core";

/** Nom proposé pour la racine des conteneurs, sous le dossier personnel (ADR 0053, point 1). */
export const DEFAULT_ROOT_NAME = "RedWidow-conteneurs";

/** Nom saisi pour un conteneur : même motif que le parseur du cockpit. */
const CREATE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export interface RootDeps {
  /** Réglage machine `warband.containers.root` (vide ou absent : jamais configuré). */
  readSetting(): string | undefined;
  saveSetting(path: string): Promise<void>;
  home(): string;
  /** Modale de proposition : « use » = dossier proposé, « other » = choisir, `undefined` = annulé. */
  confirmDefault(proposed: string): Promise<"use" | "other" | undefined>;
  /** Sélecteur de dossier natif (dossier seul) ; `undefined` si annulé. */
  pickFolder(): Promise<string | undefined>;
}

/**
 * Racine des conteneurs, validée (chemin réel). Réglage vide : proposition puis choix ; le chemin
 * retenu est validé puis enregistré. `undefined` si l'utilisateur annule (rien n'est créé).
 * Jamais de chemin venant de la webview.
 */
export async function ensureContainersRoot(deps: RootDeps): Promise<string | undefined> {
  const current = deps.readSetting();
  if (typeof current === "string" && current !== "") return await validateRoot(current);
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
  const real = await validateRoot(chosen);
  await deps.saveSetting(real);
  return real;
}

async function validateRoot(path: string): Promise<string> {
  try {
    return await validateProjectFolder(path);
  } catch {
    throw new CodedError("container.rootInvalid");
  }
}

export interface ContainerPlan {
  /** Valeur de nom pour la création (suffixe pour Exegol, nom complet pour Kali). */
  name: string;
  /** Nom du dossier sous la racine, en minuscules ; égal au nom Docker du conteneur. */
  folder: string;
}

export interface PlanDeps {
  /** Noms Docker de tous les conteneurs, quel que soit l'état. */
  listContainerNames(): Promise<string[]>;
  /** Noms des entrées existantes de la racine. */
  listRootFolders(root: string): Promise<string[]>;
}

/** Nom suggéré pour l'affichage : le suffixe `N` pour Exegol, `kali-N` pour Kali. */
export function suggestName(kind: "kali" | "exegol", taken: readonly string[]): string {
  const name = nextContainerName(kind, taken);
  return kind === "exegol" ? name.slice("exegol-".length) : name;
}

/**
 * Nom et dossier d'un conteneur à créer. Nom de la webview s'il est valide, sinon le prochain nom
 * libre d'après les conteneurs Docker (tous états) et les dossiers de la racine.
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
 * Supprime `folder` seulement s'il est un dossier réel strictement sous `root` et ne contient, à
 * part l'arborescence `RedWidow` préparée par nous, aucun fichier. Renvoie vrai si supprimé.
 */
export async function removeReservedFolder(root: string, folder: string): Promise<boolean> {
  try {
    const base = await realpath(root);
    const real = await realpath(folder);
    if (real === base || !(await isInsideShare(base, real))) return false;
    if (dirname(real) !== base) return false;
    const entries = await readdir(real, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name !== REDWIDOW_DIR || !entry.isDirectory()) return false;
    }
    const known = new Set<string>([...CONTAINER_ROOT_DIRS, PROJECTS_DIR]);
    if (entries.length > 0) {
      const inner = await readdir(join(real, REDWIDOW_DIR), { withFileTypes: true });
      for (const sub of inner) {
        if (!sub.isDirectory() || !known.has(sub.name)) return false;
        if ((await readdir(join(real, REDWIDOW_DIR, sub.name))).length > 0) return false;
      }
    }
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
 * Réserve `<root>/<folder>`, prépare l'arborescence RedWidow, puis exécute `create` avec le chemin
 * réel. Si `create` échoue, le dossier réservé est supprimé s'il est vide (voir
 * `removeReservedFolder`) et l'erreur d'origine est remontée.
 */
export async function createInReservedFolder<T>(
  root: string,
  folder: string,
  create: (path: string) => Promise<T>,
  deps: ReserveDeps = {},
): Promise<T> {
  const real = await reserveContainerFolder(root, folder);
  try {
    await prepareRedwidowRoot(real);
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
