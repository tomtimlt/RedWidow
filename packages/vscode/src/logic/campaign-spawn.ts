import {
  type BypassState,
  CodedError,
  createRecorder,
  errorInfo,
  fingerprint,
  type ProviderFailureInput,
} from "@warband/core";
import type { EngineHandle, EngineSpec } from "./campaign-host.js";
import type {
  EngineAuth,
  EngineController,
  EngineControllerOptions,
  EngineHandlers,
} from "./controller.js";
import type { FromEngine, StartParams, ToEngine } from "./protocol.js";
import {
  createFailureTracker,
  createKeyGuard,
  type FailureTracker,
  ROTATION_RESUME_PROMPT,
  type RotationAdviceContext,
  type RotationOutcome,
  type VaultPick,
} from "./vault-launch.js";

/**
 * Lancement réel d'un moteur de campagne (ADR 0054, lot 3b) : un processus par agent, forké par le
 * même contrôleur que pour un chat (cycle de vie de l'ADR 0001, `safeEnv`, options verrouillées
 * inchangées). Module sans `vscode`, testable avec un contrôleur factice.
 *
 * Coffre à clés (ADR 0056) : un moteur dont la clé du coffre échoue (quota, clé invalide) est remplacé
 * par un NOUVEAU moteur avec la clé suivante et `resume` sur la même session. Le worker relancé garde son
 * intention, son `runId` de campagne et son Bypass ; l'hôte de campagne ne voit ni `ended` ni sortie de
 * l'ancien moteur (donc aucun `closeOnBehalf`).
 */

/** Ce que l'hôte résout au lancement de chaque moteur : jeton et paramètres communs du chat. */
export interface CampaignEngineSetup {
  auth?: EngineAuth;
  /** Clé du coffre retenue (ADR 0056) ; absent : clé unique ou abonnement, aucune rotation. */
  vault?: VaultPick;
  /** Contexte de l'avis « pas de rotation » (fournisseur, abonnement, modèle). */
  advice?: RotationAdviceContext;
  /** Mêmes `cwd`, modèle, effort, fournisseur et dossier de projet que le chat (sans `resume`). */
  params: Omit<StartParams, "multiAgent" | "resume" | "conversationContext" | "vault">;
}

/** Accès au coffre pour la rotation des moteurs de campagne. */
export interface CampaignVaultAccess {
  /** Classe l'échec, persiste l'état de la clé et indique s'il en reste une. */
  rotate(pick: VaultPick, failure: ProviderFailureInput): Promise<RotationOutcome>;
  /** Nombre de clés du coffre du fournisseur (plafond de rotations par moteur). */
  keyCount(provider: string): Promise<number>;
  /** Avis « pas de rotation possible » (une fois par fournisseur et par campagne, côté hôte). */
  advise?(context: RotationAdviceContext, failure: ProviderFailureInput): Promise<void>;
}

export interface CampaignSpawnDeps {
  make: (options: EngineControllerOptions) => EngineController;
  /** Script, arguments et dossier de travail du moteur (identiques à ceux d'un chat). */
  options: Omit<EngineControllerOptions, "auth" | "handlers">;
  /** Relit le jeton et les réglages au moment du lancement (une fois par moteur) ; `afterKeyId` : clé fautive à dépasser. */
  resolve(afterKeyId?: string): Promise<CampaignEngineSetup>;
  /** Rotation du coffre ; absent : aucune rotation. */
  vault?: CampaignVaultAccess;
}

/** Un moteur lancé pour ce worker (le courant, ou un ancien écarté par une rotation). */
interface Engine {
  ctl: EngineController;
  pick: VaultPick | undefined;
  advice: RotationAdviceContext | undefined;
  /** Empreinte attendue de la clé d'API transmise ; comparée à `provider.key`, jamais envoyée au moteur. */
  expected: string | undefined;
  /** Garde de clé, créée au premier événement (échec fermé si le moteur agit sans annoncer sa clé). */
  guard?: ReturnType<typeof createKeyGuard>;
  tracker: FailureTracker;
  /** Écarté : ses messages et sa sortie sont ignorés. */
  detached: boolean;
  /** Rotation en cours pour ce moteur. */
  pending: Promise<boolean> | undefined;
}

