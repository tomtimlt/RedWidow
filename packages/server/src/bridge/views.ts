/**
 * Vues `program`, `engagement`, `cockpit` et `sessions` (ADR 0052) : les contrôleurs de `logic/` sont
 * réutilisés tels quels, l'état vit sur le disque du serveur (dossier de configuration du cœur) et les
 * changements sont diffusés aux sockets abonnés. Chaque message est validé par son parseur d'origine.
 *
 * Gestes qui, dans VS Code, passent par un dialogue natif (modale de validation, import d'un fichier,
 * ouverture d'un lien, demande à l'agent, création d'un conteneur, VPN, dossier partagé, terminal) : ils
 * passent par `HostUi` (ADR 0055). Sans réponse affirmative d'un humain, rien n'est fait ; seul l'arrêt
 * d'urgence (`halt`) et sa levée n'ont aucune confirmation (geste d'urgence, ADR 0041). Comme dans
 * l'extension, l'hôte retient la vue (donc l'empreinte) affichée à chaque abonné : le navigateur ne renvoie
 * jamais d'empreinte, et un brouillon modifié depuis l'affichage est refusé par le cœur.
 */
import { CodedError, defaultConfigDir } from "@warband/core";
import { formatError, t } from "@warband/messages";
import {
  type CockpitViewPayload,
  controlListedContainer,
  linkContainer,
  listCockpitImages,
  loadCockpitView,
  parseCockpitMessage,
  setPrimary,
} from "@warband/vscode/logic/cockpit";
import {
  type ContainerRemovalConfirmation,
  type ContainerRemovalResult,
  removeListedContainer,
} from "@warband/vscode/logic/container-remove";
import {
  createEngagementControls,
  ENGAGEMENT_IMPORT_MAX_BYTES,
  type EngagementControls,
  type EngagementPageView,
  engagementCitationUrl,
  parseEngagementMessage,
} from "@warband/vscode/logic/engagement-controls";
import {
  citationUrl,
  createProgramControls,
  PROGRAM_IMPORT_MAX_BYTES,
  type ProgramControls,
  type ProgramView,
  parseProgramMessage,
} from "@warband/vscode/logic/program-controls";
import { readProjectChoices } from "@warband/vscode/logic/project-controls";
import {
  buildSessionGrid,
  parseSessionsMessage,
  type SessionGridChat,
} from "@warband/vscode/logic/session-grid";
import { CockpitGestures, defaultExegol, type ExegolPort } from "./cockpit.js";
import type { ContainerHost } from "./containers.js";
import {
  confirmSuspendPlan,
  confirmSuspendSheet,
  confirmValidateCampaign,
  confirmValidateEngagement,
} from "./engagement.js";
import type { View } from "./envelope.js";
import type { EmergencyHalt } from "./halt.js";
import type { BridgeContext } from "./hostui.js";
import { readJsonUpload } from "./imports.js";
import {
  citationLabel,
  confirmResumeHost,
  confirmSuspendProgram,
  confirmValidateProgram,
  newChatFrame,
  programDraftText,
} from "./program.js";
import { openWindowMessage } from "./shell-messages.js";

/** Destinataire d'un message sortant (même forme que `Sink` du hub). */
export interface ViewSink {
  send(view: View, frame: string, msg: Record<string, unknown>): void;
}

export interface CockpitBackend {
  load(): Promise<CockpitViewPayload>;
  link(name: string): Promise<CockpitViewPayload>;
  setPrimary(name: string): Promise<CockpitViewPayload>;
  control(action: "start" | "stop", name: string): Promise<void>;
  /** Références d'images proposées au sélecteur (`listImages`). */
  images(): Promise<string[]>;
  /** Suppression d'un conteneur listé ; `confirm` est appelé une fois, avant toute action destructive. */
  remove(
    name: string,
    options: {
      confirm(info: ContainerRemovalConfirmation): Promise<boolean>;
      signal: AbortSignal;
    },
  ): Promise<ContainerRemovalResult>;
}

/** Tout ce que les vues lisent ou modifient hors de la mémoire du processus (injectable pour les tests). */
export interface ViewBackends {
  activeProjectId(): Promise<string | null>;
  program(projectId: string): ProgramControls;
  engagement(projectId: string): EngagementControls;
  cockpit: CockpitBackend;
}

