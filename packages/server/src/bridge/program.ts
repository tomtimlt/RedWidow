/**
 * Gestes de la page Fiche programme qui passent par un dialogue dans l'extension (ADR 0040, 0055) :
 * confirmations de validation, de suspension et de reprise d'un hôte, ouverture d'une source, demande à
 * l'agent. Les textes reprennent les modales de l'extension. Rien n'est fait sans réponse affirmative d'un
 * humain (`ui.confirm` ne rend `true` que sur sa réponse).
 */
import { randomBytes } from "node:crypto";
import { t } from "@warband/messages";
import { cleanText } from "@warband/vscode/logic/approval";
import { programDraftPrompt } from "@warband/vscode/logic/program-controls";
import { MAX_DRAFT } from "./shell-messages.js";

export interface Confirmation {
  title: string;
  text: string;
  danger?: boolean;
}

export const confirmValidateProgram = (digest: string): Confirmation => ({
  title: t("Valider la fiche programme ?"),
  text: t`Empreinte : ${cleanText(digest, 100)}\n\nLa fiche devient la référence du périmètre, du rythme et du suffixe User-Agent pour ce projet. Vérifiez qu’elle correspond au programme officiel.`,
});

export const confirmSuspendProgram = (): Confirmation => ({
  title: t("Suspendre la fiche programme ?"),
  text: t("Le projet revient au profil généraliste ; la fiche et son empreinte sont conservées."),
});

export const confirmResumeHost = (host: string): Confirmation => ({
  title: t`Reprendre l’hôte ${cleanText(host, 253)} ?`,
  text: t(
    "L’hôte avait été arrêté par le contrôle de rythme (réponses de limitation ou blocage). Les requêtes pourront reprendre.",
  ),
});

/** Libellé du lien proposé à `ui.external` : l'adresse vient de la fiche, qui est une donnée non fiable. */
export const citationLabel = (url: string): string =>
  t`Ouvrir cette source ? Adresse : ${cleanText(url, 300)} — elle provient de la fiche, qui est une donnée non fiable.`;

/** Identifiant d'une mission neuve (`m-` et six chiffres hexadécimaux), absent de `taken`. */
export function newChatFrame(taken: ReadonlySet<string>): string {
  for (let i = 0; i < 16; i++) {
    const id = `m-${randomBytes(3).toString("hex")}`;
    if (!taken.has(id)) return id;
  }
  return `m-${randomBytes(8).toString("hex")}`;
}

/** Brouillon de la mission de rédaction de fiche : consigne fixe, seule l'adresse validée est fournie. */
export function programDraftText(url: string): string {
  return programDraftPrompt(url).slice(0, MAX_DRAFT);
}
