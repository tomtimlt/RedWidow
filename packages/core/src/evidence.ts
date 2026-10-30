import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { capOutput } from "./output.js";
import { projectFindingsPath } from "./project.js";
import { CodedError } from "./reason.js";
import { createRedactor, secretsFromEnv } from "./redact.js";

export interface EvidenceSource {
  kind: "editor" | "terminal" | "tool";
  reference: string;
  startLine?: number;
  endLine?: number;
}

export interface Evidence {
  id: string;
  label: string;
  text: string;
  sha256: string;
  /** Empreinte stockée avant un nouveau masquage de la vue ; jamais persistée. */
  storedSha256?: string;
  /** Le nouveau masquage a nécessité un plafonnement explicite d’un champ. */
  redactionTruncated?: true;
  capturedAt: string;
  source: EvidenceSource;
}

export interface EvidenceMutationOptions {
  beforeCommit?: () => void | Promise<void>;
}

export const EVIDENCE_MAX_TEXT_BYTES = 16 * 1024;
export const EVIDENCE_MAX_COUNT = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const invalid = () => new CodedError("project.invalid", { reason: "json" });
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const redact = (text: string) => createRedactor({ values: secretsFromEnv() })(text);
const evidencePath = (configDir: string, projectId: string) =>
  join(dirname(projectFindingsPath(configDir, projectId)), "evidence.json");

function sourceValue(raw: unknown): EvidenceSource {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid();
  const source = raw as Record<string, unknown>;
  if (!["editor", "terminal", "tool"].includes(source.kind as string)) throw invalid();
  if (
    typeof source.reference !== "string" ||
    !source.reference.trim() ||
    source.reference.length > 1024 ||
    /[\\:]/.test(source.reference) ||
    [...source.reference].some((character) => character.charCodeAt(0) < 32) ||
    source.reference.startsWith("/") ||
    source.reference.split("/").some((part) => part === "..")
  )
    throw invalid();
  for (const key of ["startLine", "endLine"]) {
    const value = source[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) < 1))
      throw invalid();
  }
  if (
    source.endLine !== undefined &&
    (source.startLine === undefined || (source.endLine as number) < (source.startLine as number))
  )
    throw invalid();
  return {
    kind: source.kind as EvidenceSource["kind"],
    reference: redact(source.reference),
    ...(source.startLine !== undefined ? { startLine: source.startLine as number } : {}),
    ...(source.endLine !== undefined ? { endLine: source.endLine as number } : {}),
  };
}

function cappedField(text: string, max: number): string {
  if (text.length <= max) return text;
  let prefix = text.slice(0, max - 1);
  const last = prefix.charCodeAt(prefix.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) prefix = prefix.slice(0, -1);
  return `${prefix}…`;
}

function content(raw: {
  label: string;
  text: string;
  source: EvidenceSource;
  redactionTruncated?: true;
}) {
  if (typeof raw.label !== "string" || typeof raw.text !== "string") throw invalid();
  if (raw.label.length > 200 || Buffer.byteLength(raw.text, "utf8") > EVIDENCE_MAX_TEXT_BYTES)
    throw invalid();
  if (raw.redactionTruncated !== undefined && raw.redactionTruncated !== true) throw invalid();
  const maskedLabel = redact(raw.label.trim());
  const maskedText = redact(raw.text);
  if (!maskedLabel) throw invalid();
  const label = cappedField(maskedLabel, 200);
  const capped = capOutput(maskedText, EVIDENCE_MAX_TEXT_BYTES);
  const text = capped.truncated
    ? `${capOutput(maskedText, EVIDENCE_MAX_TEXT_BYTES - Buffer.byteLength("…")).output}…`
    : maskedText;
  const source = sourceValue(raw.source);
  const reference = cappedField(source.reference, 1024);
  const truncated =
    raw.redactionTruncated ||
    capped.truncated ||
    label !== maskedLabel ||
    reference !== source.reference;
  return {
    label,
    text,
    source: { ...source, reference },
    ...(truncated ? { redactionTruncated: true as const } : {}),
  };
}

/** Vérifie le texte stocké puis applique le masquage courant à la vue. Aucune source n’est ouverte. */
export async function listEvidence(configDir: string, projectId: string): Promise<Evidence[]> {
  const path = evidencePath(configDir, projectId);
  let parsed: unknown;
  try {
    const handle = await open(path, "r");
    try {
      if ((await handle.stat()).size > 24 * 1024 * 1024) throw invalid();
      parsed = JSON.parse(await handle.readFile("utf8"));
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    if (error instanceof SyntaxError) throw invalid();
    throw error;
  }
  if (!Array.isArray(parsed) || parsed.length > EVIDENCE_MAX_COUNT) throw invalid();
  const ids = new Set<string>();
  return parsed.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid();
    const row = raw as Evidence;
    if (typeof row.id !== "string" || !UUID.test(row.id) || ids.has(row.id)) throw invalid();
    ids.add(row.id);
    if (typeof row.text !== "string" || row.sha256 !== hash(row.text)) throw invalid();
    const safe = content(row);
    if (
      typeof row.capturedAt !== "string" ||
      !Number.isFinite(Date.parse(row.capturedAt)) ||
      new Date(row.capturedAt).toISOString() !== row.capturedAt
    )
      throw invalid();
    const sha256 = hash(safe.text);
    return {
      id: row.id,
      ...safe,
      sha256,
      ...(sha256 !== row.sha256 ? { storedSha256: row.sha256 } : {}),
      capturedAt: row.capturedAt,
    };
  });
}

/** Ajoute une capture explicite, masquée avant empreinte et écriture, sans exécuter son contenu. */
export async function createEvidence(
  configDir: string,
  projectId: string,
  input: { label: string; text: string; source: EvidenceSource },
  options: EvidenceMutationOptions = {},
): Promise<Evidence> {
  const path = evidencePath(configDir, projectId);
  const safe = content(input);
  await mkdir(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + 3000;
  let lock: Awaited<ReturnType<typeof open>>;
  for (;;) {
    try {
      lock = await open(lockPath, "wx", 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new CodedError("finding.busy");
      await setTimeout(25);
    }
  }
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const current = await listEvidence(configDir, projectId);
    if (current.length >= EVIDENCE_MAX_COUNT) throw invalid();
    const evidence: Evidence = {
      id: randomUUID(),
      ...safe,
      sha256: hash(safe.text),
      capturedAt: new Date().toISOString(),
    };
    // La vue remasquée devient la nouvelle forme canonique, sans métadonnée de vue.
    const canonical = [...current, evidence].map(({ storedSha256: _storedSha256, ...row }) => row);
    await writeFile(temp, `${JSON.stringify(canonical, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await options.beforeCommit?.();
    await rename(temp, path);
    return evidence;
  } finally {
    try {
      await unlink(temp).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    } finally {
      try {
        await lock.close();
      } finally {
        await unlink(lockPath);
      }
    }
  }
}
