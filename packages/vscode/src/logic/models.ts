import { EFFORTS, type ModelOption } from "@warband/core";
import { cleanText } from "./approval.js";

/** Plafonds du sondage (réponse venue du moteur, donc validée comme toute entrée). */
export const MAX_MODELS = 100;
const MAX_FIELD = 200;
const MAX_DESCRIPTION = 500;

/** Identifiant de modèle acceptable : pas d'espace, pas de contrôle, borné. */
const MODEL_ID = /^[A-Za-z0-9._:/@[\]-]+$/;
export const isModelId = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_FIELD && MODEL_ID.test(value);

/** Variante opaque du moteur : identifiant borné, sans contrôle ni texte d'affichage. */
export const isReasoningVariant = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const OPTION_KEYS = [
  "value",
  "displayName",
  "description",
  "supportedEffortLevels",
  "reasoningVariants",
];

/** Valide strictement la liste reçue du moteur : forme exacte, bornes ; `null` si mal formée. */
export function parseModelOptions(raw: unknown): ModelOption[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_MODELS) return null;
  const out: ModelOption[] = [];
  for (const item of raw) {
    if (!isObj(item) || Object.keys(item).some((k) => !OPTION_KEYS.includes(k))) return null;
    const { value, displayName, description, supportedEffortLevels, reasoningVariants } = item;
    if (typeof value !== "string" || value === "" || value.length > MAX_FIELD) return null;
    if (typeof displayName !== "string" || displayName.length > MAX_FIELD) return null;
    if (
      description !== undefined &&
      (typeof description !== "string" || description.length > MAX_DESCRIPTION)
    ) {
      return null;
    }
    if (
      reasoningVariants !== undefined &&
      (!Array.isArray(reasoningVariants) ||
        reasoningVariants.length > 64 ||
        reasoningVariants.some((variant) => !isReasoningVariant(variant)) ||
        new Set(reasoningVariants).size !== reasoningVariants.length)
    ) {
      return null;
    }
    if (
      supportedEffortLevels !== undefined &&
      (!Array.isArray(supportedEffortLevels) ||
        supportedEffortLevels.length > EFFORTS.length ||
        supportedEffortLevels.some((l) => !(EFFORTS as readonly string[]).includes(String(l))))
    ) {
      return null;
    }
    out.push(item as unknown as ModelOption);
  }
  return out;
}

/** Entrées utilisables par l'interface : identifiant valide, textes neutralisés (affichage). */
export function usableModels(list: readonly ModelOption[]): ModelOption[] {
  return list
    .filter((m) => isModelId(m.value))
    .map((m) => ({
      ...m,
      displayName: cleanText(m.displayName, MAX_FIELD) || m.value,
      ...(m.description !== undefined && {
        description: cleanText(m.description, MAX_DESCRIPTION),
      }),
    }));
}

/** Cache de la liste, valable pour une seule version du SDK. */
export interface ModelCache {
  sdk: string;
  models: ModelOption[];
}

/** Relit le cache : version différente, forme invalide ou liste vide → `null` (à resonder). */
export function parseModelCache(raw: unknown, sdk: string): ModelOption[] | null {
  if (!isObj(raw) || raw.sdk !== sdk) return null;
  const models = parseModelOptions(raw.models);
  const usable = models ? usableModels(models) : [];
  return usable.length > 0 ? usable : null;
}

/**
 * Choix de modèle venu de la webview (hostile) : `null` = défaut. Liste connue → l'identifiant doit en
 * être ; liste inconnue → saisie libre, mais toujours un identifiant bien formé.
 */
export function validateModelChoice(
  choice: unknown,
  models: readonly ModelOption[] | null,
): { ok: true; model: string | null } | { ok: false } {
  if (choice === null || choice === "") return { ok: true, model: null };
  if (!isModelId(choice)) return { ok: false };
  if (models !== null && !models.some((m) => m.value === choice)) return { ok: false };
  return { ok: true, model: choice };
}
