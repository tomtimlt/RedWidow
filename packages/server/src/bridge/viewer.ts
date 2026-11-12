/**
 * Vue `viewer` (Monitor, Sortie, Rapport), pages en lecture seule, ADR 0052 et 0055.
 *
 * Contrat du mode. La page ne l'envoie pas d'elle-même : il est dans l'URL de la page (`?mode=`). Le
 * message `ready` PEUT le porter (`{type:"ready", mode}`, `monitor`, `watch` ou `report`) ; sans lui, le mode
 * est `monitor`. Une coquille qui ouvre un Rapport doit donc l'annoncer.
 *
 * - Monitor et Sortie (`monitor`, `watch`) suivent la session de chat du cadre (cadre = identifiant du chat).
 *   `watch {toolUseId}` restreint la vue de ce socket à un appel d'outil. Si aucune session vivante ne porte
 *   l'identifiant et que c'est un UUID (run ou conversation de l'historique), le journal JSONL du run est
 *   relu sous `paths.runs` et affiché en lecture seule : lecture bornée (octets et 2000 événements), nom de
 *   fichier construit du seul UUID validé, fichier ordinaire exigé, événements déjà masqués par le recorder
 *   et revalidés. Aucun chemin ne vient du client.
 * - Rapport : aperçu `missionReportPreview` du projet actif (identifiants et loot exclus) ; `exportReport`
 *   offre le même Markdown que `/api/report`, et seulement pour le projet actif.
 * - `exportText` : le texte visible renvoyé par la page est offert en téléchargement à son émetteur.
 * Les vues n'exposent ni catalogue de capacités, ni cartes d'approbation, ni chemin hôte.
 */
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import type { EngineEvent } from "@warband/core";
import { activeProject, CodedError, parseJournal, readFindings, readProjects } from "@warband/core";
import type { Locale } from "@warband/messages";
import { MAX_EXPORT_TEXT_CHARS } from "@warband/vscode/logic/approval";
import { type ChatView, createChatState, monitorChatView } from "@warband/vscode/logic/chat";
import { isRunId, parseIndex } from "@warband/vscode/logic/history";
import { missionReportPreview } from "@warband/vscode/logic/mission-report";
import { buildMissionReport } from "./findings.js";
import type { BridgeContext } from "./hostui.js";
import type { Sink } from "./hub.js";

export const VIEWER_MODES = ["monitor", "watch", "report"] as const;
export type ViewerMode = (typeof VIEWER_MODES)[number];

/** Bornes de relecture d'un journal terminé : octets lus par run, événements au total, runs d'une conversation. */
export const MAX_REPLAY_BYTES = 8 * 1024 * 1024;
export const MAX_REPLAY_EVENTS = 2000;
export const MAX_REPLAY_RUNS = 8;
/** Regroupement des mises à jour d'un chat vivant (les vues arrivent en rafale pendant un tour). */
const PUSH_THROTTLE_MS = 100;

const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type ViewerMessage =
  | { type: "ready"; mode: ViewerMode }
  | { type: "watch"; toolUseId: string }
  | { type: "exportText"; text: string }
  | { type: "exportReport"; projectId: string };

const isMode = (v: unknown): v is ViewerMode =>
  typeof v === "string" && (VIEWER_MODES as readonly string[]).includes(v);

/** Valide un message de la vue (entrée non fiable) : types fermés, champs exacts, bornes ; `null` sinon. */
export function parseViewerMessage(raw: unknown): ViewerMessage | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const keys = Object.keys(m);
  const only = (...allowed: string[]) => keys.every((k) => allowed.includes(k));
  switch (m.type) {
    case "ready":
      if (!only("type", "mode")) return null;
      if (m.mode === undefined) return { type: "ready", mode: "monitor" };
      return isMode(m.mode) ? { type: "ready", mode: m.mode } : null;
    case "watch":
      return keys.length === 2 &&
        typeof m.toolUseId === "string" &&
        m.toolUseId.length >= 1 &&
        m.toolUseId.length <= 200 &&
        !/\p{Cc}/u.test(m.toolUseId)
        ? { type: "watch", toolUseId: m.toolUseId }
        : null;
    case "exportText":
      return keys.length === 2 &&
        typeof m.text === "string" &&
        m.text.length >= 1 &&
        m.text.length <= MAX_EXPORT_TEXT_CHARS
        ? { type: "exportText", text: m.text }
        : null;
    case "exportReport":
      return keys.length === 2 && typeof m.projectId === "string" && PROJECT_ID.test(m.projectId)
        ? { type: "exportReport", projectId: m.projectId }
        : null;
    default:
      return null;
  }
}

