import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  activeProject,
  CodedError,
  deleteFinding,
  type Finding,
  projectFindingsPath,
  readFindings,
  readProjects,
  USER_PROJECT_FILE,
} from "@warband/core";
import { t } from "@warband/messages";

export interface FindingDeleteConfirmation {
  projectName: string;
  finding: Finding;
  dependentCount: number;
}

export interface FindingDeleteDependencies {
  confirm: (confirmation: FindingDeleteConfirmation) => Promise<boolean>;
  /** Inclut la génération du projet affiché et la validité du panneau demandeur. */
  isCurrent: () => boolean;
  signal?: AbortSignal;
}

export type FindingDeleteResult =
  | { status: "cancelled" }
  | { status: "deleted"; removed: Finding; detachedFrom: string[] };

/** Une confirmation ne peut pas autoriser une nouvelle version des éléments affichés. */
export class FindingDeleteChangedError extends Error {
  constructor() {
    super(t("Les éléments ont été modifiés ; recommencez la suppression."));
    this.name = "FindingDeleteChangedError";
  }
}

/** L'inode et les dates nanosecondes détectent aussi un aller-retour A → B → A sur disque. */
async function projectVersion(configDir: string): Promise<string> {
  try {
    const file = await stat(join(configDir, USER_PROJECT_FILE), { bigint: true });
    return [file.dev, file.ino, file.size, file.mtimeNs, file.ctimeNs].join(":");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new FindingDeleteChangedError();
    throw error;
  }
}

/** Confirmation native injectée ; aucun chemin ni libellé n'est fourni par la webview. */
export async function deleteSelectedFinding(
  configDir: string,
  projectId: string,
  id: string,
  deps: FindingDeleteDependencies,
): Promise<FindingDeleteResult> {
  // Valide l'UUID avant toute E/S, même pour un appel direct hors du parseur.
  projectFindingsPath(configDir, projectId);
  if (id.trim().length === 0 || id.length > 200 || /\p{Cc}/u.test(id)) {
    throw new CodedError("project.invalid", { reason: "json" });
  }
  if (deps.signal?.aborted) return { status: "cancelled" };
  if (!deps.isCurrent()) throw new FindingDeleteChangedError();
  const file = await readProjects(configDir);
  const project = file === null ? null : activeProject(file);
  if (project === null || project.id !== projectId) throw new CodedError("project.absent");
  const version = await projectVersion(configDir);
  const projectSnapshot = JSON.stringify(file);
  const findings = await readFindings(configDir, projectId);
  const finding = findings.find((row) => row.id === id);
  if (!finding) throw new CodedError("finding.notFound");
  const findingsSnapshot = JSON.stringify(findings);

  const validate = async () => {
    if (deps.signal?.aborted) deps.signal.throwIfAborted();
    const current = await readProjects(configDir);
    if (JSON.stringify(current) !== projectSnapshot) throw new FindingDeleteChangedError();
    const rows = await readFindings(configDir, projectId);
    if (JSON.stringify(rows) !== findingsSnapshot) throw new FindingDeleteChangedError();
    if ((await projectVersion(configDir)) !== version) throw new FindingDeleteChangedError();
    if (!deps.isCurrent()) throw new FindingDeleteChangedError();
    if (deps.signal?.aborted) deps.signal.throwIfAborted();
  };

  try {
    await validate();
    const confirmed = await deps.confirm({
      projectName: project.name,
      finding: { ...finding, ...(finding.from && { from: [...finding.from] }) },
      dependentCount: findings.filter((row) => row.from?.includes(id)).length,
    });
    if (!confirmed || deps.signal?.aborted) return { status: "cancelled" };
    await validate();
    const result = await deleteFinding(configDir, projectId, id, {
      ...(deps.signal && { signal: deps.signal }),
      beforeCommit: validate,
    });
    return { status: "deleted", ...result };
  } catch (error) {
    if (
      deps.signal?.aborted &&
      (error instanceof FindingDeleteChangedError ||
        (error instanceof Error && error.name === "AbortError"))
    )
      return { status: "cancelled" };
    if (error instanceof CodedError && error.code === "finding.notFound") {
      throw new FindingDeleteChangedError();
    }
    throw error;
  }
}
