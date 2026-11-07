import {
  approveProgram,
  type Cited,
  clearPaceHalt,
  haltedPaceHosts,
  type ProgramPace,
  type ProgramState,
  type ProgramStatus,
  readProgram,
  suspendProgram,
} from "@warband/core";

/**
 * Contrôles de la fiche programme (ADR 0040) côté hôte de l'extension. Seul module autorisé à
 * appeler `approveProgram`, `suspendProgram` et `clearPaceHalt` : jamais importé par `engine/`
 * ni exposé à un outil d'agent. La fiche est une donnée non fiable : la vue ne contient que des
 * valeurs brutes, le rendu se fait par `textContent`.
 */

/** Valeur citée, prête à afficher. `verified:false` : citation non recoupée par le moteur. */
export interface ProgramCitationView {
  quote: string;
  url: string;
  retrievedAt: string;
  verified: boolean;
}

export interface ProgramListView {
  values: string[];
  citation: ProgramCitationView;
}

export interface ProgramView {
  state: ProgramState;
  /** Empreinte du brouillon courant : celle que la modale de validation affiche. */
  digest?: string;
  approvedAt?: string;
  suspendedAt?: string;
  inScope: ProgramListView | null;
  outOfScope: ProgramListView | null;
  userAgentSuffix: { value: string; citation: ProgramCitationView } | null;
  pace: { value: ProgramPace; citation: ProgramCitationView } | null;
  haltedHosts: string[];
  /** Validation possible : brouillon lisible et pas déjà appliqué. */
  canValidate: boolean;
  /** Suspension possible : fiche appliquée. */
  canSuspend: boolean;
}

const citation = (c: Cited<unknown>): ProgramCitationView => ({
  quote: c.quote,
  url: c.url,
  retrievedAt: c.retrievedAt,
  verified: c.verified,
});

/** Construit la vue (pure) depuis l'état de la fiche et la liste des hôtes arrêtés. */
export function buildProgramView(
  status: ProgramStatus,
  haltedHosts: readonly string[],
): ProgramView {
  const sheet = status.draft;
  const view: ProgramView = {
    state: status.state,
    inScope: sheet ? { values: [...sheet.inScope.value], citation: citation(sheet.inScope) } : null,
    outOfScope: sheet
      ? { values: [...sheet.outOfScope.value], citation: citation(sheet.outOfScope) }
      : null,
    userAgentSuffix: sheet?.userAgentSuffix
      ? { value: sheet.userAgentSuffix.value, citation: citation(sheet.userAgentSuffix) }
      : null,
    pace: sheet ? { value: sheet.pace.value, citation: citation(sheet.pace) } : null,
    haltedHosts: [...haltedHosts],
    canValidate:
      status.digest !== undefined &&
      (status.state === "draft" || status.state === "invalidated" || status.state === "suspended"),
    canSuspend: status.state === "approved",
  };
  if (status.digest !== undefined) view.digest = status.digest;
  if (status.approvedAt !== undefined) view.approvedAt = status.approvedAt;
  if (status.suspendedAt !== undefined) view.suspendedAt = status.suspendedAt;
  return view;
}

export interface ProgramControls {
  view(): Promise<ProgramView>;
  /** Approuve le brouillon dont l'empreinte a été affichée ; empreinte périmée → rejet, rien n'est écrit. */
  validate(displayedDigest: string): Promise<ProgramView>;
  suspend(): Promise<ProgramView>;
  /** Retire un hôte arrêté ; `false` s'il n'y figurait pas. */
  resume(host: string): Promise<{ resumed: boolean; view: ProgramView }>;
}

export function createProgramControls(configDir: string, projectId: string): ProgramControls {
  const view = async (): Promise<ProgramView> =>
    buildProgramView(
      await readProgram(configDir, projectId),
      haltedPaceHosts(configDir, projectId),
    );
  return {
    view,
    async validate(displayedDigest) {
      await approveProgram(configDir, projectId, displayedDigest);
      return view();
    },
    async suspend() {
      await suspendProgram(configDir, projectId);
      return view();
    },
    async resume(host) {
      const resumed = clearPaceHalt(configDir, projectId, host);
      return { resumed, view: await view() };
    },
  };
}
