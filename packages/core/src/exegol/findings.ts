import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CodedError } from "../reason.js";

export const USER_FINDINGS_FILE = "findings.json";

export const FINDING_KINDS = ["host", "credential", "site", "step", "loot"] as const;
export const FINDING_STATES = ["confirmed", "hypothesis", "failed"] as const;

export type FindingKind = (typeof FINDING_KINDS)[number];
export type FindingState = (typeof FINDING_STATES)[number];

export interface Finding {
  id: string;
  kind: FindingKind;
  label: string;
  state: FindingState;
}

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

/** Lit les trouvailles du projet. Fichier absent : liste vide. */
export async function readFindings(configDir: string): Promise<Finding[]> {
  const path = join(configDir, USER_FINDINGS_FILE);
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
    return { id: rec.id, kind: rec.kind, label: rec.label, state: rec.state };
  });
}

/** Ajoute une trouvaille. Au-delà du plafond, la plus ancienne sort. */
export async function appendFinding(
  configDir: string,
  input: { kind: FindingKind; label: string; state: FindingState },
): Promise<Finding> {
  const label = input.label.trim();
  if (label === "" || label.length > MAX_LABEL || !isKind(input.kind) || !isState(input.state)) {
    throw invalid();
  }
  const current = await readFindings(configDir);
  const finding: Finding = { id: randomUUID(), kind: input.kind, label, state: input.state };
  const next = [...current, finding].slice(-MAX_FINDINGS);
  await mkdir(configDir, { recursive: true });
  const path = join(configDir, USER_FINDINGS_FILE);
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
  return finding;
}
