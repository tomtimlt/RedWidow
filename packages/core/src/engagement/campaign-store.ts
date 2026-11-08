import { projectCampaignApprovalPath, projectCampaignPath } from "../project.js";
import { CodedError, type Reason, reason } from "../reason.js";
import { type CampaignPlan, campaignDigest, canonicalCampaign, parseCampaignPlan } from "./plan.js";
import { readIfExists, readIfExistsSync, writePrivate } from "./private-file.js";

/** Approbation : empreinte du contenu canonique validé, date, et suspension éventuelle. */
export interface CampaignApproval {
  version: 1;
  digest: string;
  approvedAt: string;
  suspendedAt?: string;
}

/**
 * État du plan de campagne d'un projet.
 * - `none` : aucun brouillon ; `draft` : brouillon jamais approuvé ;
 * - `approved` : empreinte = contenu courant (seul état où le plan s'applique) ;
 * - `suspended` : approbation suspendue, plan conservé ;
 * - `invalidated` : contenu modifié depuis l'approbation ;
 * - `unreadable` : approbation ou brouillon illisible alors qu'une approbation existe.
 */
export type CampaignState =
  | "none"
  | "draft"
  | "approved"
  | "suspended"
  | "invalidated"
  | "unreadable";

export interface CampaignStatus {
  state: CampaignState;
  /** Plan du brouillon courant, si lisible (présent même si non appliqué). */
  draft?: CampaignPlan;
  /** Empreinte du brouillon courant, si lisible. */
  digest?: string;
  /** Empreinte approuvée, si une approbation lisible existe. */
  approvedDigest?: string;
  approvedAt?: string;
  suspendedAt?: string;
  /** Plan appliqué : seulement dans l'état `approved`. */
  applied?: CampaignPlan;
  /** Pourquoi le brouillon ou l'approbation est illisible. */
  problem?: Reason;
}

function parseCampaignApproval(text: string): CampaignApproval {
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
  if (!ok) throw new CodedError("campaign.unreadable", { part: "approval" });
  return raw as unknown as CampaignApproval;
}

/**
 * Calcul pur de l'état effectif à partir des textes lus (une seule lecture : le plan
 * appliqué est celui dont l'empreinte a été comparée, jamais une seconde lecture).
 */
export function evaluateCampaignStatus(
  draftText: string | null,
  approvalText: string | null,
): CampaignStatus {
  let draft: CampaignPlan | undefined;
  let draftProblem: Reason | undefined;
  if (draftText !== null) {
    try {
      draft = parseCampaignPlan(JSON.parse(draftText));
    } catch {
      draftProblem = reason("campaign.unreadable", { part: "draft" });
    }
  }
  const digest = draft && campaignDigest(draft);
  const base: CampaignStatus = {
    state: "none",
    ...(draft && { draft }),
    ...(digest !== undefined && { digest }),
    ...(draftProblem && { problem: draftProblem }),
  };

  if (approvalText === null) return { ...base, state: draftText === null ? "none" : "draft" };

  let approval: CampaignApproval;
  try {
    approval = parseCampaignApproval(approvalText);
  } catch {
    return {
      ...base,
      state: "unreadable",
      problem: reason("campaign.unreadable", { part: "approval" }),
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
      problem: draftProblem ?? reason("campaign.unreadable", { part: "draft" }),
    };
  }
  if (digest !== approval.digest) return { ...approved, state: "invalidated" };
  return { ...approved, state: "approved", applied: draft };
}

/** État effectif du plan. Id non UUID → `project.invalid`. Lecture seule. */
export async function readCampaign(configDir: string, projectId: string): Promise<CampaignStatus> {
  const draftPath = projectCampaignPath(configDir, projectId);
  const approvalPath = projectCampaignApprovalPath(configDir, projectId);
  const [draftText, approvalText] = await Promise.all([
    readIfExists(draftPath),
    readIfExists(approvalPath),
  ]);
  return evaluateCampaignStatus(draftText, approvalText);
}

/** Variante synchrone (bureau de mission, dont `context()` est synchrone). Même règles. */
export function readCampaignSync(configDir: string, projectId: string): CampaignStatus {
  const draftPath = projectCampaignPath(configDir, projectId);
  const approvalPath = projectCampaignApprovalPath(configDir, projectId);
  return evaluateCampaignStatus(readIfExistsSync(draftPath), readIfExistsSync(approvalPath));
}

/**
 * Importe un brouillon (texte JSON). Il est validé en forme, puis écrit tel quel dans sa forme
 * canonique lisible. **Importer n'approuve rien** : une approbation existante devient
 * `invalidated` si le contenu change. Brouillon invalide → `campaign.invalid`, rien d'écrit.
 */
export async function importCampaignDraft(
  configDir: string,
  projectId: string,
  text: string,
): Promise<CampaignStatus> {
  const path = projectCampaignPath(configDir, projectId);
  let plan: CampaignPlan;
  try {
    plan = parseCampaignPlan(JSON.parse(text));
  } catch (err) {
    if (err instanceof CodedError) throw err;
    throw new CodedError("campaign.invalid", { field: "json" });
  }
  await writePrivate(path, `${JSON.stringify(JSON.parse(canonicalCampaign(plan)), null, 2)}\n`);
  return readCampaign(configDir, projectId);
}

/**
 * Approuve le brouillon courant : écrit son empreinte et la date. Réservé à la CLI (puis à
 * l'interface) : aucun outil d'agent ne l'appelle. Brouillon absent ou illisible →
 * `campaign.absent` / `campaign.unreadable`.
 */
export async function approveCampaign(
  configDir: string,
  projectId: string,
  expectedDigest: string | undefined,
  now: () => Date = () => new Date(),
): Promise<CampaignStatus> {
  if (expectedDigest === undefined || expectedDigest === "") {
    throw new CodedError("campaign.digestRequired");
  }
  const current = await readCampaign(configDir, projectId);
  if (current.state === "none") throw new CodedError("campaign.absent");
  if (current.draft === undefined || current.digest === undefined) {
    throw new CodedError("campaign.unreadable", { part: "draft" });
  }
  // L'humain approuve ce qu'il a lu : si le brouillon a changé depuis, rien n'est écrit.
  if (current.digest !== expectedDigest.trim().toLowerCase()) {
    throw new CodedError("campaign.digestMismatch", {
      expected: expectedDigest,
      actual: current.digest,
    });
  }
  const approval: CampaignApproval = {
    version: 1,
    digest: current.digest,
    approvedAt: now().toISOString(),
  };
  await writePrivate(
    projectCampaignApprovalPath(configDir, projectId),
    `${JSON.stringify(approval, null, 2)}\n`,
  );
  return readCampaign(configDir, projectId);
}

/**
 * Suspend le plan : le plan cesse de s'appliquer, lui et son empreinte sont
 * conservés. Sans approbation → `campaign.absent`. Réapprouver lève la suspension.
 */
export async function suspendCampaign(
  configDir: string,
  projectId: string,
  now: () => Date = () => new Date(),
): Promise<CampaignStatus> {
  const path = projectCampaignApprovalPath(configDir, projectId);
  const text = await readIfExists(path);
  if (text === null) throw new CodedError("campaign.absent");
  const approval = parseCampaignApproval(text);
  const suspended: CampaignApproval = {
    ...approval,
    suspendedAt: approval.suspendedAt ?? now().toISOString(),
  };
  await writePrivate(path, `${JSON.stringify(suspended, null, 2)}\n`);
  return readCampaign(configDir, projectId);
}