export interface ViewerDeps {
  configDir: string;
  /** Dossier des journaux de runs (`paths.runs`) : seule racine lue. */
  runsDir: string;
  ctx: BridgeContext;
  locale(): Locale;
  /** Vue de la session de chat vivante du cadre, `undefined` si aucune. */
  chatView(frame: string): ChatView | undefined;
  /** Index d'historique (conversation → runs), non fiable : relu par `parseIndex`. */
  historyIndex(): unknown;
  now?(): Date;
}

interface Sub {
  frame: string;
  mode: ViewerMode;
  /** Appel d'outil suivi (`watch`) ; `undefined` : tous. */
  toolUseId?: string;
  /** Dernière vue envoyée (sérialisée) : rien n'est renvoyé d'identique. */
  shown: string;
}

/** Vue exposée : sans catalogue de capacités ni carte d'approbation (inutiles et sans effet ici). */
function publicView(view: ChatView, toolUseId?: string): ChatView {
  const { capabilities: _capabilities, ...rest } = monitorChatView(view, toolUseId);
  return { ...rest, approvals: [] };
}

/** Lit au plus `MAX_REPLAY_BYTES` d'un journal ordinaire ; fichier absent, lien ou autre type : aucun texte. */
async function readBounded(path: string): Promise<string> {
  const info = await lstat(path).catch(() => null);
  if (info === null || !info.isFile()) return "";
  const handle = await open(path, "r");
  try {
    const length = Math.min(info.size, MAX_REPLAY_BYTES);
    const buf = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buf, 0, length, 0);
    let text = buf.toString("utf8", 0, bytesRead);
    // Lecture partielle : la dernière ligne est probablement coupée.
    if (info.size > length) text = text.slice(0, text.lastIndexOf("\n") + 1);
    return text;
  } finally {
    await handle.close();
  }
}

