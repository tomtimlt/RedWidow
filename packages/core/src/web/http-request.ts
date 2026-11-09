import { z } from "zod";
import { capOutput } from "../output.js";
import type { PaceController, PaceOutcome } from "../pace/controller.js";
import type { PaceRegistry } from "../pace/registry.js";
import { hostOfTarget } from "../program/scope.js";
import type { ProgramSheet } from "../program/sheet.js";
import type { ProgramStatus } from "../program/store.js";
import { CodedError } from "../reason.js";
import type { Recorder } from "../recorder.js";
import { stripControl } from "../sanitize.js";
import { webNetworkError } from "./errors.js";
import { requestRaw, type WebDependencies, webUrl } from "./network.js";

/** Attente maximale d'un créneau de rythme avant de rendre `program.paced`. */
export const MAX_PACE_WAIT_MS = 90_000;
const REQUEST_TIMEOUT_MS = 25_000;
const DEFAULT_USER_AGENT = "Warband/0.3 (http_request)";
const MAX_BODY = 1024 * 1024;

/** Accès de l'outil à la fiche programme du projet actif et à son contrôleur de rythme. */
export interface WebProgram {
  /** Fiche appliquée (approuvée) du projet actif, sinon `undefined`. */
  sheet(): ProgramSheet | undefined;
  /** Contrôleur de rythme du projet pour cette fiche ; `null` sans projet. */
  pace(sheet: ProgramSheet): PaceController | null;
  /** Journal du run en cours (reçoit `pace.adjusted` et `pace.halted`). */
  attach?(recorder: Recorder): void;
  /** Attente annulable (défaut : minuterie). Injectable pour les tests. */
  sleep?(ms: number, signal: AbortSignal | undefined): Promise<void>;
}

/** Fabrique un `WebProgram` à partir du lecteur de fiche et du registre de contrôleurs. */
export function createWebProgram(options: {
  program: () => ProgramStatus;
  registry: PaceRegistry;
}): WebProgram {
  return {
    sheet: () => options.program().applied,
    pace: (sheet) => options.registry.controller(sheet),
    attach: (recorder) => options.registry.attach(recorder),
  };
}

function sleepAbortable(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", stop, { once: true });
  });
}

/** En-têtes que le modèle ne fixe pas : le moteur les gère (hôte, longueur, connexion, UA). */
const FORBIDDEN_HEADERS = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "te",
  "trailer",
  "expect",
  "accept-encoding",
  "proxy-authorization",
  "proxy-connection",
]);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export const HTTP_REQUEST_INPUT = {
  method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
  url: z.string().min(1).max(4096),
  headers: z.record(z.string(), z.string().max(8192)).optional(),
  body: z.string().max(MAX_BODY).optional(),
};

/** Indices de pare-feu applicatif (WAF) dans les en-têtes de réponse. */
const WAF_HEADERS = [
  "cf-mitigated",
  "x-sucuri-id",
  "x-sucuri-block",
  "x-amzn-waf-action",
  "x-iinfo",
  "x-datadome",
  "x-akamai-edgescape-block",
];
const WAF_SERVERS = /cloudflare|akamaighost|awswaf|imperva|incapsula|sucuri|barracuda|f5|bigip/i;
const WAF_BODY =
  /attention required|access denied|request blocked|blocked by (?:the )?(?:web application firewall|waf)|web application firewall|mod_security|modsecurity|incident id|incapsula incident|sucuri website firewall|request rejected/i;

/** 403 vraisemblablement émis par un WAF : en-tête, serveur ou corps typique. */
export function isWafForbidden(
  headers: Record<string, string | undefined>,
  bodyText: string,
): boolean {
  if (WAF_HEADERS.some((name) => headers[name] !== undefined)) return true;
  if (WAF_SERVERS.test(headers.server ?? "")) return true;
  return WAF_BODY.test(bodyText.slice(0, 8192));
}

/** Classe une réponse pour le contrôleur de rythme. */
export function paceOutcome(
  status: number,
  headers: Record<string, string | undefined>,
  bodyText: string,
): PaceOutcome {
  if (status === 429) return "http429";
  if (status === 403 && isWafForbidden(headers, bodyText)) return "waf403";
  return status >= 200 && status < 400 ? "ok" : "neutral";
}

function isTimeout(error: unknown, bounded: AbortSignal, parent: AbortSignal | undefined): boolean {
  if (parent?.aborted) return false;
  if (bounded.aborted) return true;
  const e = webNetworkError(error);
  return e.code === "web.timeout";
}

