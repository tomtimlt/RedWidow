/**
 * Masquage des secrets dans les charges utiles d'événements. Appliqué par le
 * recorder avant tout sink : journal, CLI et export HTML ne voient jamais les
 * valeurs en clair.
 */

export const REDACTED = "[REDACTED]";

export type Redactor = <T>(value: T) => T;

const SENSITIVE_KEY =
  /secret|token|passw|pwd|api[-_]?key|auth|credential|private[-_]?key|access[-_]?key|cookie|session|^pass$|^mdp$/i;

/** Clés qui correspondent à l'heuristique mais ne portent pas de secret (identifiants opaques). */
/**
 * Clés dont le nom ressemble à un secret mais dont la valeur est un simple
 * descripteur (identifiant de session, ORIGINE du jeton ou de la clé : « none »,
 * « CLAUDE_CODE_OAUTH_TOKEN »…), jamais le secret lui-même.
 */
const SAFE_KEYS = new Set(["sessionId", "apiKeySource", "tokenSource"]);

/** Variable d'environnement dont la valeur est sensible (même heuristique que les clés). */
const SENSITIVE_ENV_NAME = SENSITIVE_KEY;

const PATTERNS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];

/** `://user:pass@host` → `://user:[REDACTED]@host` */
const URL_CREDENTIALS = /(:\/\/[^\s:/@]+:)[^\s@/]+(@)/g;

/** `password=abc`, `token: abc`, `--api-key abc` → valeur masquée. */
const KEY_VALUE =
  /\b((?:pass\s*=|[A-Za-z0-9_-]*(?:secret|token|passw(?:or)?d|pwd|api[-_]?key|credential|private[-_]?key|access[-_]?key)\s*[=:])\s*)(?!\[REDACTED\])("[^"]*"|'[^']*'|[^\s"',;]+)/gi;

/** Identifiants saisis comme texte libre : mêmes motifs pour le masquage et l’avertissement. */
const EMAIL_PASSWORD =
  /(?<![A-Z0-9._%+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}:(?![A-Z0-9_.-]+\/[A-Z0-9_.-]+)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s"'<>]+)/gi;
const MDP_VALUE =
  /\b(mdp(?:[ \t]*[=:][ \t]*|[ \t]+))(?!\[REDACTED\])(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s"',;]+)/gi;
const COOKIE_HEADER = /\b(Cookie[ \t]*:[ \t]*)(?!\[REDACTED\])[^\r\n]+/gi;

export function hasPastedCredentials(text: string): boolean {
  return [EMAIL_PASSWORD, KEY_VALUE, MDP_VALUE, COOKIE_HEADER].some(
    (pattern) => text.search(pattern) >= 0,
  );
}

const ENV_FLAGS = new Set(["--env", "-e"]);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface RedactorOptions {
  /** Valeurs littérales à masquer partout (ex. secrets de `process.env`). */
  values?: readonly string[];
}

/** Valeurs des variables d'environnement au nom sensible (longueur ≥ 8). */
export function secretsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const out = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (value && value.length >= 8 && SENSITIVE_ENV_NAME.test(name)) out.add(value);
  }
  return [...out];
}

