import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Choice, WebviewMessage } from "@warband/vscode/logic/approval";
import {
  attachmentMessage,
  type TextAttachment,
  withAttachments,
} from "@warband/vscode/logic/attachments";
import { type BypassHost, createBypassHost } from "@warband/vscode/logic/bypass";
import type { ChatView } from "@warband/vscode/logic/chat";
import type { EngineController, EngineControllerOptions } from "@warband/vscode/logic/controller";
import { type ChatSession, createChatSession } from "@warband/vscode/logic/session";
import type { ServerStorage } from "../storage/index.js";
import { buildChatDeps } from "./deps.js";
import { isFrameId, type View } from "./envelope.js";

/** Destinataire d'un message sortant (un socket, ou un double dans les tests). */
export interface Sink {
  send(view: View, frame: string, msg: Record<string, unknown>): void;
}

/** Demande en attente, telle que la coquille l'affiche (texte déjà neutralisé par la session). */
export interface ApprovalItem {
  frame: string;
  toolUseId: string;
  tool: string;
  summary: string;
  /** « Toujours » proposé seulement si le verdict est mémorisable (prédicat du cœur). */
  canRemember: boolean;
  /** Confirmation native en cours : aucune autorisation n'est encore accordée. */
  confirming: boolean;
}

/** Cadre de la coquille : les messages `shell` portent cette valeur. */
export const SHELL_FRAME = "shell";
/** Nombre maximal de cadres (conversations) simultanés, et de questions en attente. */
export const MAX_FRAMES = 16;
export const MAX_PENDING_CONFIRMS = 32;

export interface HubOptions {
  storage: ServerStorage;
  /** Dossier de travail de l'agent. Défaut : `<données>/projects`. */
  cwd?: string;
  /** Script du moteur (défaut : `REDWIDOW_ENGINE`, sinon le moteur compilé de `packages/vscode`). */
  enginePath?: string;
  /** Racine des binaires, premier argument du moteur (défaut : `REDWIDOW_BIN_ROOT`). */
  binRoot?: string;
  /** Contrôleur injectable (tests). */
  createController?(options: EngineControllerOptions): EngineController;
  /** Sortie d'erreur du moteur, déjà masquée par le contrôleur. */
  onLog?(text: string): void;
}

/** Chemin du moteur et racine des binaires, d'après l'environnement (ADR 0052, point 1). */
export function resolveEngine(env: Readonly<Record<string, string | undefined>>): {
  enginePath: string;
  binRoot: string;
} {
  const configured = env.REDWIDOW_ENGINE;
  const enginePath = configured
    ? resolve(configured)
    : fileURLToPath(new URL("../../../vscode/dist/engine/main.js", import.meta.url));
  // Disposition de l'extension : le script voisin du dossier `bin/` ; le moteur compilé en est deux niveaux plus haut.
  const fallback = configured ? dirname(enginePath) : resolve(dirname(enginePath), "..", "..");
  return { enginePath, binRoot: env.REDWIDOW_BIN_ROOT ? resolve(env.REDWIDOW_BIN_ROOT) : fallback };
}

interface Frame {
  id: string;
  session: ChatSession;
  bypass: BypassHost;
  subs: Set<Sink>;
  approvals: ApprovalItem[];
}

interface PendingConfirm {
  id: string;
  frame: string;
  kind: "always" | "delete";
  text: string;
  resolve(accepted: boolean): void;
}

/**
 * Sessions de chat côté serveur, indépendantes des navigateurs : une mission continue si l'onglet se
 * ferme, et une demande d'approbation reste en attente (jamais d'approbation implicite) jusqu'à la
 * réponse d'un humain authentifié.
 */
export class MissionHub {
  private readonly frames = new Map<string, Frame>();
  private readonly shell = new Set<Sink>();
  private readonly confirms = new Map<string, PendingConfirm>();
  private lastApprovals = "[]";
  private disposed = false;
  private readonly enginePath: string;
  private readonly binRoot: string;
  private readonly cwd: string;

  constructor(private readonly options: HubOptions) {
    const engine = resolveEngine(process.env);
    this.enginePath = options.enginePath ?? engine.enginePath;
    this.binRoot = options.binRoot ?? engine.binRoot;
    this.cwd = options.cwd ?? options.storage.paths.projects;
  }

