import {
  createDockerClient,
  createRecorder,
  type DockerClient,
  defaultConfigDir,
  type LabelPrefixContainer,
  readProjects,
  removeContainerAssociations,
  type StoredProject,
} from "@warband/core";
import { t } from "@warband/messages";

export interface ContainerRemovalConfirmation {
  name: string;
  state: "running" | "stopped";
  family: "exegol" | "kali";
  force: boolean;
  projects: readonly StoredProject[];
}

export type ContainerRemovalResult =
  | { status: "removed" | "cancelled"; name: string }
  | { status: "partial"; name: string; error: unknown };

type RemovalDocker = Pick<DockerClient, "listLabelPrefix" | "inspect" | "rm">;

function validatedRow(rows: LabelPrefixContainer[], name: string): LabelPrefixContainer {
  const matches = rows.filter((row) => row.name === name);
  const row = matches[0];
  if (
    matches.length !== 1 ||
    row === undefined ||
    (row.family !== "exegol" && row.family !== "kali") ||
    (row.state !== "running" && row.state !== "stopped")
  )
    throw new Error(t("Conteneur absent ou famille non autorisée."));
  return row;
}

export async function listedContainerIdentity(
  docker: Pick<DockerClient, "inspect">,
  row: LabelPrefixContainer,
): Promise<string> {
  const raw = await docker.inspect(row.name);
  if (!Array.isArray(raw) || raw.length !== 1) throw new Error(t("Identité Docker invalide."));
  const value = raw[0];
  if (
    value === null ||
    typeof value !== "object" ||
    typeof value.Id !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.Id) ||
    value.Name !== `/${row.name}` ||
    value.State?.Running !== (row.state === "running")
  )
    throw new Error(t("Identité ou état Docker modifié."));
  return value.Id;
}

/** Suppression humaine par ID ; aucun volume, image ou dossier hôte n'est supprimé. */
export async function removeListedContainer(
  name: string,
  deps: {
    confirm: (info: ContainerRemovalConfirmation) => Promise<boolean>;
    configDir?: string;
    createDocker?: () => RemovalDocker;
    cleanup?: typeof removeContainerAssociations;
    signal?: AbortSignal;
  },
): Promise<ContainerRemovalResult> {
  deps.signal?.throwIfAborted();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) throw new Error(t("Nom Docker invalide."));
  const configDir = deps.configDir ?? defaultConfigDir();
  // Refuser un fichier invalide avant toute action destructive.
  const file = await readProjects(configDir);
  const docker =
    deps.createDocker?.() ??
    createDockerClient({
      recorder: createRecorder(),
      binary: "docker",
      timeoutMs: 15_000,
    });
  const row = validatedRow(await docker.listLabelPrefix(), name);
  const id = await listedContainerIdentity(docker, row);
  const force = row.state === "running";
  if (
    !(await deps.confirm({
      name,
      family: row.family,
      state: row.state,
      force,
      projects: file?.projects.filter((project) => project.containers.includes(name)) ?? [],
    }))
  )
    return { status: "cancelled", name };
  const current = validatedRow(await docker.listLabelPrefix(), name);
  if (
    current.family !== row.family ||
    current.state !== row.state ||
    (await listedContainerIdentity(docker, current)) !== id
  ) {
    throw new Error(t("Le conteneur a changé depuis la confirmation ; recommencez."));
  }
  // Relire également la configuration avant Docker pour refuser une corruption concurrente.
  await readProjects(configDir);
  deps.signal?.throwIfAborted();
  await docker.rm(id, force ? { force: true } : {});
  try {
    await (deps.cleanup ?? removeContainerAssociations)(configDir, name);
  } catch (error) {
    // Le nettoyage peut être réessayé directement, sans supprimer un nouveau conteneur homonyme.
    return { status: "partial", name, error };
  }
  return { status: "removed", name };
}
