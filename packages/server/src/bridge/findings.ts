/**
 * Trouvailles et rapport de mission côté serveur (ADR 0052). Même source que l'extension : `findings.json`,
 * `evidence.json` et l'audit du projet sous le dossier de configuration. Le contenu des preuves est déjà
 * masqué par `listEvidence` ; la liste n'en expose que les libellés, le détail un texte borné.
 * Aucune gravité n'est déduite : le modèle `Finding` n'en porte pas.
 */
import {
  AuditStore,
  CodedError,
  type Evidence,
  type Finding,
  listEvidence,
  readFindings,
  readProjects,
} from "@warband/core";
import type { Locale } from "@warband/messages";
import { deleteSelectedFinding } from "@warband/vscode/logic/finding-delete";
import { missionReport } from "@warband/vscode/logic/mission-report";
import { missionSnapshot } from "@warband/vscode/logic/mission-snapshot";

/** Texte de preuve renvoyé dans le détail d'une trouvaille (par preuve, en caractères). */
export const MAX_EVIDENCE_TEXT = 4000;
/** Nombre maximal de preuves détaillées pour une trouvaille. */
export const MAX_EVIDENCE_ITEMS = 20;

export interface FindingItem {
  id: string;
  project: string;
  kind: Finding["kind"];
  label: string;
  state: Finding["state"];
  tactic: string | null;
  technique: string | null;
  from: string[];
  evidence: { id: string; label: string }[];
}

export interface FindingDetail extends FindingItem {
  pathFrom: string[];
  evidenceDetails: {
    id: string;
    label: string;
    capturedAt: string;
    source: { kind: string; reference: string };
    text: string;
    truncated: boolean;
  }[];
}

async function knownProjects(configDir: string): Promise<readonly { id: string; name: string }[]> {
  return (await readProjects(configDir).catch(() => null))?.projects ?? [];
}

function item(project: string, f: Finding, evidence: ReadonlyMap<string, Evidence>): FindingItem {
  return {
    id: f.id,
    project,
    kind: f.kind,
    label: f.label,
    state: f.state,
    tactic: f.tactic ?? null,
    technique: f.technique ?? null,
    from: [...(f.from ?? [])],
    evidence: (f.evidenceIds ?? []).flatMap((id) => {
      const e = evidence.get(id);
      return e ? [{ id, label: e.label }] : [];
    }),
  };
}

async function evidenceMap(configDir: string, project: string): Promise<Map<string, Evidence>> {
  const rows = await listEvidence(configDir, project).catch(() => [] as Evidence[]);
  return new Map(rows.map((e) => [e.id, e]));
}

/** Trouvailles d'un projet (ou de tous si `project` est nul), sans contenu de preuve. */
export async function listFindingItems(
  configDir: string,
  project: string | null,
): Promise<FindingItem[]> {
  const projects = await knownProjects(configDir);
  const targets = project === null ? projects : projects.filter((p) => p.id === project);
  if (project !== null && targets.length === 0) throw new CodedError("project.absent");
  const out: FindingItem[] = [];
  for (const p of targets) {
    const rows = await readFindings(configDir, p.id).catch(() => [] as Finding[]);
    const evidence = await evidenceMap(configDir, p.id);
    for (const f of rows) out.push(item(p.id, f, evidence));
  }
  return out;
}

/** Détail d'une trouvaille avec un texte de preuve borné ; `finding.notFound` si absente. */
export async function getFindingDetail(
  configDir: string,
  project: string,
  id: string,
): Promise<FindingDetail> {
  if (!(await knownProjects(configDir)).some((p) => p.id === project)) {
    throw new CodedError("project.absent");
  }
  const rows = await readFindings(configDir, project);
  const f = rows.find((row) => row.id === id);
  if (!f) throw new CodedError("finding.notFound");
  const evidence = await evidenceMap(configDir, project);
  const base = item(project, f, evidence);
  return {
    ...base,
    pathFrom: [...(f.pathFrom ?? [])],
    evidenceDetails: base.evidence.slice(0, MAX_EVIDENCE_ITEMS).flatMap(({ id: eid }) => {
      const e = evidence.get(eid);
      if (!e) return [];
      return [
        {
          id: e.id,
          label: e.label,
          capturedAt: e.capturedAt,
          source: { kind: e.source.kind, reference: e.source.reference },
          text: e.text.slice(0, MAX_EVIDENCE_TEXT),
          truncated: e.text.length > MAX_EVIDENCE_TEXT,
        },
      ];
    }),
  };
}

/**
 * Supprime une trouvaille par la logique de l'extension. La confirmation humaine a déjà eu lieu côté
 * client (`confirmed: true` exigé par l'appelant). `true` : supprimée.
 */
export async function removeFinding(
  configDir: string,
  project: string,
  id: string,
): Promise<boolean> {
  const res = await deleteSelectedFinding(configDir, project, id, {
    confirm: async () => true,
    isCurrent: () => true,
  });
  return res.status === "deleted";
}

/** Rapport Markdown d'un projet connu (même assemblage que l'extension) ; `project.absent` sinon. */
export async function buildMissionReport(
  configDir: string,
  projectId: string,
  locale: Locale,
  date: Date = new Date(),
): Promise<{ markdown: string; filename: string }> {
  const project = (await knownProjects(configDir)).find((p) => p.id === projectId);
  if (!project) throw new CodedError("project.absent");
  const findings = await readFindings(configDir, project.id);
  const [audit, evidence] = await Promise.all([
    new AuditStore(configDir).view(project.id).catch(() => null),
    listEvidence(configDir, project.id).catch(() => null),
  ]);
  const snapshot = missionSnapshot(findings, audit, evidence);
  return {
    markdown: missionReport(project, snapshot.findings, date, locale, snapshot),
    filename: reportFilename(project.name, date),
  };
}

/** `rapport-<projet>-<date>.md` : nom réduit à `[a-z0-9._-]`, jamais de séparateur ni de guillemet. */
export function reportFilename(name: string, date: Date): string {
  const slug =
    name
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/\.{2,}/g, ".")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 60) || "projet";
  return `rapport-${slug}-${date.toISOString().slice(0, 10)}.md`;
}