export function defaultBackends(configDir: string = defaultConfigDir()): ViewBackends {
  const deps = { configDir };
  return {
    activeProjectId: async () => (await readProjectChoices(configDir)).activeId,
    program: (id) => createProgramControls(configDir, id),
    engagement: (id) => createEngagementControls(configDir, id),
    cockpit: {
      load: () => loadCockpitView(deps),
      link: (name) => linkContainer(name, deps),
      setPrimary: (name) => setPrimary(name, deps),
      control: (action, name) => controlListedContainer(action, name),
      images: () => listCockpitImages(),
      remove: (name, options) => removeListedContainer(name, { ...options, configDir }),
    },
  };
}

/** Ce que la grille lit du hub : les chats ouverts et l'ordre d'arrivée des demandes. */
export interface SessionsSource {
  chats(): SessionGridChat[];
  waiting(): string[];
  /** Historique des conversations (index du hub) : id, titre, projet (nom), mise à jour, ouverte ou non. */
  history(): Promise<SessionHistoryItem[]>;
}

export interface SessionHistoryItem {
  id: string;
  title: string;
  project: string | null;
  updatedAt: string;
  live: boolean;
}

/** Ce que les vues utilisent du contexte du pont : dialogues, conteneurs, dossiers, Exegol. */
export interface ViewExtras {
  ctx: Pick<BridgeContext, "ui" | "uploads" | "audit">;
  containers: ContainerHost;
  /** `<données>/projects` et `<données>`. */
  projectsRoot: string;
  dataRoot: string;
  configDir: string;
  locale(): "fr" | "en";
  /** Exegol par la CLI du serveur (défaut : binaire du PATH). */
  exegol?: ExegolPort;
}

type HostedView = "program" | "engagement" | "cockpit" | "sessions";
export const HOSTED_VIEWS: readonly string[] = ["program", "engagement", "cockpit", "sessions"];
export const isHostedView = (v: string): v is HostedView => HOSTED_VIEWS.includes(v);

/** Code d'erreur sans détail : le texte est celui du catalogue côté navigateur, jamais un message brut. */
class ViewError extends Error {
  constructor(readonly code: "view.stale" | "project.changed") {
    super(code);
  }
}

const errorCode = (error: unknown): string =>
  error instanceof ViewError || error instanceof CodedError ? error.code : "view.failed";

/** Texte français (ou anglais) d'une erreur de vue : les pages n'affichent que `text`, jamais le code seul. */
function errorText(error: unknown | string, locale: "fr" | "en"): string {
  const code = typeof error === "string" ? error : errorCode(error);
  if (code === "view.stale") return t("La vue a changé : réessayez.");
  if (code === "project.changed") return t("Le projet actif a changé : réessayez.");
  if (code === "project.none") return t("Aucun projet actif : choisissez ou créez un projet.");
  if (error instanceof CodedError) return formatError(error, locale);
  return t("L'opération a échoué.");
}

/** Identifiant d'une conversation ou d'un cadre : plus large que celui de la grille (un UUID de 36 caractères passe). */
const OPEN_CHAT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** `open` d'un identifiant de l'historique ou d'un cadre, sinon le parseur de la grille (`ready`). */
function parseSessions(raw: unknown): ReturnType<typeof parseSessionsMessage> {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const m = raw as Record<string, unknown>;
    if (
      m.type === "open" &&
      Object.keys(m).length === 2 &&
      typeof m.chatId === "string" &&
      OPEN_CHAT_ID.test(m.chatId)
    )
      return { type: "open", chatId: m.chatId };
  }
  return parseSessionsMessage(raw);
}

/** Intervalle de regroupement des mises à jour de la grille (les vues arrivent en rafale pendant un tour). */
const SESSIONS_THROTTLE_MS = 100;

interface Shown<V> {
  projectId: string;
  view: V;
}

