import { readFile, realpath, stat } from "node:fs/promises";
import { createServer as createHttpServer, type Server, type ServerResponse } from "node:http";
import { extname, isAbsolute, resolve, sep } from "node:path";
import type { ServerConfig } from "./config.js";

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/** En-têtes posés sur toute réponse. */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  headers: Record<string, string>,
  headOnly = false,
): void {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    ...headers,
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(headOnly ? undefined : body);
}

const text = (
  res: ServerResponse,
  status: number,
  msg: string,
  extra: Record<string, string> = {},
) =>
  send(res, status, msg, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    ...extra,
  });

type Resolved = { path: string } | { status: 400 | 404 };

/**
 * Résout un chemin d'URL en fichier sous `webDir`. Refuse `..`, chemins absolus, antislash,
 * octets nuls et tout lien symbolique qui sortirait du dossier.
 */
async function resolveStatic(webDir: string, urlPath: string): Promise<Resolved> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return { status: 400 };
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return { status: 400 };
  const segments = decoded.split("/").filter((s) => s !== "");
  if (segments.some((s) => s === ".." || s === ".")) return { status: 404 };
  const rel = segments.length === 0 ? "index.html" : segments.join("/");
  if (isAbsolute(rel)) return { status: 404 };
  const candidate = resolve(webDir, rel);
  try {
    const base = await realpath(webDir);
    const real = await realpath(candidate);
    if (real !== base && !real.startsWith(base + sep)) return { status: 404 };
    if (!(await stat(real)).isFile()) return { status: 404 };
    return { path: real };
  } catch {
    return { status: 404 };
  }
}

/** Crée le serveur HTTP (sans écouter). */
export function createServer(config: ServerConfig): Server {
  return createHttpServer((req, res) => {
    void handle(config, req.method ?? "GET", req.url ?? "/", res).catch(() => {
      if (!res.headersSent) text(res, 500, "Erreur interne");
      else res.destroy();
    });
  });
}

async function handle(
  config: ServerConfig,
  method: string,
  url: string,
  res: ServerResponse,
): Promise<void> {
  const pathname = url.split(/[?#]/, 1)[0] ?? "/";
  const head = method === "HEAD";
  if (method !== "GET" && !head) {
    return text(res, 405, "Méthode non autorisée", { Allow: "GET, HEAD" });
  }
  if (pathname === "/healthz") {
    return send(
      res,
      200,
      JSON.stringify({ status: "ok" }),
      { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      head,
    );
  }
  const found = await resolveStatic(config.webDir, pathname);
  if ("status" in found) return text(res, found.status, "Introuvable");
  const type = MIME[extname(found.path).toLowerCase()];
  if (!type) return text(res, 404, "Introuvable");
  const headers: Record<string, string> = { "Content-Type": type };
  if (type.startsWith("text/html")) headers["Cache-Control"] = "no-store";
  send(res, 200, await readFile(found.path), headers, head);
}
