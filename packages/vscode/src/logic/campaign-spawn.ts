import { errorInfo } from "@warband/core";
import type { EngineHandle, EngineSpec } from "./campaign-host.js";
import type {
  EngineAuth,
  EngineController,
  EngineControllerOptions,
  EngineHandlers,
} from "./controller.js";
import type { FromEngine, StartParams, ToEngine } from "./protocol.js";

/**
 * Lancement réel d'un moteur de campagne (ADR 0054, lot 3b) : un processus par agent, forké par le
 * même contrôleur que pour un chat (cycle de vie de l'ADR 0001, `safeEnv`, options verrouillées
 * inchangées). Module sans `vscode`, testable avec un contrôleur factice.
 */

/** Ce que l'hôte résout au lancement de chaque moteur : jeton et paramètres communs du chat. */
export interface CampaignEngineSetup {
  auth?: EngineAuth;
  /** Mêmes `cwd`, modèle, effort, fournisseur et dossier de projet que le chat (sans `resume`). */
  params: Omit<StartParams, "multiAgent" | "resume" | "conversationContext">;
}

export interface CampaignSpawnDeps {
  make: (options: EngineControllerOptions) => EngineController;
  /** Script, arguments et dossier de travail du moteur (identiques à ceux d'un chat). */
  options: Omit<EngineControllerOptions, "auth" | "handlers">;
  /** Relit le jeton et les réglages au moment du lancement (une fois par moteur). */
  resolve(): Promise<CampaignEngineSetup>;
}

/** Fabrique `spawnEngine` pour `createCampaignHost`. */
export function createCampaignSpawner(deps: CampaignSpawnDeps): (spec: EngineSpec) => EngineHandle {
  return (spec) => {
    let messageCallback: ((message: FromEngine) => void) | undefined;
    let exitCallback: (() => void) | undefined;
    let ctl: EngineController | undefined;
    let ready = false;
    let stopped = false;
    let exited = false;
    /** Messages de l'hôte reçus avant que le moteur ait démarré. */
    const queue: ToEngine[] = [];

    const emit = (message: FromEngine): void => {
      if (!exited) messageCallback?.(message);
    };
    const finishExit = (): void => {
      if (exited) return;
      exited = true;
      exitCallback?.();
    };

    const apply = (message: ToEngine): void => {
      if (ctl === undefined) return;
      switch (message.type) {
        case "bypass":
          // Le contrôleur tient son propre `seq` (le miroir du moteur l'exige croissant).
          ctl.bypass(message.state);
          return;
        case "answer":
          ctl.answer(message.toolUseId, message.decision, message.remember);
          return;
        case "campaignResult":
          ctl.campaignResult({
            id: message.id,
            ok: message.ok,
            ...(message.value !== undefined && { value: message.value }),
            ...(message.reason !== undefined && { reason: message.reason }),
          });
          return;
        case "prompt":
          ctl.prompt(message.text, message.research, message.images);
          return;
        case "abort":
          ctl.abort();
          return;
        case "dispose":
          ctl.dispose();
          return;
        default:
          return; // `start` et `models` ne passent pas par ici
      }
    };

    const handlers: EngineHandlers = {
      onStarted: (info) =>
        emit({
          v: 1,
          type: "started",
          runId: info.runId,
          policySource: info.policySource,
          ...(info.warning && { warning: info.warning }),
        }),
      onEvent: (event) => emit({ v: 1, type: "event", event }),
      onMissionContext: (snapshot) => emit({ v: 1, type: "missionContext", ...snapshot }),
      onApproval: (approval) => emit({ v: 1, type: "approval", approval }),
      onEnded: (summary) => emit({ v: 1, type: "ended", summary }),
      onError: (reason) => emit({ v: 1, type: "error", reason }),
      onBypassAck: (ack) => emit({ v: 1, type: "bypassAck", seq: ack.seq, state: ack.state }),
      onCampaign: (message) => emit(message),
      onExit: () => finishExit(),
    };

    const run = async (): Promise<void> => {
      try {
        const setup = await deps.resolve();
        if (stopped) return finishExit();
        ctl = deps.make({
          ...deps.options,
          ...(setup.auth && { auth: setup.auth }),
          handlers,
        });
        await ctl.start({
          ...setup.params,
          multiAgent: { ...spec.multiAgent, runId: spec.runId },
        });
        ready = true;
        if (stopped) {
          ctl.kill();
          return;
        }
        for (const message of queue.splice(0)) apply(message);
        ctl.prompt(spec.prompt);
      } catch (error) {
        emit({ v: 1, type: "error", reason: errorInfo(error) });
        try {
          ctl?.kill();
        } catch {
          // Un moteur déjà parti ne bloque pas la sortie.
        }
        finishExit();
      }
    };
    void run();

    return {
      runId: spec.runId,
      send(message) {
        if (stopped || exited) return;
        if (ready) apply(message);
        else queue.push(message);
      },
      onMessage(callback) {
        messageCallback = callback;
      },
      onExit(callback) {
        exitCallback = callback;
      },
      stop() {
        if (stopped) return;
        stopped = true;
        queue.length = 0;
        // Arrêt par le contrôleur : Bypass éteint d'abord, `abort` + `dispose`, puis arbre de processus.
        ctl?.kill();
      },
    };
  };
}