export interface HttpRequestSpecOptions {
  deps: WebDependencies;
  program: WebProgram | undefined;
}

/** Corps de l'outil `http_request` : résultat sérialisé en JSON pour le modèle. */
export async function runHttpRequest(
  raw: unknown,
  signal: AbortSignal | undefined,
  { deps, program }: HttpRequestSpecOptions,
): Promise<string> {
  const args = z.object(HTTP_REQUEST_INPUT).strict().parse(raw);
  const sheet = program?.sheet();
  if (!program || !sheet) throw new CodedError("program.required");

  if (args.body !== undefined && (args.method === "GET" || args.method === "HEAD"))
    throw new CodedError("web.invalidRequest");
  const url = webUrl(args.url);
  const host = hostOfTarget(url.hostname);
  if (host === null) throw new CodedError("web.invalidUrl");

  // En-têtes : validés, hors liste interdite ; le User-Agent fourni est complété du suffixe de la
  // fiche, qui n'est jamais retirable.
  const headers: Record<string, string> = {};
  let provided: string | undefined;
  for (const [name, value] of Object.entries(args.headers ?? {})) {
    const key = name.toLowerCase();
    if (!HEADER_NAME.test(name) || /[\r\n\0]/.test(value))
      throw new CodedError("web.invalidRequest");
    if (key === "user-agent") provided = stripControl(value).trim();
    else if (!FORBIDDEN_HEADERS.has(key)) headers[key] = value;
  }
  const suffix = sheet.userAgentSuffix?.value.trim();
  const userAgent = [provided || DEFAULT_USER_AGENT, suffix].filter(Boolean).join(" ");

  // Rythme : attente annulable bornée, puis `program.paced`.
  const pace = program.pace(sheet);
  const sleep = program.sleep ?? sleepAbortable;
  let waited = 0;
  const beforeRequest = async (_url: URL, addresses: string[]) => {
    pace?.bind?.(host, addresses);
    if (pace) {
      for (;;) {
        signal?.throwIfAborted();
        const decision = pace.acquire(host);
        if (decision.action === "send") break;
        if (decision.action === "halted")
          throw new CodedError("program.halted", {
            host: (pace.members?.(host) ?? [host]).join(", "),
          });
        if (waited + decision.ms > MAX_PACE_WAIT_MS)
          throw new CodedError(
            pace.status(host).suspected ? "pace.edgeBanSuspected" : "program.paced",
            { host: (pace.members?.(host) ?? [host]).join(", "), retryAfterMs: decision.ms },
          );
        await sleep(decision.ms, signal);
        waited += decision.ms;
      }
    }
  };

  const bounded = AbortSignal.any(signal ? [signal] : []);
  let transportStarted = false;
  const started = Date.now();
  let response: Awaited<ReturnType<typeof requestRaw>>;
  try {
    response = await requestRaw(
      url.href,
      {
        method: args.method,
        signal: bounded,
        headers,
        userAgent,
        beforeRequest,
        timeoutMs: REQUEST_TIMEOUT_MS,
        onTransport: () => {
          transportStarted = true;
        },
        ...(args.body !== undefined && { body: args.body }),
      },
      deps,
    );
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (
      error instanceof CodedError &&
      ["program.halted", "program.paced", "pace.edgeBanSuspected"].includes(error.code)
    )
      throw error;
    if (transportStarted && isTimeout(error, bounded, signal)) pace?.report(host, "timeout");
    else if (transportStarted) {
      const cause = error as { code?: string; cause?: { code?: string } };
      if (["ECONNRESET", "UND_ERR_SOCKET"].includes(cause.code ?? cause.cause?.code ?? ""))
        pace?.report(host, "disconnect");
    }
    if (pace?.status(host).halted)
      throw new CodedError("program.halted", { host: (pace.members?.(host) ?? [host]).join(", ") });
    if (pace?.status(host).suspected)
      throw new CodedError("pace.edgeBanSuspected", {
        host: (pace.members?.(host) ?? [host]).join(", "),
        retryAfterMs: 300_000,
      });
    if (error instanceof CodedError) throw error;
    throw webNetworkError(error, bounded.aborted);
  }
  const durationMs = Date.now() - started;
  const text = response.body.toString("utf8");
  pace?.report(host, paceOutcome(response.status, response.headers, text));

  const capped = capOutput(stripControl(text));
  return JSON.stringify({
    url: response.url,
    status: response.status,
    headers: response.headers,
    body: capped.output,
    truncated: capped.truncated || response.truncated,
    durationMs,
    ...(waited > 0 && { pacedMs: waited }),
  });
}