export class ViewHosts {
  private readonly subs: Record<HostedView, Map<ViewSink, string>> = {
    program: new Map(),
    engagement: new Map(),
    cockpit: new Map(),
    sessions: new Map(),
  };
  private readonly programShown = new Map<ViewSink, Shown<ProgramView>>();
  private readonly engagementShown = new Map<ViewSink, Shown<EngagementPageView>>();
  private cockpitBusy = false;
  private sessionsTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly gestures: CockpitGestures;

  constructor(
    private readonly backends: ViewBackends,
    private readonly halt: EmergencyHalt,
    private readonly sessions: SessionsSource,
    private readonly extras: ViewExtras,
  ) {
    this.gestures = new CockpitGestures({
      ctx: extras.ctx,
      backend: backends.cockpit,
      containers: extras.containers,
      projectsRoot: extras.projectsRoot,
      dataRoot: extras.dataRoot,
      configDir: extras.configDir,
      exegol: extras.exegol ?? defaultExegol(),
      locale: extras.locale,
      emit: (sink, msg) => this.emit("cockpit", sink, msg),
      emitAll: (msg) => this.emitAll("cockpit", msg),
      refresh: async () => {
        const first = this.subs.cockpit.keys().next().value;
        if (first !== undefined) await this.push("cockpit", first, true);
      },
    });
  }

  unsubscribe(sink: ViewSink): void {
    for (const map of Object.values(this.subs)) map.delete(sink);
    this.programShown.delete(sink);
    this.engagementShown.delete(sink);
    this.gestures.unsubscribe(sink);
  }

  dispose(): void {
    this.gestures.dispose();
    if (this.sessionsTimer !== undefined) clearTimeout(this.sessionsTimer);
    this.sessionsTimer = undefined;
    for (const map of Object.values(this.subs)) map.clear();
    this.programShown.clear();
    this.engagementShown.clear();
  }

  private emit(view: HostedView, sink: ViewSink, msg: Record<string, unknown>): void {
    const frame = this.subs[view].get(sink);
    if (frame !== undefined) sink.send(view, frame, msg);
  }

  private emitAll(view: HostedView, msg: Record<string, unknown>): void {
    for (const sink of this.subs[view].keys()) this.emit(view, sink, msg);
  }

  /**
   * Message d'une vue hébergée. `ready` abonne le destinataire au cadre annoncé ; le reste exige cet
   * abonnement et le même cadre. `false` : message invalide, sans équivalent serveur, ou non abonné.
   */
  async handle(
    view: HostedView,
    frame: string,
    msg: Record<string, unknown>,
    sink: ViewSink,
  ): Promise<boolean> {
    const parsed =
      view === "program"
        ? parseProgramMessage(msg)
        : view === "engagement"
          ? parseEngagementMessage(msg)
          : view === "cockpit"
            ? parseCockpitMessage(msg)
            : parseSessions(msg);
    if (parsed === null) return false;
    if (parsed.type === "ready") {
      this.subs[view].set(sink, frame);
      await this.push(view, sink);
      return true;
    }
    if (this.subs[view].get(sink) !== frame) return false;
    switch (view) {
      case "program":
        return this.program(parsed as NonNullable<ReturnType<typeof parseProgramMessage>>, sink);
      case "engagement":
        return this.engagement(
          parsed as NonNullable<ReturnType<typeof parseEngagementMessage>>,
          sink,
        );
      case "cockpit":
        return this.cockpit(parsed as NonNullable<ReturnType<typeof parseCockpitMessage>>, sink);
      case "sessions":
        return this.openChat(parsed as NonNullable<ReturnType<typeof parseSessions>>, sink);
    }
  }

  /** Envoie la vue courante (`only`) ; `all` : à tous les abonnés (après un geste). */
  private async push(view: HostedView, only: ViewSink, all = false): Promise<void> {
    try {
      if (view === "program") return await this.pushProgram(only, all);
      if (view === "engagement") return await this.pushEngagement(only, all);
      if (view === "cockpit") return await this.pushCockpit(only, all);
      await this.pushSessions(only, all);
    } catch (error) {
      this.fail(view, only, error);
    }
  }

