import { projectEngagementApprovalPath, projectEngagementPath } from "../project.js";
import { CodedError, type Reason, reason } from "../reason.js";
import { readIfExists, readIfExistsSync, writePrivate } from "./private-file.js";
import {
  canonicalEngagement,
  type EngagementSheet,
  engagementDigest,
  parseEngagementSheet,
} from "./sheet.js";

/** Approbation : empreinte du contenu canonique validé, date, et suspension éventuelle. */
export interface EngagementApproval {
  version: 1;
  digest: string;
  approvedAt: string;
  suspendedAt?: string;
}

/**
 * État de la fiche d'un projet.
 * - `none` : aucun brouillon ; `draft` : brouillon jamais approuvé ;
 * - `approved` : empreinte = contenu courant (seul état où la fiche s'applique) ;
 * - `suspended` : approbation suspendue, fiche conservée ;
 * - `invalidated` : contenu modifié depuis l'approbation ;
 * - `unreadable` : approbation ou brouillon illisible alors qu'une approbation existe.
 */
export type EngagementState =
  | "none"
  | "draft"
  | "approved"
  | "suspended"
  | "invalidated"
  | "unreadable";

export interface EngagementStatus {
  state: EngagementState;
  /** Fiche du brouillon courant, si lisible (présente même si non appliquée). */
  draft?: EngagementSheet;
  /** Empreinte du brouillon courant, si lisible. */
  digest?: string;
  /** Empreinte approuvée, si une approbation lisible existe. */
  approvedDigest?: string;
  approvedAt?: string;
  suspendedAt?: string;
  /** Fiche appliquée : seulement dans l'état `approved`. */
  applied?: EngagementSheet;
  /** Pourquoi le brouillon ou l'approbation est illisible. */
  problem?: Reason;
}

function parseApproval(text: string): EngagementApproval {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const ok =
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    raw.version === 1 &&
    typeof raw.digest === "string" &&
    /^[0-9a-f]{64}$/.test(raw.digest) &&
    typeof raw.approvedAt === "string" &&
    (raw.suspendedAt === undefined || typeof raw.suspendedAt === "string") &&
    Object.keys(raw).every((k) => ["version", "digest", "approvedAt", "suspendedAt"].includes(k));
  if (!ok) throw new CodedError("engagement.unreadable", { part: "approval" });
  return raw as unknown as EngagementApproval;
}

/**
 * Calcul pur de l'état effectif à partir des textes lus (une seule lecture : la fiche
 * appliquée est celle dont l'empreinte a été comparée, jamais une seconde lecture).
 */
export function evaluateEngagementStatus(
  draftText: string | null,
  approvalText: string | null,
): EngagementStatus {
  let draft: EngagementSheet | undefined;
  let draftProblem: Reason | undefined;
  if (draftText !== null) {
    try {
      draft = parseEngagementSheet(JSON.parse(draftText));
    } catch {
      draftProblem = reason("engagement.unreadable", { part: "draft" });
    }
  }
  const digest = draft && engagementDigest(draft);
  const base: EngagementStatus = {
    state: "none",
    ...(draft && { draft }),
    ...(digest !== undefined && { digest }),
    ...(draftProblem && { problem: draftProblem }),
  };

  if (approvalText === null) return { ...base, state: draftText === null ? "none" : "draft" };

  let approval: EngagementApproval;
  try {
    approval = parseApproval(approvalText);
  } catch {
    return {
      ...base,
      state: "unreadable",
      problem: reason("engagement.unreadable", { part: "approval" }),
    };
  }
  const approved = {
    ...base,
    approvedDigest: approval.digest,
    approvedAt: approval.approvedAt,
    ...(approval.suspendedAt !== undefined && { suspendedAt: approval.suspendedAt }),
  };
  if (approval.suspendedAt !== undefined) return { ...approved, state: "suspended" };
  if (draft === undefined || digest === undefined) {
    return {
      ...approved,
      state: "unreadable",
      problem: draftProblem ?? reason("engagement.unreadable", { part: "draft" }),
    };
  }
  if (digest !== approval.digest) return { ...approved, state: "invalidated" };
  return { ...approved, state: "approved", applied: draft };
}

