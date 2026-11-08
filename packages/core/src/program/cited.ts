import { isIP } from "node:net";
import { z } from "zod";

/** Valeur citée : d'où elle vient (citation, URL, date) et si le moteur a pu la recouper. */
export interface Cited<T> {
  value: T;
  quote: string;
  url: string;
  retrievedAt: string;
  verified: boolean;
}

const MAX_PATTERNS = 200;
const MAX_PATTERN = 253;
const MAX_QUOTE = 2000;
const MAX_URL = 2048;

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const validHost = (host: string, minLabels: number): boolean => {
  if (host.length === 0 || host.length > MAX_PATTERN) return false;
  const labels = host.split(".");
  return labels.length >= minLabels && labels.every((l) => HOST_LABEL.test(l));
};

/** CIDR `adresse/préfixe` : adresse IPv4 ou IPv6 valide, préfixe entier dans la plage de la famille. */
const validCidr = (text: string): boolean => {
  const [addr, prefix, ...rest] = text.split("/");
  if (addr === undefined || prefix === undefined || rest.length > 0) return false;
  const family = isIP(addr);
  if (family === 0 || !/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
};

/**
 * Motif de périmètre valide : hôte (`api.example.com`), joker de sous-domaines (`*.example.com`,
 * au moins deux étiquettes derrière le joker), adresse IP ou CIDR. Casse déjà ramenée en minuscules.
 */
export function isValidScopePattern(pattern: string): boolean {
  if (pattern.length === 0 || pattern.length > MAX_PATTERN) return false;
  if (pattern.includes("/")) return validCidr(pattern);
  if (isIP(pattern) !== 0) return true;
  if (pattern.startsWith("*.")) return validHost(pattern.slice(2), 2);
  return validHost(pattern, 1);
}

export const citedBase = {
  quote: z.string().max(MAX_QUOTE),
  url: z
    .string()
    .max(MAX_URL)
    .refine((u) => {
      try {
        const { protocol } = new URL(u);
        return protocol === "https:" || protocol === "http:";
      } catch {
        return false;
      }
    }),
  retrievedAt: z
    .string()
    .max(40)
    .refine((d) => !Number.isNaN(Date.parse(d))),
  verified: z.boolean(),
};

export const cited = <V extends z.ZodTypeAny>(value: V) =>
  z.object({ value, ...citedBase }).strict();

export const patterns = z
  .array(
    z
      .string()
      .transform((s) => s.trim().toLowerCase())
      .refine(isValidScopePattern),
  )
  .max(MAX_PATTERNS);

export const sortedUnique = (list: readonly string[]): string[] => [...new Set(list)].sort();

export const canonicalCited = <T>(c: Cited<T>, value: unknown) => ({
  value,
  quote: c.quote,
  url: c.url,
  retrievedAt: c.retrievedAt,
  verified: c.verified,
});
