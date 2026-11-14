/**
 * Conteneurs gérés par RedWidow, vus par l'API Engine (ADR 0053). Convention « géré » reprise du cœur
 * (`DOCKER_LABEL_PREFIX_INSPECT_FORMAT`, core/src/docker/client.ts) : étiquette `org.exegol.*` (Exegol),
 * étiquette `io.warband.runtime=kali` (Kali créé par RedWidow) ou image dont le nom contient `kali`.
 * Tout le reste, y compris le conteneur du serveur lui-même, est invisible et refusé.
 */
import { dirname } from "node:path";
import { CodedError } from "@warband/core";
import type { DockerApi } from "./api.js";

export type ContainerKind = "kali" | "exegol" | "autre";

export interface ManagedContainer {
  id: string;
  name: string;
  image: string;
  running: boolean;
  kind: Exclude<ContainerKind, "autre">;
  /** Nom du dossier partagé sous la racine des conteneurs (ADR 0056), jamais un chemin hôte. */
  folder?: string;
}

/** Étiquette posée à la création d'un Kali par RedWidow (même convention que le cœur). */
export const RUNTIME_LABEL = "io.warband.runtime";
export const RUNTIME_KALI = "kali";
/** Étiquette du dossier partagé (nom sous `<données>/containers`) posée à la création d'un Kali (ADR 0056). */
export const WORKSPACE_LABEL = "io.warband.workspace";
/** Point de montage du dossier partagé dans le conteneur (convention Exegol). */
export const WORKSPACE_MOUNT = "/workspace";
const EXEGOL_PREFIX = "org.exegol.";

/** Image Kali locale par défaut (`containers/kali/Dockerfile`), surchargeable par `REDWIDOW_KALI_IMAGE`. */
export const DEFAULT_KALI_IMAGE = "redwidow-kali:local";

/** Nom ou identifiant accepté : mêmes bornes que l'opérande Docker du cœur, sans tiret initial. */
export const CONTAINER_REF = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
export const isContainerRef = (v: unknown): v is string =>
  typeof v === "string" && CONTAINER_REF.test(v);

/** Famille d'un conteneur d'après ses étiquettes et son image ; `null` : non géré. */
export function classify(
  labels: Readonly<Record<string, unknown>> | null | undefined,
  image: string,
): "kali" | "exegol" | null {
  const keys = Object.keys(labels ?? {});
  if (keys.some((k) => k.startsWith(EXEGOL_PREFIX))) return "exegol";
  if (labels?.[RUNTIME_LABEL] === RUNTIME_KALI) return "kali";
  return image.includes("kali") ? "kali" : null;
}

/**
 * Dossier partagé d'un conteneur : l'étiquette `io.warband.workspace` (Kali créé ici) ou, à défaut, la source du
 * montage `/workspace` quand elle est directement sous la racine des conteneurs (Exegol créé ici). Autrement
 * (conteneur antérieur à l'ADR 0056, montage ailleurs) : `undefined`.
 */