export class ViewerHost {
  private readonly subs = new Map<Sink, Sub>();
  private readonly dirty = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly deps: ViewerDeps) {}

  unsubscribe(sink: Sink): void {
    this.subs.delete(sink);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.dirty.clear();
    this.subs.clear();
  }

  private send(sink: Sink, msg: Record<string, unknown>): void {
    const sub = this.subs.get(sink);
    if (sub !== undefined) sink.send("viewer", sub.frame, msg);
  }

  /**
   * Message de la vue. `ready` abonne le destinataire au cadre (et au mode) annoncés ; le reste exige cet
   * abonnement, le même cadre et un mode compatible. `false` : invalide ou refusé.
   */
  async handle(frame: string, msg: Record<string, unknown>, sink: Sink): Promise<boolean> {
    if (this.disposed) return false;
    const m = parseViewerMessage(msg);
    if (m === null) return false;
    if (m.type === "ready") {
      const sub: Sub = { frame, mode: m.mode, shown: "" };
      this.subs.set(sink, sub);
      this.send(sink, { type: "locale", locale: this.deps.locale() });
      if (sub.mode !== "report") this.send(sink, { type: "title", text: this.titleOf(frame) });
      await this.pushSub(sink);
      return true;
    }
    const sub = this.subs.get(sink);
    if (sub === undefined || sub.frame !== frame) return false;
    switch (m.type) {
      case "watch": {
        if (sub.mode === "report") return false;
        const known = (await this.monitorView(sub.frame)).items.some(
          (i) => i.kind === "tool" && i.toolUseId === m.toolUseId,
        );
        if (!known) return false;
        sub.toolUseId = m.toolUseId;
        await this.pushSub(sink, true);
        return true;
      }
      case "exportText":
        if (sub.mode === "report") return false;
        return this.offer(
          {
            filename: sub.mode === "monitor" ? "monitor-warband.txt" : "sortie-warband.txt",
            mime: "text/plain",
            body: m.text,
          },
          sink,
        );
      case "exportReport":
        return sub.mode === "report" ? this.exportReport(m.projectId, sink) : false;
    }
  }

  /** Titre : l'identifiant du cadre ; pour un run relu, son début. Jamais de chemin. */
  private titleOf(frame: string): string {
    return this.deps.chatView(frame) === undefined && isRunId(frame) ? frame.slice(0, 8) : frame;
  }

  /** Une vue de chat a changé : mise à jour des abonnés de ce cadre, regroupée. Sans abonné, rien n'est calculé. */
  chatChanged(frame: string): void {
    if (this.disposed) return;
    let watched = false;
    for (const s of this.subs.values())
      if (s.frame === frame && s.mode !== "report") watched = true;
    if (!watched) return;
    this.dirty.add(frame);
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const frames = new Set(this.dirty);
      this.dirty.clear();
      for (const [sink, sub] of this.subs)
        if (sub.mode !== "report" && frames.has(sub.frame)) void this.pushSub(sink);
    }, PUSH_THROTTLE_MS);
    this.timer.unref?.();
  }

  /** Projet actif ou liste modifiés (studio) : les rapports ouverts sont recalculés. */
  async projectChanged(): Promise<void> {
    for (const [sink, sub] of this.subs) if (sub.mode === "report") await this.pushSub(sink);
  }

  private async pushSub(sink: Sink, force = false): Promise<void> {
    const sub = this.subs.get(sink);
    if (sub === undefined || this.disposed) return;
    let payload: Record<string, unknown>;
    try {
      payload =
        sub.mode === "report"
          ? await this.reportView()
          : {
              type: "view",
              chatId: sub.frame,
              view: publicView(await this.monitorView(sub.frame), sub.toolUseId),
            };
    } catch (error) {
      sub.shown = "";
      this.send(sink, {
        type: "error",
        code: error instanceof CodedError ? error.code : "view.failed",
      });
      return;
    }
    const fingerprint = JSON.stringify(payload);
    // L'abonnement a pu changer pendant la lecture.
    if (this.subs.get(sink) !== sub || (!force && sub.shown === fingerprint)) return;
    sub.shown = fingerprint;
    this.send(sink, payload);
  }

  // -------------------------------------------------------------------------------------------
  // Monitor et Sortie
  // -------------------------------------------------------------------------------------------

  private async monitorView(frame: string): Promise<ChatView> {
    const live = this.deps.chatView(frame);
    if (live !== undefined) return live;
    const state = createChatState();
    if (isRunId(frame)) {
      for (const event of await this.replay(frame)) state.event(event);
      state.interruptPending();
    }
    return state.view();
  }

  /** Événements d'un run terminé (ou des runs d'une conversation de l'historique), bornés. */
  private async replay(id: string): Promise<EngineEvent[]> {
    const runs = [id];
    const conversation = parseIndex(this.deps.historyIndex()).find((c) => c.id === id);
    if (conversation !== undefined)
      runs.splice(0, 1, ...conversation.runIds.slice(-MAX_REPLAY_RUNS));
    const events: EngineEvent[] = [];
    for (const run of runs) {
      // Nom construit du seul UUID validé : aucun séparateur de chemin ne peut y figurer.
      if (!isRunId(run) || events.length >= MAX_REPLAY_EVENTS) break;
      const text = await readBounded(join(this.deps.runsDir, `${run}.jsonl`)).catch(() => "");
      for (const event of parseJournal(text).events) {
        if (events.length >= MAX_REPLAY_EVENTS) break;
        events.push(event);
      }
    }
    return events;
  }

  // -------------------------------------------------------------------------------------------
  // Rapport
  // -------------------------------------------------------------------------------------------

  private async reportView(): Promise<Record<string, unknown>> {
    const file = await readProjects(this.deps.configDir);
    const project = file === null ? null : activeProject(file);
    const items =
      project === null
        ? []
        : [
            missionReportPreview(
              project,
              await readFindings(this.deps.configDir, project.id),
              this.deps.locale(),
            ),
          ];
    return {
      type: "view",
      view: {
        items,
        approvals: [],
        busy: false,
        sandbox: null,
        sandboxNetwork: null,
        controls: null,
        history: [],
        readonly: null,
        noProvider: false,
      },
    };
  }

  private async exportReport(projectId: string, sink: Sink): Promise<boolean> {
    try {
      const file = await readProjects(this.deps.configDir);
      const project = file === null ? null : activeProject(file);
      // Même règle que l'extension : le rapport exporté est celui du projet actif affiché.
      if (project === null || project.id !== projectId) throw new CodedError("project.absent");
      const report = await buildMissionReport(
        this.deps.configDir,
        project.id,
        this.deps.locale(),
        (this.deps.now ?? (() => new Date()))(),
      );
      await this.offer(
        { filename: report.filename, mime: "text/markdown", body: report.markdown },
        sink,
      );
      this.deps.ctx.audit({ kind: "report.export", project: project.id });
      return true;
    } catch (error) {
      this.send(sink, {
        type: "error",
        code: error instanceof CodedError ? error.code : "view.failed",
      });
      return true;
    }
  }

  /** Offre le fichier à l'émetteur ; toujours « traité » (un refus de borne est signalé à la page). */
  private async offer(
    file: { filename: string; mime: string; body: string },
    sink: Sink,
  ): Promise<boolean> {
    const id = await this.deps.ctx.downloads.offer({
      filename: file.filename,
      mime: file.mime,
      body: Buffer.from(file.body, "utf8"),
      to: sink,
    });
    if (id === null) this.send(sink, { type: "error", code: "view.failed" });
    return true;
  }
}
