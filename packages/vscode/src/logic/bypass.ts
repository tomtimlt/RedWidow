import { BYPASS_DEFAULT_MS, type BypassState, createBypassSwitch } from "@john-studio/core";

/**
 * Bypass des approbations, côté hôte (ADR 0006, lot 2). L'état vit en mémoire, par fenêtre :
 * jamais persisté (ni `globalState`, ni `workspaceState`, ni réglage, ni variable d'environnement).
 * Module pur : l'horloge et les minuteurs sont injectés, `vscode` n'est pas importé ici.
 */

/** Message poussé aux surfaces : la webview ne décide jamais de l'état, elle l'affiche. */
export interface BypassPush {
  type: "bypass";
  on: boolean;
  expiresAt: number | null;
}

/** Horloge et minuteurs injectés (tests : horloge factice). */
export interface BypassClock {
  now(): number;
  schedule(fn: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface BypassHostOptions {
  clock: BypassClock;
  /** Appelée à chaque changement visible (activation, désactivation, expiration). */
  onChange(push: BypassPush): void;
}

export interface BypassHost {
  /**
   * Demande d'interrupteur. `enabled: true` n'est accepté que si la vue demandeuse est visible ;
   * `enabled: false` est toujours accepté. Renvoie `false` si la demande est refusée.
   */
  request(enabled: boolean, viewVisible: boolean): boolean;
  /** Remise à « off » sans demande de l'utilisateur (`reset`, changement de dossiers). */
  reset(): void;
  /** État courant, relu à l'horloge. */
  snapshot(): BypassPush;
  /** Temps restant en ms, `null` si le Bypass est inactif. */
  remainingMs(): number | null;
  /** Annule le minuteur d'expiration. */
  dispose(): void;
}

const offPush = (): BypassPush => ({ type: "bypass", on: false, expiresAt: null });

const pushOf = (state: BypassState | null): BypassPush =>
  state === null ? offPush() : { type: "bypass", on: true, expiresAt: state.expiresAt };

/** Hôte du Bypass : une instance par fenêtre, branchée sur l'interrupteur du cœur. */
export function createBypassHost({ clock, onChange }: BypassHostOptions): BypassHost {
  const switchState = createBypassSwitch({ now: clock.now });
  let timer: unknown = null;
  let lastPushed = JSON.stringify(offPush());

  /** Relit l'état, réarme le minuteur d'expiration, pousse seulement si l'état a changé. */
  const sync = (): void => {
    if (timer !== null) {
      clock.cancel(timer);
      timer = null;
    }
    const state = switchState.current(clock.now());
    if (state !== null) {
      timer = clock.schedule(sync, Math.max(0, state.expiresAt - clock.now()));
    }
    const push = pushOf(state);
    const key = JSON.stringify(push);
    if (key !== lastPushed) {
      lastPushed = key;
      onChange(push);
    }
  };

  return {
    request(enabled, viewVisible) {
      if (enabled) {
        if (!viewVisible) return false;
        // Durée fixée par l'hôte : la webview ne fournit jamais de durée.
        switchState.enable(BYPASS_DEFAULT_MS);
      } else {
        switchState.disable();
      }
      sync();
      return true;
    },
    reset() {
      switchState.disable();
      sync();
    },
    snapshot() {
      return pushOf(switchState.current(clock.now()));
    },
    remainingMs() {
      const state = switchState.current(clock.now());
      return state === null ? null : Math.max(0, state.expiresAt - clock.now());
    },
    dispose() {
      if (timer !== null) {
        clock.cancel(timer);
        timer = null;
      }
    },
  };
}

/** Temps restant lisible pour la barre d'état : arrondi à la minute supérieure. */
export function formatRemaining(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours} h ${String(rest).padStart(2, "0")}` : `${rest} min`;
}
