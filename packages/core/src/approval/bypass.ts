/**
 * Bypass des approbations (ADR 0006, universel depuis l'ADR 0017) : auto-approbation `once`
 * décidée DANS la gate pour tout verdict non-`allow`, dès qu'un Asker est présent (`gate.ts`).
 * L'état vit en mémoire, n'est jamais persisté et n'écrit aucune règle. Aucun texte d'affichage :
 * des codes (`Reason`) seulement.
 */

/** Durée par défaut d'une activation du Bypass : 2 h. */
export const BYPASS_DEFAULT_MS = 2 * 60 * 60 * 1000;

/** Durée maximale d'une activation : 4 h. Aucune durée demandée ne la dépasse. */
export const BYPASS_MAX_MS = 4 * 60 * 60 * 1000;

/** Bornes d'une activation, en ms epoch. */
export interface BypassState {
  since: number;
  expiresAt: number;
}

/** Motif de la dernière mise à « off » : désactivation explicite ou expiration. */
export type BypassOffReason = "bypass.disabled" | "bypass.expired";

/** Interrupteur lu par la gate à chaque décision. */
export interface BypassSwitch {
  /** État courant ; `null` = inactif ou expiré. */
  current(now: number): BypassState | null;
  /** Motif de la dernière mise à « off », pour `bypass.changed`. */
  lastOffReason(): BypassOffReason;
}

/** Interrupteur modifiable (côté hôte) : la gate ne voit que la lecture. */
export interface MemoryBypassSwitch extends BypassSwitch {
  /** Active le Bypass pour `durationMs`, bornée à `BYPASS_MAX_MS`. Durée invalide : désactive (fail-closed). */
  enable(durationMs: number): void;
  disable(): void;
}

export interface BypassSwitchOptions {
  /** Horloge (ms epoch). */
  now: () => number;
}

/** Interrupteur en mémoire. Rien n'est persisté : une nouvelle instance démarre « off ». */
export function createBypassSwitch({ now }: BypassSwitchOptions): MemoryBypassSwitch {
  let state: BypassState | null = null;
  let offReason: BypassOffReason = "bypass.disabled";

  /** Passe à « off » si l'échéance est atteinte à l'instant `at`. */
  const expire = (at: number): void => {
    if (state !== null && at >= state.expiresAt) {
      state = null;
      offReason = "bypass.expired";
    }
  };

  const disable = (): void => {
    expire(now());
    if (state !== null) {
      state = null;
      offReason = "bypass.disabled";
    }
  };

  return {
    enable(durationMs) {
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        disable();
        return;
      }
      const at = now();
      const duration = Math.min(durationMs, BYPASS_MAX_MS);
      state = { since: at, expiresAt: at + duration };
    },
    disable,
    current(at) {
      expire(at);
      return state === null ? null : { ...state };
    },
    lastOffReason() {
      return offReason;
    },
  };
}
