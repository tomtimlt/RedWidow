import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { projectProgramApprovalPath, projectProgramPath, renameWithRetry } from "../project.js";
import { CodedError, type Reason, reason } from "../reason.js";
import { canonicalProgram, type ProgramSheet, parseProgramSheet, programDigest } from "./sheet.js";

/** Approbation : empreinte du contenu canonique validé, date, et suspension éventuelle. */
export interface ProgramApproval {
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
export type ProgramState =
  | "none"
  | "draft"
  | "approved"
  | "suspended"
  | "invalidated"
  | "unreadable";

export interface ProgramStatus {
  state: ProgramState;
  /** Fiche du brouillon courant, si lisible (présente même si non appliquée). */
  draft?: ProgramSheet;
  /** Empreinte du brouillon courant, si lisible. */
  digest?: string;
  /** Empreinte approuvée, si une approbation lisible existe. */
  approvedDigest?: string;
  approvedAt?: string;
  suspendedAt?: string;
  /** Fiche appliquée : seulement dans l'état `approved`. */
  applied?: ProgramSheet;
  /** Pourquoi le brouillon ou l'approbation est illisible. */
  problem?: Reason;
}

const isMissing = (err: unknown) => (err as NodeJS.ErrnoException).code === "ENOENT";

const readIfExists = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
};

const readIfExistsSync = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
};

function parseApproval(text: string): ProgramApproval {
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
  if (!ok) throw new CodedError("program.unreadable", { part: "approval" });
  return raw as unknown as ProgramApproval;
}

/**
 * Calcul pur de l'état effectif à partir des textes lus (une seule lecture : la fiche
 * appliquée est celle dont l'empreinte a été comparée, jamais une seconde lecture).
 */
export function evaluateProgramStatus(
  draftText: string | null,
  approvalText: string | null,
): ProgramStatus {
  let draft: ProgramSheet | undefined;
  let draftProblem: Reason | undefined;
  if (draftText !== null) {
    try {
      draft = parseProgramSheet(JSON.parse(draftText));
    } catch {
      draftProblem = reason("program.unreadable", { part: "draft" });
    }
  }
  const digest = draft && programDigest(draft);
  const base: ProgramStatus = {
    state: "none",
    ...(draft && { draft }),
    ...(digest !== undefined && { digest }),
    ...(draftProblem && { problem: draftProblem }),
  };

  if (approvalText === null) return { ...base, state: draftText === null ? "none" : "draft" };

  let approval: ProgramApproval;
  try {
    approval = parseApproval(approvalText);
  } catch {
    return {
      ...base,
      state: "unreadable",
      problem: reason("program.unreadable", { part: "approval" }),
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
      problem: draftProblem ?? reason("program.unreadable", { part: "draft" }),
    };
  }
  if (digest !== approval.digest) return { ...approved, state: "invalidated" };
  return { ...approved, state: "approved", applied: draft };
}

/** État effectif de la fiche. Id non UUID → `project.invalid`. Lecture seule. */
export async function readProgram(configDir: string, projectId: string): Promise<ProgramStatus> {
  const draftPath = projectProgramPath(configDir, projectId);
  const approvalPath = projectProgramApprovalPath(configDir, projectId);
  const [draftText, approvalText] = await Promise.all([
    readIfExists(draftPath),
    readIfExists(approvalPath),
  ]);
  return evaluateProgramStatus(draftText, approvalText);
}

/** Variante synchrone (bureau de mission, dont `context()` est synchrone). Même règles. */
export function readProgramSync(configDir: string, projectId: string): ProgramStatus {
  const draftPath = projectProgramPath(configDir, projectId);
  const approvalPath = projectProgramApprovalPath(configDir, projectId);
  return evaluateProgramStatus(readIfExistsSync(draftPath), readIfExistsSync(approvalPath));
}

/** Écriture atomique (temporaire exclusif puis renommage), mode 0o600. */
async function writePrivate(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await renameWithRetry(temp, path);
  } catch (err) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw err;
  }
  await chmod(path, 0o600);
}

/**
 * Importe un brouillon (texte JSON). Il est validé en forme, puis écrit tel quel dans sa forme
 * canonique lisible. **Importer n'approuve rien** : une approbation existante devient
 * `invalidated` si le contenu change. Brouillon invalide → `program.invalid`, rien d'écrit.
 */
export async function importProgramDraft(
  configDir: string,
  projectId: string,
  text: string,
): Promise<ProgramStatus> {
  const path = projectProgramPath(configDir, projectId);
  let sheet: ProgramSheet;
  try {
    sheet = parseProgramSheet(JSON.parse(text));
  } catch (err) {
    if (err instanceof CodedError) throw err;
    throw new CodedError("program.invalid", { field: "json" });
  }
  await writePrivate(path, `${JSON.stringify(JSON.parse(canonicalProgram(sheet)), null, 2)}\n`);
  return readProgram(configDir, projectId);
}

/**
 * Écriture du brouillon demandée par l'outil d'agent `program_draft` : même effet que l'import
 * (aucune approbation, toute modification invalide l'approbation existante). Sans projet actif
 * (`projectId` nul) → `project.absent`.
 */
export async function writeProgramDraft(
  configDir: string,
  projectId: string | null,
  text: string,
): Promise<ProgramStatus> {
  if (projectId === null) throw new CodedError("project.absent");
  return importProgramDraft(configDir, projectId, text);
}

/**
 * Approuve le brouillon courant : écrit son empreinte et la date. Réservé à la CLI (puis à
 * l'interface) : aucun outil d'agent ne l'appelle. Brouillon absent ou illisible →
 * `program.absent` / `program.unreadable`.
 */
export async function approveProgram(
  configDir: string,
  projectId: string,
  expectedDigest: string | undefined,
  now: () => Date = () => new Date(),
): Promise<ProgramStatus> {
  if (expectedDigest === undefined || expectedDigest === "") {
    throw new CodedError("program.digestRequired");
  }
  const current = await readProgram(configDir, projectId);
  if (current.state === "none") throw new CodedError("program.absent");
  if (current.draft === undefined || current.digest === undefined) {
    throw new CodedError("program.unreadable", { part: "draft" });
  }
  // L'humain approuve ce qu'il a lu : si le brouillon a changé depuis, rien n'est écrit.
  if (current.digest !== expectedDigest.trim().toLowerCase()) {
    throw new CodedError("program.digestMismatch", {
      expected: expectedDigest,
      actual: current.digest,
    });
  }
  const approval: ProgramApproval = {
    version: 1,
    digest: current.digest,
    approvedAt: now().toISOString(),
  };
  await writePrivate(
    projectProgramApprovalPath(configDir, projectId),
    `${JSON.stringify(approval, null, 2)}\n`,
  );
  return readProgram(configDir, projectId);
}

/**
 * Suspend la fiche : le projet revient au profil généraliste, la fiche et son empreinte sont
 * conservées. Sans approbation → `program.absent`. Réapprouver lève la suspension.
 */
export async function suspendProgram(
  configDir: string,
  projectId: string,
  now: () => Date = () => new Date(),
): Promise<ProgramStatus> {
  const path = projectProgramApprovalPath(configDir, projectId);
  const text = await readIfExists(path);
  if (text === null) throw new CodedError("program.absent");
  const approval = parseApproval(text);
  const suspended: ProgramApproval = {
    ...approval,
    suspendedAt: approval.suspendedAt ?? now().toISOString(),
  };
  await writePrivate(path, `${JSON.stringify(suspended, null, 2)}\n`);
  return readProgram(configDir, projectId);
}
