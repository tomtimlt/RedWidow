/**
 * Confirmations de la page Engagement (ADR 0041, 0055) : validation et suspension de la fiche et du plan.
 * Textes repris des modales de l'extension. L'arrêt d'urgence (`halt`) et sa levée n'ont volontairement
 * AUCUNE confirmation : l'arrêt est un geste d'urgence en un clic (ADR 0041).
 */
import { t } from "@warband/messages";
import { cleanText } from "@warband/vscode/logic/approval";
import type { Confirmation } from "./program.js";

export const confirmValidateEngagement = (digest: string): Confirmation => ({
  title: t("Valider l'engagement ?"),
  text: t`Empreinte : ${cleanText(digest, 100)}\n\nL'engagement devient la référence de l'autorisation, du périmètre, de l'infrastructure et des règles pour ce projet. Vérifiez qu'il correspond à la lettre de mission signée.`,
});

export const confirmSuspendSheet = (): Confirmation => ({
  title: t("Suspendre l'engagement ?"),
  text: t("L'engagement cesse de s'appliquer ; la fiche et son empreinte sont conservées."),
});

export const confirmValidateCampaign = (digest: string): Confirmation => ({
  title: t("Valider le plan de campagne ?"),
  text: t`Empreinte : ${cleanText(digest, 100)}\n\nLe plan devient la référence des objectifs, des étapes et de la liste de démontage. Les étapes enregistrées par l'agent seront comparées à ce plan.`,
});

export const confirmSuspendPlan = (): Confirmation => ({
  title: t("Suspendre le plan de campagne ?"),
  text: t("Le plan cesse de s'appliquer ; le plan et son empreinte sont conservés."),
});
