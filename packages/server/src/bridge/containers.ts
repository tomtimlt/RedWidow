/**
 * Pilotage des conteneurs gérés pour l'écran Conteneurs (ADR 0053). Geste humain direct, via l'API
 * Engine du démon de l'hôte : liste, démarrage, arrêt, création d'un Kali. Seuls les conteneurs
 * « gérés » (convention du cœur, voir `docker/containers.ts`) sont visibles ou modifiables.
 * Chaque Kali créé reçoit son dossier partagé `<données>/containers/<nom>` (ADR 0056). Exegol : sa création
 * passe par la CLI Exegol (voir `cockpit.ts`), avec le même dossier.
 */
import { CodedError, errorInfo, type StoredProject } from "@warband/core";
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
import { containerFolder } from "../storage/paths.js";
import { discardFolder, projectsInFolder, provisionFolder } from "./workspaces.js";

export interface ContainerItem {
  id: string;
  name: string;
  image: string;
  state: "running" | "stopped";
  kind: ContainerKind;
  /** Nom du projet qui lie ce conteneur, s'il y en a un. */
  project?: string;
  /** Nom du dossier partagé sous la racine des conteneurs (jamais un chemin hôte), s'il en a un (ADR 0056). */
  folder?: string;
  /** Projets qui vivent dans ce dossier partagé. */
  projects?: { id: string; name: string }[];
}

export interface ContainerHostOptions {
  docker: DockerApi;
  /** Identifiants du conteneur du serveur : exclus de tout. */
  selfIds?: readonly string[];
  /** Image du Kali créé (`REDWIDOW_KALI_IMAGE`). */
  kaliImage?: string;
  /** Réseau des outils (`REDWIDOW_TOOLS_NETWORK`), optionnel. */
  network?: string | undefined;
  /** Racine des dossiers partagés (`<données>/containers`). */
  containersRoot: string;
  /** Projets enregistrés (fiches) : nom du projet lié et projets de chaque dossier partagé. */
  projects?(): Promise<readonly StoredProject[]>;
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
      listManaged(this.options.docker, this.self, this.options.containersRoot),
      this.options.projects?.().catch((): readonly StoredProject[] => []) ?? [],
    ]);
    return rows.map((r) => {
      const linked = projects.find((p) => p.containers.includes(r.name));
      const inside =
        r.folder === undefined
          ? []
          : projectsInFolder(projects, this.options.containersRoot, r.folder).map((p) => ({
              id: p.id,
              name: p.name,
            }));
      return {
        id: r.id,
        name: r.name,
        image: r.image,
        state: r.running ? "running" : "stopped",
        kind: r.kind,
        ...(linked !== undefined && { project: linked.name }),
        ...(r.folder !== undefined && { folder: r.folder, projects: inside }),
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

  /**
   * Crée le dossier partagé du conteneur (racine RedWidow comprise), puis un Kali étiqueté qui le monte en
   * `/workspace` : aucun autre montage, ni privilège. Dossier déjà présent : `container.folderExists`, rien
   * n'est créé. Nom pris ou démon absent : le dossier tout juste créé est retiré (jamais un fichier : `discardFolder`).
   */
  async createKali(name: string): Promise<void> {
    if (!isContainerRef(name)) throw new CodedError("container.invalidName");
    const path = containerFolder(this.options.containersRoot, name);
    if (path === null) throw new CodedError("container.invalidName");
    await provisionFolder(this.options.containersRoot, name);
    try {
      await createKali(this.options.docker, {
        name,
        image: this.options.kaliImage ?? DEFAULT_KALI_IMAGE,
        network: this.options.network,
        workspace: { path, folder: name },
      });
    } catch (error) {
      // Seulement si le conteneur n'a sûrement pas été créé : sinon il garde son dossier (jamais perdu).
      if (
        error instanceof CodedError &&
        ["container.exists", "docker.unavailable"].includes(errorInfo(error).code)
      )
        await discardFolder(path);
      throw error;
    }
  }
}
