import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE = "__Host-rw_session";

export interface SessionOptions {
  /** Horloge (ms) ; injectable pour les tests. */
  now?: () => number;
  /** Expiration glissante (inactivité). */
  idleMs?: number;
  /** Durée de vie maximale depuis la création. */
  absoluteMs?: number;
  /** Nombre maximal de sessions : la plus ancienne est évincée. */
  maxSessions?: number;
}

interface Entry {
  id: string;
  createdAt: number;
  lastSeen: number;
}

export const IDLE_MS = 12 * 3600_000;
export const ABSOLUTE_MS = 7 * 24 * 3600_000;

const sha256 = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Sessions en mémoire. Le jeton (256 bits) n'est jamais conservé : seule son empreinte SHA-256
 * sert de clé. `id` (public, interne au serveur) identifie la session sans permettre de l'usurper.
 */
export class SessionStore {
  private readonly now: () => number;
  private readonly idleMs: number;
  private readonly absoluteMs: number;
  private readonly maxSessions: number;
  // Ordre d'insertion = ordre de création : le premier est le plus ancien.
  private readonly byHash = new Map<string, Entry>();
  private readonly listeners = new Set<(id: string) => void>();

  constructor(options: SessionOptions = {}) {
    this.now = options.now ?? Date.now;
    this.idleMs = options.idleMs ?? IDLE_MS;
    this.absoluteMs = options.absoluteMs ?? ABSOLUTE_MS;
    this.maxSessions = options.maxSessions ?? 50;
  }

  /** Durée de vie absolue (s), pour `Max-Age` du cookie. */
  get absoluteSeconds(): number {
    return Math.floor(this.absoluteMs / 1000);
  }

  /** Abonne un rappel appelé à chaque fin de session (révocation, éviction, expiration). */
  onEnd(listener: (id: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Crée une session et renvoie le jeton (à placer dans le cookie, jamais journalisé). */
  create(): string {
    const token = randomBytes(32).toString("base64url");
    const t = this.now();
    this.purgeExpired();
    while (this.byHash.size >= this.maxSessions) {
      const oldest = this.byHash.keys().next();
      if (oldest.done) break;
      this.end(oldest.value);
    }
    this.byHash.set(sha256(token), {
      id: randomBytes(12).toString("hex"),
      createdAt: t,
      lastSeen: t,
    });
    return token;
  }

  /** Valide un jeton et prolonge la session ; renvoie son identifiant, ou `undefined`. */
  validate(token: string | undefined): string | undefined {
    if (!token) return undefined;
    const key = sha256(token);
    const entry = this.byHash.get(key);
    if (!entry) return undefined;
    if (this.expired(entry)) {
      this.end(key);
      return undefined;
    }
    entry.lastSeen = this.now();
    return entry.id;
  }

  /** Prolonge une session connue par son identifiant ; faux si elle a expiré (et la termine). */
  touch(id: string): boolean {
    for (const [key, entry] of this.byHash) {
      if (entry.id !== id) continue;
      if (this.expired(entry)) {
        this.end(key);
        return false;
      }
      entry.lastSeen = this.now();
      return true;
    }
    return false;
  }

  /** Révoque la session du jeton ; faux si elle n'existait pas. */
  revoke(token: string | undefined): boolean {
    if (!token) return false;
    const key = sha256(token);
    if (!this.byHash.has(key)) return false;
    this.end(key);
    return true;
  }

  /** Termine les sessions expirées (appelle les rappels). */
  purgeExpired(): void {
    for (const [key, entry] of [...this.byHash]) if (this.expired(entry)) this.end(key);
  }

  get size(): number {
    return this.byHash.size;
  }

  private expired(e: Entry): boolean {
    const t = this.now();
    return t - e.lastSeen >= this.idleMs || t - e.createdAt >= this.absoluteMs;
  }

  private end(key: string): void {
    const entry = this.byHash.get(key);
    if (!entry) return;
    this.byHash.delete(key);
    for (const l of this.listeners) l(entry.id);
  }
}

/** Valeur du cookie de session dans un en-tête `Cookie`. */
export function readSessionCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === SESSION_COOKIE) return part.slice(i + 1).trim() || undefined;
  }
  return undefined;
}

const COOKIE_FLAGS = "Path=/; HttpOnly; Secure; SameSite=Strict";

/** `Set-Cookie` d'ouverture de session. */
export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${token}; ${COOKIE_FLAGS}; Max-Age=${maxAgeSeconds}`;
}

/** `Set-Cookie` qui expire le cookie. */
export function expiredSessionCookie(): string {
  return `${SESSION_COOKIE}=; ${COOKIE_FLAGS}; Max-Age=0`;
}
