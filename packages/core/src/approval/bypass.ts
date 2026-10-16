/**
 * Bypass des approbations (ADR 0006) : auto-approbation `once` décidée DANS la gate, pour les
 * verdicts « ask » que `isBypassable` couvre. L'état vit en mémoire, n'est jamais persisté et
 * n'écrit aucune règle. Aucun texte d'affichage : des codes (`Reason`) seulement.
 */

import type { ApprovalRequest } from "./gate.js";
import { EXTERNAL_DIRECTORY_TOOL, EXTERNAL_PATTERNS_FIELD } from "./paths.js";
import { BASH_TOOL, type Policy, type PolicyVerdict } from "./policy.js";
import { parseShell } from "./shell.js";

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

/** Motifs de verdict « ask » que le Bypass peut couvrir. Tout le reste reste demandé ou refusé. */
const BYPASSABLE = new Set(["policy.default", "policy.rule", "policy.rule.custom"]);

/**
 * Vrai si le Bypass peut auto-approuver cette demande, ce verdict ayant été rendu par `policy`.
 * Un `deny`, un garde-fou de chemin, un accès à l'hôte, un danger shell ou une commande sans
 * règle restent hors d'atteinte.
 */
export function isBypassable(
  request: ApprovalRequest,
  verdict: PolicyVerdict,
  policy: Policy,
): boolean {
  if (verdict.decision !== "ask" || !BYPASSABLE.has(verdict.reason.code)) return false;
  // Même test que la gate pour les répertoires externes : le motif `policy.default` seul ne suffit pas.
  if (request.tool === EXTERNAL_DIRECTORY_TOOL || EXTERNAL_PATTERNS_FIELD in request.input) {
    return false;
  }
  if (request.tool !== BASH_TOOL) return true;
  return bashBypassable(request, verdict, policy);
}

/**
 * Bash : une commande simple, sans danger, couverte par une règle `ask` dont le premier mot est
 * littéral. Une règle sans `command` ou en joker ne couvre rien (elle rendrait `bash.noRule` bypassable).
 */
function bashBypassable(request: ApprovalRequest, verdict: PolicyVerdict, policy: Policy): boolean {
  const command = request.input.command;
  if (typeof command !== "string") return false;
  const parsed = parseShell(command);
  if (!parsed.ok) return false;
  const { segments, hazards } = parsed.value;
  if (hazards.size > 0 || segments.length !== 1) return false;
  if (verdict.rule === null) return false;
  const rule = policy.rules[verdict.rule];
  if (rule?.command === undefined) return false;
  const first = rule.command.trim().split(/\s+/)[0] ?? "";
  return first !== "" && !first.includes("*");
}
