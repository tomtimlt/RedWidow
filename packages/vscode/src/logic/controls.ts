import type { Effort, ModelOption } from "@john-studio/core";
import { clampEffort, DEFAULT_EFFORT, EFFORT_LEVELS, isSupported, parseEffort } from "./effort.js";
import { isModelId } from "./models.js";

/** Préférences de la conversation (persistées côté extension, jamais dans l'espace de travail). */
export interface Prefs {
  /** `null` : modèle par défaut (réglage machine `john.model`, sinon celui du binaire). */
  model: string | null;
  effort: Effort;
}

export const DEFAULT_PREFS: Prefs = { model: null, effort: DEFAULT_EFFORT };

/** Relit des préférences stockées en les revalidant (le stockage n'est pas une source de confiance). */
export function parsePrefs(raw: unknown): Prefs {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    model: isModelId(r.model) ? r.model : null,
    effort: parseEffort(r.effort) ?? DEFAULT_EFFORT,
  };
}

export type ModelsStatus = "idle" | "loading" | "ready" | "unavailable";

/** Ce que la webview affiche pour les sélecteurs : chaînes déjà neutralisées. */
export interface ChatControls {
  /** Modèle choisi (`null` = défaut). */
  model: string | null;
  /** `null` : liste inconnue, la webview propose la saisie libre. */
  models: { value: string; label: string; description: string }[] | null;
  modelsStatus: ModelsStatus;
  effort: Effort;
  effortLabel: string;
  effortTip: string;
  levels: { value: Effort; label: string; tip: string; enabled: boolean }[];
  /** Le modèle n'a pas d'effort réglable : curseur grisé. */
  effortDisabled: boolean;
  /** Un tour est en cours : les choix sont gelés (ils s'appliquent au message suivant). */
  locked: boolean;
}

/** Modèle dont les niveaux comptent : le choix, sinon le réglage machine, sinon la première entrée de la liste. */
export function effectiveModel(
  models: readonly ModelOption[] | null,
  model: string | null,
  fallback: string | undefined,
): ModelOption | undefined {
  if (models === null) return undefined;
  const wanted = model ?? fallback;
  return wanted === undefined ? models[0] : models.find((m) => m.value === wanted);
}

export function buildControls(input: {
  prefs: Prefs;
  models: readonly ModelOption[] | null;
  status: ModelsStatus;
  defaultModel: string | undefined;
  busy: boolean;
}): ChatControls {
  const { prefs, models, status, defaultModel, busy } = input;
  const supported = effectiveModel(models, prefs.model, defaultModel)?.supportedEffortLevels;
  const effort = clampEffort(prefs.effort, supported).effort ?? prefs.effort;
  const current = EFFORT_LEVELS.find((l) => l.value === effort);
  return {
    model: prefs.model,
    models:
      models?.map((m) => ({
        value: m.value,
        label: m.displayName,
        description: m.description ?? "",
      })) ?? null,
    modelsStatus: status,
    effort,
    effortLabel: current?.label ?? "",
    effortTip: current?.tip ?? "",
    levels: EFFORT_LEVELS.map((l) => ({ ...l, enabled: isSupported(l.value, supported) })),
    effortDisabled: supported !== undefined && supported.length === 0,
    locked: busy,
  };
}
