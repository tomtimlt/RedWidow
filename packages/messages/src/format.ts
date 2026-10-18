import { CodedError, type ErrorInfo, type Reason } from "@warband/core";
import { type Catalog, DEFAULT_LOCALE, type Locale, type Messages } from "./catalog.js";
import { en } from "./en.js";
import { fr } from "./fr.js";

export const MESSAGES: Readonly<Record<Locale, Messages>> = { fr, en };

/** Ordre de repli : la langue demandée, puis les autres (fr → en, en → fr). */
function chain(locale: Locale): Catalog[] {
  const order: Locale[] = [
    locale,
    ...(Object.keys(MESSAGES) as Locale[]).filter((l) => l !== locale),
  ];
  return order.map((l) => MESSAGES[l].reasons);
}

/** Repli final : le code suivi des paramètres en JSON, pour un code qu'aucun catalogue ne connaît. */
function raw(reason: Reason): string {
  return reason.params === undefined
    ? reason.code
    : `${reason.code} ${JSON.stringify(reason.params)}`;
}

/**
 * Libellé d'un motif. Un texte brut (ancien journal) est rendu tel quel ; un
 * code inconnu s'affiche sous la forme `code + JSON des paramètres`.
 */
export function formatReason(reason: Reason | string, locale: Locale = DEFAULT_LOCALE): string {
  if (typeof reason === "string") return reason;
  const template = chain(locale)
    .map((catalog) => catalog[reason.code])
    .find((t) => t !== undefined);
  if (template === undefined) return raw(reason);
  const cause = reason.cause === undefined ? undefined : formatReason(reason.cause, locale);
  return template(reason.params ?? {}, { cause });
}

/**
 * Libellé d'une erreur : événement `error` (`ErrorInfo`), `CodedError` du
 * cœur, exception quelconque (message brut) ou texte d'un ancien journal.
 */
export function formatError(error: unknown, locale: Locale = DEFAULT_LOCALE): string {
  if (typeof error === "string") return error;
  if (error instanceof CodedError) {
    return formatReason(
      { code: error.code, ...(error.params && { params: error.params }) },
      locale,
    );
  }
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as ErrorInfo).code === "string"
  ) {
    const { message, ...reason } = error as ErrorInfo;
    // Une erreur inconnue porte son message brut : le libellé le reprend.
    return formatReason(
      message === undefined ? reason : { ...reason, params: { ...reason.params, message } },
      locale,
    );
  }
  return String(error);
}
