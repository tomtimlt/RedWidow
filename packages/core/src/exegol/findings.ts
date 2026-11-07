import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout } from "node:timers/promises";
import { listEvidence } from "../evidence.js";
import { projectFindingsPath } from "../project.js";
import { CodedError } from "../reason.js";
import { createRedactor, secretsFromEnv } from "../redact.js";

export const USER_FINDINGS_FILE = "findings.json";

export const FINDING_KINDS = ["host", "credential", "site", "step", "loot"] as const;
export const FINDING_STATES = ["confirmed", "hypothesis", "failed"] as const;

export const MITRE_TACTICS = [
  "TA0043",
  "TA0042",
  "TA0001",
  "TA0002",
  "TA0003",
  "TA0004",
  "TA0005",
  "TA0006",
  "TA0007",
  "TA0008",
  "TA0009",
  "TA0011",
  "TA0010",
  "TA0040",
] as const;

export type MitreTactic = (typeof MITRE_TACTICS)[number];

export const TECHNIQUE_PATTERN = /^T\d{4}(\.\d{3})?$/;

export type FindingKind = (typeof FINDING_KINDS)[number];
export type FindingState = (typeof FINDING_STATES)[number];

export interface Finding {
  id: string;
  kind: FindingKind;
  label: string;
  state: FindingState;
  tactic?: MitreTactic;
  technique?: string;
  from?: string[];
  /** Parents appartenant au chemin retenu ; annotation, pas une preuve de réussite. */
  pathFrom?: string[];
  evidenceIds?: string[];
}

const MAX_FROM = 8;
const EVIDENCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function validEvidenceIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 20 &&
    value.every((id) => typeof id === "string" && EVIDENCE_ID.test(id)) &&
    new Set(value).size === value.length
  );
}
async function validateEvidenceLinks(
  configDir: string,
  projectId: string,
  ids: string[],
): Promise<void> {
  if (!validEvidenceIds(ids)) throw invalid();
  if (!ids.length) return;
  const known = new Set((await listEvidence(configDir, projectId)).map((row) => row.id));
  if (ids.some((id) => !known.has(id))) throw invalid();
}
const redactLabel = (label: string) => createRedactor({ values: secretsFromEnv() })(label);

export const FINDING_MAX_LABEL = 200;
const MAX_FINDINGS = 200;

function invalid() {
  return new CodedError("project.invalid", { reason: "json" });
}

/** Retire des `from`/`pathFrom` toute référence à un id absent de la liste (réconciliation). */
function reconcileParents(findings: Finding[], removed: ReadonlySet<string>): Finding[] {
  return findings.map((finding) => {
    if (!finding.from?.some((parent) => removed.has(parent))) return finding;
    const child = { ...finding };
    const from = finding.from.filter((parent) => !removed.has(parent));
    if (child.pathFrom) {
      const pathFrom = child.pathFrom.filter((parent) => !removed.has(parent));
      if (pathFrom.length) child.pathFrom = pathFrom;
      else delete child.pathFrom;
    }
    if (from.length) child.from = from;
    else delete child.from;
    return child;
  });
}

function isKind(v: unknown): v is FindingKind {
  return typeof v === "string" && (FINDING_KINDS as readonly string[]).includes(v);
}

function isState(v: unknown): v is FindingState {
  return typeof v === "string" && (FINDING_STATES as readonly string[]).includes(v);
}

function isTactic(v: unknown): v is MitreTactic {
  return typeof v === "string" && (MITRE_TACTICS as readonly string[]).includes(v);
}

function isTechnique(v: unknown): v is string {
  return typeof v === "string" && TECHNIQUE_PATTERN.test(v);
}

/** Valide un tableau `from` stocké : 1 à 8 ids non vides, sans doublon. */
function validFrom(v: unknown): v is string[] {
  return (
    Array.isArray(v) &&
    v.length >= 1 &&
    v.length <= MAX_FROM &&
    v.every((x) => typeof x === "string" && x !== "") &&
    new Set(v).size === v.length
  );
}

