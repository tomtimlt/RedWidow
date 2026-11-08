import type { Locale } from "./catalog.js";
import { AUDIT_LABELS, auditEn } from "./ui-domains/audit.js";
import { chatEn } from "./ui-domains/chat.js";
import { cockpitEn } from "./ui-domains/cockpit.js";
import { engagementEn } from "./ui-domains/engagement.js";
import { hostEn } from "./ui-domains/host.js";
import { logicEn } from "./ui-domains/logic.js";
import { programEn } from "./ui-domains/program.js";
import { redwidowEn } from "./ui-domains/redwidow.js";
import { resourcesEn } from "./ui-domains/resources.js";
import { sessionsEn } from "./ui-domains/sessions.js";
import { studioEn } from "./ui-domains/studio.js";
import { viewerEn } from "./ui-domains/viewer.js";

/** Les clés sont les textes produit français ; les valeurs dynamiques restent des données. */
export const UI_EN: Readonly<Record<string, string>> = {
  ...chatEn,
  ...cockpitEn,
  ...hostEn,
  ...logicEn,
  ...studioEn,
  ...resourcesEn,
  ...auditEn,
  ...redwidowEn,
  ...programEn,
  ...engagementEn,
  ...sessionsEn,
  ...viewerEn,
};
let currentLocale: Locale = "fr";
export const getUiLocale = (): Locale => currentLocale;
export function setUiLocale(value: unknown): void {
  currentLocale = value === "en" ? "en" : "fr";
}
export type UiParams = Readonly<Record<string, unknown>>;
export function uiText(locale: Locale, key: string, params: UiParams = {}): string {
  const template = locale === "en" ? (UI_EN[key] ?? key) : key;
  return template.replace(/\{(\w+)\}/g, (token, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : token,
  );
}
export function translateFr(
  key: string,
  locale: Locale = currentLocale,
  params?: UiParams,
): string {
  return uiText(locale, key, params);
}
export interface UiTranslator {
  (key: string, params?: UiParams): string;
  (parts: TemplateStringsArray, ...values: unknown[]): string;
}
export function createUiTranslator(locale: () => Locale): UiTranslator {
  return ((input: string | TemplateStringsArray, ...values: unknown[]) => {
    if (typeof input === "string")
      return uiText(locale(), input, values[0] as UiParams | undefined);
    const params: Record<string, unknown> = {};
    const key = input.reduce((text, part, index) => {
      if (index < values.length) params[String(index)] = values[index];
      return text + part + (index < values.length ? `{${index}}` : "");
    }, "");
    return uiText(locale(), key, params);
  }) as UiTranslator;
}
export const t: UiTranslator = createUiTranslator(getUiLocale);

/** Les valeurs du registre gardent des codes stables ; seul leur libellé est traduit. */
export function auditLabel(value: string, locale: Locale = currentLocale): string {
  return uiText(locale, AUDIT_LABELS[value] ?? value);
}