  /**
   * Erreur d'une vue, affichable : `code` + `text` localisé. La page cockpit ne montre que le texte d'un
   * message `operation` ; program et engagement attendent `{type:"error", text}`.
   */
  private fail(view: HostedView, sink: ViewSink, error: unknown | string): void {
    const text = errorText(error, this.extras.locale());
    const code = typeof error === "string" ? error : errorCode(error);
    this.emit(view, sink, { type: "error", code, text });
    if (view === "cockpit")
      this.emit(view, sink, {
        type: "operation",
        busy: false,
        stage: "",
        layers: [],
        error: text,
        code,
      });
  }

  private async shownProject(): Promise<string | null> {
    return this.backends.activeProjectId();
  }

  private async pushProgram(only: ViewSink, all: boolean): Promise<void> {
    const projectId = await this.shownProject();
    const targets = all ? [...this.subs.program.keys()] : [only];
    if (projectId === null) {
      for (const s of targets) {
        this.programShown.delete(s);
        this.fail("program", s, "project.none");
      }
      return;
    }
    const view = await this.backends.program(projectId).view();
    for (const s of targets) {
      this.programShown.set(s, { projectId, view });
      this.emit("program", s, { type: "view", view });
    }
  }

  private async pushEngagement(only: ViewSink, all: boolean): Promise<void> {
    const projectId = await this.shownProject();
    const targets = all ? [...this.subs.engagement.keys()] : [only];
    if (projectId === null) {
      for (const s of targets) {
        this.engagementShown.delete(s);
        this.fail("engagement", s, "project.none");
      }
      return;
    }
    const view = await this.backends.engagement(projectId).view();
    for (const s of targets) {
      this.engagementShown.set(s, { projectId, view });
      this.emit("engagement", s, { type: "view", view });
    }
  }

  private async pushCockpit(only: ViewSink, all: boolean): Promise<void> {
    const payload = await this.backends.cockpit.load();
    if (all) this.emitAll("cockpit", { ...payload });
    else this.emit("cockpit", only, { ...payload });
  }

  /** Tuiles des chats ouverts, puis historique complet des conversations (id, titre, projet, mise à jour). */
  private async pushSessions(only: ViewSink, all: boolean): Promise<void> {
    const tiles = buildSessionGrid(this.sessions.chats(), this.sessions.waiting());
    const history = await this.sessions.history();
    if (all) this.emitAll("sessions", { type: "view", tiles, history });
    else this.emit("sessions", only, { type: "view", tiles, history });
  }

  /**
   * Ouvre un chat : seuls les chats ouverts et les conversations de l'historique s'ouvrent (un identifiant
   * inconnu est ignoré) ; aucune réponse d'approbation ne passe par ici. La coquille ouvre la fenêtre.
   */
  private async openChat(
    message: { type: "ready" } | { type: "open"; chatId: string },
    sink: ViewSink,
  ): Promise<boolean> {
    if (message.type !== "open") return false;
    const { chatId } = message;
    const live = this.sessions
      .chats()
      .find((c) => c.id === chatId || c.view.history.some((h) => h.current && h.id === chatId));
    // Conversation affichée dans un cadre ouvert : c'est ce cadre qui s'ouvre.
    const frame = live?.id ?? chatId;
    if (live === undefined && !(await this.sessions.history()).some((h) => h.id === chatId))
      return false;
    sink.send("shell", "shell", { ...openWindowMessage("chat", frame) });
    return true;
  }

  /**
   * Le projet actif ou la liste a changé (studio) : les vues program, engagement et cockpit sont
   * recalculées et diffusées à leurs abonnés ; les erreurs vont à l'abonné concerné.
   */
  async projectChanged(): Promise<void> {
    for (const view of ["program", "engagement", "cockpit"] as const) {
      const first = this.subs[view].keys().next().value;
      if (first !== undefined) await this.push(view, first, true);
    }
  }

  /** Une vue de chat a changé : mise à jour de la grille, regroupée. */
  sessionsChanged(): void {
    if (this.subs.sessions.size === 0 || this.sessionsTimer !== undefined) return;
    this.sessionsTimer = setTimeout(() => {
      this.sessionsTimer = undefined;
      const first = this.subs.sessions.keys().next().value;
      if (first !== undefined) void this.pushSessions(first, true).catch(() => undefined);
    }, SESSIONS_THROTTLE_MS);
    this.sessionsTimer.unref?.();
  }