  /** Demandes en attente de toutes les sessions, de la plus ancienne session à la plus récente. */
  approvals(): ApprovalItem[] {
    return [...this.frames.values()].flatMap((f) => f.approvals);
  }

  /** Cadre existant ou nouveau ; `undefined` si l'identifiant est refusé, le plafond atteint ou le hub arrêté. */
  private frame(id: string): Frame | undefined {
    const existing = this.frames.get(id);
    if (existing) return existing;
    if (this.disposed || !isFrameId(id) || this.frames.size >= MAX_FRAMES) return undefined;
    const f = { id, subs: new Set<Sink>(), approvals: [] } as unknown as Frame;
    f.bypass = createBypassHost({
      clock: {
        now: () => Date.now(),
        schedule: (fn, delayMs) => setTimeout(fn, delayMs),
        cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
      onChange: (push) => this.broadcast(f, { ...push }),
    });
    f.session = createChatSession(
      buildChatDeps({
        storage: this.options.storage,
        frame: id,
        cwd: this.cwd,
        enginePath: this.enginePath,
        engineArgs: [this.binRoot],
        ask: (q) => this.ask(q),
        onView: (view) => this.onView(f, view),
        bypass: f.bypass,
        ...(this.options.onLog && { onLog: this.options.onLog }),
        ...(this.options.createController && { createController: this.options.createController }),
      }),
    );
    this.frames.set(id, f);
    return f;
  }

  private broadcast(f: Frame, msg: Record<string, unknown>): void {
    for (const sink of f.subs) sink.send("chat", f.id, msg);
  }

  private onView(f: Frame, view: ChatView): void {
    f.approvals = view.approvals.map((card) => ({
      frame: f.id,
      toolUseId: card.toolUseId,
      tool: card.tool,
      summary: card.summary,
      canRemember: card.canRemember,
      confirming: card.confirming === true,
    }));
    this.broadcast(f, { type: "view", view, chatId: f.id });
    this.pushApprovals(false);
  }

  /** Liste agrégée vers la coquille : à chaque changement (`force` : à la connexion). */
  private pushApprovals(force: boolean, only?: Sink): void {
    const items = this.approvals();
    const json = JSON.stringify(items);
    if (!force && json === this.lastApprovals) return;
    this.lastApprovals = json;
    for (const sink of only ? [only] : this.shell)
      sink.send("shell", SHELL_FRAME, { type: "approvals", items });
  }

  /** Abonne un destinataire à un cadre (annoncé par `ready`) : état courant, puis tout ce que la session poste. */
  subscribe(frameId: string, sink: Sink): boolean {
    const f = this.frame(frameId);
    if (!f) return false;
    f.subs.add(sink);
    sink.send("chat", f.id, { ...f.bypass.snapshot() });
    sink.send("chat", f.id, { type: "view", view: f.session.view(), chatId: f.id });
    void f.session.loadModels().catch(() => undefined);
    return true;
  }

  /** Abonne la coquille : demandes en attente et questions ouvertes lui sont envoyées tout de suite. */
  subscribeShell(sink: Sink): void {
    if (this.disposed) return;
    this.shell.add(sink);
    this.pushApprovals(true, sink);
    for (const c of this.confirms.values()) sink.send("shell", SHELL_FRAME, this.confirmMessage(c));
  }

  /** Retire un destinataire (socket fermé). Les demandes et les moteurs restent : rien n'est répondu. */
  unsubscribe(sink: Sink): void {
    this.shell.delete(sink);
    for (const f of this.frames.values()) f.subs.delete(sink);
  }

  private confirmMessage(c: PendingConfirm): Record<string, unknown> {
    return { type: "confirm", id: c.id, frame: c.frame, kind: c.kind, text: c.text };
  }

  /**
   * Question posée à l'humain (vue `shell`, message `confirm`). Sans réponse elle reste en attente ;
   * seul l'arrêt du hub la résout, par `false`. Au-delà du plafond : `false`, jamais `true`.
   */
  private ask(q: { kind: "always" | "delete"; text: string; frame: string }): Promise<boolean> {
    if (this.disposed || this.confirms.size >= MAX_PENDING_CONFIRMS) return Promise.resolve(false);
    return new Promise<boolean>((done) => {
      const c: PendingConfirm = { id: randomUUID(), ...q, resolve: done };
      this.confirms.set(c.id, c);
      for (const sink of this.shell) sink.send("shell", SHELL_FRAME, this.confirmMessage(c));
    });
  }

  /** Réponse d'un humain à une question (`confirmResult`). `false` si la question n'existe plus. */
  answerConfirm(id: string, accepted: boolean): boolean {
    const c = this.confirms.get(id);
    if (!c) return false;
    this.confirms.delete(id);
    c.resolve(accepted);
    for (const sink of this.shell) sink.send("shell", SHELL_FRAME, { type: "confirmClosed", id });
    return true;
  }

  /** Route une réponse d'approbation vers la session du cadre. Jamais de création de cadre ici. */
  async approve(frameId: string, toolUseId: string, choice: Choice): Promise<boolean> {
    const f = this.frames.get(frameId);
    if (!f || this.disposed) return false;
    await f.session.approve(toolUseId, choice);
    return true;
  }

  /**
   * Message de chat déjà validé (`parseWebviewMessage`) d'un destinataire abonné au cadre.
   * `false` : message valide mais sans équivalent serveur (ignoré par l'appelant).
   */
  async dispatch(frameId: string, message: WebviewMessage, from: Sink): Promise<boolean> {
    const f = this.frames.get(frameId);
    if (!f || this.disposed) return false;
    const s = f.session;
    switch (message.type) {
      case "send": {
        const files = message.attachments ?? [];
        const hasFiles = message.attachments !== undefined;
        const reply = (accepted: boolean) => {
          if (message.requestId)
            from.send("chat", f.id, {
              type: hasFiles ? "attachmentResult" : "sendResult",
              requestId: message.requestId,
              accepted,
            });
        };
        const v = s.view();
        // Même contrôle de contexte que l'extension pour les envois à identifiant ou à pièces jointes.
        if (
          (hasFiles || message.requestId) &&
          ((hasFiles && v.busy) ||
            v.stopping ||
            v.readonly ||
            v.noProvider ||
            message.conversation !== v.conversation)
        ) {
          reply(false);
          return true;
        }
        const texts = files.filter((x): x is TextAttachment => "text" in x);
        const images = files.filter((x) => "mimeType" in x);
        const prompt = texts.length ? withAttachments(message.text, texts) : message.text;
        try {
          reply(
            await s.send(
              hasFiles ? attachmentMessage(message.text, files) : message.text,
              prompt,
              message.research === true,
              images,
            ),
          );
        } catch (error) {
          reply(false);
          throw error;
        }
        return true;
      }
      case "stop":
        s.stop();
        return true;
      case "reset":
        s.reset();
        return true;
      case "approve":
        await s.approve(message.toolUseId, message.choice);
        return true;
      case "setBypass":
        // Demande humaine d'une socket authentifiée et abonnée au cadre ; la durée est bornée par le cœur.
        f.bypass.request(message.enabled, true, message.durationMs);
        return true;
      case "setModel":
        s.setModel(message.model);
        return true;
      case "setEffort":
        s.setEffort(message.effort);
        return true;
      case "setVariant":
        s.setVariant(message.variant);
        return true;
      case "setSupervision":
        s.setSupervision(message.supervision);
        return true;
      case "setLearning":
        s.setLearning(message.enabled);
        return true;
      case "selectProvider":
        await s.selectProvider(message.id);
        return true;
      case "refreshModels":
        await s.authChanged();
        return true;
      case "timelinePage":
        await s.timelinePage(message.direction);
        return true;
      case "historyOpen":
        await s.openConversation(message.id);
        return true;
      case "historyResume":
        await s.resumeConversation();
        return true;
      case "historyRename":
        s.renameConversation(message.id, message.title);
        return true;
      case "historyDelete":
        await s.deleteConversation(message.id);
        return true;
      case "historyClear":
        await s.clearHistory();
        return true;
      case "historyRefresh":
        await s.refreshHistoryProjects();
        return true;
      default:
        // `ready` est traité par l'abonnement ; le reste (ouvertures VS Code, mentions, exports…) n'a pas d'équivalent.
        return false;
    }
  }

  /** Arrêt du serveur : questions refusées, moteurs arrêtés proprement, plus aucun abonné. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const c of [...this.confirms.values()]) {
      this.confirms.delete(c.id);
      c.resolve(false);
    }
    for (const f of this.frames.values()) {
      f.bypass.dispose();
      f.session.dispose();
      f.subs.clear();
    }
    this.frames.clear();
    this.shell.clear();
  }
}
