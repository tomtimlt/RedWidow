/**
 * Bypass des approbations (ADR 0006) : auto-approbation `once` décidée DANS la gate, pour les
 * verdicts « ask » que `isBypassable` couvre. L'état vit en mémoire, n'est jamais persisté et
 * n'écrit aucune règle. Aucun texte d'affichage : des codes (`Reason`) seulement.
 */

import { EXEGOL_TOOL_PREFIX } from "../exegol/tool-specs.js";
import { KALI_TOOL_PREFIX } from "../kali/tool-specs.js";
import type { ApprovalRequest } from "./gate.js";
import { checkPathAccess, EXTERNAL_DIRECTORY_TOOL, EXTERNAL_PATTERNS_FIELD } from "./paths.js";
import { BASH_TOOL, type Policy, type PolicyContext, type PolicyVerdict } from "./policy.js";
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

/** Profondeur maximale de l'entrée d'un outil explorée pour y chercher des chemins (au-delà : refus). */
const MAX_INPUT_DEPTH = 64;

/**
 * Vrai si le Bypass peut auto-approuver cette demande, ce verdict ayant été rendu par `policy`.
 * Un `deny`, un garde-fou de chemin, un accès à l'hôte, un danger shell ou une commande sans
 * règle restent hors d'atteinte. Un chemin sensible, hors de `workspace` ou non analysable dans
 * l'entrée (arguments Bash, chaînes imbriquées d'un outil) rend la demande non bypassable.
 * Tout `ask` d'un outil `mcp__kali__*` ou `mcp__exegol__*` est couvert (ADR 0014) : redirection, chemin, plusieurs
 * segments, danger ou commande illisible avalés dans `shell.unanalyzable` pour `execute_command`,
 * et tout verdict `ask` des autres outils Kali structurés (y compris un jeton qui ressemble à un
 * chemin dans leurs paramètres : URL, wordlist, fichier de sortie). Un `deny` ne l'est pas, et le
 * verdict ne devient pas mémorisable.
 */
