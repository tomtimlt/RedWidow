/** Plafond de l'attente après échecs : 15 minutes. */
const MAX_WAIT_MS = 15 * 60_000;
/** Au-delà de ce délai après la fin de l'attente, l'historique d'échecs est oublié. */
const FORGET_MS = 3600_000;

interface Entry {
  failures: number;
  blockedUntil: number;
  inFlight: boolean;
}

export type Admission = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Délai croissant par IP : après le n-ième échec, attente de 2^(n-1) s (plafond 15 min), pendant
 * laquelle toute tentative est refusée sans vérifier le mot de passe. Une seule vérification à la
 * fois par IP (pas de rafale parallèle). Table bornée : la plus ancienne entrée est évincée.
 */
export class LoginLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 10_000,
  ) {}

  /** Demande l'autorisation de vérifier un mot de passe ; à clore par `success`, `fail` ou `release`. */
  begin(ip: string): Admission {
    const t = this.now();
    let e = this.entries.get(ip);
    if (e && !e.inFlight && t >= e.blockedUntil + FORGET_MS) {
      this.entries.delete(ip);
      e = undefined;
    }
    if (e) {
      if (e.inFlight) return { ok: false, retryAfterSeconds: 1 };
      if (t < e.blockedUntil) {
        return { ok: false, retryAfterSeconds: Math.ceil((e.blockedUntil - t) / 1000) };
      }
    } else {
      while (this.entries.size >= this.maxEntries) {
        const oldest = this.entries.keys().next();
        if (oldest.done) break;
        this.entries.delete(oldest.value);
      }
      e = { failures: 0, blockedUntil: 0, inFlight: false };
      this.entries.set(ip, e);
    }
    e.inFlight = true;
    return { ok: true };
  }

  /** Échec de vérification : allonge l'attente. */
  fail(ip: string): void {
    const e = this.entries.get(ip);
    if (!e) return;
    e.inFlight = false;
    e.failures += 1;
    const wait = Math.min(MAX_WAIT_MS, 1000 * 2 ** Math.min(e.failures - 1, 20));
    e.blockedUntil = this.now() + wait;
  }

  /** Succès : remise à zéro. */
  success(ip: string): void {
    this.entries.delete(ip);
  }

  /** Tentative abandonnée sans verdict (requête mal formée) : libère sans compter d'échec. */
  release(ip: string): void {
    const e = this.entries.get(ip);
    if (e) e.inFlight = false;
  }

  get size(): number {
    return this.entries.size;
  }
}
