/**
 * Contrôleur de rythme (ADR 0040, §3) : plafond global du programme (seau à
 * jetons) et multiplicateur adaptatif par hôte. Pur : l'horloge est injectée
 * et le contrôleur ne temporise jamais, il répond « envoyer » ou « attendre
 * N ms » et reçoit le résultat de chaque réponse. Aucun texte d'affichage.
 */

/** Préréglages du plafond global, en requêtes par seconde. */
export const PACE_PRESETS = {
  fast: 1,
  normal: 0.5,
  careful: 0.2,
} as const;

export type PacePreset = keyof typeof PACE_PRESETS;

/** Signal défavorable observé par l'appelant (le 403 « WAF » est identifié par lui). */
export type PaceSignal = "http429" | "waf403" | "timeout";

/** Résultat d'une réponse rapporté au contrôleur. */
export type PaceOutcome = "ok" | PaceSignal;

/** Cause d'un ajustement : un signal, ou la remontée après des réponses saines. */
export type PaceAdjustCause = PaceSignal | "recovery";

/** Cause d'un arrêt : trois signaux dans la fenêtre, ou un signal au plancher. */
export type PaceHaltCause = "burst" | "floor";

/** Données des événements `pace.adjusted` et `pace.halted` (sans métadonnées). */
export type PaceEventData =
  | {
      kind: "pace.adjusted";
      host: string;
      fromRps: number;
      toRps: number;
      cause: PaceAdjustCause;
    }
  | { kind: "pace.halted"; host: string; cause: PaceHaltCause };

/** Réponse de `acquire`. En cas d'attente, rien n'est consommé : l'appelant redemande. */
export type PaceDecision =
  | { action: "send" }
  | { action: "wait"; ms: number }
  | { action: "halted" };

export interface PaceOptions {
  /** Plafond global ; un préréglage ou un nombre explicite de requêtes par seconde. */
  preset?: PacePreset;
  maxRequestsPerSecond?: number;
  /** Horloge en millisecondes (défaut : `Date.now`). */
  now?: () => number;
  /** Reçoit les données des événements émis. */
  onEvent?: (event: PaceEventData) => void;
}

export interface PaceHostStatus {
  halted: boolean;
  /** Débit courant de l'hôte (req/s). */
  rps: number;
  /** Fin de la pause en cours (ms), 0 si aucune. */
  pausedUntil: number;
}

export interface PaceController {
  /** Plafond global effectif (req/s). */
  readonly ceilingRps: number;
  acquire(host: string): PaceDecision;
  report(host: string, outcome: PaceOutcome): void;
  /** Reprise explicite d'un hôte arrêté (geste humain, jamais automatique). */
  resume(host: string): void;
  status(host: string): PaceHostStatus;
}

/** Pause imposée à l'hôte après un signal. */
export const PACE_PAUSE_MS = 60_000;
/** Plancher du multiplicateur : le débit ne descend pas sous le plafond ÷ 8. */
export const PACE_FLOOR = 1 / 8;
/** Multiplicateur après une reprise explicite : plafond ÷ 2. */
export const PACE_RESUME = 1 / 2;
/** Facteur de remontée et nombre de réponses saines consécutives qui le déclenchent. */
export const PACE_RECOVERY_FACTOR = 1.5;
export const PACE_RECOVERY_AFTER = 20;
/** Arrêt : ce nombre de signaux dans cette fenêtre. */
export const PACE_HALT_SIGNALS = 3;
export const PACE_HALT_WINDOW_MS = 10 * 60_000;

interface HostState {
  multiplier: number;
  healthy: number;
  signals: number[];
  pausedUntil: number;
  nextAt: number;
  halted: boolean;
}

const EPSILON = 1e-9;

export function createPaceController(options: PaceOptions = {}): PaceController {
  const ceiling = resolveCeiling(options);
  const now = options.now ?? Date.now;
  const emit = options.onEvent ?? (() => {});

  // Seau global : capacité d'un jeton, plein au départ.
  let tokens = 1;
  let refilledAt = now();
  const hosts = new Map<string, HostState>();

  const state = (host: string): HostState => {
    let s = hosts.get(host);
    if (!s) {
      s = { multiplier: 1, healthy: 0, signals: [], pausedUntil: 0, nextAt: 0, halted: false };
      hosts.set(host, s);
    }
    return s;
  };

  const refill = (t: number) => {
    tokens = Math.min(1, tokens + ((t - refilledAt) / 1000) * ceiling);
    refilledAt = t;
  };

  return {
    ceilingRps: ceiling,

    acquire(host) {
      const s = state(host);
      if (s.halted) return { action: "halted" };
      const t = now();
      refill(t);
      const hostWait = Math.max(s.pausedUntil - t, s.nextAt - t, 0);
      const bucketWait = tokens >= 1 - EPSILON ? 0 : ((1 - tokens) / ceiling) * 1000;
      const wait = Math.ceil(Math.max(hostWait, bucketWait) - EPSILON);
      if (wait > 0) return { action: "wait", ms: wait };
      tokens = Math.max(0, tokens - 1);
      s.nextAt = t + 1000 / (ceiling * s.multiplier);
      return { action: "send" };
    },

    report(host, outcome) {
      const s = state(host);
      if (s.halted) return;
      const t = now();
      if (outcome === "ok") {
        s.healthy += 1;
        if (s.healthy >= PACE_RECOVERY_AFTER) {
          s.healthy = 0;
          const next = Math.min(1, s.multiplier * PACE_RECOVERY_FACTOR);
          if (next > s.multiplier + EPSILON) {
            const from = s.multiplier;
            s.multiplier = next;
            emit({
              kind: "pace.adjusted",
              host,
              fromRps: ceiling * from,
              toRps: ceiling * next,
              cause: "recovery",
            });
          }
        }
        return;
      }
      s.healthy = 0;
      s.signals = s.signals.filter((ts) => t - ts < PACE_HALT_WINDOW_MS);
      s.signals.push(t);
      const atFloor = s.multiplier <= PACE_FLOOR + EPSILON;
      if (atFloor || s.signals.length >= PACE_HALT_SIGNALS) {
        s.halted = true;
        emit({ kind: "pace.halted", host, cause: atFloor ? "floor" : "burst" });
        return;
      }
      const from = s.multiplier;
      s.multiplier = Math.max(PACE_FLOOR, from / 2);
      s.pausedUntil = t + PACE_PAUSE_MS;
      emit({
        kind: "pace.adjusted",
        host,
        fromRps: ceiling * from,
        toRps: ceiling * s.multiplier,
        cause: outcome,
      });
    },

    resume(host) {
      const s = hosts.get(host);
      if (!s?.halted) return;
      // Reprise prudente : débit à la moitié du plafond (pas au plancher : un signal ultérieur
      // ne ré-arrêterait pas aussitôt l'hôte), historique effacé, pas de pause résiduelle.
      s.halted = false;
      s.multiplier = PACE_RESUME;
      s.healthy = 0;
      s.signals = [];
      s.pausedUntil = 0;
      s.nextAt = 0;
    },

    status(host) {
      const s = state(host);
      return { halted: s.halted, rps: ceiling * s.multiplier, pausedUntil: s.pausedUntil };
    },
  };
}

function resolveCeiling(options: PaceOptions): number {
  const explicit = options.maxRequestsPerSecond;
  if (explicit !== undefined) {
    if (!Number.isFinite(explicit) || explicit <= 0) {
      throw new RangeError("maxRequestsPerSecond doit être un nombre positif");
    }
    return explicit;
  }
  return PACE_PRESETS[options.preset ?? "normal"];
}
