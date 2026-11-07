import {
  DEFAULT_SUPERVISION,
  type ModelOption,
  parseSupervision,
  type SupervisionLevel,
} from "@warband/core";
import { t } from "@warband/messages";
import {
  clampEffort,
  type EffortChoice,
  isProvider,
  isSupported,
  levelsFor,
  type Provider,
  parseEffortChoice,
  toEffort,
  type UltracodeLimits,
  ultracodeTip,
} from "./effort.js";
import { isModelId, isReasoningVariant } from "./models.js";

/** Préférences de la conversation (persistées côté extension, jamais dans l'espace de travail). */
export interface Prefs {
  /** `null` : modèle par défaut (réglage machine `warband.model`, sinon celui du binaire). */
  model: string | null;
  /** `null` = « Auto » : aucun effort n'est transmis, le modèle garde son défaut (tant que le curseur n'a pas été touché). */
  effort: EffortChoice | null;
  /** Variante OpenCode exacte ; `null` laisse le moteur choisir. */
  variant: string | null;
  provider: Provider;
  /** Niveau d'encadrement du chat (fréquence des relances du moteur) ; défaut `standard`. */
  supervision: SupervisionLevel;
}

export const DEFAULT_PREFS: Prefs = {
  model: null,
  effort: null,
  variant: null,
  provider: "claude",
  supervision: DEFAULT_SUPERVISION,
};

/** Relit des préférences stockées en les revalidant (le stockage n'est pas une source de confiance). */
export function parsePrefs(raw: unknown): Prefs {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    model: isModelId(r.model) ? r.model : null,
    effort: parseEffortChoice(r.effort),
    variant: isReasoningVariant(r.variant) ? r.variant : null,
    provider: isProvider(r.provider) ? r.provider : "claude",
    supervision: parseSupervision(r.supervision),
  };
}

export type ModelsStatus = "idle" | "loading" | "ready" | "unavailable";

/** Ce que la webview affiche pour les sélecteurs : chaînes déjà neutralisées. */
export interface ChatControls {
  /** Modèle choisi (`null` = défaut). */
  model: string | null;
  /** `null` : liste inconnue, la webview propose la saisie libre. */
  models: { value: string; label: string; description: string; supportsImages?: boolean }[] | null;
  supportsImages?: boolean;
  modelsStatus: ModelsStatus;
  modelsMessage: string | null;
  /** `null` : Auto (aucun niveau transmis). */
  effort: EffortChoice | null;
  variant: string | null;
  reasoningVariants: { value: string; label: string }[];
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
  modelsMessage?: string | null;
  defaultModel: string | undefined;
  busy: boolean;
  ultracode?: UltracodeLimits;
  learning?: boolean;
}): ChatControls {
  const { prefs, models, status, defaultModel, busy } = input;
  const model = effectiveModel(models, prefs.model, defaultModel);
  const supported = model?.supportedEffortLevels;
  const reasoningVariants =
    prefs.provider === "claude"
      ? []
      : (model?.reasoningVariants ?? []).map((value) => ({ value, label: value }));
  const variant = reasoningVariants.some((entry) => entry.value === prefs.variant)
    ? prefs.variant
    : null;
  const effort =
    prefs.provider !== "claude" || prefs.effort === null
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
    ...(model?.supportsImages !== undefined && { supportsImages: model.supportsImages }),
    models:
      models?.map((m) => ({
        value: m.value,
        label: m.displayName,
        description: m.description ?? "",
        ...(m.supportsImages !== undefined && { supportsImages: m.supportsImages }),
      })) ?? null,
    modelsStatus: status,
    modelsMessage: input.modelsMessage ?? null,
    effort,
    variant,
    reasoningVariants,
    provider: prefs.provider,
    effortLabel: variant ?? current?.label ?? t("Auto"),
    effortTip:
      variant !== null
        ? t`Variante de raisonnement du modèle : ${variant}.`
        : current
          ? tip(current)
          : t(
              "Auto : aucun niveau d'effort n'est transmis, le modèle garde son comportement par défaut. Touchez le curseur pour en choisir un.",
            ),
    levels: levels.map((l) => ({
      value: l.value,
      label: l.label,
      tip: tip(l),
      enabled: isSupported(toEffort(l.value), supported),
    })),
    effortDisabled:
      prefs.provider === "claude"
        ? supported !== undefined && supported.length === 0
        : reasoningVariants.length === 0,
    locked: busy,
    learning: input.learning === true,
  };
}
