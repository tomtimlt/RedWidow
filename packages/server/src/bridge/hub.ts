import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultConfigDir } from "@warband/core";
import type { Choice, WebviewMessage } from "@warband/vscode/logic/approval";
import {
  attachmentMessage,
  type TextAttachment,
  withAttachments,
} from "@warband/vscode/logic/attachments";
import { type BypassHost, createBypassHost } from "@warband/vscode/logic/bypass";
import type { ChatView } from "@warband/vscode/logic/chat";
import type { EngineController, EngineControllerOptions } from "@warband/vscode/logic/controller";
import { readProjectChoices } from "@warband/vscode/logic/project-controls";
import { type ChatSession, createChatSession } from "@warband/vscode/logic/session";
import type { ServerStorage } from "../storage/index.js";
import { AccountStore } from "./accounts.js";
import {
  applySettingsPatch,
  deleteLayout,
  deleteToken,
  listTokens,
  readLayouts,
  readSettingsObject,
  saveLayout,
  setToken,
} from "./config.js";
import { buildChatDeps } from "./deps.js";
import { isFrameId, type View } from "./envelope.js";
import { coreProjectHalts, EmergencyHalt, type ProjectHalts } from "./halt.js";
import type { ShellControl } from "./shell-messages.js";
import { defaultBackends, isHostedView, type ViewBackends, ViewHosts } from "./views.js";

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
  /** Dossier de configuration du cœur (projets, fiche, engagement). Défaut : celui du moteur (`defaultConfigDir`). */
  configDir?: string;
  /** Lecture et écriture des vues program, engagement et cockpit (injectable : tests). */
  backends?: ViewBackends;
  /** Arrêts d'urgence par projet (injectable : tests). */
  projectHalts?: ProjectHalts;
  /**
   * Journal d'audit des gestes sensibles (arrêt, Bypass, jetons, comptes). Reçoit des champs
   * non secrets seulement : jamais une valeur de jeton, de secret ou de compte.
   */
  audit?(entry: Record<string, unknown>): void;
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
  private readonly halt: EmergencyHalt;
  private readonly accounts: AccountStore;
  private readonly views: ViewHosts;
  private readonly configDir: string;
  /** Bypass global demandé depuis la coquille (en mémoire seulement, ADR 0017) ; `until` nul = illimité. */
  private globalBypass: { until: number | null } | null = null;
  private bypassTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly enginePath: string;
  private readonly binRoot: string;
  private readonly cwd: string;

  constructor(private readonly options: HubOptions) {
    const engine = resolveEngine(process.env);
    this.enginePath = options.enginePath ?? engine.enginePath;
    this.binRoot = options.binRoot ?? engine.binRoot;
    this.cwd = options.cwd ?? options.storage.paths.projects;
    this.configDir = options.configDir ?? defaultConfigDir();
    this.halt = new EmergencyHalt(
      options.storage,
      options.projectHalts ?? coreProjectHalts(this.configDir),
    );
    this.accounts = new AccountStore(options.storage);
    this.views = new ViewHosts(options.backends ?? defaultBackends(this.configDir), this.halt, {
      chats: () =>
        [...this.frames.values()].map((f) => ({
          id: f.id,
          name: f.id,
          location: "editor" as const,
          view: f.session.view(),
        })),
      waiting: () =>
        [...this.frames.values()].filter((f) => f.approvals.length > 0).map((f) => f.id),
    });
  }

  private audit(entry: Record<string, unknown>): void {
    try {
      this.options.audit?.(entry);
    } catch {
      // Le journal d'audit ne doit jamais bloquer un geste humain déjà appliqué.
    }
  }

  /** Projet actif (identifiant et nom), `null` sans projet ou si le fichier est illisible. */
  private async activeProject(): Promise<{ id: string; name: string } | null> {
    const choices = await readProjectChoices(this.configDir).catch(() => null);
    return choices?.projects.find((p) => p.id === choices.activeId) ?? null;
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
        getTestAccounts: async () => this.accounts.testAccountsFor(await this.activeProject()),
        ...(this.options.onLog && { onLog: this.options.onLog }),
        ...(this.options.createController && { createController: this.options.createController }),
      }),
    );
    this.frames.set(id, f);
    this.applyGlobalBypass(f);
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
    this.views.sessionsChanged();
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
    this.pushHalt(sink);
    this.pushBypass(sink);
    this.pushApprovals(true, sink);
    for (const c of this.confirms.values()) sink.send("shell", SHELL_FRAME, this.confirmMessage(c));
  }

  /** Retire un destinataire (socket fermé). Les demandes et les moteurs restent : rien n'est répondu. */
  unsubscribe(sink: Sink): void {
    this.shell.delete(sink);
    this.views.unsubscribe(sink);
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
    // Arrêt d'urgence : aucune autorisation ne passe, seul un refus est accepté.
    if (this.halt.active() && choice !== "deny") return false;
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
        if (this.halt.active() && message.choice !== "deny") return false;
        await s.approve(message.toolUseId, message.choice);
        return true;
      case "setBypass":
        if (message.enabled && this.halt.active()) return false;
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

  /** Arrêt d'urgence actif ? (lu par le canal et les vues) */
  halted(): boolean {
    return this.halt.active();
  }

  private pushHalt(only?: Sink): void {
    const { active, since } = this.halt.state();
    for (const sink of only ? [only] : this.shell)
      sink.send("shell", SHELL_FRAME, { type: "halt", active, since });
  }

  /**
   * Arrêt d'urgence (`halt`) ou levée (`resume`), pour tous les cadres. Le Bypass est coupé avant tout :
   * il ne contourne jamais l'arrêt, et personne ne peut l'activer tant que l'arrêt dure.
   */
  async emergencyHalt(on: boolean): Promise<void> {
    if (this.disposed) return;
    this.audit({ kind: on ? "halt.on" : "halt.off" });
    if (on) this.setGlobalBypass(false, null);
    if (on) {
      for (const f of this.frames.values()) f.bypass.request(false, true);
      await this.halt.halt();
    } else await this.halt.resume();
    this.pushHalt();
  }

  private pushBypass(only?: Sink): void {
    const g = this.globalBypass;
    for (const sink of only ? [only] : this.shell)
      sink.send("shell", SHELL_FRAME, {
        type: "bypass",
        active: g !== null,
        until: g === null ? null : g.until,
      });
  }

  /** Applique le Bypass global à un cadre (création tardive) : seulement si l'échéance laisse au moins 1 minute. */
  private applyGlobalBypass(f: Frame): void {
    const g = this.globalBypass;
    if (g === null) return;
    const remaining = g.until === null ? null : g.until - Date.now();
    if (remaining !== null && remaining < 60_000) return;
    f.bypass.request(true, true, remaining);
  }

  /**
   * Bypass global (ADR 0017 inchangé : effet seulement si un humain répond aux demandes). `minutes`
   * nul : illimité, comme le cœur l'autorise. Refusé pendant l'arrêt d'urgence. État en mémoire seulement.
   */
  setGlobalBypass(active: boolean, minutes: number | null): boolean {
    if (this.disposed) return false;
    if (this.bypassTimer !== undefined) clearTimeout(this.bypassTimer);
    this.bypassTimer = undefined;
    if (active) {
      if (this.halt.active()) return false;
      const ms = minutes === null ? null : minutes * 60_000;
      const until = ms === null ? null : Date.now() + ms;
      this.globalBypass = { until };
      for (const f of this.frames.values()) f.bypass.request(true, true, ms);
      if (ms !== null) {
        this.bypassTimer = setTimeout(() => {
          this.bypassTimer = undefined;
          this.globalBypass = null;
          this.pushBypass();
        }, ms);
        this.bypassTimer.unref?.();
      }
      this.audit({ kind: "bypass.on", until });
    } else {
      const was = this.globalBypass !== null;
      this.globalBypass = null;
      for (const f of this.frames.values()) f.bypass.request(false, true);
      if (was) this.audit({ kind: "bypass.off" });
    }
    this.pushBypass();
    return true;
  }

  /** Message d'une vue hébergée (program, engagement, cockpit, sessions) : validé par son parseur. */
  async handleView(
    view: View,
    frame: string,
    msg: Record<string, unknown>,
    from: Sink,
  ): Promise<boolean> {
    if (this.disposed || !isHostedView(view)) return false;
    return this.views.handle(view, frame, msg, from);
  }

  private configError(to: Sink, op: string): false {
    to.send("shell", SHELL_FRAME, { type: "configError", op });
    return false;
  }

  /**
   * Message de contrôle de la coquille (déjà validé par `parseShellControl`). Les réponses portant un
   * secret (`accountSecret`) ne vont qu'à `from` ; ce qui est diffusé ne contient jamais de valeur secrète.
   * `false` : demande refusée (une `configError` sans détail a été renvoyée au demandeur).
   */
  async control(c: ShellControl, from: Sink): Promise<boolean> {
    if (this.disposed) return false;
    const storage = this.options.storage;
    const toAll = (msg: Record<string, unknown>) => {
      for (const sink of this.shell) sink.send("shell", SHELL_FRAME, msg);
    };
    switch (c.type) {
      case "halt":
        await this.emergencyHalt(true);
        return true;
      case "resume":
        await this.emergencyHalt(false);
        return true;
      case "setBypass":
        return this.setGlobalBypass(c.active, c.durationMinutes) || this.configError(from, c.type);
      case "settingsGet":
        from.send("shell", SHELL_FRAME, { type: "settings", values: readSettingsObject(storage) });
        return true;
      case "settingsSet": {
        const values = applySettingsPatch(storage, c.patch);
        if (values === null) return this.configError(from, c.type);
        this.audit({ kind: "settings.set", keys: Object.keys(c.patch) });
        toAll({ type: "settings", values });
        return true;
      }
      case "tokens":
        from.send("shell", SHELL_FRAME, { type: "tokens", items: await listTokens(storage) });
        return true;
      case "tokenSet":
      case "tokenDelete": {
        if (c.type === "tokenSet") await setToken(storage, c.provider, c.kind, c.value);
        else await deleteToken(storage, c.provider);
        this.audit({
          kind: c.type === "tokenSet" ? "token.set" : "token.delete",
          provider: c.provider,
        });
        // Le changement d'authentification est répercuté aux sessions (modèles, grisage sans jeton).
        for (const f of this.frames.values()) void f.session.authChanged().catch(() => undefined);
        toAll({ type: "tokens", items: await listTokens(storage) });
        return true;
      }
      case "accounts":
        from.send("shell", SHELL_FRAME, { type: "accounts", items: this.accounts.list() });
        return true;
      case "accountAdd": {
        const meta = await this.accounts.add({
          programme: c.programme,
          label: c.label,
          login: c.login,
          secret: c.secret,
        });
        if (meta === null) return this.configError(from, c.type);
        this.audit({
          kind: "account.add",
          id: meta.id,
          programme: meta.programme,
          label: meta.label,
        });
        toAll({ type: "accounts", items: this.accounts.list() });
        return true;
      }
      case "accountReveal": {
        const value = await this.accounts.reveal(c.id);
        if (value === null) return this.configError(from, c.type);
        // Audit sans la valeur ; la réponse ne va qu'au socket demandeur.
        this.audit({ kind: "account.reveal", id: c.id });
        from.send("shell", SHELL_FRAME, { type: "accountSecret", id: c.id, value });
        return true;
      }
      case "accountRemove":
        if (!(await this.accounts.remove(c.id))) return this.configError(from, c.type);
        this.audit({ kind: "account.remove", id: c.id });
        toAll({ type: "accounts", items: this.accounts.list() });
        return true;
      case "layouts":
        from.send("shell", SHELL_FRAME, { type: "layouts", ...readLayouts(storage) });
        return true;
      case "layoutSave":
        if (!saveLayout(storage, c.name, c.layout)) return this.configError(from, c.type);
        toAll({ type: "layouts", ...readLayouts(storage) });
        return true;
      case "layoutDelete":
        if (!deleteLayout(storage, c.name)) return this.configError(from, c.type);
        toAll({ type: "layouts", ...readLayouts(storage) });
        return true;
    }
  }

  /** Arrêt du serveur : questions refusées, moteurs arrêtés proprement, plus aucun abonné. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.bypassTimer !== undefined) clearTimeout(this.bypassTimer);
    this.bypassTimer = undefined;
    this.globalBypass = null;
    this.views.dispose();
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
