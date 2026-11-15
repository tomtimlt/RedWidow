import { randomUUID } from "node:crypto";
import {
  type AgentCampaignPort,
  type BypassState,
  type CampaignRunStatus,
  CodedError,
  createCampaignCoordinator,
  createLocalCampaignPort,
  DEFAULT_MAX_WORKERS,
  type ErrorInfo,
  errorInfo,
  type IntentClosure,
  type IntentDraft,
  MAX_WORKERS_LIMIT,
  type Reason,
  type Recorder,
  reason,
} from "@warband/core";
import { type ApprovalCard, answerFor, type Choice, cleanText, toCard } from "./approval.js";
import type { FromEngine, MultiAgentParams, ToEngine } from "./protocol.js";

/**
 * Hôte de campagne multi-agents (ADR 0054, lot 3a) : module pur, sans `vscode` ni processus.
 * Le lancement réel des moteurs est injecté (`spawnEngine`, port vers `controller.ts`). L'hôte
 * tient le coordinateur (seule source de vérité), route les approbations par `toolUseId`,
 * diffuse le Bypass et arrête tout à la fin. Chaque moteur garde sa gate et son `ask`.
 */

/** Une campagne active à la fois dans l'extension (borne le nombre de processus). */
let activeCampaign = false;

export function isCampaignActive(): boolean {
  return activeCampaign;
}

const activityListeners = new Set<() => void>();

/**
 * Abonnement au changement « campagne active » (lecteur sans état global supplémentaire : les
 * autres chats se rafraîchissent). L'avis est différé d'un micro-cycle : l'appelant a fini de se brancher.
 */
export function onCampaignActivity(listener: () => void): () => void {
  activityListeners.add(listener);
  return () => void activityListeners.delete(listener);
}

function setCampaignActive(value: boolean): void {
  if (activeCampaign === value) return;
  activeCampaign = value;
  queueMicrotask(() => {
    for (const listener of [...activityListeners]) {
      try {
        listener();
      } catch {
        // Un abonné défaillant ne doit pas gêner les autres.
      }
    }
  });
}

export type CampaignAgentRole = "planner" | "worker";

/** Ce que `spawnEngine` reçoit pour lancer un moteur de campagne. */
export interface EngineSpec {
  /** Identifiant de run choisi par l'hôte : le moteur doit l'adopter (`multiAgent.runId`). */
  runId: string;
  role: CampaignAgentRole;
  /** 0 pour le planificateur, 1.. pour les workers (dans l'ordre de lancement). */
  index: number;
  /** Paramètres `multiAgent` du message `start`. */
  multiAgent: MultiAgentParams;
  /** Première consigne du run (objectif, intention ou instantané). */
  prompt: string;
}

/** Moteur lancé : `send` est mis en file jusqu'à ce que le moteur ait démarré. */
export interface EngineHandle {
  runId: string;
  send(message: ToEngine): void;
  onMessage(callback: (message: FromEngine) => void): void;
  onExit(callback: () => void): void;
  stop(): void;
}

export interface CampaignAgentInfo {
  role: CampaignAgentRole;
  index: number;
  runId: string;
  intent?: { id: string; title: string; rationale: string };
}

export interface CampaignHostOptions {
  objective: string;
  /** Workers simultanés, de 1 à 8 ; 3 par défaut. */
  workers?: number;
  spawnEngine: (spec: EngineSpec) => EngineHandle;
  /** Recorder du journal de campagne. */
  recorder: Recorder;
  now?: () => number;
  /** Délai anti-rebond avant de réveiller le planificateur (défaut : 2000 ms). */
  debounceMs?: number;
  /** Carte d'approbation d'un moteur de la campagne, déjà estampillée `agent`. */
  onApproval?: (card: ApprovalCard) => void;
  /** Tout autre message d'un moteur (événements, `started`, `ended`, erreurs…). */
  onMessage?: (agent: CampaignAgentInfo, message: FromEngine) => void;
  /** L'état de la campagne a changé (intention ouverte, prise, fermée, moteur sorti) : la vue se rafraîchit. */
  onChange?: () => void;
  /** La campagne est terminée (fin normale, `stop()` ou arrêt d'urgence). */
  onFinished?: (why: Reason) => void;
}