/** Lit les trouvailles du projet. Id invalide : `project.invalid` avant toute lecture. Fichier absent : liste vide. */
export async function readFindings(configDir: string, projectId: string): Promise<Finding[]> {
  const path = projectFindingsPath(configDir, projectId);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalid();
  }
  if (!Array.isArray(parsed)) throw invalid();
  return parsed.map((row) => {
    if (typeof row !== "object" || row === null) throw invalid();
    const rec = row as Record<string, unknown>;
    if (typeof rec.id !== "string" || rec.id === "") throw invalid();
    if (!isKind(rec.kind) || !isState(rec.state)) throw invalid();
    if (typeof rec.label !== "string" || rec.label === "" || rec.label.length > FINDING_MAX_LABEL) {
      throw invalid();
    }
    const finding: Finding = {
      id: rec.id,
      kind: rec.kind,
      label: redactLabel(rec.label),
      state: rec.state,
    };
    if (rec.tactic !== undefined) {
      if (!isTactic(rec.tactic)) throw invalid();
      finding.tactic = rec.tactic;
    }
    if (rec.technique !== undefined) {
      if (!isTechnique(rec.technique)) throw invalid();
      finding.technique = rec.technique;
    }
    if (rec.from !== undefined) {
      if (!validFrom(rec.from)) throw invalid();
      finding.from = [...rec.from];
    }
    if (rec.pathFrom !== undefined) {
      if (!validFrom(rec.pathFrom) || !rec.pathFrom.every((id) => finding.from?.includes(id)))
        throw invalid();
      finding.pathFrom = [...rec.pathFrom];
    }
    if (rec.evidenceIds !== undefined) {
      if (!validEvidenceIds(rec.evidenceIds)) throw invalid();
      finding.evidenceIds = [...rec.evidenceIds];
    }
    return finding;
  });
}

/** Options réservées aux appelants de confiance, jamais au modèle. */
export interface FindingMutationOptions {
  signal?: AbortSignal;
  /** Revalide le contexte sous verrou, juste avant l’écriture. Lever une erreur annule l’opération. */
  beforeCommit?: () => void | Promise<void>;
}

