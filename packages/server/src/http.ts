import { readFile, realpath, stat } from "node:fs/promises";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { extname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CodedError, defaultConfigDir, type Reason, reason } from "@warband/core";
import { isLocale } from "@warband/messages";
import { buildCsp, injectNonce, makeNonce } from "./auth/csp.js";
import { LoginLimiter } from "./auth/limiter.js";
import { originAllowed } from "./auth/origin.js";
import { isValidPasswordHash, verifyPassword } from "./auth/password.js";
import {
  expiredSessionCookie,
  readSessionCookie,
  SessionStore,
  sessionCookie,
} from "./auth/sessions.js";
import { isFrameId } from "./bridge/envelope.js";
import { buildMissionReport } from "./bridge/findings.js";
import type { BridgeContext } from "./bridge/hostui.js";
import type { ServerConfig } from "./config.js";
import { contentDisposition } from "./downloads.js";
import { sanitizeFilename, UploadTooLargeError } from "./uploads.js";
import { isViewerMode, isViewPage, renderViewPage } from "./web/view-page.js";
import { attachWebSocket } from "./ws.js";

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
  "X-Frame-Options": "SAMEORIGIN",
  "Strict-Transport-Security": "max-age=31536000",
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

/** Taille maximale du corps de `POST /api/login`. */
const MAX_LOGIN_BODY = 4096;

export interface ServerOptions {
  /** Empreinte scrypt du mot de passe (voir `loadPasswordHash`). */
  passwordHash: string;
  /** Horloge (ms) injectable pour les tests (sessions, limitation). */
  now?: () => number;
  /** Rappel pour chaque WebSocket authentifiée (pont moteur, lot suivant). */
  onConnection?: (socket: import("ws").WebSocket, sessionId: string) => void;
  /** Stockage persistant (état, secrets), exposé aux lots suivants. */
  storage?: import("./storage/index.js").ServerStorage;
  /** Dossier `media` de l'extension, servi en lecture seule sous `/media/` (défaut : `packages/vscode/media`). */
  mediaDir?: string;
  /** Dossier de configuration des projets (défaut : celui du moteur, `XDG_CONFIG_HOME/warband`). */
  configDir?: string;
  /** Dialogues, téléversements et téléchargements (`hub.context`, ADR 0055). Absent : routes `/api/upload` et `/api/download` fermées. */
  files?: Pick<BridgeContext, "ui" | "uploads" | "downloads">;
}

/** `packages/vscode/media`, à la même position relative depuis `src` ou `dist`. */
const DEFAULT_MEDIA_DIR = fileURLToPath(new URL("../../vscode/media", import.meta.url));

interface Ctx {
  config: ServerConfig;
  passwordHash: string;
  sessions: SessionStore;
  limiter: LoginLimiter;
  mediaDir: string;
  configDir: string;
  files: ServerOptions["files"];
}

