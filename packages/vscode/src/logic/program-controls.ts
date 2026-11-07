import {
  approveProgram,
  type Cited,
  clearPaceHalt,
  haltedPaceHosts,
  importProgramDraft,
  type ProgramPace,
  type ProgramState,
  type ProgramStatus,
  readProgram,
  suspendProgram,
} from "@warband/core";
import { t } from "@warband/messages";

/**
 * Contrôles de la fiche programme (ADR 0040) côté hôte de l'extension. Seul module autorisé à
 * appeler `approveProgram`, `suspendProgram`, `importProgramDraft` et `clearPaceHalt` : jamais importé par `engine/`
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
  /** Importe un brouillon (texte JSON) : n'approuve jamais, une approbation existante devient « modifiée ». */
  importDraft(text: string): Promise<ProgramView>;
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
    async importDraft(text) {
      await importProgramDraft(configDir, projectId, text);
      return view();
    },
    async resume(host) {
      const resumed = clearPaceHalt(configDir, projectId, host);
      return { resumed, view: await view() };
    },
  };
}

/** Messages acceptés depuis la webview de la fiche (non fiables) : aucun champ de donnée, jamais l'empreinte. */
export type ProgramMessage =
  | { type: "ready" | "refresh" | "validate" | "suspend" | "askAgent" | "importFile" }
  | { type: "resume"; host: string }
  | { type: "openCitation"; field: ProgramCitationField };

export type ProgramCitationField = "inScope" | "outOfScope" | "userAgentSuffix" | "pace";

const CITATION_FIELDS: readonly string[] = ["inScope", "outOfScope", "userAgentSuffix", "pace"];

export function parseProgramMessage(raw: unknown): ProgramMessage | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const keys = Object.keys(m);
  if (
    (m.type === "ready" ||
      m.type === "refresh" ||
      m.type === "validate" ||
      m.type === "suspend" ||
      m.type === "askAgent" ||
      m.type === "importFile") &&
    keys.length === 1
  )
    return { type: m.type };
  if (
    m.type === "resume" &&
    keys.length === 2 &&
    typeof m.host === "string" &&
    m.host.length > 0 &&
    m.host.length <= 253 &&
    !/[\p{Cc}\s]/u.test(m.host)
  )
    return { type: "resume", host: m.host };
  if (
    m.type === "openCitation" &&
    keys.length === 2 &&
    typeof m.field === "string" &&
    CITATION_FIELDS.includes(m.field)
  )
    return { type: "openCitation", field: m.field as ProgramCitationField };
  return null;
}

/** URL de citation de la vue affichée, seulement en http(s) ; la webview n'en fournit jamais. */
export function citationUrl(view: ProgramView, field: ProgramCitationField): string | null {
  const url = view[field]?.citation.url;
  if (url === undefined) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Taille maximale d'un fichier de fiche importé (octets) : une fiche est un petit JSON. */
export const PROGRAM_IMPORT_MAX_BYTES = 256 * 1024;

/**
 * Consigne envoyée au chat actif par « Demander à l'agent de rédiger la fiche ». Elle ne
 * demande que la rédaction du brouillon : la validation reste un geste humain de la page.
 */
export function programDraftPrompt(): string {
  return t(
    "Rédige la fiche programme du projet actif. Si tu n'as pas l'adresse de la page officielle du programme, demande-la-moi. Lis cette page avec read_url, puis appelle program_draft avec le périmètre, le hors périmètre, le rythme et le suffixe User-Agent, chacun cité depuis la page. Ne valide rien : je relirai le brouillon et je le validerai moi-même depuis la page Fiche programme.",
  );
}
