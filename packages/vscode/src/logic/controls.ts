import type { ModelOption } from "@john-studio/core";
import {
  clampEffort,
  type EffortChoice,
  isSupported,
  levelsFor,
  type Provider,
  parseEffortChoice,
  toEffort,
  type UltracodeLimits,
  ultracodeTip,
} from "./effort.js";
import { isModelId } from "./models.js";

/** Préférences de la conversation (persistées côté extension, jamais dans l'espace de travail). */
export interface Prefs {
  /** `null` : modèle par défaut (réglage machine `john.model`, sinon celui du binaire). */
  model: string | null;
  /** `null` = « Auto » : aucun effort n'est transmis, le modèle garde son défaut (tant que le curseur n'a pas été touché). */
  effort: EffortChoice | null;
  provider: Provider;
}

export const DEFAULT_PREFS: Prefs = { model: null, effort: null, provider: "claude" };

/** Relit des préférences stockées en les revalidant (le stockage n'est pas une source de confiance). */
export function parsePrefs(raw: unknown): Prefs {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    model: isModelId(r.model) ? r.model : null,
    effort: parseEffortChoice(r.effort),
    provider: "claude",
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
  /** `null` : Auto (aucun niveau transmis). */
  effort: EffortChoice | null;
  provider: Provider;
  effortLabel: string;
  effortTip: string;
  levels: { value: EffortChoice; label: string; tip: string; enabled: boolean }[];
  /** Le modèle n'a pas d'effort réglable : curseur grisé. */
  effortDisabled: boolean;
  /** Un tour est en cours : les choix sont gelés (ils s'appliquent au message suivant). */
  locked: boolean;
  /** Mode apprentissage (ADR 0010) de ce chat : lecture des cours seule, Bypass inopérant. */
  learning: boolean;
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
  ultracode?: UltracodeLimits;
  learning?: boolean;
}): ChatControls {
  const { prefs, models, status, defaultModel, busy } = input;
  const supported = effectiveModel(models, prefs.model, defaultModel)?.supportedEffortLevels;
  const effort =
    prefs.effort === null
      ? null
      : prefs.effort === "ultracode"
        ? clampEffort("max", supported).clamped
          ? (clampEffort("max", supported).effort ?? "max")
          : "ultracode"
        : (clampEffort(prefs.effort, supported).effort ?? prefs.effort);
  const tip = (l: { value: EffortChoice; tip: string }) =>
    l.value === "ultracode" ? ultracodeTip(input.ultracode) : l.tip;
  const levels = levelsFor(prefs.provider);
  const current = levels.find((l) => l.value === effort);
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
    provider: prefs.provider,
    effortLabel: current?.label ?? "Auto",
    effortTip: current
      ? tip(current)
      : "Auto : aucun niveau d'effort n'est transmis, le modèle garde son comportement par défaut. Touchez le curseur pour en choisir un.",
    levels: levels.map((l) => ({
      value: l.value,
      label: l.label,
      tip: tip(l),
      enabled: isSupported(toEffort(l.value), supported),
    })),
    effortDisabled: supported !== undefined && supported.length === 0,
    locked: busy,
    learning: input.learning === true,
  };
}
