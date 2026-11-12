/**
 * Vues `program`, `engagement`, `cockpit` et `sessions` (ADR 0052) : les contrôleurs de `logic/` sont
 * réutilisés tels quels, l'état vit sur le disque du serveur (dossier de configuration du cœur) et les
 * changements sont diffusés aux sockets abonnés. Chaque message est validé par son parseur d'origine.
 *
 * Gestes qui, dans VS Code, passent par un dialogue natif (import d'un fichier, ouverture d'un lien,
 * demande à l'agent) : sans équivalent ici, ils sont ignorés. Comme dans l'extension, l'hôte retient la
 * vue (donc l'empreinte) affichée à chaque abonné : le navigateur ne renvoie jamais d'empreinte, et un
 * brouillon modifié depuis l'affichage est refusé par le cœur.
 */
import { CodedError, defaultConfigDir } from "@warband/core";
import {
  type CockpitViewPayload,
  controlListedContainer,
  linkContainer,
  loadCockpitView,
  parseCockpitMessage,
  setPrimary,
} from "@warband/vscode/logic/cockpit";
import {
  createEngagementControls,
  type EngagementControls,
  type EngagementPageView,
  parseEngagementMessage,
} from "@warband/vscode/logic/engagement-controls";
import {
  createProgramControls,
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
import type { View } from "./envelope.js";
import type { EmergencyHalt } from "./halt.js";

/** Destinataire d'un message sortant (même forme que `Sink` du hub). */
export interface ViewSink {
  send(view: View, frame: string, msg: Record<string, unknown>): void;
}

export interface CockpitBackend {
  load(): Promise<CockpitViewPayload>;
  link(name: string): Promise<CockpitViewPayload>;
  setPrimary(name: string): Promise<CockpitViewPayload>;
  control(action: "start" | "stop", name: string): Promise<void>;
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
    },
  };
}

/** Ce que la grille lit du hub : les chats ouverts et l'ordre d'arrivée des demandes. */
export interface SessionsSource {
  chats(): SessionGridChat[];
  waiting(): string[];
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

  constructor(
    private readonly backends: ViewBackends,
    private readonly halt: EmergencyHalt,
    private readonly sessions: SessionsSource,
  ) {}

  unsubscribe(sink: ViewSink): void {
    for (const map of Object.values(this.subs)) map.delete(sink);
    this.programShown.delete(sink);
    this.engagementShown.delete(sink);
  }

  dispose(): void {
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
            : parseSessionsMessage(msg);
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
      case "sessions": {
        const open = parsed as NonNullable<ReturnType<typeof parseSessionsMessage>>;
        // Seuls les chats ouverts s'ouvrent ; aucune réponse d'approbation ne passe par ici.
        if (open.type !== "open" || !this.sessions.chats().some((c) => c.id === open.chatId))
          return false;
        this.emit("sessions", sink, { type: "open", chatId: open.chatId });
        return true;
      }
    }
  }

  /** Envoie la vue courante (`only`) ; `all` : à tous les abonnés (après un geste). */
  private async push(view: HostedView, only: ViewSink, all = false): Promise<void> {
    try {
      if (view === "program") return await this.pushProgram(only, all);
      if (view === "engagement") return await this.pushEngagement(only, all);
      if (view === "cockpit") return await this.pushCockpit(only, all);
      this.pushSessions(only, all);
    } catch (error) {
      this.emit(view, only, { type: "error", code: errorCode(error) });
    }
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
        this.emit("program", s, { type: "error", code: "project.none" });
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
        this.emit("engagement", s, { type: "error", code: "project.none" });
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

  private pushSessions(only: ViewSink, all: boolean): void {
    const tiles = buildSessionGrid(this.sessions.chats(), this.sessions.waiting());
    if (all) this.emitAll("sessions", { type: "view", tiles });
    else this.emit("sessions", only, { type: "view", tiles });
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
      if (first !== undefined) this.pushSessions(first, true);
    }, SESSIONS_THROTTLE_MS);
    this.sessionsTimer.unref?.();
  }

  private async program(
    message: NonNullable<ReturnType<typeof parseProgramMessage>>,
    sink: ViewSink,
  ): Promise<boolean> {
    if (message.type === "refresh") {
      await this.push("program", sink);
      return true;
    }
    if (message.type !== "validate" && message.type !== "suspend" && message.type !== "resume")
      return false;
    try {
      const shown = this.programShown.get(sink);
      if (shown === undefined) throw new ViewError("view.stale");
      if ((await this.shownProject()) !== shown.projectId) {
        await this.push("program", sink);
        throw new ViewError("project.changed");
      }
      const controls = this.backends.program(shown.projectId);
      if (message.type === "validate") {
        // L'empreinte est celle affichée : si le brouillon a changé depuis, le cœur refuse.
        if (shown.view.digest === undefined || !shown.view.canValidate) return true;
        await controls.validate(shown.view.digest);
      } else if (message.type === "suspend") {
        if (!shown.view.canSuspend) return true;
        await controls.suspend();
      } else {
        const wanted = message.type === "resume" ? message.host.toLowerCase() : "";
        const host = shown.view.haltedHosts.find((h) => h === wanted);
        if (host === undefined) return true;
        await controls.resume(host);
      }
    } catch (error) {
      this.emit("program", sink, { type: "error", code: errorCode(error) });
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
    const gestures = [
      "validateEngagement",
      "suspendSheet",
      "halt",
      "resume",
      "validateCampaign",
      "suspendPlan",
    ];
    if (!gestures.includes(message.type)) return false;
    // L'arrêt global ne se lève que par `shell/resume` : la page engagement ne le défait pas.
    if (message.type === "resume" && this.halt.active()) return false;
    try {
      const shown = this.engagementShown.get(sink);
      if (shown === undefined) throw new ViewError("view.stale");
      if ((await this.shownProject()) !== shown.projectId) {
        await this.push("engagement", sink);
        throw new ViewError("project.changed");
      }
      const controls = this.backends.engagement(shown.projectId);
      const v = shown.view;
      switch (message.type) {
        case "halt":
          await controls.halt();
          break;
        case "resume":
          if (v.halt.active) await controls.resume();
          break;
        case "validateEngagement":
          if (v.digest !== undefined && v.canValidate) await controls.validateEngagement(v.digest);
          break;
        case "suspendSheet":
          if (v.canSuspend) await controls.suspendSheet();
          break;
        case "validateCampaign":
          if (v.campaign.digest !== undefined && v.campaign.canValidate)
            await controls.validateCampaign(v.campaign.digest);
          break;
        case "suspendPlan":
          if (v.campaign.canSuspend) await controls.suspendPlan();
          break;
      }
    } catch (error) {
      this.emit("engagement", sink, { type: "error", code: errorCode(error) });
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
    if (
      message.type !== "link" &&
      message.type !== "setPrimary" &&
      message.type !== "start" &&
      message.type !== "stop"
    )
      return false;
    // Une opération à la fois, comme dans l'extension.
    if (this.cockpitBusy) return false;
    this.cockpitBusy = true;
    try {
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
      this.emit("cockpit", sink, { type: "error", code: errorCode(error) });
      await this.push("cockpit", sink, true);
    } finally {
      this.cockpitBusy = false;
    }
    return true;
  }
}