function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
  headOnly = false,
): void {
  send(
    res,
    status,
    JSON.stringify(body),
    { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
    headOnly,
  );
}

/** Erreur d'API : `{ error: Reason }`, le client affiche le libellé via `@warband/messages`. */
const apiError = (
  res: ServerResponse,
  status: number,
  r: Reason,
  extra: Record<string, string> = {},
) => json(res, status, { error: r }, extra);

/** Crée le serveur HTTP (sans écouter). Refuse une empreinte de mot de passe invalide. */
export function createServer(config: ServerConfig, options: ServerOptions): Server {
  if (!isValidPasswordHash(options.passwordHash)) {
    throw new CodedError("server.passwordHashInvalid");
  }
  const now = options.now ?? Date.now;
  const ctx: Ctx = {
    config,
    passwordHash: options.passwordHash,
    sessions: new SessionStore({ now }),
    limiter: new LoginLimiter(now),
    mediaDir: resolve(options.mediaDir ?? DEFAULT_MEDIA_DIR),
    configDir: options.configDir ?? defaultConfigDir(),
    files: options.files,
  };
  const server = createHttpServer((req, res) => {
    void handle(ctx, req, res).catch(() => {
      if (!res.headersSent) text(res, 500, "Erreur interne");
      else res.destroy();
    });
  });
  const detach = attachWebSocket(server, {
    origin: config.publicOrigin,
    sessions: ctx.sessions,
    ...(options.onConnection && { onConnection: options.onConnection }),
  });
  server.on("close", detach);
  return server;
}

/** IP cliente : `remoteAddress`, ou la dernière valeur de `X-Forwarded-For` derrière un proxy de confiance. */
function clientIp(config: ServerConfig, req: IncomingMessage): string {
  if (config.trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    const last = (Array.isArray(xff) ? xff.join(",") : xff)?.split(",").pop()?.trim();
    if (last) return last;
  }
  return req.socket.remoteAddress ?? "inconnue";
}

/** Corps JSON limité à `max` octets ; `undefined` si trop gros ou illisible. */
async function readBody(req: IncomingMessage, max: number): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) {
      req.resume();
      return undefined;
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function login(ctx: Ctx, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return apiError(res, 415, reason("auth.badRequest"));
  const ip = clientIp(ctx.config, req);
  const admission = ctx.limiter.begin(ip);
  if (!admission.ok) {
    return apiError(
      res,
      429,
      reason("auth.rateLimited", { seconds: admission.retryAfterSeconds }),
      { "Retry-After": String(admission.retryAfterSeconds) },
    );
  }
  let password: unknown;
  try {
    const body = await readBody(req, MAX_LOGIN_BODY);
    if (body === undefined) {
      ctx.limiter.release(ip);
      return apiError(res, 413, reason("auth.badRequest"));
    }
    password = (JSON.parse(body) as { password?: unknown } | null)?.password;
  } catch {
    ctx.limiter.release(ip);
    return apiError(res, 400, reason("auth.badRequest"));
  }
  if (typeof password !== "string" || password === "") {
    ctx.limiter.release(ip);
    return apiError(res, 400, reason("auth.badRequest"));
  }
  let ok = false;
  try {
    ok = await verifyPassword(password, ctx.passwordHash);
  } finally {
    if (ok) ctx.limiter.success(ip);
    else ctx.limiter.fail(ip);
  }
  if (!ok) return apiError(res, 401, reason("auth.invalidCredentials"));
  const token = ctx.sessions.create();
  send(res, 204, "", {
    "Cache-Control": "no-store",
    "Set-Cookie": sessionCookie(token, ctx.sessions.absoluteSeconds),
  });
}

/** Page HTML : nonce par réponse, CSP dans l'en-tête. */
function html(res: ServerResponse, body: string, headOnly: boolean): void {
  const nonce = makeNonce();
  send(
    res,
    200,
    injectNonce(body, nonce),
    {
      "Content-Type": MIME[".html"] as string,
      "Cache-Control": "no-store",
      "Content-Security-Policy": buildCsp(nonce),
    },
    headOnly,
  );
}

async function serveStatic(
  ctx: Ctx,
  pathname: string,
  res: ServerResponse,
  head: boolean,
  dir: string = ctx.config.webDir,
): Promise<void> {
  const found = await resolveStatic(dir, pathname);
  if ("status" in found) return text(res, found.status, "Introuvable");
  const type = MIME[extname(found.path).toLowerCase()];
  if (!type) return text(res, 404, "Introuvable");
  if (type.startsWith("text/html")) {
    return html(res, await readFile(found.path, "utf8"), head);
  }
  send(res, 200, await readFile(found.path), { "Content-Type": type }, head);
}

/**
 * `GET /view/<nom>?frame=<id>[&mode=…]` : page d'une vue de la liste fermée, pour l'`iframe` de la
 * coquille. Nonce propre à la réponse, CSP en en-tête (`frame-ancestors 'self'` compris).
 */
function serveView(pathname: string, search: string, res: ServerResponse, head: boolean): void {
  const name = pathname.slice("/view/".length);
  if (!isViewPage(name)) {
    text(res, 404, "Introuvable");
    return;
  }
  const params = new URLSearchParams(search);
  const mode = params.get("mode") ?? "monitor";
  if (!isFrameId(params.get("frame")) || !isViewerMode(mode)) {
    apiError(res, 400, reason("auth.badRequest"));
    return;
  }
  const nonce = makeNonce();
  send(
    res,
    200,
    renderViewPage(name, { nonce, mode }),
    {
      "Content-Type": MIME[".html"] as string,
      "Cache-Control": "no-store",
      "Content-Security-Policy": buildCsp(nonce),
    },
    head,
  );
}

/**
 * `GET /api/report?project=<id>&locale=fr|en` : rapport de mission en Markdown, construit par le serveur
 * (jamais dans le navigateur). L'identifiant n'est qu'une clé de recherche parmi les projets connus :
 * aucun chemin fourni par le client n'est utilisé.
 */
async function serveReport(
  ctx: Ctx,
  query: string,
  res: ServerResponse,
  head: boolean,
): Promise<void> {
  const params = new URLSearchParams(query);
  const project = params.get("project");
  const locale = params.get("locale") ?? "fr";
  if (project === null || project === "" || project.length > 100 || !isLocale(locale)) {
    return apiError(res, 400, reason("auth.badRequest"));
  }
  let report: Awaited<ReturnType<typeof buildMissionReport>>;
  try {
    report = await buildMissionReport(ctx.configDir, project, locale);
  } catch (err) {
    if (err instanceof CodedError && err.code === "project.absent") {
      return apiError(res, 404, reason("project.absent"));
    }
    return apiError(res, 500, reason("project.invalid", { reason: "json" }));
  }
  send(
    res,
    200,
    report.markdown,
    {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${report.filename}"`,
      "Cache-Control": "no-store",
    },
    head,
  );
}

/** Après une réponse d'erreur sans lecture du corps : on vide au plus 1 Mio, puis on coupe. */
function drainThenClose(req: IncomingMessage): void {
  let extra = 0;
  req.on("data", (c: Buffer) => {
    extra += c.length;
    if (extra > 1024 * 1024) req.destroy();
  });
  req.on("error", () => undefined);
}

/**
 * `POST /api/upload?dialog=<id>` : corps `application/octet-stream`, nom dans `X-Filename` (assaini, jamais
 * un chemin). Rattaché à un dialogue `file` en attente (sinon 403) ; taille ≤ `maxBytes` (413), extension
 * dans `accept` (415). Réponse `{ id, name, size }` ; la coquille répond alors `dialogResult {value: id}`.
 */
async function serveUpload(
  files: NonNullable<Ctx["files"]>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const refuse = (status: number, r: Reason) => {
    drainThenClose(req);
    apiError(res, status, r, { Connection: "close" });
  };
  const query = (req.url ?? "").split("#", 1)[0]?.split("?")[1] ?? "";
  const dialog = new URLSearchParams(query).get("dialog");
  if (dialog === null || !isFrameId(dialog)) return refuse(400, reason("auth.badRequest"));
  const spec = files.ui.fileSpec(dialog);
  if (!spec) return refuse(403, reason("hostui.uploadForbidden"));
  const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  if (type !== "application/octet-stream") return refuse(415, reason("hostui.uploadBadType"));
  const header = req.headers["x-filename"];
  let raw = Array.isArray(header) ? (header[0] ?? "") : (header ?? "");
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // Nom non encodé : gardé tel quel, l'assainissement s'applique de toute façon.
  }
  const name = sanitizeFilename(raw);
  const ext = extname(name).toLowerCase();
  if (!spec.accept.includes(ext)) return refuse(415, reason("hostui.uploadBadType"));
  const tooLarge = () => refuse(413, reason("hostui.uploadTooLarge", { max: spec.maxBytes }));
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > spec.maxBytes) return tooLarge();
  let info: Awaited<ReturnType<typeof files.uploads.receive>>;
  try {
    info = await files.uploads.receive(req, { dialog, name, maxBytes: spec.maxBytes });
  } catch (err) {
    if (err instanceof UploadTooLargeError) return tooLarge();
    return apiError(res, 500, reason("auth.badRequest"));
  }
  // Le dialogue a pu être fermé pendant l'envoi : le fichier n'a alors plus de destinataire.
  if (!files.ui.fileSpec(dialog)) {
    await files.uploads.discardDialog(dialog);
    return apiError(res, 403, reason("hostui.uploadForbidden"));
  }
  json(res, 200, { id: info.id, name: info.name, size: info.size });
}

