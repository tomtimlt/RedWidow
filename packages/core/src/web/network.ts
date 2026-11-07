import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, ProxyAgent, request } from "undici";
import { CodedError } from "../reason.js";
import { webCertificateAuthorities } from "./certificates.js";

const MAX_BYTES = 1024 * 1024;
export interface WebResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  close?(): Promise<void>;
}
export interface WebRequest {
  method: "GET" | "POST";
  body?: string;
  signal: AbortSignal;
}
export interface WebDependencies {
  lookup?: (hostname: string) => Promise<{ address: string; family: number }[]>;
  transport?: (url: URL, address: string, init: WebRequest) => Promise<WebResponse>;
}

/** Adresses routables publiques uniquement, y compris après redirection et résolution DNS. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) !== 6) return false;
  const normalized = new URL(`https://[${address}]/`).hostname.slice(1, -1).toLowerCase();
  return (
    /^[23]/.test(normalized) &&
    !/^2002:/.test(normalized) &&
    !/^2001:(?:db8:|(?:0|1|2|10|20):|:)/.test(normalized)
  );
}

export function webUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CodedError("web.invalidUrl");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    value.length > 4096
  )
    throw new CodedError("web.invalidUrl");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname) && !isPublicAddress(hostname)) throw new CodedError("web.invalidUrl");
  url.hash = "";
  return url;
}

function proxyFor(url: URL): string | undefined {
  const hostname = url.hostname.toLowerCase();
  const entries = (process.env.NO_PROXY ?? process.env.no_proxy ?? "").split(",");
  if (
    entries.some((entry) => {
      const host = entry
        .trim()
        .toLowerCase()
        .replace(/:\d+$/, "")
        .replace(/^\*?\./, "");
      return host === "*" || (host !== "" && (hostname === host || hostname.endsWith(`.${host}`)));
    })
  )
    return undefined;
  return (
    (url.protocol === "https:"
      ? (process.env.HTTPS_PROXY ?? process.env.https_proxy)
      : (process.env.HTTP_PROXY ?? process.env.http_proxy)) ??
    process.env.ALL_PROXY ??
    process.env.all_proxy
  );
}

/** IP validée épinglée ; HTTP par proxy utilise la forme absolue, HTTPS conserve CONNECT et SNI. */
export async function webTransport(
  url: URL,
  address: string,
  init: WebRequest,
  certificates = webCertificateAuthorities(),
): Promise<WebResponse> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const pinned = new URL(url);
  pinned.hostname = isIP(address) === 6 ? `[${address}]` : address;
  const trust = { rejectUnauthorized: true, ...(certificates && { ca: certificates }) };
  const tls = { ...trust, ...(!isIP(hostname) && { servername: hostname }) };
  const proxy = proxyFor(url);
  const dispatcher = proxy
    ? new ProxyAgent({ uri: proxy, proxyTunnel: false, requestTls: tls, proxyTls: trust })
    : new Agent({ connect: tls });
  try {
    const response = await request(pinned, {
      dispatcher,
      method: init.method,
      signal: init.signal,
      headers: {
        host: url.host,
        "user-agent": "Warband/0.3 (web tools)",
        "accept-encoding": "identity",
        accept:
          init.method === "POST"
            ? "application/json, text/event-stream"
            : "text/html, text/plain, application/json;q=0.9, */*;q=0.1",
        ...(init.body !== undefined && { "content-type": "application/json" }),
      },
      ...(init.body !== undefined && { body: init.body }),
    });
    // Fermer un corps non lu (erreur HTTP, redirection ou type refusé) émet
    // AbortError. L’itérateur continue de propager les erreurs de lecture,
    // mais une fermeture précoce ne doit pas tuer le moteur par un événement non géré.
    response.body.on("error", () => undefined);
    const headers: WebResponse["headers"] = {};
    for (const [key, value] of Object.entries(response.headers))
      if (typeof value === "string") headers[key.toLowerCase()] = value;
    return {
      status: response.statusCode,
      headers,
      body: response.body,
      close: async () => {
        response.body.destroy();
        await dispatcher.destroy();
      },
    };
  } catch (error) {
    await dispatcher.destroy();
    throw error;
  }
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let reject!: (error: unknown) => void;
  const aborted = new Promise<never>((_, fail) => {
    reject = fail;
  });
  const stop = () => reject(signal.reason);
  signal.addEventListener("abort", stop, { once: true });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", stop);
  }
}

/** Réseau partagé : pas de cookies, d’identifiants ou d’en-têtes fournis par le modèle. */
export async function requestWeb(
  value: string,
  init: WebRequest,
  deps: WebDependencies = {},
  /** Filtre de redirection : un saut refusé échoue (`web.redirectOffList`). Absent : tout hôte public HTTPS. */
  redirectAllowed?: (next: URL) => boolean,
): Promise<{ url: string; type: string; text: string }> {
  let url = webUrl(value);
  let current = init;
  for (let redirect = 0; redirect <= 5; redirect++) {
    current.signal.throwIfAborted();
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await abortable(
          (deps.lookup ?? ((name) => lookup(name, { all: true, verbatim: true })))(hostname),
          current.signal,
        );
    current.signal.throwIfAborted();
    if (addresses.length === 0 || addresses.some((row) => !isPublicAddress(row.address)))
      throw new CodedError("web.invalidUrl");
    const address = addresses.find((row) => isIP(row.address) === 4) ?? addresses[0];
    if (!address) throw new CodedError("web.invalidUrl");
    const response = await (deps.transport ?? webTransport)(url, address.address, current);
    try {
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.location;
        if (!location || redirect === 5) throw new CodedError("web.unavailable");
        const next = webUrl(new URL(location, url).href);
        if (url.protocol === "https:" && next.protocol !== "https:")
          throw new CodedError("web.invalidUrl");
        if (redirectAllowed && !redirectAllowed(next))
          throw new CodedError("web.redirectOffList", { host: next.hostname });
        if ([301, 302, 303].includes(response.status))
          current = { method: "GET", signal: init.signal };
        url = next;
        continue;
      }
      if (response.status === 429) throw new CodedError("web.rateLimited");
      if (response.status < 200 || response.status >= 300)
        throw new CodedError("web.unavailable", { status: response.status });
      const encoding = response.headers["content-encoding"];
      if (encoding && encoding !== "identity") throw new CodedError("web.unsupportedType");
      const type =
        (response.headers["content-type"] ?? "text/plain").split(";")[0]?.trim().toLowerCase() ??
        "text/plain";
      if (
        !(
          type.startsWith("text/") || /^(application\/(?:json|xml|xhtml\+xml|rss\+xml))$/.test(type)
        )
      )
        throw new CodedError("web.unsupportedType");
      if (Number(response.headers["content-length"] ?? 0) > MAX_BYTES)
        throw new CodedError("web.tooLarge");
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        current.signal.throwIfAborted();
        bytes += chunk.byteLength;
        if (bytes > MAX_BYTES) throw new CodedError("web.tooLarge");
        chunks.push(chunk);
      }
      current.signal.throwIfAborted();
      return { url: url.href, type, text: Buffer.concat(chunks).toString("utf8") };
    } finally {
      await response.close?.();
    }
  }
  throw new CodedError("web.unavailable");
}
