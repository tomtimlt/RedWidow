import type { Policy } from "../approval/policy.js";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/**
 * Politique du mode apprentissage (ADR 0010) : tout est refusé sauf les deux outils `cours`,
 * par leur nom exact (sans joker, casse sensible). Un `deny` n'est ni mémorisable ni bypassable.
 * Figée en profondeur : aucun appelant ne peut l'élargir.
 */
export const LEARNING_POLICY: Policy = deepFreeze({
  default: "deny",
  rules: [
    { tool: "mcp__cours__chercher", decision: "allow" },
    { tool: "mcp__cours__lire", decision: "allow" },
  ],
} as Policy);
