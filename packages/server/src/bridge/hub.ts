import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CodedError,
  type CredentialInput,
  type CredentialResult,
  defaultConfigDir,
  type EngineEvent,
  errorInfo,
  readProjects,
} from "@warband/core";
import type { Choice, WebviewMessage } from "@warband/vscode/logic/approval";
import {
  attachmentMessage,
  type TextAttachment,
  withAttachments,
} from "@warband/vscode/logic/attachments";
import { type BypassHost, createBypassHost } from "@warband/vscode/logic/bypass";
import type { ChatView } from "@warband/vscode/logic/chat";
import {
  createEngineController,
  type EngineController,
  type EngineControllerOptions,
} from "@warband/vscode/logic/controller";
import { readProjectChoices } from "@warband/vscode/logic/project-controls";
import { type ChatSession, createChatSession } from "@warband/vscode/logic/session";
import { createDockerApi, type DockerApi, dockerSocketPath } from "../docker/api.js";
import type { ServerStorage } from "../storage/index.js";
import { AccountStore } from "./accounts.js";
import {
  activatePoolKey,
  activePoolKey,
  addPoolKey,
  applySettingsPatch,
  deleteLayout,
  deleteToken,
  listTokens,
  readLayouts,
  readPool,
  readSettingsObject,
  removePoolKey,
  reorderPool,
  saveLayout,
  setToken,
  writePool,
} from "./config.js";
import { ContainerHost, containerEnv } from "./containers.js";
import { buildChatDeps, HISTORY_INDEX_KEY } from "./deps.js";
import { isFrameId, type View } from "./envelope.js";
import { getFindingDetail, listFindingItems, removeFinding } from "./findings.js";
import { coreProjectHalts, EmergencyHalt, type ProjectHalts } from "./halt.js";
import {
  type LiveMission,
  listMissions,
  listProjects,
  listRuns,
  missionState,
  tailAudit,
} from "./lists.js";
import {
  classifyEvent,
  type Limit,
  markKey,
  nextKey,
  nextRetryAt,
  POOL_PROVIDERS,
  type PoolProvider,
  publicPool,
  RESUME_TEXT,
  type RotationReason,
} from "./rotation.js";
import type { ShellControl } from "./shell-messages.js";
import { type Clock, TermHost } from "./term.js";
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
  /** Client de l'API Engine (injectable : tests). Défaut : socket `REDWIDOW_DOCKER_SOCKET`. */
  docker?: DockerApi;
  /** Horloge des terminaux (injectable : tests). */
  clock?: Clock;
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
  /** Clé de réserve (identifiant) avec laquelle le moteur de ce cadre a été configuré. */
  using: { provider: PoolProvider; id: string } | null;
  /** Bascule de clé en cours (ADR 0052, point 6). */
  rot: Rotation | null;
  /** Attentes de l'arrêt complet du moteur (résolues par `onView`). */
  idleWaiters: (() => boolean)[];
  /** Dernier état diffusé en `missionState` (ADR 0052). */
  lastState?: string;
}

/** Une passe de bascule : une seule fois par clé de la réserve, puis arrêt de la mission. */
interface Rotation {
  provider: PoolProvider;
  /** `switching` : arrêt et relance ; `verifying` : la relance attend une première sortie sans erreur. */
  phase: "switching" | "verifying";
  tried: Set<string>;
  sawStart: boolean;
  reason: RotationReason;
  fromLabel: string | null;
  toLabel: string | null;
}