/** Sérialise les mutations entre processus. Un verrou laissé par un crash exige une récupération explicite. */
async function withFindingsLock<T>(
  path: string,
  options: FindingMutationOptions,
  mutate: () => Promise<T>,
): Promise<T> {
  options.signal?.throwIfAborted();
  await mkdir(dirname(path), { recursive: true });
  const lock = `${path}.lock`;
  const deadline = Date.now() + 3_000;
  let handle: Awaited<ReturnType<typeof open>>;
  for (;;) {
    options.signal?.throwIfAborted();
    try {
      handle = await open(lock, "wx", 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new CodedError("finding.busy");
      await setTimeout(Math.min(25, remaining), undefined, { signal: options.signal });
    }
  }
  try {
    options.signal?.throwIfAborted();
    return await mutate();
  } finally {
    try {
      await handle.close();
    } finally {
      await unlink(lock);
    }
  }
}

async function commitFindings(
  path: string,
  findings: Finding[],
  options: FindingMutationOptions,
): Promise<void> {
  options.signal?.throwIfAborted();
  await persistFindings(path, findings, options);
}

function uniqueFindingIndex(current: Finding[], id: string): number {
  const index = current.findIndex((finding) => finding.id === id);
  if (index < 0) throw new CodedError("finding.notFound");
  if (current.some((finding, other) => other !== index && finding.id === id)) throw invalid();
  return index;
}

/** Ajoute une trouvaille. Au-delà du plafond, la plus ancienne sort. */
export async function appendFinding(
  configDir: string,
  projectId: string,
  input: {
    kind: FindingKind;
    label: string;
    state: FindingState;
    tactic?: MitreTactic | undefined;
    technique?: string | undefined;
    from?: string[] | undefined;
    evidenceIds?: string[] | undefined;
  },
  options: FindingMutationOptions = {},
): Promise<Finding> {
  const path = projectFindingsPath(configDir, projectId);
  const label = redactLabel(input.label.trim());
  if (label === "" || label.length > FINDING_MAX_LABEL) {
    throw new CodedError("finding.labelInvalid", { max: FINDING_MAX_LABEL });
  }
  if (!isKind(input.kind) || !isState(input.state)) throw invalid();
  if (input.tactic !== undefined && !isTactic(input.tactic)) throw invalid();
  if (input.technique !== undefined && !isTechnique(input.technique)) throw invalid();
  const from = input.from === undefined ? [] : [...new Set(input.from)];
  if (from.length > MAX_FROM) throw invalid();
  return withFindingsLock(path, options, async () => {
    const current = await readFindings(configDir, projectId);
    if (input.evidenceIds !== undefined)
      await validateEvidenceLinks(configDir, projectId, input.evidenceIds);
    const known = new Set(current.map((f) => f.id));
    const unknown = from.filter((id) => !known.has(id));
    if (unknown.length) throw new CodedError("finding.parentUnknown", { ids: unknown.join(", ") });
    const finding: Finding = { id: randomUUID(), kind: input.kind, label, state: input.state };
    if (input.tactic !== undefined) finding.tactic = input.tactic;
    if (input.technique !== undefined) finding.technique = input.technique;
    if (from.length > 0) finding.from = from;
    if (input.evidenceIds?.length) finding.evidenceIds = [...input.evidenceIds];
    const all = [...current, finding];
    const kept = all.slice(-MAX_FINDINGS);
    // Aucune note ne garde un parent évincé : on réconcilie les liens restants.
    const evicted = new Set(all.slice(0, all.length - kept.length).map((f) => f.id));
    const next = evicted.size ? reconcileParents(kept, evicted) : kept;
    await commitFindings(path, next, options);
    return finding;
  });
}

/** Champs modifiables ; null efface les métadonnées MITRE, [] efface les parents. */
export interface FindingPatch {
  kind?: FindingKind;
  label?: string;
  state?: FindingState;
  tactic?: MitreTactic | null;
  technique?: string | null;
  from?: string[];
  pathFrom?: string[];
  evidenceIds?: string[];
}

/** Remplace atomiquement le fichier, avec un temporaire exclusif propre à cet appel. */
async function persistFindings(
  path: string,
  findings: Finding[],
  options: FindingMutationOptions,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(findings, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    options.signal?.throwIfAborted();
    await options.beforeCommit?.();
    options.signal?.throwIfAborted();
    await rename(temp, path);
  } finally {
    await unlink(temp).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

/** Modifie une trouvaille du seul projet désigné, sans changer son id. */
export async function updateFinding(
  configDir: string,
  projectId: string,
  id: string,
  patch: FindingPatch,
  options: FindingMutationOptions = {},
): Promise<Finding> {
  const path = projectFindingsPath(configDir, projectId);
  return withFindingsLock(path, options, async () => {
    const current = await readFindings(configDir, projectId);
    const index = uniqueFindingIndex(current, id);
    const existing = current[index];
    if (!existing) throw new CodedError("finding.notFound");
    const finding: Finding = { ...existing };
    if (patch.label !== undefined) {
      if (
        typeof patch.label !== "string" ||
        patch.label.trim() === "" ||
        patch.label.trim().length > FINDING_MAX_LABEL
      )
        throw new CodedError("finding.labelInvalid", { max: FINDING_MAX_LABEL });
      finding.label = redactLabel(patch.label.trim());
      if (finding.label.length > FINDING_MAX_LABEL)
        throw new CodedError("finding.labelInvalid", { max: FINDING_MAX_LABEL });
    }
    if (patch.kind !== undefined) {
      if (!isKind(patch.kind)) throw invalid();
      finding.kind = patch.kind;
    }
    if (patch.state !== undefined) {
      if (!isState(patch.state)) throw invalid();
      finding.state = patch.state;
    }
    if (patch.tactic === null) delete finding.tactic;
    else if (patch.tactic !== undefined) {
      if (!isTactic(patch.tactic)) throw invalid();
      finding.tactic = patch.tactic;
    }
    if (patch.technique === null) delete finding.technique;
    else if (patch.technique !== undefined) {
      if (!isTechnique(patch.technique)) throw invalid();
      finding.technique = patch.technique;
    }
    if (patch.from !== undefined) {
      const fail = () => new CodedError("finding.invalidLinks");
      if (!Array.isArray(patch.from)) throw fail();
      const from = [...new Set(patch.from)];
      const known = new Map(current.map((row) => [row.id, row]));
      if (from.length > MAX_FROM || from.some((parent) => !known.has(parent))) throw fail();
      // Un parent ne peut pas être la trouvaille ni l'un de ses descendants.
      const reaches = (start: string, visited: Set<string>): boolean => {
        if (start === id) return true;
        if (visited.has(start)) return false;
        visited.add(start);
        return (known.get(start)?.from ?? []).some((parent) => reaches(parent, visited));
      };
      if (from.some((parent) => reaches(parent, new Set()))) throw fail();
      if (from.length) finding.from = from;
      else delete finding.from;
    }
    if (patch.pathFrom !== undefined) {
      if (!Array.isArray(patch.pathFrom)) throw invalid();
      const pathFrom = [...new Set(patch.pathFrom)];
      if (pathFrom.length > MAX_FROM) throw invalid();
      const notParents = pathFrom.filter(
        (parent) => !finding.from?.includes(parent) || !current.some((node) => node.id === parent),
      );
      if (notParents.length)
        throw new CodedError("finding.pathNotSubset", { ids: notParents.join(", ") });
      if (pathFrom.length) finding.pathFrom = pathFrom;
      else delete finding.pathFrom;
    } else if (finding.pathFrom) {
      const pathFrom = finding.pathFrom.filter((parent) => finding.from?.includes(parent));
      if (pathFrom.length) finding.pathFrom = pathFrom;
      else delete finding.pathFrom;
    }
    if (patch.evidenceIds !== undefined) {
      await validateEvidenceLinks(configDir, projectId, patch.evidenceIds);
      if (patch.evidenceIds.length) finding.evidenceIds = [...patch.evidenceIds];
      else delete finding.evidenceIds;
    }
    current[index] = finding;
    await commitFindings(path, current, options);
    return finding;
  });
}

export interface DeleteFindingResult {
  removed: Finding;
  /** Ids des enfants directs dont la liste de parents a changé. */
  detachedFrom: string[];
}

/** Marquage visuel d'un seul lien, fusionné sous le même verrou que les notes de l'agent. */
export async function setFindingPathEdge(
  configDir: string,
  projectId: string,
  from: string,
  to: string,
  retained: boolean,
  options: FindingMutationOptions = {},
): Promise<void> {
  const path = projectFindingsPath(configDir, projectId);
  if (
    typeof retained !== "boolean" ||
    typeof from !== "string" ||
    typeof to !== "string" ||
    from === to
  )
    throw invalid();
  await withFindingsLock(path, options, async () => {
    const findings = await readFindings(configDir, projectId);
    const index = uniqueFindingIndex(findings, to);
    const child = findings[index];
    if (!child?.from?.includes(from) || !findings.some((node) => node.id === from))
      throw new CodedError("finding.notFound");
    const selected = new Set(child.pathFrom ?? []);
    if (retained) selected.add(from);
    else selected.delete(from);
    if (selected.size) child.pathFrom = [...selected];
    else delete child.pathFrom;
    await commitFindings(path, findings, options);
  });
}

/** Supprime un seul nœud et ses références chez les enfants directs, sans cascade ni reconnexion. */
export async function deleteFinding(
  configDir: string,
  projectId: string,
  id: string,
  options: FindingMutationOptions = {},
): Promise<DeleteFindingResult> {
  const path = projectFindingsPath(configDir, projectId);
  return withFindingsLock(path, options, async () => {
    const current = await readFindings(configDir, projectId);
    const index = uniqueFindingIndex(current, id);
    const removed = current[index];
    if (!removed) throw new CodedError("finding.notFound");
    const detachedFrom = current
      .filter((finding) => finding.from?.includes(id))
      .map((finding) => finding.id);
    const next = reconcileParents(
      current.filter((_, other) => other !== index),
      new Set([id]),
    );
    await commitFindings(path, next, options);
    return { removed, detachedFrom };
  });
}

/** Attache une preuve en fusionnant les références courantes sous le verrou de la trouvaille. */
export async function attachEvidence(
  configDir: string,
  projectId: string,
  findingId: string,
  evidenceId: string,
  options: FindingMutationOptions = {},
): Promise<Finding> {
  const path = projectFindingsPath(configDir, projectId);
  return withFindingsLock(path, options, async () => {
    const current = await readFindings(configDir, projectId);
    const index = uniqueFindingIndex(current, findingId);
    const existing = current[index];
    if (!existing) throw new CodedError("finding.notFound");
    const evidenceIds = [...new Set([...(existing.evidenceIds ?? []), evidenceId])];
    await validateEvidenceLinks(configDir, projectId, evidenceIds);
    const finding: Finding = { ...existing, evidenceIds };
    current[index] = finding;
    await commitFindings(path, current, options);
    return finding;
  });
}