/** État effectif de la fiche. Id non UUID → `project.invalid`. Lecture seule. */
export async function readEngagement(
  configDir: string,
  projectId: string,
): Promise<EngagementStatus> {
  const draftPath = projectEngagementPath(configDir, projectId);
  const approvalPath = projectEngagementApprovalPath(configDir, projectId);
  const [draftText, approvalText] = await Promise.all([
    readIfExists(draftPath),
    readIfExists(approvalPath),
  ]);
  return evaluateEngagementStatus(draftText, approvalText);
}

/** Variante synchrone (bureau de mission, dont `context()` est synchrone). Même règles. */
export function readEngagementSync(configDir: string, projectId: string): EngagementStatus {
  const draftPath = projectEngagementPath(configDir, projectId);
  const approvalPath = projectEngagementApprovalPath(configDir, projectId);
  return evaluateEngagementStatus(readIfExistsSync(draftPath), readIfExistsSync(approvalPath));
}

/**
 * Importe un brouillon (texte JSON). Il est validé en forme, puis écrit tel quel dans sa forme
 * canonique lisible. **Importer n'approuve rien** : une approbation existante devient
 * `invalidated` si le contenu change. Brouillon invalide → `engagement.invalid`, rien d'écrit.
 */
export async function importEngagementDraft(
  configDir: string,
  projectId: string,
  text: string,
): Promise<EngagementStatus> {
  const path = projectEngagementPath(configDir, projectId);
  let sheet: EngagementSheet;
  try {
    sheet = parseEngagementSheet(JSON.parse(text));
  } catch (err) {
    if (err instanceof CodedError) throw err;
    throw new CodedError("engagement.invalid", { field: "json" });
  }
  await writePrivate(path, `${JSON.stringify(JSON.parse(canonicalEngagement(sheet)), null, 2)}\n`);
  return readEngagement(configDir, projectId);
}

/**
 * Approuve le brouillon courant : écrit son empreinte et la date. Réservé à la CLI (puis à
 * l'interface) : aucun outil d'agent ne l'appelle. Brouillon absent ou illisible →
 * `engagement.absent` / `engagement.unreadable`.
 */
export async function approveEngagement(
  configDir: string,
  projectId: string,
  expectedDigest: string | undefined,
  now: () => Date = () => new Date(),
): Promise<EngagementStatus> {
  if (expectedDigest === undefined || expectedDigest === "") {
    throw new CodedError("engagement.digestRequired");
  }
  const current = await readEngagement(configDir, projectId);
  if (current.state === "none") throw new CodedError("engagement.absent");
  if (current.draft === undefined || current.digest === undefined) {
    throw new CodedError("engagement.unreadable", { part: "draft" });
  }
  // L'humain approuve ce qu'il a lu : si le brouillon a changé depuis, rien n'est écrit.
  if (current.digest !== expectedDigest.trim().toLowerCase()) {
    throw new CodedError("engagement.digestMismatch", {
      expected: expectedDigest,
      actual: current.digest,
    });
  }
  const approval: EngagementApproval = {
    version: 1,
    digest: current.digest,
    approvedAt: now().toISOString(),
  };
  await writePrivate(
    projectEngagementApprovalPath(configDir, projectId),
    `${JSON.stringify(approval, null, 2)}\n`,
  );
  return readEngagement(configDir, projectId);
}

/**
 * Suspend la fiche : la fiche cesse de s'appliquer, elle et son empreinte sont
 * conservées. Sans approbation → `engagement.absent`. Réapprouver lève la suspension.
 */
export async function suspendEngagement(
  configDir: string,
  projectId: string,
  now: () => Date = () => new Date(),
): Promise<EngagementStatus> {
  const path = projectEngagementApprovalPath(configDir, projectId);
  const text = await readIfExists(path);
  if (text === null) throw new CodedError("engagement.absent");
  const approval = parseApproval(text);
  const suspended: EngagementApproval = {
    ...approval,
    suspendedAt: approval.suspendedAt ?? now().toISOString(),
  };
  await writePrivate(path, `${JSON.stringify(suspended, null, 2)}\n`);
  return readEngagement(configDir, projectId);
}
