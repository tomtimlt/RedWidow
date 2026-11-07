import { isIP } from "node:net";
import { createRedactor, REDACTED } from "../redact.js";
import { isPublicAddress } from "./network.js";

/** Noms d'outils côté gate (préfixe MCP du serveur `web`). */
export const SEARCH_WEB_TOOL = "mcp__web__search_web";
export const READ_URL_TOOL = "mcp__web__read_url";

/**
 * Sources de référence (ADR 0039) : `read_url` y est autorisé sans demande. Correspondance d'hôte
 * exacte ou sous-domaine strict (jamais un simple suffixe de texte), HTTPS uniquement.
 */
export const REFERENCE_HOSTS: readonly string[] = [
  // Vulnérabilités et exploits
  "nvd.nist.gov",
  "cve.mitre.org",
  "cve.org",
  "exploit-db.com",
  "portswigger.net",
  "owasp.org",
  "arxiv.org",
  // GitHub et ses avis
  "github.com",
  "raw.githubusercontent.com",
  // Documentations d'éditeurs
  "learn.microsoft.com",
  "developer.mozilla.org",
  "docs.aws.amazon.com",
  "cloud.google.com",
  "docs.docker.com",
  "kubernetes.io",
  "nginx.org",
  "httpd.apache.org",
  "solr.apache.org",
  "php.net",
  "docs.python.org",
  "nodejs.org",
  "access.redhat.com",
  "coreruleset.org",
];

function normalizeHost(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

/** `true` si `host` est un hôte de référence ou un sous-domaine strict de l'un d'eux. */
export function isReferenceHost(host: string): boolean {
  const h = normalizeHost(host);
  return REFERENCE_HOSTS.some((ref) => h === ref || h.endsWith(`.${ref}`));
}

/** `true` pour une URL HTTPS (port par défaut, sans identifiants) vers un hôte de référence. */
export function isReferenceUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    (url.port === "" || url.port === "443") &&
    isReferenceHost(url.hostname)
  );
}

export type WebGuardFinding = "secret" | "redacted" | "privateAddress";

const IPV4 = /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/g;
const IPV6 = /[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}/gi;
const LOCAL_NAME = /(?:^|\.)(?:localhost|local|internal|lan|home|corp|intranet)$/;
const redact = createRedactor();

function privateAddress(text: string): boolean {
  for (const m of text.match(IPV4) ?? []) if (isIP(m) === 4 && !isPublicAddress(m)) return true;
  for (const m of text.match(IPV6) ?? []) if (isIP(m) === 6 && !isPublicAddress(m)) return true;
  return false;
}

function inspect(text: string): WebGuardFinding | null {
  if (text.includes(REDACTED)) return "redacted";
  if (redact(text) !== text) return "secret";
  if (privateAddress(text)) return "privateAddress";
  return null;
}

/**
 * Garde d'arguments des outils web (ADR 0039) : une requête ou une URL qui contient un secret
 * (motifs du recorder), une valeur déjà masquée, une adresse IP privée ou locale (ou un nom d'hôte
 * local pour `read_url`) est une fuite possible vers un tiers. Renvoie la nature du constat, ou
 * `null`. Un constat repasse l'appel en « ask » non mémorisable, même vers un hôte de référence.
 * Les appels aux autres outils ne sont pas concernés.
 */
export function webArgumentGuard(
  tool: string,
  input: Record<string, unknown>,
): WebGuardFinding | null {
  if (tool === SEARCH_WEB_TOOL) {
    const query = input.query;
    return typeof query === "string" ? inspect(query) : null;
  }
  if (tool !== READ_URL_TOOL) return null;
  const value = input.url;
  if (typeof value !== "string") return null;
  const found = inspect(value);
  if (found !== null) return found;
  try {
    // Aussi la forme décodée : un secret encodé en pourcentage échapperait aux motifs.
    const url = new URL(value);
    const decoded = decodeURIComponent(`${url.pathname}${url.search}`);
    const inDecoded = inspect(decoded);
    if (inDecoded !== null) return inDecoded;
    if (LOCAL_NAME.test(normalizeHost(url.hostname))) return "privateAddress";
  } catch {
    /* URL illisible ou encodage invalide : le texte brut a déjà été inspecté. */
  }
  return null;
}