export function isBypassable(
  request: ApprovalRequest,
  verdict: PolicyVerdict,
  policy: Policy,
  workspace: PolicyContext,
): boolean {
  if (verdict.decision !== "ask") return false;
  // Tout ask d'un outil Kali ou Exegol est couvert (ils s'exécutent dans le conteneur : leurs chemins
  // ne sont pas des chemins hôte). Un deny est déjà exclu ci-dessus (règle, danger, chemin, montage
  // hôte) : ces préfixes ne lèvent jamais un deny, seulement l'obligation de demander.
  if (request.tool.startsWith(KALI_TOOL_PREFIX) || request.tool.startsWith(EXEGOL_TOOL_PREFIX)) {
    return true;
  }
  if (!BYPASSABLE.has(verdict.reason.code)) return false;
  // Même test que la gate pour les répertoires externes : le motif `policy.default` seul ne suffit pas.
  if (request.tool === EXTERNAL_DIRECTORY_TOOL || EXTERNAL_PATTERNS_FIELD in request.input) {
    return false;
  }
  if (!inputPathsFree(request, workspace)) return false;
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

/**
 * Garde-fous de chemin sur l'entrée entière : chaque chaîne (objets et tableaux explorés en
 * profondeur, clés comprises) est contrôlée. Bash : chaque mot de la commande est un candidat
 * (un lien symbolique du dépôt ou un `--opt=/chemin` ne ressemble pas à un chemin). Autres outils :
 * seuls les jetons qui ressemblent à un chemin (absolu, lecteur Windows, `..`, `~`) sont contrôlés.
 * `false` dès qu'un constat (sensible, hors espace, non analysable) apparaît, ou si l'entrée est
 * trop profonde pour être explorée.
 */
function inputPathsFree(request: ApprovalRequest, workspace: PolicyContext): boolean {
  const strings: string[] = [];
  if (!collectStrings(request.input, strings, 0)) return false;
  if (request.tool === BASH_TOOL && typeof request.input.command === "string") {
    // Mots tels que l'analyseur les découpe (guillemets retirés) : tout mot est un candidat.
    const parsed = parseShell(request.input.command);
    if (!parsed.ok) return false;
    for (const argv of parsed.value.segments) {
      for (const word of argv) {
        if (!candidatesFree(attachedCandidates(word), workspace, false)) return false;
      }
    }
  }
  for (const value of strings) {
    for (const token of valueTokens(value)) {
      // Une variable d'environnement dans un chemin (`$HOME/…`, `%USERPROFILE%\…`) n'est pas résolue ici.
      // Pour Bash, `$` est déjà un danger de l'analyseur ; `%` (formats `--format=%H/%s`) est courant.
      if (request.tool !== BASH_TOOL && /[$%]/.test(token) && /[\\/]/.test(token)) return false;
      if (!candidatesFree(attachedCandidates(token), workspace, true)) return false;
    }
  }
  return true;
}

/**
 * Vrai si aucun candidat n'a de constat. `onlyPathLike` : ne contrôler que les candidats qui
 * ressemblent à un chemin (chaînes d'un outil non Bash) ; sinon tous (mots Bash, dont un lien
 * symbolique du dépôt ne ressemble pas à un chemin).
 */
function candidatesFree(candidates: string[], workspace: PolicyContext, onlyPathLike: boolean) {
  return candidates.every(
    (candidate) =>
      candidate === "" ||
      (onlyPathLike && !looksLikePath(candidate)) ||
      tokenPathFree(candidate, workspace),
  );
}

/** Collecte les chaînes d'une valeur JSON (clés comprises). `false` si la profondeur dépasse la borne. */
function collectStrings(value: unknown, out: string[], depth: number): boolean {
  if (depth > MAX_INPUT_DEPTH) return false;
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) if (!collectStrings(item, out, depth + 1)) return false;
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      out.push(key);
      if (!collectStrings(item, out, depth + 1)) return false;
    }
  }
  return true;
}

/** Jetons d'une chaîne d'entrée : la chaîne entière et chacun de ses mots, sans guillemets d'encadrement. */
function valueTokens(value: string): string[] {
  return [value, ...value.split(/\s+/)]
    .map((token) => token.replace(/^["'`]+|["'`]+$/g, ""))
    .filter((token) => token !== "");
}

/**
 * Candidats de chemin d'un jeton : le jeton lui-même, la valeur après chaque `=` (`--file=/x`), le
 * chemin attaché à une option courte (`-f/x`, premier `/` avant tout `=`) et la partie suivant `:`
 * (`hôte:/x`). Un `/` interne d'une valeur (`--format=%H/%s`) ne fait pas un candidat.
 */
function attachedCandidates(token: string): string[] {
  const out = [token];
  const equals = token.indexOf("=");
  for (let i = 0; i < token.length; i++) {
    const c = token.charAt(i);
    if (c === "=") out.push(token.slice(i + 1));
    else if (c === "/" && i > 0 && token.charAt(i - 1) === ":") out.push(token.slice(i));
  }
  const slash = token.indexOf("/");
  if (token.startsWith("-") && slash > 0 && (equals === -1 || slash < equals)) {
    out.push(token.slice(slash));
  }
  return out;
}

/** Un jeton ressemble-t-il à un chemin : absolu, lecteur Windows, segment `..` ou `~` ? */
function looksLikePath(token: string): boolean {
  return /^(?:[\\/]|~|[A-Za-z]:)/.test(token) || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(token);
}

/** Vrai si `checkPathAccess` ne relève aucun constat pour ce candidat ; `~utilisateur` est refusé (non résolu). */
function tokenPathFree(candidate: string, workspace: PolicyContext): boolean {
  if (/^~(?![\\/]|$)/.test(candidate)) return false;
  return checkPathAccess([candidate], workspace) === null;
}