export function createRedactor({ values = [] }: RedactorOptions = {}): Redactor {
  const literals = [...new Set(values.filter((v) => v.length >= 8))].sort(
    (a, b) => b.length - a.length,
  );
  const literalRe =
    literals.length > 0 ? new RegExp(literals.map(escapeRegExp).join("|"), "g") : null;

  const redactString = (text: string): string => {
    let out = text;
    if (literalRe) out = out.replace(literalRe, REDACTED);
    for (const pattern of PATTERNS) out = out.replace(pattern, REDACTED);
    out = out.replace(URL_CREDENTIALS, `$1${REDACTED}$2`);
    out = out.replace(KEY_VALUE, `$1${REDACTED}`);
    out = out.replace(EMAIL_PASSWORD, REDACTED);
    out = out.replace(MDP_VALUE, `$1${REDACTED}`);
    out = out.replace(COOKIE_HEADER, `$1${REDACTED}`);
    return out;
  };

  const redactEnvAssignment = (text: string): string => {
    const eq = text.indexOf("=");
    return eq === -1 ? text : `${text.slice(0, eq + 1)}${REDACTED}`;
  };

  const redactArgv = (argv: readonly unknown[]): unknown[] =>
    argv.map((item, i) => {
      if (typeof item !== "string") return walk(item, "");
      const previous = argv[i - 1];
      if (typeof previous === "string" && ENV_FLAGS.has(previous)) {
        return redactEnvAssignment(item);
      }
      if (item.startsWith("--env=")) return `--env=${redactEnvAssignment(item.slice(6))}`;
      return redactString(item);
    });

  const walk = (value: unknown, key: string): unknown => {
    if (typeof value === "string") {
      return key !== "" && SENSITIVE_KEY.test(key) && !SAFE_KEYS.has(key)
        ? REDACTED
        : redactString(value);
    }
    if (Array.isArray(value)) {
      if (key === "argv" || key === "command") return redactArgv(value);
      return value.map((item) => walk(item, key));
    }
    if (typeof value === "object" && value !== null) {
      const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => {
        if (k === "env" && typeof v === "object" && v !== null && !Array.isArray(v)) {
          return [k, Object.fromEntries(Object.keys(v).map((name) => [name, REDACTED]))] as const;
        }
        return [k, walk(v, k)] as const;
      });
      return Object.fromEntries(entries);
    }
    return value;
  };

  return <T>(value: T): T => walk(value, "") as T;
}

/** Masqueur de valeurs apprises en cours de session (secret d'un identifiant découvert par l'agent). */
export interface SecretMasker {
  /** Apprend une valeur ; `false` si elle est trop courte (< 6 caractères) pour être masquée sans dégât. */
  add(value: string): boolean;
  /** Masque la valeur apprise et ses variantes encodées dans toutes les chaînes (clés comprises : non). */
  redact: Redactor;
}

/** Champs structurels à la racine d'une charge utile (ou d'un message IPC `event`) : jamais réécrits (ids, genres, corrélation). */
const STRUCTURAL_KEYS = new Set([
  "kind",
  "code",
  "id",
  "runId",
  "parentId",
  "toolUseId",
  "correlation",
  "type",
  "v",
]);

/** Seuil des valeurs masquées, identique à celui des comptes de test (ADR 0043). */
const MIN_LEARNED_LENGTH = 6;

export function createSecretMasker(): SecretMasker {
  const literals = new Set<string>();
  let pattern: RegExp | null = null;
  const add = (value: string): boolean => {
    if (value.length < MIN_LEARNED_LENGTH) return false;
    for (const variant of [
      value,
      encodeURIComponent(value),
      new URLSearchParams({ v: value }).toString().slice(2),
      Buffer.from(value).toString("base64"),
      JSON.stringify(value).slice(1, -1),
    ])
      if (variant.length >= MIN_LEARNED_LENGTH) literals.add(variant);
    pattern = new RegExp(
      [...literals]
        .sort((a, b) => b.length - a.length)
        .map(escapeRegExp)
        .join("|"),
      "g",
    );
    return true;
  };
  /** `path` : clés parcourues depuis la racine ; la racine d'un événement est `[]` ou `["event"]` (message IPC). */
  const walk = (value: unknown, path: readonly string[]): unknown => {
    if (pattern === null) return value;
    if (typeof value === "string") return value.replace(pattern, REDACTED);
    if (Array.isArray(value)) return value.map((item) => walk(item, [...path, ""]));
    if (typeof value === "object" && value !== null) {
      const eventRoot = path.length === 0 || (path.length === 1 && path[0] === "event");
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          eventRoot && STRUCTURAL_KEYS.has(key) ? item : walk(item, [...path, key]),
        ]),
      );
    }
    return value;
  };
  return { add, redact: <T>(value: T): T => walk(value, []) as T };
}