/** `GET /api/download/<id>` : usage unique, jamais mis en cache, nom assaini (`Content-Disposition`). */
function serveDownload(files: NonNullable<Ctx["files"]>, id: string, res: ServerResponse): void {
  const file = files.downloads.take(id);
  if (!file) {
    apiError(res, 404, reason("hostui.downloadGone"));
    return;
  }
  send(res, 200, file.body, {
    "Content-Type": file.mime,
    "Content-Disposition": contentDisposition(file.filename),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
}

async function handle(ctx: Ctx, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const pathname = (req.url ?? "/").split(/[?#]/, 1)[0] ?? "/";
  const head = method === "HEAD";
  const read = method === "GET" || head;

  // CSRF : toute requête modifiante exige l'Origin publique, avant tout autre traitement.
  if (!read && !originAllowed(req.headers.origin, ctx.config.publicOrigin)) {
    return apiError(res, 403, reason("auth.originDenied"));
  }

  // Routes publiques.
  if (read && pathname === "/healthz") return json(res, 200, { status: "ok" }, {}, head);
  if (read && pathname === "/login") return serveStatic(ctx, "/login.html", res, head);
  if (read && (pathname === "/login.js" || pathname.startsWith("/assets/"))) {
    return serveStatic(ctx, pathname, res, head);
  }
  if (method === "POST" && pathname === "/api/login") return login(ctx, req, res);

  // Tout le reste exige une session.
  const sessionId = ctx.sessions.validate(readSessionCookie(req.headers.cookie));
  const isApi = pathname === "/api" || pathname.startsWith("/api/");
  if (sessionId === undefined) {
    if (isApi || !read) return apiError(res, 401, reason("auth.required"));
    return text(res, 302, "Authentification requise", { Location: "/login" });
  }

  if (method === "POST" && pathname === "/api/logout") {
    ctx.sessions.revoke(readSessionCookie(req.headers.cookie));
    return send(res, 204, "", {
      "Cache-Control": "no-store",
      "Set-Cookie": expiredSessionCookie(),
    });
  }
  if (read && pathname === "/api/session") return json(res, 200, { authenticated: true }, {}, head);
  if (read && pathname === "/api/report") {
    const query = (req.url ?? "").split("#", 1)[0]?.split("?")[1] ?? "";
    return serveReport(ctx, query, res, head);
  }
  if (ctx.files && method === "POST" && pathname === "/api/upload") {
    return serveUpload(ctx.files, req, res);
  }
  if (ctx.files && method === "GET" && pathname.startsWith("/api/download/")) {
    return serveDownload(ctx.files, pathname.slice("/api/download/".length), res);
  }
  if (isApi) return text(res, 404, "Introuvable");
  if (!read) return text(res, 405, "Méthode non autorisée", { Allow: "GET, HEAD" });
  if (pathname.startsWith("/view/")) {
    const query = (req.url ?? "").split("#", 1)[0]?.split("?")[1] ?? "";
    return serveView(pathname, query, res, head);
  }
  if (pathname.startsWith("/media/")) {
    return serveStatic(ctx, pathname.slice("/media".length), res, head, ctx.mediaDir);
  }
  return serveStatic(ctx, pathname, res, head);
}
