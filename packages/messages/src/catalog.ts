import type { ReasonParams } from "@warband/core";

export type Locale = "fr" | "en";

/** Langue par défaut : le repli commence toujours par le catalogue demandé. */
export const DEFAULT_LOCALE: Locale = "fr";

/** Valide une langue d’interface sans conversion implicite. */
export function isLocale(value: unknown): value is Locale {
  return value === "fr" || value === "en";
}

/** Utilise le français pour une valeur absente ou inconnue. */
export function localeOf(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Outils de formatage donnés à chaque libellé, pour composer les motifs imbriqués. */
export interface FormatContext {
  /** Libellé du motif sous-jacent (`cause`), ou `undefined` s'il n'y en a pas. */
  cause: string | undefined;
}

/** Libellé d'un code : reçoit les paramètres du motif (`{}` s'il n'en a pas). */
export type Template = (params: Readonly<ReasonParams>, ctx: FormatContext) => string;

/** Catalogue des libellés de motifs et d'erreurs, indexé par code. */
export type Catalog = Readonly<Record<string, Template>>;

/** Textes fixes des libellés d'événements (`eventLabel`). */
export interface EventStrings {
  run: string;
  user: string;
  thinking: string;
  thinkingMasked: string;
  deniedBySdk: string;
  retry: string;
  task: string;
  rateLimit: string;
  paceAdjusted: string;
  paceHalted: string;
  session: string;
  tools: string;
  turns: string;
  journalTruncated: string;
  lostEvents: string;
  lines: string;
  authSubscription: string;
  authApiKey: string;
  authCloud: string;
  authUnknown: string;
  authentication: string;
  authenticating: string;
  approvalRequested: string;
  bypass: string;
  programSheet: string;
  engagementSheet: string;
  engagementHalt: string;
  turn: string;
  context: string;
  sandbox: string;
}

export interface Messages {
  reasons: Catalog;
  events: EventStrings;
}
