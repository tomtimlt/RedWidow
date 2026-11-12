/**
 * Pilotage des conteneurs gérés pour l'écran Conteneurs (ADR 0053). Geste humain direct, via l'API
 * Engine du démon de l'hôte : liste, démarrage, arrêt, création d'un Kali. Seuls les conteneurs
 * « gérés » (convention du cœur, voir `docker/containers.ts`) sont visibles ou modifiables.
 * Exegol : sa création passe par la CLI Exegol (hors de ce lot).
 */
import { CodedError } from "@warband/core";
import type { DockerApi } from "../docker/api.js";
import {
  type ContainerKind,
  createKali,
  DEFAULT_KALI_IMAGE,
  findManaged,
  isContainerRef,
  listManaged,
  setRunning,
} from "../docker/containers.js";

export interface ContainerItem {
  id: string;
  name: string;
  image: string;
  state: "running" | "stopped";
  kind: ContainerKind;
  /** Nom du projet qui lie ce conteneur, s'il y en a un. */
  project?: string;
}

export interface ContainerHostOptions {
  docker: DockerApi;
  /** Identifiants du conteneur du serveur : exclus de tout. */
  selfIds?: readonly string[];
  /** Image du Kali créé (`REDWIDOW_KALI_IMAGE`). */
  kaliImage?: string;
  /** Réseau des outils (`REDWIDOW_TOOLS_NETWORK`), optionnel. */
  network?: string | undefined;
  /** Nom du projet lié, par nom de conteneur. */
  projects?(): Promise<ReadonlyMap<string, string>>;
}

/** Lit la configuration d'image et de réseau dans l'environnement du serveur. */
export function containerEnv(env: Readonly<Record<string, string | undefined>>): {
  kaliImage: string;
  network: string | undefined;
} {
  return {
    kaliImage: env.REDWIDOW_KALI_IMAGE?.trim() || DEFAULT_KALI_IMAGE,
    network: env.REDWIDOW_TOOLS_NETWORK?.trim() || undefined,
  };
}

export class ContainerHost {
  constructor(private readonly options: ContainerHostOptions) {}

  private get self(): readonly string[] {
    return this.options.selfIds ?? [];
  }

  /** Conteneurs gérés seulement. */
  async list(): Promise<ContainerItem[]> {
    const [rows, projects] = await Promise.all([
      listManaged(this.options.docker, this.self),
      this.options.projects?.().catch(() => new Map<string, string>()) ?? new Map<string, string>(),
    ]);
    return rows.map((r) => {
      const project = projects.get(r.name);
      return {
        id: r.id,
        name: r.name,
        image: r.image,
        state: r.running ? "running" : "stopped",
        kind: r.kind,
        ...(project !== undefined && { project }),
      };
    });
  }

  /** Démarre ou arrête un conteneur géré. Inconnu, non géré ou serveur : `terminal.notManaged`. */
  async setRunning(ref: string, run: boolean): Promise<ContainerItem["name"]> {
    const c = await findManaged(this.options.docker, ref, this.self);
    if (c === null) throw new CodedError("terminal.notManaged");
    await setRunning(this.options.docker, c.id, run);
    return c.name;
  }

  /** Crée et démarre un Kali étiqueté, sans privilège ni montage de l'hôte. */
  async createKali(name: string): Promise<void> {
    if (!isContainerRef(name)) throw new CodedError("container.invalidName");
    await createKali(this.options.docker, {
      name,
      image: this.options.kaliImage ?? DEFAULT_KALI_IMAGE,
      network: this.options.network,
    });
  }
}
