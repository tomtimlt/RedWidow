/**
 * Vue `killchain` (graphe des trouvailles du projet actif), ADR 0052 et 0055. Les messages sont validés par
 * le parseur de l'extension (`parseStudioMessage`) puis limités à la liste de cette vue ; le graphe et les
 * exports réutilisent la logique de l'extension. L'état vit sur le disque du serveur (dossier de
 * configuration du cœur).
 *
 * Comme dans l'extension, tout geste (suppression, annotation, exports, preuve) exige que le projet de
 * l'identifiant reçu soit le projet ACTIF : un autre projet est refusé. La vue elle-même n'affiche que le
 * projet actif.
 *
 * - Mise à jour : sondage borné des dates de `project.json`, `findings.json` et `evidence.json` du projet
 *   actif (un seul minuteur, tant qu'un socket est abonné), puis empreinte de la vue envoyée : rien n'est
 *   renvoyé s'il n'y a pas de changement. `refresh` force le renvoi, comme l'extension.
 * - Suppression d'une trouvaille : confirmation humaine par `HostUi` (sans réponse, rien n'est supprimé).
 * - Exports (image SVG, Attack Flow, rapport Markdown) : offerts en téléchargement au seul émetteur ;
 *   aucun chemin hôte n'est transmis. Identifiants et loot sont exclus par la logique de l'extension.
 * - Preuve : le texte (déjà masqué par le cœur) est renvoyé borné à `MAX_EVIDENCE_TEXT`, sans éditeur.
 * - `openReport` (ouverture d'une fenêtre de rapport) : sans équivalent ici, ignoré.
 */
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  AuditStore,
  activeProject,
  buildAttackFlow,
  CodedError,
  type Evidence,
  type Finding,
  listEvidence,
  projectFindingsPath,
  readFindings,
  readProjects,
  USER_PROJECT_FILE,
} from "@warband/core";
import { formatError, type Locale } from "@warband/messages";
import { cleanText } from "@warband/vscode/logic/approval";
import {
  deleteSelectedFinding,
  FindingDeleteChangedError,
} from "@warband/vscode/logic/finding-delete";
import { killchainImage } from "@warband/vscode/logic/killchain-image";
import { setSelectedPathEdge } from "@warband/vscode/logic/killchain-path";
import { missionSnapshot } from "@warband/vscode/logic/mission-snapshot";
import { parseStudioMessage, type StudioMessage } from "@warband/vscode/logic/studio";
import { buildMissionReport, MAX_EVIDENCE_TEXT } from "./findings.js";
import type { BridgeContext } from "./hostui.js";
import type { Sink } from "./hub.js";

/** Types de message admis pour cette vue (le parseur d'origine en connaît d'autres : ils sont ignorés). */
const ACCEPTED = new Set<StudioMessage["type"]>([
  "ready",
  "rendered",
  "refresh",
  "openEvidence",
  "exportKillchain",
  "exportAttackFlow",
  "exportReport",
  "setPathEdge",
  "deleteFinding",
]);

/** Période du sondage des fichiers de trouvailles (ms), et plafond de caractères d'un message d'erreur. */
export const DEFAULT_POLL_MS = 1000;
const MAX_ERROR = 400;

export interface KillchainDeps {
  configDir: string;
  ctx: BridgeContext;
  locale(): Locale;
  /** Période de sondage (ms) ; 0 : aucun sondage (les gestes et `changed()` suffisent). */
  pollMs?: number;
  now?(): Date;
}

interface Sub {
  frame: string;
  /** Dernière vue envoyée à ce socket (sérialisée) : sert à ne rien renvoyer d'identique. */
  shown: string;
}

type ExportKind = "exportKillchain" | "exportAttackFlow" | "exportReport";

/**
 * Canal de réponse d'un geste : la vue Kill chain y répond sur son cadre, les pages du studio sur le leur.
 * `alive` vaut `false` dès que le destinataire s'est désabonné (le geste en cours s'interrompt alors).
 */
export interface GestureChannel {
  send(msg: Record<string, unknown>): void;
  alive(): boolean;
}

/** `[a-z0-9._-]` seulement, jamais de séparateur ni de guillemet. */
export function exportFilename(prefix: string, name: string, date: Date, ext: string): string {
  const slug =
    name
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/\.{2,}/g, ".")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 60) || "projet";
  return `${prefix}-${slug}-${date.toISOString().slice(0, 10)}.${ext}`;
}

