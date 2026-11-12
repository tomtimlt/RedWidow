import { CodedError } from "@warband/core";

/** Normalise `REDWIDOW_PUBLIC_ORIGIN` ; erreur codée si absente ou invalide. */
export function normalizeOrigin(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) throw new CodedError("server.originMissing");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CodedError("server.originInvalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CodedError("server.originInvalid");
  }
  return url.origin;
}

/** Égalité stricte entre l'en-tête `Origin` reçu et l'origine publique attendue. */
export function originAllowed(header: string | undefined, expected: string): boolean {
  return header !== undefined && header === expected;
}