  /** Le projet affiché est-il encore l'actif ? Sinon la vue est recalculée et le geste refusé. */
  private async assertShown(view: "program" | "engagement", sink: ViewSink, projectId: string) {
    if ((await this.shownProject()) === projectId) return;
    await this.push(view, sink);
    throw new ViewError("project.changed");
  }

  private async program(
    message: NonNullable<ReturnType<typeof parseProgramMessage>>,
    sink: ViewSink,
  ): Promise<boolean> {
    if (message.type === "refresh") {
      await this.push("program", sink);
      return true;
    }
    const ui = this.extras.ctx.ui;
    if (message.type === "openCitation") {
      // L'adresse vient de la vue affichée (donnée non fiable), jamais du navigateur ; http(s) seulement.
      const shown = this.programShown.get(sink);
      const url = shown === undefined ? null : citationUrl(shown.view, message.field);
      if (url !== null) await ui.external({ url, label: citationLabel(url) }, sink);
      return true;
    }
    if (message.type === "askAgent") {
      // Nouvelle mission préremplie : la consigne est fixe, seule l'adresse validée vient de la page.
      if ((await this.shownProject()) === null) {
        this.fail("program", sink, "project.none");
        return true;
      }
      const taken = new Set(this.sessions.chats().map((c) => c.id));
      sink.send("shell", "shell", {
        ...openWindowMessage("chat", newChatFrame(taken), { draft: programDraftText(message.url) }),
      });
      return true;
    }
    try {
      const shown = this.programShown.get(sink);
      if (shown === undefined) throw new ViewError("view.stale");
      await this.assertShown("program", sink, shown.projectId);
      const controls = this.backends.program(shown.projectId);
      if (message.type === "validate") {
        // L'empreinte est celle affichée : si le brouillon a changé depuis, le cœur refuse.
        const digest = shown.view.digest;
        if (digest === undefined || !shown.view.canValidate) return true;
        if (!(await ui.confirm(confirmValidateProgram(digest), sink))) return true;
        await this.assertShown("program", sink, shown.projectId);
        await controls.validate(digest);
      } else if (message.type === "suspend") {
        if (!shown.view.canSuspend) return true;
        if (!(await ui.confirm(confirmSuspendProgram(), sink))) return true;
        await this.assertShown("program", sink, shown.projectId);
        await controls.suspend();
      } else if (message.type === "resume") {
        const wanted = message.host.toLowerCase();
        const host = shown.view.haltedHosts.find((h) => h === wanted);
        if (host === undefined) return true;
        if (!(await ui.confirm(confirmResumeHost(host), sink))) return true;
        await this.assertShown("program", sink, shown.projectId);
        await controls.resume(host);
      } else if (message.type === "importFile") {
        const text = await readJsonUpload(this.extras.ctx, sink, {
          title: t("Importer la fiche"),
          limit: PROGRAM_IMPORT_MAX_BYTES,
        });
        if (text === null) return true;
        await this.assertShown("program", sink, shown.projectId);
        // Importer n'approuve rien : la validation reste le geste confirmé ci-dessus.
        await controls.importDraft(text);
      }
    } catch (error) {
      this.fail("program", sink, error);
    }
    await this.push("program", sink, true);
    return true;
  }