/** Fabrique `spawnEngine` pour `createCampaignHost`. */
export function createCampaignSpawner(deps: CampaignSpawnDeps): (spec: EngineSpec) => EngineHandle {
  return (spec) => {
    let messageCallback: ((message: FromEngine) => void) | undefined;
    let exitCallback: (() => void) | undefined;
    let engine: Engine | undefined;
    let ready = false;
    let stopped = false;
    let exited = false;
    /** Messages de l'hôte reçus avant que le moteur ait démarré (ou pendant une rotation). */
    const queue: ToEngine[] = [];
    /** De quoi relancer un moteur : session créée, dernier état du Bypass, dernière consigne. */
    let sessionId: string | undefined;
    let lastBypass: BypassState | null | undefined;
    let lastPrompt = spec.prompt;
    /** Rotations faites par ce worker (au plus autant que de clés). */
    let rotations = 0;
    let hostRecorder: ReturnType<typeof createRecorder> | undefined;

    const emit = (message: FromEngine): void => {
      if (!exited) messageCallback?.(message);
    };
    const finishExit = (): void => {
      if (exited) return;
      exited = true;
      exitCallback?.();
    };

    const apply = (message: ToEngine): void => {
      const ctl = engine?.ctl;
      if (ctl === undefined) return;
      switch (message.type) {
        case "bypass":
          lastBypass = message.state;
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
          lastPrompt = message.text;
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

    /** Plafonds du worker : le plus bas gagne face au réglage du chat. */
    const startParams = (setup: CampaignEngineSetup): StartParams => {
      const lowest = (a: number | undefined, b: number | undefined): number | undefined =>
        a === undefined ? b : b === undefined ? a : Math.min(a, b);
      const maxTurns = lowest(setup.params.maxTurns, spec.maxTurns);
      const maxBudgetUsd = lowest(setup.params.maxBudgetUsd, spec.maxBudgetUsd);
      return {
        ...setup.params,
        ...(maxTurns !== undefined && { maxTurns }),
        ...(maxBudgetUsd !== undefined && { maxBudgetUsd }),
        ...(setup.vault && {
          vault: { provider: setup.vault.provider, name: setup.vault.name, rank: setup.vault.rank },
        }),
        multiAgent: { ...spec.multiAgent, runId: spec.runId },
      };
    };

    /** Moteur de campagne arrêté : la clé qu'il utilise n'est pas celle qui a été choisie. */
    const failKey = (current: Engine): void => {
      current.detached = true;
      emit({ v: 1, type: "error", reason: errorInfo(new CodedError("vault.keyMismatch")) });
      try {
        current.ctl.kill();
      } catch {
        // Un moteur déjà parti ne bloque pas la sortie.
      }
      finishExit();
    };

    /** Lance le moteur suivant (clé suivante, même session) à la place de `old`. */
    const relaunch = async (afterKeyId: string): Promise<void> => {
      const setup = await deps.resolve(afterKeyId);
      if (stopped) return finishExit();
      const next: Engine = {
        ctl: undefined as unknown as EngineController,
        pick: setup.vault,
        advice: setup.advice,
        expected:
          setup.auth && setup.auth.name !== "CLAUDE_CODE_OAUTH_TOKEN"
            ? fingerprint(setup.auth.value)
            : undefined,
        tracker: createFailureTracker(),
        detached: false,
        pending: undefined,
      };
      next.ctl = deps.make({
        ...deps.options,
        ...(setup.auth && { auth: setup.auth }),
        handlers: handlersFor(next),
      });
      engine = next;
      await next.ctl.start({
        ...startParams(setup),
        ...(sessionId !== undefined && { resume: sessionId }),
      });
      if (stopped) {
        next.ctl.kill();
        return;
      }
      // Le nouveau moteur naît sans Bypass : on lui rend l'état courant avant toute consigne.
      if (lastBypass !== undefined) next.ctl.bypass(lastBypass);
      ready = true;
      // Les réponses aux demandes de l'ancien moteur n'ont plus d'objet dans le nouveau.
      for (const message of queue.splice(0)) {
        if (["bypass", "prompt", "abort", "dispose"].includes(message.type)) apply(message);
      }
      // La session existe : on la reprend sans rejouer la consigne ; sinon, même consigne.
      next.ctl.prompt(sessionId !== undefined ? ROTATION_RESUME_PROMPT : lastPrompt);
    };

    /**
     * Échec du tour d'un moteur : si c'est un quota ou une clé invalide du coffre, le moteur est remplacé.
     * Résout `true` quand le worker a été relancé (ou terminé en erreur) : ni `ended` ni sortie de l'ancien.
     */
    const attemptRotation = async (current: Engine): Promise<boolean> => {
      const failure = current.tracker.take();
      const access = deps.vault;
      const pick = current.pick;
      if (!access || !failure || stopped || exited || current.detached) return false;
      if (!pick) {
        // Pas de clé du coffre (coffre vide, abonnement, fournisseur sans coffre) : aucune rotation, un avis.
        if (current.advice !== undefined) await access.advise?.(current.advice, failure);
        return false;
      }
      try {
        const outcome = await access.rotate(pick, failure);
        if (outcome.kind === "none") return false;
        if (stopped || exited || current.detached) return false;
        // L'ancien moteur est écarté : sa sortie ne ferme rien (aucun `closeOnBehalf`).
        current.detached = true;
        ready = false;
        hostRecorder ??= createRecorder({ runId: spec.runId });
        emit({ v: 1, type: "event", event: hostRecorder.emit(outcome.event) });
        current.ctl.kill();
        const keys = await access.keyCount(pick.provider);
        if (outcome.kind === "exhausted" || rotations >= keys) {
          if (current.advice !== undefined) await access.advise?.(current.advice, failure);
          emit({
            v: 1,
            type: "error",
            reason: errorInfo(
              new CodedError(
                "vault.allExhausted",
                outcome.kind === "exhausted" && outcome.until !== undefined
                  ? { until: outcome.until }
                  : {},
              ),
            ),
          });
          finishExit();
          return true;
        }
        rotations++;
        await relaunch(pick.keyId);
        return true;
      } catch (error) {
        if (current.detached) {
          // Rotation commencée : le worker ne peut plus continuer, l'hôte de campagne le constate.
          emit({ v: 1, type: "error", reason: errorInfo(error) });
          try {
            engine?.ctl.kill();
          } catch {
            // Un moteur déjà parti ne bloque pas la sortie.
          }
          finishExit();
          return true;
        }
        return false;
      }
    };

    const rotate = (current: Engine): Promise<boolean> => {
      if (current.pending !== undefined) return current.pending;
      const attempt = attemptRotation(current).finally(() => {
        current.pending = undefined;
      });
      current.pending = attempt;
      return attempt;
    };

    const handlersFor = (current: Engine): EngineHandlers => ({
      onStarted: (info) => {
        if (current.detached) return;
        emit({
          v: 1,
          type: "started",
          runId: info.runId,
          policySource: info.policySource,
          ...(info.warning && { warning: info.warning }),
        });
      },
      onEvent: (event) => {
        if (current.detached) return;
        current.tracker.observe(event);
        if (event.kind === "session.started") sessionId = event.sessionId;
        // Le moteur annonce la clé qu'il utilise vraiment : une autre que celle choisie l'arrête.
        current.guard ??= createKeyGuard(current.expected);
        if (current.guard.observe(event)) return failKey(current);
        emit({ v: 1, type: "event", event });
        if (event.kind === "turn.finished" && event.status === "error") void rotate(current);
      },
      onMissionContext: (snapshot) => {
        if (!current.detached) emit({ v: 1, type: "missionContext", ...snapshot });
      },
      onApproval: (approval) => {
        if (!current.detached) emit({ v: 1, type: "approval", approval });
      },
      onEnded: (summary) => {
        if (current.detached) return;
        if (summary.status === "error" && current.pick !== undefined && deps.vault !== undefined) {
          // Un échec de clé du coffre remplace le moteur : `ended` n'est transmis que sans rotation.
          void rotate(current).then((rotated) => {
            if (!rotated && !current.detached) emit({ v: 1, type: "ended", summary });
          });
          return;
        }
        emit({ v: 1, type: "ended", summary });
      },
      onError: (reason) => {
        if (!current.detached) emit({ v: 1, type: "error", reason });
      },
      onBypassAck: (ack) => {
        if (!current.detached) emit({ v: 1, type: "bypassAck", seq: ack.seq, state: ack.state });
      },
      onCampaign: (message) => {
        if (!current.detached) emit(message);
      },
      onExit: () => {
        if (current.detached) return;
        // Une rotation en cours décide d'abord : `ended` puis la sortie, ou le moteur suivant.
        const waiting = current.pending;
        if (waiting === undefined) return finishExit();
        void waiting.then(() => {
          if (!current.detached) finishExit();
        });
      },
    });

    const run = async (): Promise<void> => {
      try {
        const setup = await deps.resolve();
        if (stopped) return finishExit();
        const first: Engine = {
          ctl: undefined as unknown as EngineController,
          pick: setup.vault,
          advice: setup.advice,
          expected:
            setup.auth && setup.auth.name !== "CLAUDE_CODE_OAUTH_TOKEN"
              ? fingerprint(setup.auth.value)
              : undefined,
          tracker: createFailureTracker(),
          detached: false,
          pending: undefined,
        };
        first.ctl = deps.make({
          ...deps.options,
          ...(setup.auth && { auth: setup.auth }),
          handlers: handlersFor(first),
        });
        engine = first;
        await first.ctl.start(startParams(setup));
        ready = true;
        if (stopped) {
          first.ctl.kill();
          return;
        }
        for (const message of queue.splice(0)) apply(message);
        first.ctl.prompt(spec.prompt);
      } catch (error) {
        emit({ v: 1, type: "error", reason: errorInfo(error) });
        try {
          engine?.ctl.kill();
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
        engine?.ctl.kill();
      },
    };
  };
}