/** Délai maximal d'attente de l'arrêt du moteur avant d'abandonner la bascule. */
const ROTATION_IDLE_MS = 15_000;

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
  private readonly term: TermHost;
  private readonly containers: ContainerHost;
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
    const docker = options.docker ?? createDockerApi({ socketPath: dockerSocketPath(process.env) });
    // Jamais le conteneur du serveur : `HOSTNAME` y vaut son identifiant court.
    const selfIds = process.env.HOSTNAME ? [process.env.HOSTNAME] : [];
    this.term = new TermHost({
      docker,
      runsDir: options.storage.paths.runs,
      selfIds,
      audit: (e) => this.audit(e),
      ...(options.clock && { clock: options.clock }),
      secretValues: async () => {
        const values: string[] = [];
        for (const key of options.storage.secrets.keys()) {
          const v = await options.storage.secrets.get(key);
          if (v) values.push(v);
        }
        return values;
      },
    });
    this.containers = new ContainerHost({
      docker,
      selfIds,
      ...containerEnv(process.env),
      projects: async () => {
        const file = await readProjects(this.configDir).catch(() => null);
        const map = new Map<string, string>();
        for (const p of file?.projects ?? []) for (const c of p.containers) map.set(c, p.name);
        return map;
      },
    });
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

  /**
   * Identifiant découvert par l'agent (outil `store_credential`) : secret au coffre, métadonnées dans l'état,
   * diffusion `accounts` sans valeur, audit sans valeur. Programme : celui demandé, sinon le projet actif ;
   * sans l'un ni l'autre, refus. Libellé déjà pris ou plafond atteint : refus. Jamais d'exception qui citerait le secret.
   */
  private async storeAgentCredential(request: CredentialInput): Promise<CredentialResult> {
    if (this.disposed) return { ok: false };
    try {
      const programme = request.programme ?? (await this.activeProject())?.id;
      if (programme === undefined) return { ok: false };
      const meta = await this.accounts.add(
        {
          programme,
          label: request.label,
          login: request.login ?? "",
          secret: request.secret,
          kind: request.kind,
        },
        "agent",
      );
      if (meta === null) return { ok: false };
      this.audit({
        kind: "account.add",
        id: meta.id,
        programme: meta.programme,
        label: meta.label,
        createdBy: "agent",
      });
      const items = this.accounts.list();
      for (const sink of this.shell) sink.send("shell", SHELL_FRAME, { type: "accounts", items });
      // Le moteur courant ne connaît pas ce compte : le suivant (au prochain message) le recevra.
      for (const f of this.frames.values()) f.session.testAccountsChanged();
      return { ok: true, id: meta.id };
    } catch {
      return { ok: false };
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
    const f = {
      id,
      subs: new Set<Sink>(),
      approvals: [],
      using: null,
      rot: null,
      idleWaiters: [],
    } as unknown as Frame;
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
        onObservedEvent: (event) => this.onEngineEvent(f, event),
        poolKey: (provider) => activePoolKey(this.options.storage, provider, Date.now()),
        onPoolKey: (provider, id) => {
          f.using = id === null ? null : { provider, id };
        },
        bypass: f.bypass,
        getTestAccounts: async () => this.accounts.testAccountsFor(await this.activeProject()),
        onCredential: (request) => this.storeAgentCredential(request),
        ...(this.options.onLog && { onLog: this.options.onLog }),
        createController: (o) =>
          this.guardStart((this.options.createController ?? createEngineController)(o)),
      }),
    );
    this.frames.set(id, f);
    this.applyGlobalBypass(f);
    return f;
  }

  /** Pendant l'arrêt global, le moteur ne démarre qu'une fois l'arrêt posé sur les projets (échec fermé). */
  private guardStart(ctl: EngineController): EngineController {
    const start = ctl.start.bind(ctl);
    ctl.start = async (params) => {
      if (this.halt.active()) await this.halt.ensureProjects();
      return start(params);
    };
    return ctl;
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
    f.idleWaiters = f.idleWaiters.filter((wait) => !wait());
    this.pushApprovals(false);
    this.pushMissionState(f, view);
    this.views.sessionsChanged();
  }

  /** Diffuse `missionState` quand l'état d'un cadre vivant change (dock, palette). */
  private pushMissionState(f: Frame, view: ChatView): void {
    const id = view.conversation ?? f.id;
    const state = missionState(view);
    const key = `${id}:${state}`;
    if (f.lastState === key) return;
    f.lastState = key;
    this.toShell({ type: "missionState", id, state });
  }

  /** Cadres vivants : conversation affichée (à défaut l'identifiant du cadre) et état. */
  private liveMissions(): LiveMission[] {
    return [...this.frames.values()].map((f) => {
      const view = f.session.view();
      return { id: view.conversation ?? f.id, state: missionState(view) };
    });
  }

  private toShell(msg: Record<string, unknown>): void {
    for (const sink of this.shell) sink.send("shell", SHELL_FRAME, msg);
  }

  /** Bascule : journal d'audit (libellés seulement) et diffusion `poolEvent`. Jamais une valeur de clé. */
  private emitRotation(
    provider: PoolProvider,
    from: string | null,
    to: string | null,
    reason: RotationReason,
    phase: "switched" | "confirmed" | "failed" | "exhausted",
  ): void {
    const entry = { provider, from, to, reason, phase };
    this.audit({ kind: "provider.rotated", ...entry });
    this.toShell({ type: "poolEvent", ...entry });
  }

  private pushPool(provider: PoolProvider): void {
    this.toShell({
      type: "pool",
      ...publicPool(provider, readPool(this.options.storage, provider)),
    });
  }

  /** Événement du moteur d'un cadre : détection d'une limite, puis vérification de la bascule en cours. */
  private onEngineEvent(f: Frame, event: EngineEvent | null): void {
    if (event === null || this.disposed) return;
    const rot = f.rot;
    // Arrêt et relance en cours : les événements de l'ancien moteur n'ont plus de sens.
    if (rot?.phase === "switching") return;
    const limit = classifyEvent(event, Date.now());
    if (rot?.phase === "verifying") {
      if (event.kind === "session.started" || event.kind === "run.started") rot.sawStart = true;
      if (limit) void this.rotate(f, limit);
      else if (rot.sawStart && event.kind === "agent.text") {
        f.rot = null;
        this.emitRotation(rot.provider, rot.fromLabel, rot.toLabel, rot.reason, "confirmed");
      }
      return;
    }
    if (limit && f.using !== null) void this.rotate(f, limit);
  }

  /** Attend que le moteur du cadre soit complètement arrêté (ni occupé, ni en cours d'arrêt). */
  private waitIdle(f: Frame): Promise<boolean> {
    const idle = () => {
      const v = f.session.view();
      return !v.busy && v.stopping !== true;
    };
    if (idle()) return Promise.resolve(true);
    return new Promise<boolean>((done) => {
      const timer = setTimeout(() => {
        f.idleWaiters = f.idleWaiters.filter((w) => w !== wait);
        done(false);
      }, ROTATION_IDLE_MS);
      const wait = () => {
        if (!idle()) return false;
        clearTimeout(timer);
        done(true);
        return true;
      };
      f.idleWaiters.push(wait);
    });
  }

  /** Arrête le moteur d'un cadre : demandes en attente refusées (jamais approuvées), puis arrêt. */
  private async haltEngine(f: Frame): Promise<boolean> {
    for (const a of [...f.approvals]) await f.session.approve(a.toolUseId, "deny");
    f.session.stop();
    return this.waitIdle(f);
  }

  /**
   * Bascule vers la clé suivante de la réserve : la clé en défaut est marquée, le moteur est arrêté puis
   * relancé avec la clé suivante (même conversation, `resume`), et un message de reprise est envoyé.
   * Une seule passe sur la réserve ; tout épuisé : mission arrêtée et `poolExhausted` diffusé.
   */
  private async rotate(f: Frame, limit: Limit): Promise<void> {
    const using = f.using;
    if (using === null || this.disposed) return;
    const { provider } = using;
    const storage = this.options.storage;
    const prev = f.rot;
    const rot: Rotation = prev ?? {
      provider,
      phase: "switching",
      tried: new Set(),
      sawStart: false,
      reason: limit.reason,
      fromLabel: null,
      toLabel: null,
    };
    rot.phase = "switching";
    rot.sawStart = false;
    rot.reason = limit.reason;
    f.rot = rot;
    const now = Date.now();
    let pool = readPool(storage, provider);
    const failedLabel = pool.keys[using.id]?.label ?? null;
    if (prev) this.emitRotation(provider, prev.fromLabel, prev.toLabel, limit.reason, "failed");
    rot.tried.add(using.id);
    pool = markKey(pool, using.id, limit.reason, limit.retryAt, now);
    const next = nextKey(pool, using.id, now, rot.tried);
    if (next === null) {
      writePool(storage, provider, pool);
      f.rot = null;
      this.pushPool(provider);
      this.emitRotation(provider, failedLabel, null, limit.reason, "exhausted");
      this.toShell({ type: "poolExhausted", provider, nextRetryAt: nextRetryAt(pool) });
      await this.haltEngine(f);
      return;
    }
    pool.active = next;
    writePool(storage, provider, pool);
    this.pushPool(provider);
    rot.fromLabel = failedLabel;
    rot.toLabel = pool.keys[next]?.label ?? null;
    this.emitRotation(provider, rot.fromLabel, rot.toLabel, limit.reason, "switched");
    const stopped = await this.haltEngine(f);
    if (this.disposed || f.rot !== rot) return;
    rot.phase = "verifying";
    let sent = false;
    if (stopped) sent = await f.session.send(RESUME_TEXT).catch(() => false);
    if (this.disposed || f.rot !== rot) return;
    if (!sent) {
      // Relance impossible : la passe s'arrête là, le moteur reste arrêté (rien n'est approuvé ni relancé).
      f.rot = null;
      this.emitRotation(provider, rot.fromLabel, rot.toLabel, limit.reason, "failed");
    }
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
    this.term.detach(sink);
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

  /** Message de la vue `term` (terminal humain, hors gate : ADR 0053). */
  async handleTerm(frame: string, msg: Record<string, unknown>, from: Sink): Promise<boolean> {
    if (this.disposed) return false;
    return this.term.handle(frame, msg, from);
  }

  /** Toutes les écritures de journaux de terminal en cours sont terminées (arrêt du serveur). */
  settled(): Promise<void> {
    return this.term.settled();
  }

  private async pushContainers(only?: Sink): Promise<void> {
    const items = await this.containers.list();
    for (const sink of only ? [only] : this.shell)
      sink.send("shell", SHELL_FRAME, { type: "containers", items });
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
      case "containersList":
      case "containerStart":
      case "containerStop":
      case "containerCreate":
        try {
          if (c.type === "containerStart" || c.type === "containerStop") {
            const name = await this.containers.setRunning(c.id, c.type === "containerStart");
            this.audit({ kind: c.type, container: name });
          } else if (c.type === "containerCreate") {
            await this.containers.createKali(c.name);
            this.audit({ kind: "containerCreate", container: c.name });
          }
          await this.pushContainers(c.type === "containersList" ? from : undefined);
          return true;
        } catch (err) {
          // Code seulement : jamais le message brut du démon.
          from.send("shell", SHELL_FRAME, {
            type: "containerError",
            op: c.type,
            code: err instanceof CodedError ? errorInfo(err).code : "container.failed",
          });
          return false;
        }
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
      case "poolList":
        for (const provider of POOL_PROVIDERS)
          from.send("shell", SHELL_FRAME, {
            type: "pool",
            ...publicPool(provider, readPool(storage, provider)),
          });
        return true;
      case "poolAdd": {
        const id = await addPoolKey(storage, c.provider, c.label, c.value, Date.now());
        if (id === null) return this.configError(from, c.type);
        this.audit({ kind: "pool.add", provider: c.provider, id, label: c.label });
        this.poolChanged(c.provider);
        return true;
      }
      case "poolRemove":
        if (!(await removePoolKey(storage, c.provider, c.id, Date.now())))
          return this.configError(from, c.type);
        this.audit({ kind: "pool.remove", provider: c.provider, id: c.id });
        this.poolChanged(c.provider);
        return true;
      case "poolReorder":
        if (!reorderPool(storage, c.provider, c.order)) return this.configError(from, c.type);
        this.audit({ kind: "pool.reorder", provider: c.provider });
        this.poolChanged(c.provider);
        return true;
      case "poolActivate":
        if (!activatePoolKey(storage, c.provider, c.id, Date.now()))
          return this.configError(from, c.type);
        this.audit({ kind: "pool.activate", provider: c.provider, id: c.id });
        this.poolChanged(c.provider);
        return true;
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
        for (const f of this.frames.values()) f.session.testAccountsChanged();
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
        for (const f of this.frames.values()) f.session.testAccountsChanged();
        return true;
      case "findingsList":
        try {
          const items = await listFindingItems(this.configDir, c.project);
          from.send("shell", SHELL_FRAME, { type: "findings", project: c.project, items });
          return true;
        } catch {
          return this.configError(from, c.type);
        }
      case "findingGet":
        try {
          const finding = await getFindingDetail(this.configDir, c.project, c.id);
          from.send("shell", SHELL_FRAME, { type: "finding", finding });
          return true;
        } catch {
          return this.configError(from, c.type);
        }
      case "findingDelete":
        // Sans confirmation explicite du client, rien n'est supprimé.
        if (!c.confirmed) return this.configError(from, c.type);
        try {
          if (!(await removeFinding(this.configDir, c.project, c.id))) {
            return this.configError(from, c.type);
          }
          this.audit({ kind: "finding.delete", project: c.project, id: c.id });
          toAll({
            type: "findings",
            project: c.project,
            items: await listFindingItems(this.configDir, c.project),
          });
          return true;
        } catch {
          return this.configError(from, c.type);
        }
      case "missionsList":
        from.send("shell", SHELL_FRAME, {
          type: "missions",
          items: listMissions(storage.state.get(HISTORY_INDEX_KEY), this.liveMissions()),
        });
        return true;
      case "runsList":
        try {
          const items = await listRuns(
            storage.paths.runs,
            storage.state.get(HISTORY_INDEX_KEY),
            c.project,
          );
          from.send("shell", SHELL_FRAME, { type: "runs", items });
          return true;
        } catch {
          return this.configError(from, c.type);
        }
      case "projectsList":
        try {
          from.send("shell", SHELL_FRAME, {
            type: "projects",
            items: await listProjects(this.configDir),
          });
          return true;
        } catch {
          return this.configError(from, c.type);
        }
      case "auditTail":
        try {
          const items = await tailAudit(join(storage.paths.root, "audit.jsonl"), c.limit);
          from.send("shell", SHELL_FRAME, { type: "audit", items });
          return true;
        } catch {
          return this.configError(from, c.type);
        }
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

  /** Réserve modifiée par l'utilisateur : diffusée, et répercutée aux sessions (comme un changement de jeton). */
  private poolChanged(provider: PoolProvider): void {
    this.pushPool(provider);
    for (const f of this.frames.values()) void f.session.authChanged().catch(() => undefined);
  }

  /** Arrêt du serveur : questions refusées, moteurs arrêtés proprement, plus aucun abonné. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.bypassTimer !== undefined) clearTimeout(this.bypassTimer);
    this.bypassTimer = undefined;
    this.globalBypass = null;
    this.views.dispose();
    this.term.dispose();
    for (const c of [...this.confirms.values()]) {
      this.confirms.delete(c.id);
      c.resolve(false);
    }
    for (const f of this.frames.values()) {
      f.bypass.dispose();
      f.rot = null;
      f.idleWaiters = [];
      f.session.dispose();
      f.subs.clear();
    }
    this.frames.clear();
    this.shell.clear();
  }
}
