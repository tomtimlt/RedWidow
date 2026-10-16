import type { BypassOffReason, BypassState, BypassSwitch } from "@john-studio/core";

/**
 * Miroir en lecture du Bypass dans le moteur (ADR 0006, décision 6). L'hôte possède l'état et la
 * durée ; ce module retient les bornes absolues reçues et répond à `current`. Il ne calcule ni
 * durée ni tolérance d'horloge, et naît « off ». Module pur : l'horloge est injectée.
 */

export interface BypassMirrorOptions {
  /** Horloge du moteur (ms epoch). */
  now(): number;
}

export interface BypassMirror extends BypassSwitch {
  /**
   * Applique un état reçu de l'hôte. Renvoie `false` si `seq` est déjà vu ou inférieur (rejeu,
   * désordre) : le message est alors ignoré, sans effet ni accusé.
   */
  apply(seq: number, state: BypassState | null): boolean;
  /** Passe à « off » sans demande de l'hôte (message rejeté, canal coupé). */
  off(): void;
}

export function createBypassMirror({ now }: BypassMirrorOptions): BypassMirror {
  let held: BypassState | null = null;
  let offReason: BypassOffReason = "bypass.disabled";
  let lastSeq = 0;

  /** Retire l'état s'il est échu à `at` ; le motif devient « expiré ». */
  const expire = (at: number): void => {
    if (held !== null && at >= held.expiresAt) {
      held = null;
      offReason = "bypass.expired";
    }
  };

  /** Passe à « off ». Le motif tient compte de l'échéance de l'état retenu, à l'horloge du moteur. */
  const drop = (): void => {
    if (held === null) return;
    offReason = now() >= held.expiresAt ? "bypass.expired" : "bypass.disabled";
    held = null;
  };

  return {
    apply(seq, state) {
      if (seq <= lastSeq) return false;
      lastSeq = seq;
      if (state === null) drop();
      else held = { since: state.since, expiresAt: state.expiresAt };
      return true;
    },
    off: drop,
    current(at) {
      expire(at);
      return held === null ? null : { ...held };
    },
    lastOffReason() {
      return offReason;
    },
  };
}
