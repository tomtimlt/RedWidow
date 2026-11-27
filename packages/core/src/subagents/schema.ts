import { z } from "zod";

/**
 * Sous-agents proposés par l'agent et validés par l'utilisateur (ADR 0054) : bornes et schéma de la
 * proposition. Fichier sans dépendance d'exécution (ni recorder ni gate) : les événements, l'outil
 * du bureau et le tableau s'y réfèrent sans cycle.
 */

/** Nombre maximal d'éléments d'une proposition. */
export const SUBAGENTS_MAX_ITEMS = 4;
/** Plafond de sous-agents en cours (Task lancés, pas encore terminés). */
export const SUBAGENTS_MAX_RUNNING = 4;
/** Longueur maximale du nom d'un sous-agent (il sert aussi de `description` de l'appel Task). */
export const SUBAGENT_NAME_MAX = 60;
/** Longueur maximale de l'objectif d'un sous-agent. */
export const SUBAGENT_GOAL_MAX = 1000;
/** Longueur maximale de la note de l'utilisateur (refus ou accord commenté). */
export const SUBAGENTS_NOTE_MAX = 2000;

/** Élément proposé par l'agent : `name` est court et unique dans la proposition, `goal` décrit le volet. */
export interface SubagentDraft {
  name: string;
  goal: string;
}

/** Élément d'une proposition en attente : `id` est attribué par le tableau (`s1`, `s2`…). */
export interface SubagentItem extends SubagentDraft {
  id: string;
}

/** Place approuvée par l'utilisateur : `description` est celle que l'appel Task doit reprendre à l'identique. */
export interface SubagentPlace {
  id: string;
  description: string;
}

/** Clé d'unicité d'un nom : casse, espaces et accents ignorés (deux noms voisins ne cohabitent pas). */
export function subagentNameKey(name: string): string {
  return name.normalize("NFKD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Nom court sur une ligne : ni contrôle ni marque invisible (ils brouilleraient la carte et la comparaison). */
const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(SUBAGENT_NAME_MAX)
  .refine((value) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value), "contrôle interdit");

const goalSchema = z.string().trim().min(1).max(SUBAGENT_GOAL_MAX);

/** Un élément : exactement `name` et `goal` (toute autre clé est refusée). */
export const subagentDraftSchema = z.object({ name: nameSchema, goal: goalSchema }).strict();

/** Forme de l'entrée de l'outil `propose_subagents` (champ `items`), réutilisée par la spécification. */
export const proposeSubagentsShape = {
  items: z
    .array(subagentDraftSchema)
    .min(1)
    .max(SUBAGENTS_MAX_ITEMS)
    .refine(
      (items) => new Set(items.map((item) => subagentNameKey(item.name))).size === items.length,
      "noms en double",
    ),
};

/** Entrée complète : `items` seul, toute autre clé est refusée. */
export const proposeSubagentsSchema = z.object(proposeSubagentsShape).strict();

/** Premier champ fautif d'une erreur de validation, sous la forme `items.0.name`. */
export function firstIssuePath(error: z.ZodError): string | undefined {
  const path = error.issues[0]?.path;
  return path === undefined || path.length === 0 ? undefined : path.map(String).join(".");
}