export interface CampaignHost {
  /** Réponse de l'utilisateur à une carte ; `false` (sans effet) si le `toolUseId` est inconnu. */
  answer(toolUseId: string, choice: Choice): boolean;
  /** Diffuse l'état du Bypass du chat à tous les moteurs vivants, et aux workers lancés plus tard. */
  setBypass(state: BypassState | null): void;
  /** Arrête tous les moteurs ; `emergency` pour l'arrêt d'urgence. Idempotent. */
  stop(cause?: "user" | "emergency"): void;
  status(): CampaignRunStatus;
  /** Numéro (1..N, ordre de lancement) du worker de ce `runId` ; `undefined` s'il est inconnu. */
  workerIndex(runId: string): number | undefined;
  readonly finished: boolean;
}

interface Agent {
  info: CampaignAgentInfo;
  handle: EngineHandle;
  port: AgentCampaignPort;
  exited: boolean;
}

function plannerPrompt(objective: string, snapshot: CampaignRunStatus | undefined): string {
  if (snapshot === undefined)
    return `Objectif de la campagne :\n${objective}\n\nOuvre les premières intentions (campaign_open_intent), puis termine ton tour.`;
  return `Objectif de la campagne :\n${objective}\n\nUn worker a terminé ou échoué : nouveau tour. État actuel de la campagne :\n${JSON.stringify(snapshot)}\n\nOuvre de nouvelles intentions seulement pour des directions non couvertes (campaign_open_intent), puis termine ton tour. N'ouvre rien s'il n'y a plus rien à explorer.`;
}

function workerPrompt(
  objective: string,
  intent: { id: string; title: string; rationale: string },
): string {
  return `Objectif de la campagne :\n${objective}\n\nTon intention (${intent.id}) : ${intent.title}\n${intent.rationale}\n\nTraite uniquement cette intention, puis ferme-la avec campaign_close_intent.`;
}

