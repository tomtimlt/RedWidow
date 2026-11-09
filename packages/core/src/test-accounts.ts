import { z } from "zod";
import type { ProgramStatus } from "./program/store.js";
import { CodedError } from "./reason.js";
import { createRedactor, REDACTED, type Redactor } from "./redact.js";

/** Comptes réservés à SecretStorage, à l’IPC privé et au contexte de mission. */
export const testAccountSchema = z
  .object({
    label: z.string().regex(/^[A-Z][A-Z0-9_]{0,15}$/),
    host: z
      .string()
      .max(253)
      .refine((host) => host === "" || normalizeAccountHost(host) === host),
    identifier: z
      .string()
      .max(512)
      .refine((value) => !value.includes("\0")),
    secret: z
      .string()
      .min(1)
      .max(8192)
      .refine((value) => !value.includes("\0")),
    kind: z.enum(["password", "cookie"]),
  })
  .strict()
  .refine((account) => account.kind === "cookie" || account.identifier.length > 0);

export type TestAccount = z.infer<typeof testAccountSchema>;
export type TestAccountSummary = TestAccount;
export const testAccountsSchema = z
  .array(testAccountSchema)
  .max(20)
  .refine((accounts) => new Set(accounts.map((account) => account.label)).size === accounts.length);

export function normalizeAccountHost(raw: string): string | null {
  if (!raw || /[\s/@:?#%*\\]/u.test(raw)) return null;
  try {
    const url = new URL(`https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) && !host.includes("..") ? host : null;
  } catch {
    return null;
  }
}

const TOKEN = /\{\{compte:([A-Z][A-Z0-9_]{0,15}):(identifiant|secret)\}\}/g;
const mismatch = (): never => {
  throw new CodedError("account.invalid");
};

interface Cookie {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  expires: number | null;
}
export interface AccountHttpInput {
  url: string;
  headers?: Record<string, string> | undefined;
  body?: string | undefined;
  session?: string | undefined;
}
export interface TestAccounts {
  summaries(): TestAccountSummary[];
  substitute<T>(value: T): T;
  effectiveInput<T extends Record<string, unknown>>(tool: string, value: T): T;
  environment(): Record<string, string>;
  /** Masque les valeurs d’au moins six caractères et leurs variantes encodées. */
  redact: Redactor;
  prepareHttp(input: AccountHttpInput): AccountHttpInput;
  receiveCookies(session: string | undefined, url: string, cookies: readonly string[]): void;
  dispose(): void;
}

export function createTestAccounts(
  values: readonly TestAccount[],
  _program?: () => ProgramStatus,
  now = Date.now,
): TestAccounts {
  const parsed = testAccountsSchema.safeParse(values);
  if (!parsed.success) throw new CodedError("account.invalid");
  const accounts = new Map(parsed.data.map((account) => [account.label, account]));
  const jars = new Map<string, Cookie[]>();
  const initialCookieHosts = new Map<string, string>();
  const literals = new Set<string>();
  let literalPattern: RegExp | null = null;
  const baseRedact = createRedactor();
  const protect = (value: string) => {
    if (value.length < 6) return;
    for (const variant of [
      value,
      encodeURIComponent(value),
      new URLSearchParams({ v: value }).toString().slice(2),
      Buffer.from(value).toString("base64"),
      JSON.stringify(value).slice(1, -1),
    ])
      literals.add(variant);
    literalPattern = new RegExp(
      [...literals]
        .sort((a, b) => b.length - a.length)
        .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|"),
      "g",
    );
  };
  for (const account of accounts.values()) {
    protect(account.identifier);
    protect(account.secret);
    if (account.identifier.length >= 6 && account.secret.length >= 6)
      protect(`${account.identifier}:${account.secret}`);
  }
  const redact: Redactor = <T>(value: T): T => {
    const walk = (item: unknown, key = "", path: string[] = []): unknown => {
      const eventRoot = path.length === 0 || (path.length === 1 && path[0] === "event");
      const structural =
        eventRoot &&
        [
          "kind",
          "code",
          "id",
          "runId",
          "parentId",
          "toolUseId",
          "correlation",
          "type",
          "v",
        ].includes(key);
      const reasonCode =
        key === "code" &&
        ((path.length === 1 && path[0] === "reason") ||
          (path.length === 2 && path[0] === "event" && path[1] === "reason"));
      if (structural || reasonCode) return item;
      if (typeof item === "string")
        return item
          .split(REDACTED)
          .map((part) => (literalPattern ? part.replace(literalPattern, REDACTED) : part))
          .join(REDACTED);
      if (Array.isArray(item)) return item.map((entry) => walk(entry, "", [...path, key]));
      if (typeof item === "object" && item !== null)
        return Object.fromEntries(
          Object.entries(item).map(([child, entry]) => [
            child,
            walk(entry, child, key ? [...path, key] : path),
          ]),
        );
      return item;
    };
    return baseRedact(walk(value)) as T;
  };
  const checked = (label: string): TestAccount => accounts.get(label) ?? mismatch();
  const substituteText = (
    text: string,
    encode: (value: string) => string = (value) => value,
  ): string =>
    text.replace(TOKEN, (_all, label: string, field: string) => {
      const account = checked(label);
      return encode(field === "identifiant" ? account.identifier : account.secret);
    });
  const substitute = <T>(value: T): T => {
    const walk = (item: unknown): unknown =>
      typeof item === "string"
        ? substituteText(item)
        : Array.isArray(item)
          ? item.map(walk)
          : item !== null && typeof item === "object"
            ? Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, walk(entry)]))
            : item;
    return walk(value) as T;
  };
  return {
    redact,
    effectiveInput(tool, value) {
      if (tool === "mcp__web__http_request" && typeof value.url === "string") {
        return { ...value, ...this.prepareHttp(value as unknown as AccountHttpInput) };
      }
      return substitute(value);
    },
    summaries: () => [...accounts.values()].map((account) => ({ ...account })),
    substitute,
    environment: () =>
      Object.fromEntries(
        [...accounts.values()].flatMap((account) => [
          [`RW_COMPTE_${account.label}_IDENTIFIANT`, account.identifier],
          [`RW_COMPTE_${account.label}_SECRET`, account.secret],
        ]),
      ),
    prepareHttp(input) {
      const nextUrl = substituteText(input.url, encodeURIComponent);
      try {
        new URL(nextUrl);
      } catch {
        return mismatch();
      }
      const session = input.session === undefined ? undefined : checked(input.session);
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(input.headers ?? {})) {
        headers[key] = substituteText(value);
      }
      const actual = new URL(nextUrl);
      let body = input.body;
      const contentType =
        Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type")?.[1] ?? "";
      if (body !== undefined) {
        if (/application\/(?:[\w.+-]*\+)?json\b/i.test(contentType)) {
          let data: unknown;
          try {
            data = JSON.parse(body);
          } catch {
            throw new CodedError("web.invalidRequest");
          }
          const replace = (value: unknown): unknown => {
            if (typeof value === "string") return substituteText(value);
            if (Array.isArray(value)) return value.map(replace);
            if (value !== null && typeof value === "object")
              return Object.fromEntries(
                Object.entries(value).map(([key, item]) => [substituteText(key), replace(item)]),
              );
            return value;
          };
          body = JSON.stringify(replace(data));
        } else if (/application\/x-www-form-urlencoded/i.test(contentType)) {
          const form = new URLSearchParams(body);
          body = new URLSearchParams(
            [...form].map(
              ([key, value]) => [substituteText(key), substituteText(value)] as [string, string],
            ),
          ).toString();
        } else body = substituteText(body);
      }
      if (session) {
        const jar = jars.get(session.label) ?? [];
        const cookies = jar
          .filter(
            (cookie) =>
              (cookie.expires === null || cookie.expires > now()) &&
              (!cookie.secure || actual.protocol === "https:") &&
              (cookie.hostOnly
                ? actual.hostname === cookie.domain
                : actual.hostname === cookie.domain ||
                  actual.hostname.endsWith(`.${cookie.domain}`)) &&
              (actual.pathname === cookie.path ||
                actual.pathname.startsWith(
                  cookie.path.endsWith("/") ? cookie.path : `${cookie.path}/`,
                )),
          )
          .map((cookie) => `${cookie.name}=${cookie.value}`);
        if (session.kind === "cookie") {
          const host = initialCookieHosts.get(session.label) ?? (session.host || actual.hostname);
          initialCookieHosts.set(session.label, host);
          if (actual.hostname === host) cookies.unshift(session.secret);
        }
        if (cookies.length) {
          for (const key of Object.keys(headers))
            if (key.toLowerCase() === "cookie") delete headers[key];
          headers.Cookie = cookies.join("; ");
        }
      }
      return { ...input, url: nextUrl, headers, ...(body !== undefined && { body }) };
    },
    receiveCookies(session, value, cookies) {
      if (session === undefined) return;
      const url = new URL(value);
      checked(session);
      const jar = jars.get(session) ?? [];
      for (const text of cookies.slice(0, 50)) {
        const [first = "", ...attributes] = text.split(";");
        const equal = first.indexOf("=");
        const name = first.slice(0, equal).trim();
        const value = first.slice(equal + 1).trim();
        if (equal < 1 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n\0]/.test(value))
          continue;
        // Les valeurs reçues restent masquées jusqu'à la fin du run, même si le cookie expire.
        protect(value);
        const attrs = new Map(
          attributes.map((part) => {
            const [key = "", ...rest] = part.trim().split("=");
            return [key.toLowerCase(), rest.join("=").trim()];
          }),
        );
        const domain = attrs.get("domain");
        const cookieDomain =
          domain === undefined ? url.hostname : normalizeAccountHost(domain.replace(/^\./, ""));
        if (
          !cookieDomain ||
          (url.hostname !== cookieDomain && !url.hostname.endsWith(`.${cookieDomain}`))
        )
          continue;
        const defaultPath = url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1) || "/";
        const path = attrs.get("path")?.startsWith("/")
          ? (attrs.get("path") as string)
          : defaultPath;
        const maxAge = attrs.get("max-age");
        const expires =
          maxAge !== undefined && /^-?\d+$/.test(maxAge)
            ? now() + Number(maxAge) * 1000
            : attrs.has("expires") && Number.isFinite(Date.parse(attrs.get("expires") as string))
              ? Date.parse(attrs.get("expires") as string)
              : null;
        const previous = jar.findIndex(
          (cookie) =>
            cookie.name === name && cookie.path === path && cookie.domain === cookieDomain,
        );
        if (previous >= 0) jar.splice(previous, 1);
        if (expires === null || expires > now())
          jar.push({
            name,
            value,
            path,
            domain: cookieDomain,
            hostOnly: domain === undefined,
            secure: attrs.has("secure"),
            expires,
          });
      }
      jars.set(session, jar.slice(-100));
    },
    dispose() {
      accounts.clear();
      jars.clear();
      initialCookieHosts.clear();
      literals.clear();
      literalPattern = null;
    },
  };
}
