import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { projectFindingsPath } from "../project.js";
import { CodedError } from "../reason.js";

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
}

const MAX_FROM = 8;

const MAX_LABEL = 200;
const MAX_FINDINGS = 200;

function invalid() {
  return new CodedError("project.invalid", { reason: "json" });
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
    if (typeof rec.label !== "string" || rec.label === "" || rec.label.length > MAX_LABEL) {
      throw invalid();
    }
    const finding: Finding = { id: rec.id, kind: rec.kind, label: rec.label, state: rec.state };
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
    return finding;
  });
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
  },
): Promise<Finding> {
  const path = projectFindingsPath(configDir, projectId);
  const label = input.label.trim();
  if (label === "" || label.length > MAX_LABEL || !isKind(input.kind) || !isState(input.state)) {
    throw invalid();
  }
  if (input.tactic !== undefined && !isTactic(input.tactic)) throw invalid();
  if (input.technique !== undefined && !isTechnique(input.technique)) throw invalid();
  const from = input.from === undefined ? [] : [...new Set(input.from)];
  if (from.length > MAX_FROM) throw invalid();
  const current = await readFindings(configDir, projectId);
  const known = new Set(current.map((f) => f.id));
  if (!from.every((id) => known.has(id))) throw invalid();
  const finding: Finding = { id: randomUUID(), kind: input.kind, label, state: input.state };
  if (input.tactic !== undefined) finding.tactic = input.tactic;
  if (input.technique !== undefined) finding.technique = input.technique;
  if (from.length > 0) finding.from = from;
  const next = [...current, finding].slice(-MAX_FINDINGS);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
  await chmod(path, 0o600);
  return finding;
}