export function sharedFolderOf(
  labels: unknown,
  mounts: unknown,
  containersRoot: string | undefined,
): string | undefined {
  if (containersRoot === undefined) return undefined;
  const label = isRecord(labels) ? labels[WORKSPACE_LABEL] : undefined;
  if (typeof label === "string" && isContainerRef(label)) return label;
  if (!Array.isArray(mounts)) return undefined;
  for (const m of mounts) {
    if (!isRecord(m) || m.Destination !== WORKSPACE_MOUNT || typeof m.Source !== "string") continue;
    if (dirname(m.Source) !== containersRoot) continue;
    const name = m.Source.slice(containersRoot.length + 1);
    if (isContainerRef(name)) return name;
  }
  return undefined;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/**
 * Le conteneur est-il celui du serveur ? `HOSTNAME` y vaut l'identifiant court (ou un nom imposé) :
 * on refuse sur l'identifiant (préfixe d'au moins 12 caractères) et sur le nom.
 */
export function isSelf(id: string, name: string, selfIds: readonly string[]): boolean {
  return selfIds.some(
    (h) =>
      h !== "" && (h === name || (h.length >= 12 && /^[0-9a-f]+$/i.test(h) && id.startsWith(h))),
  );
}

/** Liste des conteneurs gérés (hors serveur), nom sans `/` initial. Erreur de démon : `docker.unavailable`/`container.failed`. */
export async function listManaged(
  api: DockerApi,
  selfIds: readonly string[],
  containersRoot?: string,
): Promise<ManagedContainer[]> {
  const res = await api.json("GET", "/containers/json?all=1");
  if (res.status !== 200 || !Array.isArray(res.data)) throw new CodedError("container.failed");
  const out: ManagedContainer[] = [];
  for (const row of res.data) {
    if (!isRecord(row)) continue;
    const id = str(row.Id);
    const image = str(row.Image);
    const rawName = Array.isArray(row.Names) ? str(row.Names[0]) : null;
    if (!id || !image || !rawName) continue;
    const name = rawName.startsWith("/") ? rawName.slice(1) : rawName;
    const kind = classify(isRecord(row.Labels) ? row.Labels : null, image);
    if (kind === null || isSelf(id, name, selfIds)) continue;
    const folder = sharedFolderOf(row.Labels, row.Mounts, containersRoot);
    out.push({
      id,
      name,
      image,
      running: row.State === "running",
      kind,
      ...(folder !== undefined && { folder }),
    });
  }
  return out;
}

/**
 * Conteneur géré désigné par son nom ou son identifiant, d'après l'inspection du démon. `null` s'il est
 * inconnu, non géré ou s'il s'agit du serveur : l'appelant ne distingue pas ces cas (pas d'oracle d'existence).
 */
export async function findManaged(
  api: DockerApi,
  ref: string,
  selfIds: readonly string[],
  containersRoot?: string,
): Promise<ManagedContainer | null> {
  if (!isContainerRef(ref)) return null;
  const res = await api.json("GET", `/containers/${encodeURIComponent(ref)}/json`);
  if (res.status === 404) return null;
  if (res.status !== 200 || !isRecord(res.data)) throw new CodedError("container.failed");
  const config = isRecord(res.data.Config) ? res.data.Config : {};
  const state = isRecord(res.data.State) ? res.data.State : {};
  const id = str(res.data.Id);
  const image = str(config.Image);
  const rawName = str(res.data.Name);
  if (!id || !image || !rawName) return null;
  const name = rawName.startsWith("/") ? rawName.slice(1) : rawName;
  const kind = classify(isRecord(config.Labels) ? config.Labels : null, image);
  if (kind === null || isSelf(id, name, selfIds)) return null;
  const folder = sharedFolderOf(config.Labels, res.data.Mounts, containersRoot);
  return {
    id,
    name,
    image,
    running: state.Running === true,
    kind,
    ...(folder !== undefined && { folder }),
  };
}

export interface CreateKaliOptions {
  name: string;
  image: string;
  /** Dossier partagé du conteneur : chemin hôte `<données>/containers/<dossier>`, monté en `/workspace`. */
  workspace: { path: string; folder: string };
  /** Réseau Docker des outils (`REDWIDOW_TOOLS_NETWORK`), absent : réseau par défaut. */
  network?: string | undefined;
}

/**
 * Corps de création d'un Kali : étiquettes de gestion, TTY ouvert pour que le shell par défaut de l'image
 * reste actif. Un seul montage de l'hôte, le dossier partagé du conteneur (`<chemin>:/workspace`, ADR 0056) :
 * ni `Privileged`, ni socket Docker, ni autre volume. Autre champ : le réseau des outils, s'il est configuré.
 */
export function kaliCreateBody(options: CreateKaliOptions): Record<string, unknown> {
  return {
    Image: options.image,
    Labels: { [RUNTIME_LABEL]: RUNTIME_KALI, [WORKSPACE_LABEL]: options.workspace.folder },
    Tty: true,
    OpenStdin: true,
    HostConfig: {
      Binds: [`${options.workspace.path}:${WORKSPACE_MOUNT}`],
      ...(options.network && { NetworkMode: options.network }),
    },
  };
}

/** Crée puis démarre un Kali. Nom pris : `container.exists`. */
export async function createKali(api: DockerApi, options: CreateKaliOptions): Promise<void> {
  if (!isContainerRef(options.name)) throw new CodedError("container.invalidName");
  const created = await api.json(
    "POST",
    `/containers/create?name=${encodeURIComponent(options.name)}`,
    kaliCreateBody(options),
  );
  if (created.status === 409) throw new CodedError("container.exists");
  if (created.status !== 201 || !isRecord(created.data) || !str(created.data.Id))
    throw new CodedError("container.failed", { status: created.status });
  const started = await api.json(
    "POST",
    `/containers/${encodeURIComponent(created.data.Id as string)}/start`,
  );
  if (started.status !== 204 && started.status !== 304)
    throw new CodedError("container.failed", { status: started.status });
}

/** Démarre ou arrête un conteneur déjà vérifié comme géré (204 : fait, 304 : déjà dans l'état). */
export async function setRunning(api: DockerApi, id: string, run: boolean): Promise<void> {
  const res = await api.json(
    "POST",
    `/containers/${encodeURIComponent(id)}/${run ? "start" : "stop?t=10"}`,
  );
  if (res.status !== 204 && res.status !== 304)
    throw new CodedError("container.failed", { status: res.status });
}