/** Message d'erreur sans chemin ni détail système : seuls les codes du cœur et le changement détecté sont détaillés. */
function safeMessage(error: unknown, locale: Locale): string {
  if (error instanceof CodedError || error instanceof FindingDeleteChangedError)
    return cleanText(formatError(error, locale), MAX_ERROR);
  return "Opération impossible.";
}

async function fileStamp(path: string): Promise<string> {
  try {
    const s = await stat(path, { bigint: true });
    return `${s.ino}:${s.size}:${s.mtimeNs}`;
  } catch {
    return "-";
  }
}

export class KillchainHost {
  private readonly subs = new Map<Sink, Sub>();
  private readonly deleting = new Set<Sink>();
  private queue: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | undefined;
  private polling = false;
  private stamp = "";
  private disposed = false;

  constructor(private readonly deps: KillchainDeps) {}

  unsubscribe(sink: Sink): void {
    this.subs.delete(sink);
    this.deleting.delete(sink);
    if (this.subs.size === 0) this.stopPolling();
  }

  dispose(): void {
    this.disposed = true;
    this.subs.clear();
    this.deleting.clear();
    this.stopPolling();
  }

  private stopPolling(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.stamp = "";
  }

  private startPolling(): void {
    const period = this.deps.pollMs ?? DEFAULT_POLL_MS;
    if (this.timer !== undefined || period <= 0) return;
    this.timer = setInterval(() => void this.poll(), period);
    this.timer.unref?.();
  }

  /** Une tâche à la fois : les dates changent → la vue est recalculée (l'empreinte évite les doublons). */
  private async poll(): Promise<void> {
    if (this.polling || this.subs.size === 0 || this.disposed) return;
    this.polling = true;
    try {
      const stamp = await this.currentStamp();
      if (stamp === this.stamp) return;
      this.stamp = stamp;
      await this.push();
    } catch {
      // Lecture impossible : la prochaine période réessaie.
    } finally {
      this.polling = false;
    }
  }

  private async currentStamp(): Promise<string> {
    const config = this.deps.configDir;
    const file = await readProjects(config).catch(() => null);
    const active = file === null ? null : activeProject(file);
    const parts = [await fileStamp(join(config, USER_PROJECT_FILE)), active?.id ?? ""];
    if (active !== null) {
      const findings = projectFindingsPath(config, active.id);
      parts.push(
        await fileStamp(findings),
        await fileStamp(join(dirname(findings), "evidence.json")),
      );
    }
    return parts.join("|");
  }

  /** Projet actif ou liste modifiés (studio) : vue recalculée et diffusée. */
  async changed(): Promise<void> {
    if (this.subs.size > 0 && !this.disposed) await this.push();
  }

  private send(sink: Sink, msg: Record<string, unknown>): void {
    const sub = this.subs.get(sink);
    if (sub !== undefined) sink.send("killchain", sub.frame, msg);
  }

  /**
   * Message de la vue. `ready` abonne le destinataire au cadre annoncé ; le reste exige cet abonnement et
   * le même cadre. `false` : invalide, hors liste, sans équivalent serveur ou non abonné.
   */
  async handle(frame: string, msg: Record<string, unknown>, sink: Sink): Promise<boolean> {
    if (this.disposed) return false;
    const m = parseStudioMessage(msg);
    if (m === null || !ACCEPTED.has(m.type)) return false;
    if (m.type === "ready") {
      this.subs.set(sink, { frame, shown: "" });
      this.startPolling();
      this.send(sink, { type: "locale", locale: this.deps.locale() });
      await this.push(sink, true);
      return true;
    }
    const sub = this.subs.get(sink);
    if (sub === undefined || sub.frame !== frame) return false;
    switch (m.type) {
      case "rendered":
        return true;
      case "refresh":
        this.send(sink, { type: "locale", locale: this.deps.locale() });
        await this.push(sink, true);
        return true;
      case "openEvidence":
      case "exportKillchain":
      case "exportAttackFlow":
      case "exportReport":
      case "setPathEdge":
      case "deleteFinding":
        return this.gesture(m, sink, {
          send: (msg) => this.send(sink, msg),
          alive: () => this.alive(sink, frame),
        });
      default:
        return false;
    }
  }

