import { isLocale, type Locale } from "@warband/messages";

export type Translator = (fr: string, en: string) => string;

/** La langue est lue avant Commander pour traduire également son aide et ses erreurs. */
export function languageFromArgs(args: readonly string[]): Locale {
  let locale: Locale = "en";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") break;
    const value =
      arg === "--lang" ? args[++i] : arg?.startsWith("--lang=") ? arg.slice(7) : undefined;
    if (isLocale(value)) locale = value;
  }
  return locale;
}