export function createCampaignHost(options: CampaignHostOptions): CampaignHost {
  const workers = options.workers ?? DEFAULT_MAX_WORKERS;
  if (!Number.isInteger(workers) || workers < 1 || workers > MAX_WORKERS_LIMIT)
    throw new CodedError("campaign.invalidInput", { field: "workers" });
  if (activeCampaign) throw new CodedError("campaign.alreadyActive");
  const debounceMs = options.debounceMs ?? 2000;

  const coordinator = createCampaignCoordinator({
    maxWorkers: workers,
    recorder: options.recorder,
    ...(options.now !== undefined && { now: options.now }),
  });

  const agents = new Map<string, Agent>();
  /** `toolUseId` en attente → moteur d'origine. */
  const approvals = new Map<string, Agent>();
  let planner: Agent | undefined;
  let turn = 0;
  let workerSeq = 0;
  /** `runId` d'un worker → numéro (même valeur que `agent.index`). */
  const workerIndexes = new Map<string, number>();
  let openedInTurn = false;
  let wakePending = false;
  let wakeTimer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  let bypassState: BypassState | null = null;
  let bypassSeq = 0;

  const liveWorkers = (): number =>
    [...agents.values()].filter((a) => a.info.role === "worker").length;

  const sendBypass = (agent: Agent): void => {
    bypassSeq += 1;
    agent.handle.send({ v: 1, type: "bypass", seq: bypassSeq, state: bypassState });
  };

  const spawn = (info: CampaignAgentInfo, port: AgentCampaignPort, prompt: string): Agent => {
    const multiAgent: MultiAgentParams = {
      role: info.role,
      runId: info.runId,
      ...(info.intent !== undefined && { intent: info.intent }),
    };
    const handle = options.spawnEngine({
      runId: info.runId,
      role: info.role,
      index: info.index,
      multiAgent,
      prompt,
    });
    const agent: Agent = { info, handle, port, exited: false };
    agents.set(info.runId, agent);
    handle.onMessage((message) => onEngineMessage(agent, message));
    handle.onExit(() => onExit(agent));
    // Le miroir du moteur naît « off » : seul un Bypass actif est envoyé au démarrage.
    if (bypassState !== null) sendBypass(agent);
    return agent;
  };

  const startPlannerTurn = (): void => {
    if (finished || planner !== undefined) return;
    turn += 1;
    openedInTurn = false;
    wakePending = false;
    const thisTurn = turn;
    const info: CampaignAgentInfo = { role: "planner", index: 0, runId: randomUUID() };
    const port = createLocalCampaignPort(coordinator, { role: "planner", round: () => thisTurn });
    planner = spawn(
      info,
      port,
      plannerPrompt(options.objective, thisTurn === 1 ? undefined : coordinator.status()),
    );
  };

  const changed = (): void => {
    if (finished) return;
    try {
      options.onChange?.();
    } catch {
      // Un rafraîchissement raté ne doit jamais gêner la campagne.
    }
  };

  /** Lance des workers tant qu'il y a des intentions ouvertes et de la place. */
  const pump = (): void => {
    try {
      pumpWorkers();
    } finally {
      changed();
    }
  };

  const pumpWorkers = (): void => {
    while (!finished && liveWorkers() < workers) {
      const runId = randomUUID();
      const intent = coordinator.claimNext(runId);
      if (!intent) return;
      workerSeq += 1;
      workerIndexes.set(runId, workerSeq);
      const brief = { id: intent.id, title: intent.title, rationale: intent.rationale };
      const info: CampaignAgentInfo = { role: "worker", index: workerSeq, runId, intent: brief };
      try {
        spawn(
          info,
          createLocalCampaignPort(coordinator, { role: "worker", workerRunId: runId }),
          workerPrompt(options.objective, brief),
        );
      } catch {
        // Lancement impossible : l'intention passe à `blocked`, le planificateur décidera.
        coordinator.abandon(intent.id, runId);
        scheduleWake();
        return;
      }
    }
  };

  /** Réveil du planificateur après l'anti-rebond : jamais une attente en boucle. */
  const scheduleWake = (): void => {
    if (finished) return;
    if (wakeTimer !== undefined) clearTimeout(wakeTimer);
    wakeTimer = setTimeout(() => {
      wakeTimer = undefined;
      if (finished) return;
      if (planner !== undefined) {
        wakePending = true; // tour en cours : on enchaîne à sa sortie
        return;
      }
      startPlannerTurn();
    }, debounceMs);
  };

  const finish = (why: Reason): void => {
    if (finished) return;
    finished = true;
    if (wakeTimer !== undefined) clearTimeout(wakeTimer);
    wakeTimer = undefined;
    // Les intentions encore prises sont consignées `blocked` avant la clôture du journal.
    for (const intent of coordinator.status().intents) {
      if (intent.state === "claimed" && intent.workerRunId !== undefined) {
        try {
          coordinator.abandon(intent.id, intent.workerRunId);
        } catch {
          // Déjà réglée : sans effet.
        }
      }
    }
    coordinator.finish(why);
    approvals.clear();
    for (const agent of [...agents.values()]) {
      try {
        agent.handle.stop();
      } catch {
        // Un moteur déjà parti ne doit pas empêcher d'arrêter les autres.
      }
    }
    setCampaignActive(false);
    options.onFinished?.(why);
  };

  /** Fin du tour du planificateur : terminer, enchaîner ou attendre les workers. */
  const afterPlannerTurn = (): void => {
    const { counts } = coordinator.status();
    if (!openedInTurn && counts.open + counts.claimed === 0) {
      finish(reason("campaign.completed"));
      return;
    }
    pump();
    if (finished) return;
    if (wakePending) {
      wakePending = false;
      startPlannerTurn();
      return;
    }
    checkStalled();
  };

  /** Plus rien ne peut avancer (budget : des intentions ouvertes que personne ne prendra). */
  const checkStalled = (): void => {
    if (finished || planner !== undefined || liveWorkers() > 0 || wakeTimer !== undefined) return;
    const { counts } = coordinator.status();
    if (counts.claimed === 0 && counts.open > 0) finish(reason("campaign.completed"));
  };

  const onExit = (agent: Agent): void => {
    if (agent.exited) return;
    agent.exited = true;
    agents.delete(agent.info.runId);
    for (const [toolUseId, owner] of approvals) if (owner === agent) approvals.delete(toolUseId);
    if (finished) return;
    if (agent.info.role === "planner") {
      planner = undefined;
      afterPlannerTurn();
      return;
    }
    const held = coordinator
      .status()
      .intents.find((i) => i.state === "claimed" && i.workerRunId === agent.info.runId);
    if (held) {
      coordinator.abandon(held.id, agent.info.runId);
      scheduleWake();
    }
    pump();
    checkStalled();
  };

  const roleOf = (op: string): CampaignAgentRole | "any" =>
    op === "openIntents" ? "planner" : op === "closeIntent" ? "worker" : "any";

  const handleCampaign = async (
    agent: Agent,
    message: Extract<FromEngine, { type: "campaign" }>,
  ): Promise<void> => {
    const reply = (
      result: { ok: true; value: unknown } | { ok: false; reason: ErrorInfo },
    ): void => {
      if (!agent.exited)
        agent.handle.send({ v: 1, type: "campaignResult", id: message.id, ...result });
    };
    try {
      const allowed = roleOf(message.op);
      if (allowed !== "any" && allowed !== agent.info.role)
        throw new CodedError("campaign.roleForbidden", { op: message.op, role: agent.info.role });
      if (finished) throw new CodedError("campaign.finished");
      let value: unknown;
      switch (message.op) {
        case "openIntents":
          value = await agent.port.openIntents(message.args.drafts as readonly IntentDraft[]);
          openedInTurn = true;
          break;
        case "status":
          value = await agent.port.status();
          break;
        case "closeIntent":
          value = await agent.port.closeIntent(message.args.closure as IntentClosure);
          break;
      }
      reply({ ok: true, value: value ?? null });
      if (message.op === "openIntents") pump();
      if (message.op === "closeIntent") scheduleWake();
      changed();
    } catch (error) {
      reply({ ok: false, reason: errorInfo(error) });
    }
  };

  const onEngineMessage = (agent: Agent, message: FromEngine): void => {
    if (agent.exited || finished) return;
    switch (message.type) {
      case "campaign":
        void handleCampaign(agent, message);
        return;
      case "approval": {
        const id = message.approval.toolUseId;
        const owner = approvals.get(id);
        if (owner !== undefined && owner !== agent) {
          // Collision d'identifiants entre moteurs : la demande est refusée (échec fermé).
          agent.handle.send({ v: 1, type: "answer", toolUseId: id, decision: "deny" });
          return;
        }
        approvals.set(id, agent);
        const { role, index, intent } = agent.info;
        options.onApproval?.({
          ...toCard(message.approval),
          agent: {
            role,
            index,
            ...(intent !== undefined && { intent: cleanText(intent.title, 200) }),
          },
        });
        return;
      }
      default:
        options.onMessage?.(agent.info, message);
    }
  };

  setCampaignActive(true);
  try {
    coordinator.start(options.objective);
    startPlannerTurn();
  } catch (error) {
    if (!finished) {
      try {
        finish(reason("campaign.stopped", { cause: "error" }));
      } catch {
        setCampaignActive(false);
      }
    }
    throw error;
  }

  return {
    answer(toolUseId, choice) {
      const owner = approvals.get(toolUseId);
      if (owner === undefined || owner.exited) return false;
      approvals.delete(toolUseId);
      owner.handle.send({ v: 1, type: "answer", toolUseId, ...answerFor(choice) });
      return true;
    },
    setBypass(state) {
      if (finished) return;
      bypassState = state;
      for (const agent of agents.values()) sendBypass(agent);
    },
    stop(cause = "user") {
      finish(reason("campaign.stopped", { cause }));
    },
    status: () => coordinator.status(),
    workerIndex: (runId) => workerIndexes.get(runId),
    get finished() {
      return finished;
    },
  };
}