  /**
   * Gestes sur le graphe, la preuve et les exports : mêmes fonctions pour la vue Kill chain et pour les
   * pages du studio (qui répondent sur leur propre cadre par `chan`). `false` : geste d'un autre type.
   */
  async gesture(m: StudioMessage, sink: Sink, chan: GestureChannel): Promise<boolean> {
    if (this.disposed) return false;
    switch (m.type) {
      case "openEvidence":
        return this.evidence(m.projectId, m.id, chan);
      case "exportKillchain":
      case "exportAttackFlow":
      case "exportReport":
        return this.export(m.type, m.projectId, sink, chan);
      case "setPathEdge":
        return this.setPathEdge(m, chan);
      case "deleteFinding":
        return this.deleteFinding(m.projectId, m.id, sink, chan);
      default:
        return false;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Vue
  // -------------------------------------------------------------------------------------------

  private async load(): Promise<Record<string, unknown>> {
    const config = this.deps.configDir;
    const file = await readProjects(config);
    const active = file === null ? null : activeProject(file);
    let findings: Finding[] = [];
    let evidence: Omit<Evidence, "text">[] = [];
    if (active !== null) {
      findings = await readFindings(config, active.id);
      evidence = (await listEvidence(config, active.id)).map(({ text: _text, ...meta }) => meta);
    }
    return { type: "view", page: "killchain", projectId: active?.id ?? null, findings, evidence };
  }

  /** Envoie la vue à `only` (ou à tous les abonnés), en série ; `force` : même si elle est identique. */
  private push(only?: Sink, force = false): Promise<void> {
    const run = () => this.doPush(only, force);
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  private async doPush(only: Sink | undefined, force: boolean): Promise<void> {
    const targets = only !== undefined ? [only] : [...this.subs.keys()];
    if (targets.length === 0 || this.disposed) return;
    let payload: Record<string, unknown>;
    try {
      payload = await this.load();
    } catch (error) {
      for (const sink of targets) {
        const sub = this.subs.get(sink);
        if (sub === undefined) continue;
        sub.shown = "";
        this.send(sink, {
          type: "findingsError",
          message: safeMessage(error, this.deps.locale()),
        });
      }
      return;
    }
    const fingerprint = JSON.stringify(payload);
    for (const sink of targets) {
      const sub = this.subs.get(sink);
      if (sub === undefined || (!force && sub.shown === fingerprint)) continue;
      sub.shown = fingerprint;
      this.send(sink, payload);
    }
  }

  private async active(): Promise<{ id: string; name: string } | null> {
    const file = await readProjects(this.deps.configDir).catch(() => null);
    const active = file === null ? null : activeProject(file);
    return active === null ? null : { id: active.id, name: active.name };
  }

  // -------------------------------------------------------------------------------------------
  // Preuve
  // -------------------------------------------------------------------------------------------

  private async evidence(projectId: string, id: string, chan: GestureChannel): Promise<boolean> {
    let reply: Record<string, unknown>;
    try {
      const active = await this.active();
      if (active === null || active.id !== projectId) throw new CodedError("project.absent");
      const row = (await listEvidence(this.deps.configDir, projectId)).find((e) => e.id === id);
      if (row === undefined) throw new CodedError("finding.notFound");
      reply = {
        type: "evidenceView",
        projectId,
        id: row.id,
        label: row.label,
        capturedAt: row.capturedAt,
        source: { kind: row.source.kind, reference: row.source.reference },
        sha256: row.sha256,
        text: row.text.slice(0, MAX_EVIDENCE_TEXT),
        truncated: row.text.length > MAX_EVIDENCE_TEXT,
      };
    } catch (error) {
      reply = {
        type: "evidenceView",
        projectId,
        id,
        error: safeMessage(error, this.deps.locale()),
      };
    }
    chan.send(reply);
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Exports
  // -------------------------------------------------------------------------------------------

  private async export(
    kind: ExportKind,
    projectId: string,
    sink: Sink,
    chan: GestureChannel,
  ): Promise<boolean> {
    try {
      const active = await this.active();
      if (active === null || active.id !== projectId) throw new CodedError("project.absent");
      const date = (this.deps.now ?? (() => new Date()))();
      const locale = this.deps.locale();
      let file: { filename: string; mime: string; body: string };
      if (kind === "exportReport") {
        const report = await buildMissionReport(this.deps.configDir, active.id, locale, date);
        file = { filename: report.filename, mime: "text/markdown", body: report.markdown };
      } else {
        const findings = await readFindings(this.deps.configDir, active.id);
        const [audit, evidence] = await Promise.all([
          new AuditStore(this.deps.configDir).view(active.id).catch(() => null),
          listEvidence(this.deps.configDir, active.id).catch(() => null),
        ]);
        const snapshot = missionSnapshot(findings, audit, evidence);
        if (kind === "exportKillchain") {
          file = {
            filename: exportFilename("killchain", active.name, date, "svg"),
            mime: "image/svg+xml",
            body: killchainImage(active, snapshot.findings, locale, snapshot.id),
          };
        } else {
          let bundle: ReturnType<typeof buildAttackFlow>;
          try {
            bundle = buildAttackFlow(active, snapshot.findings, date);
          } catch {
            throw new Error("attack-flow");
          }
          file = {
            filename: exportFilename("attack-flow", active.name, date, "json"),
            mime: "application/json",
            body: `${JSON.stringify({ ...bundle, x_venator_snapshot: snapshot.id }, null, 2)}\n`,
          };
        }
      }
      const id = await this.deps.ctx.downloads.offer({
        filename: file.filename,
        mime: file.mime,
        body: Buffer.from(file.body, "utf8"),
        to: sink,
      });
      if (id === null) throw new Error("download");
      this.deps.ctx.audit({ kind: `killchain.${kind}`, project: active.id });
    } catch (error) {
      const message =
        error instanceof Error && error.message === "attack-flow"
          ? "Aucune étape confirmée : l'export Attack Flow est impossible."
          : error instanceof Error && error.message === "download"
            ? "Export impossible : trop d'exports en cours ou fichier trop volumineux."
            : safeMessage(error, this.deps.locale());
      chan.send({ type: "findingsError", projectId, message });
    }
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Gestes sur le graphe
  // -------------------------------------------------------------------------------------------

  private alive(sink: Sink, frame: string): boolean {
    return !this.disposed && this.subs.get(sink)?.frame === frame;
  }

  private async setPathEdge(
    m: Extract<StudioMessage, { type: "setPathEdge" }>,
    chan: GestureChannel,
  ): Promise<boolean> {
    let error: string | undefined;
    try {
      await setSelectedPathEdge(this.deps.configDir, m.projectId, m.from, m.to, m.retained, () =>
        chan.alive(),
      );
      await this.push(undefined, true);
    } catch (cause) {
      error = safeMessage(cause, this.deps.locale());
    }
    chan.send({
      type: "pathEdgeState",
      projectId: m.projectId,
      from: m.from,
      to: m.to,
      ...(error !== undefined && { error }),
    });
    return true;
  }

  private async deleteFinding(
    projectId: string,
    id: string,
    sink: Sink,
    chan: GestureChannel,
  ): Promise<boolean> {
    const state = (busy: boolean, error?: string) =>
      chan.send({
        type: "findingDeleteState",
        projectId,
        id,
        busy,
        ...(error !== undefined && { error }),
      });
    if (this.deleting.has(sink)) {
      state(false, "Une suppression est déjà en cours. Réessayez ensuite.");
      return true;
    }
    this.deleting.add(sink);
    let failure: string | undefined;
    try {
      state(true);
      const result = await deleteSelectedFinding(this.deps.configDir, projectId, id, {
        isCurrent: () => chan.alive(),
        // Jamais de suppression sans réponse humaine : `confirm` ne vaut `true` que sur acceptation explicite.
        confirm: async ({ projectName, finding, dependentCount }) => {
          const label = cleanText(finding.label, 200);
          const links =
            dependentCount > 0
              ? ` Les liens vers cet élément seront retirés de ${dependentCount} autre(s) élément(s).`
              : "";
          return this.deps.ctx.ui.confirm(
            {
              title: "Supprimer",
              text: `Supprimer « ${label} » de la Kill chain du projet « ${cleanText(projectName, 80)} » ?${links} Les autres éléments sont conservés.`,
              danger: true,
            },
            sink,
          );
        },
      });
      if (result.status === "deleted") {
        this.deps.ctx.audit({ kind: "killchain.deleteFinding", project: projectId, id });
        await this.push(undefined, true);
      }
    } catch (error) {
      failure = safeMessage(error, this.deps.locale());
    } finally {
      this.deleting.delete(sink);
      state(false, failure);
    }
    return true;
  }
}