  private async engagement(
    message: NonNullable<ReturnType<typeof parseEngagementMessage>>,
    sink: ViewSink,
  ): Promise<boolean> {
    if (message.type === "refresh") {
      await this.push("engagement", sink);
      return true;
    }
    const ui = this.extras.ctx.ui;
    if (message.type === "openCitation") {
      const shown = this.engagementShown.get(sink);
      const url = shown === undefined ? null : engagementCitationUrl(shown.view, message.field);
      if (url !== null) await ui.external({ url, label: citationLabel(url) }, sink);
      return true;
    }
    const gestures = [
      "validateEngagement",
      "suspendSheet",
      "halt",
      "resume",
      "validateCampaign",
      "suspendPlan",
      "importEngagement",
      "importCampaign",
    ];
    if (!gestures.includes(message.type)) return false;
    // L'arrêt global ne se lève que par `shell/resume` : la page engagement ne le défait pas.
    if (message.type === "resume" && this.halt.active()) return false;
    try {
      const shown = this.engagementShown.get(sink);
      if (shown === undefined) throw new ViewError("view.stale");
      await this.assertShown("engagement", sink, shown.projectId);
      const controls = this.backends.engagement(shown.projectId);
      const v = shown.view;
      /** Confirmation humaine, puis le projet affiché doit être resté l'actif. */
      const ok = async (c: ReturnType<typeof confirmSuspendSheet>) => {
        if (!(await ui.confirm(c, sink))) return false;
        await this.assertShown("engagement", sink, shown.projectId);
        return true;
      };
      switch (message.type) {
        // Arrêt d'urgence et levée : un clic, sans confirmation (ADR 0041).
        case "halt":
          await controls.halt();
          break;
        case "resume":
          if (v.halt.active) await controls.resume();
          break;
        case "validateEngagement":
          if (
            v.digest !== undefined &&
            v.canValidate &&
            (await ok(confirmValidateEngagement(v.digest)))
          )
            await controls.validateEngagement(v.digest);
          break;
        case "suspendSheet":
          if (v.canSuspend && (await ok(confirmSuspendSheet()))) await controls.suspendSheet();
          break;
        case "validateCampaign":
          if (
            v.campaign.digest !== undefined &&
            v.campaign.canValidate &&
            (await ok(confirmValidateCampaign(v.campaign.digest)))
          )
            await controls.validateCampaign(v.campaign.digest);
          break;
        case "suspendPlan":
          if (v.campaign.canSuspend && (await ok(confirmSuspendPlan())))
            await controls.suspendPlan();
          break;
        case "importEngagement":
        case "importCampaign": {
          const text = await readJsonUpload(this.extras.ctx, sink, {
            title:
              message.type === "importEngagement"
                ? t("Importer l'engagement")
                : t("Importer le plan"),
            limit: ENGAGEMENT_IMPORT_MAX_BYTES,
          });
          if (text === null) break;
          await this.assertShown("engagement", sink, shown.projectId);
          // Importer n'approuve rien : la validation reste le geste confirmé.
          if (message.type === "importEngagement") await controls.importEngagement(text);
          else await controls.importCampaign(text);
          break;
        }
      }
    } catch (error) {
      this.fail("engagement", sink, error);
    }
    await this.push("engagement", sink, true);
    return true;
  }

  private async cockpit(
    message: NonNullable<ReturnType<typeof parseCockpitMessage>>,
    sink: ViewSink,
  ): Promise<boolean> {
    if (message.type === "refresh") {
      await this.push("cockpit", sink);
      return true;
    }
    // Annulation d'une opération longue : toujours possible, même pendant qu'elle occupe le cockpit.
    if (message.type === "cancelOperation") return this.gestures.cancel();
    // Une opération à la fois, comme dans l'extension : rien d'autre pendant qu'une opération occupe le cockpit.
    if (this.cockpitBusy) return false;
    // Gestes sans opération longue (ouvertures, listes, choix) : ils n'occupent pas le cockpit.
    const long =
      message.type === "link" ||
      message.type === "setPrimary" ||
      message.type === "start" ||
      message.type === "stop" ||
      message.type === "createKali" ||
      message.type === "createExegol" ||
      message.type === "remove";
    if (!long) {
      try {
        return await this.gestures.handle(message, sink);
      } catch (error) {
        this.fail("cockpit", sink, error);
        return true;
      }
    }
    this.cockpitBusy = true;
    try {
      if (
        message.type !== "link" &&
        message.type !== "setPrimary" &&
        message.type !== "start" &&
        message.type !== "stop"
      )
        return await this.gestures.handle(message, sink);
      const cockpit = this.backends.cockpit;
      let payload: CockpitViewPayload;
      if (message.type === "link") payload = await cockpit.link(message.name);
      else if (message.type === "setPrimary") payload = await cockpit.setPrimary(message.name);
      else {
        await cockpit.control(message.type, message.name);
        payload = await cockpit.load();
      }
      this.emitAll("cockpit", { ...payload });
    } catch (error) {
      this.fail("cockpit", sink, error);
      await this.push("cockpit", sink, true);
    } finally {
      this.cockpitBusy = false;
    }
    return true;
  }
}
