import type { ReasonParams } from "@john-studio/core";

export type Locale = "fr" | "en";

/** Langue par défaut, et langue complète : le repli commence toujours par le catalogue demandé. */
export const DEFAULT_LOCALE: Locale = "fr";

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
  thinking: string;
  thinkingMasked: string;
  deniedBySdk: string;
  retry: string;
  task: string;
  rateLimit: string;
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
  turn: string;
  sandbox: string;
}

export interface Messages {
  reasons: Catalog;
  events: EventStrings;
}
