/**
 * Terminal humain de la vue `term` (ADR 0053). Action humaine directe, hors gate : un exec Docker avec TTY
 * dans un conteneur géré par RedWidow, jamais un shell de l'hôte ni du conteneur du serveur. Une session
 * par cadre (`frame`) ; elle survit 60 s à la fermeture du dernier socket abonné, rejoue son tampon à la
 * réabonnement, puis est fermée. Tout est journalisé (`term-<id>.jsonl`, via le recorder qui masque les
 * secrets connus) ; rien de ce terminal n'alimente la politique ni la mémorisation des approbations.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  CodedError,
  createRecorder,
  createRedactor,
  errorInfo,
  type JournalWriter,
  openJournal,
  type Recorder,
  type Redactor,
  secretsFromEnv,
} from "@warband/core";
import type { DockerApi } from "../docker/api.js";
import { findManaged, isContainerRef, type ManagedContainer } from "../docker/containers.js";
import { type ExecShell, startShell } from "../docker/exec.js";
import type { Sink } from "./hub.js";

/** Horloge injectable : les tests la font avancer à la main. */
export interface Clock {
  now(): number;
  /** Programme `fn` dans `ms` millisecondes ; renvoie l'annulation. */
  after(ms: number, fn: () => void): () => void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  after(ms, fn) {
    const timer = setTimeout(fn, ms);
    timer.unref?.();
    return () => clearTimeout(timer);
  },
};

export const MAX_SESSIONS = 16;
/** Taille maximale d'un message `input` (octets). */
export const MAX_INPUT_BYTES = 64 * 1024;
/** Sortie conservée pour rejouer une session réabonnée. */
export const OUTPUT_BUFFER_CHARS = 256 * 1024;
/** Durée de conservation d'une session sans socket abonné. */
export const GRACE_MS = 60_000;
/** Morceau maximal d'un événement `terminal.data` et fenêtre de coalescence. */
export const CHUNK_CHARS = 8 * 1024;
export const FLUSH_MS = 50;
/** La saisie sans fin de ligne attend davantage : un secret tapé à la main reste ainsi d'un seul morceau, donc masquable. */
export const INPUT_IDLE_MS = 5_000;
export const MAX_COLS = 500;
export const MAX_ROWS = 200;

export type TermMessage =
  | { type: "open"; container: string; cols: number; rows: number }
  | { type: "ready" | "close" }
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

const only = (m: Record<string, unknown>, ...keys: string[]) =>
  Object.keys(m).length === keys.length && keys.every((k) => k in m);
const dim = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max;

/** Entrée non fiable : clés exactes, bornes vérifiées ; sinon `null`. La taille de `input` est contrôlée à l'exécution. */
export function parseTermMessage(m: Record<string, unknown>): TermMessage | null {
  switch (m.type) {
    case "ready":
    case "close":
      return only(m, "type") ? { type: m.type } : null;
    case "open":
      return only(m, "type", "container", "cols", "rows") &&
        isContainerRef(m.container) &&
        dim(m.cols, MAX_COLS) &&
        dim(m.rows, MAX_ROWS)
        ? { type: "open", container: m.container, cols: m.cols, rows: m.rows }
        : null;
    case "input":
      return only(m, "type", "data") && typeof m.data === "string" && m.data.length > 0
        ? { type: "input", data: m.data }
        : null;
    case "resize":
      return only(m, "type", "cols", "rows") && dim(m.cols, MAX_COLS) && dim(m.rows, MAX_ROWS)
        ? { type: "resize", cols: m.cols, rows: m.rows }
        : null;
    default:
      return null;
  }
}

export interface TermOptions {
  docker: DockerApi;
  /** Dossier des journaux (`paths.runs`). */
  runsDir: string;
  /** Valeurs secrètes connues (coffre) à masquer en plus de celles de l'environnement. */
  secretValues?(): Promise<string[]>;
  /** Masqueur imposé (tests) ; défaut : motifs usuels, environnement et coffre. */
  redact?: Redactor;
  /** Identifiants du conteneur du serveur (`HOSTNAME`) : jamais ouverts. */
  selfIds?: readonly string[];
  clock?: Clock;
  /** Audit des gestes (ouverture, fermeture) : champs non secrets seulement. */
  audit?(entry: Record<string, unknown>): void;
  maxSessions?: number;
  graceMs?: number;
}

interface Session {
  frame: string;
  id: string;
  container: ManagedContainer;
  subs: Set<Sink>;
  shell: ExecShell;
  recorder: Recorder;
  journal: JournalWriter;
  startedAt: number;
  decoder: StringDecoder;
  /** Dernière sortie (bornée) rejouée à la réabonnement. */
  buffer: string;
  outPending: string;
  inPending: string;
  cancelOut: (() => void) | null;
  cancelIn: (() => void) | null;
  cancelGrace: (() => void) | null;
  /** Fin du shell constatée ; le code est connu quand `exit` est défini. */
  finished: boolean;
  exit: { code: number | null } | null;
  /** Délai de conservation écoulé : la session disparaît dès sa fin. */
  expired: boolean;
}

const send = (sink: Sink, frame: string, msg: Record<string, unknown>) =>
  sink.send("term", frame, msg);

export class TermHost {
  private readonly sessions = new Map<string, Session>();
  private readonly opening = new Set<string>();
  private readonly finishing = new Set<Promise<void>>();
  private readonly clock: Clock;
  private disposed = false;

  constructor(private readonly options: TermOptions) {
    this.clock = options.clock ?? realClock;
  }

  /** Nombre de sessions vivantes ou conservées (tests, plafond). */
  size(): number {
    return this.sessions.size;
  }

  private audit(entry: Record<string, unknown>): void {
    try {
      this.options.audit?.(entry);
    } catch {
      // L'audit ne doit jamais bloquer le terminal.
    }
  }

  private fail(sink: Sink, frame: string, err: unknown): true {
    const info = errorInfo(err);
    // `code` seulement : jamais le message brut d'une erreur inattendue.
    send(sink, frame, {
      type: "error",
      code: err instanceof CodedError ? info.code : "terminal.failed",
    });
    return true;
  }

  /** Message de la vue `term`. `false` : message invalide ou sans objet (compté comme ignoré par le canal). */
  async handle(frame: string, raw: Record<string, unknown>, from: Sink): Promise<boolean> {
    if (this.disposed) return false;
    const msg = parseTermMessage(raw);
    if (msg === null) return false;
    const s = this.sessions.get(frame);
    switch (msg.type) {
      case "open":
        return this.open(frame, msg, from);
      case "ready":
        // Réabonnement sans connaître le conteneur : seulement si la session existe.
        if (!s) return false;
        this.attach(s, from);
        return true;
      case "input":
        if (!s?.subs.has(from)) return false;
        if (Buffer.byteLength(msg.data) > MAX_INPUT_BYTES)
          return this.fail(from, frame, new CodedError("terminal.inputTooLarge"));
        if (s.finished) return true;
        this.input(s, msg.data);
        return true;
      case "resize":
        if (!s?.subs.has(from)) return false;
        if (!s.finished) void this.resize(s, msg.cols, msg.rows);
        return true;
      case "close":
        if (!s?.subs.has(from)) return false;
        s.shell.close();
        return true;
    }
  }

  private async open(
    frame: string,
    msg: Extract<TermMessage, { type: "open" }>,
    from: Sink,
  ): Promise<boolean> {
    const existing = this.sessions.get(frame);
    if (existing) {
      const c = existing.container;
      const same =
        msg.container === c.name ||
        msg.container === c.id ||
        (msg.container.length >= 12 && c.id.startsWith(msg.container));
      if (!same) return this.fail(from, frame, new CodedError("terminal.invalidContainer"));
      this.attach(existing, from);
      if (!existing.finished) void this.resize(existing, msg.cols, msg.rows);
      return true;
    }
    if (this.opening.has(frame)) return this.fail(from, frame, new CodedError("terminal.failed"));
    if (this.sessions.size + this.opening.size >= (this.options.maxSessions ?? MAX_SESSIONS))
      return this.fail(from, frame, new CodedError("terminal.limit"));
    this.opening.add(frame);
    try {
      const container = await findManaged(
        this.options.docker,
        msg.container,
        this.options.selfIds ?? [],
      ).catch((err: unknown) => {
        throw err instanceof CodedError && err.code === "docker.unavailable"
          ? err
          : new CodedError("terminal.failed");
      });
      // Inconnu, non géré ou serveur lui-même : même réponse, pas d'oracle d'existence.
      if (container === null) throw new CodedError("terminal.notManaged");
      if (!container.running) throw new CodedError("terminal.notRunning");
      if (this.disposed) return false;
      const session = await this.start(frame, container, msg.cols, msg.rows);
      this.attach(session, from);
      this.audit({ kind: "terminal.open", frame, id: session.id, container: container.name });
      return true;
    } catch (err) {
      return this.fail(from, frame, err);
    } finally {
      this.opening.delete(frame);
    }
  }

  private async redactor(): Promise<Redactor> {
    if (this.options.redact) return this.options.redact;
    const vault = (await this.options.secretValues?.().catch(() => [])) ?? [];
    return createRedactor({ values: [...secretsFromEnv(process.env), ...vault] });
  }

  private async start(
    frame: string,
    container: ManagedContainer,
    cols: number,
    rows: number,
  ): Promise<Session> {
    const id = randomUUID();
    const redact = await this.redactor();
    const recorder = createRecorder({ runId: id, redact });
    const journal = await openJournal(join(this.options.runsDir, `term-${id}.jsonl`));
    recorder.subscribe(journal.sink);
    const startedAt = this.clock.now();
    const session: Session = {
      frame,
      id,
      container,
      subs: new Set(),
      // Posé juste après `startShell` ; les rappels ci-dessous ne s'exécutent qu'ensuite.
      shell: undefined as unknown as ExecShell,
      recorder,
      journal,
      startedAt,
      decoder: new StringDecoder("utf8"),
      buffer: "",
      outPending: "",
      inPending: "",
      cancelOut: null,
      cancelIn: null,
      cancelGrace: null,
      finished: false,
      exit: null,
      expired: false,
    };
    try {
      session.shell = await startShell(
        this.options.docker,
        container.id,
        { cols, rows },
        {
          onData: (chunk) => this.output(session, chunk),
          onEnd: () => this.end(session),
        },
      );
    } catch (err) {
      await journal.close().catch(() => undefined);
      throw err instanceof CodedError && err.code === "docker.unavailable"
        ? err
        : new CodedError("terminal.failed");
    }
    recorder.emit({ kind: "terminal.opened", container: container.name, cols, rows });
    this.sessions.set(frame, session);
    return session;
  }

  /** Abonne un socket : annonce l'ouverture, rejoue le tampon, puis l'éventuelle fin. */
  private attach(s: Session, sink: Sink): void {
    s.cancelGrace?.();
    s.cancelGrace = null;
    s.subs.add(sink);
    send(sink, s.frame, { type: "opened", container: s.container.name });
    if (s.buffer !== "") send(sink, s.frame, { type: "output", data: s.buffer });
    if (s.exit) {
      send(sink, s.frame, { type: "exit", code: s.exit.code });
      // Fin déjà constatée hors présence d'abonné : la session a livré son dernier message.
      this.drop(s);
    }
  }

  /** Retire un socket (fermeture) ; sans abonné restant, la session est conservée `graceMs`. */
  detach(sink: Sink): void {
    for (const s of this.sessions.values()) {
      if (!s.subs.delete(sink) || s.subs.size > 0) continue;
      s.cancelGrace?.();
      s.cancelGrace = this.clock.after(this.options.graceMs ?? GRACE_MS, () => this.expire(s));
    }
  }

  private expire(s: Session): void {
    s.cancelGrace = null;
    s.expired = true;
    if (s.finished) this.drop(s);
    else s.shell.close();
  }

  private drop(s: Session): void {
    s.cancelGrace?.();
    s.cancelGrace = null;
    if (this.sessions.get(s.frame) === s) this.sessions.delete(s.frame);
  }

  private output(s: Session, chunk: Buffer): void {
    const text = s.decoder.write(chunk);
    if (text === "") return;
    s.buffer += text;
    if (s.buffer.length > OUTPUT_BUFFER_CHARS) s.buffer = s.buffer.slice(-OUTPUT_BUFFER_CHARS);
    for (const sink of s.subs) send(sink, s.frame, { type: "output", data: text });
    s.outPending += text;
    if (s.outPending.length >= CHUNK_CHARS) this.flushOut(s);
    else if (!s.cancelOut) s.cancelOut = this.clock.after(FLUSH_MS, () => this.flushOut(s));
  }

  private input(s: Session, data: string): void {
    s.shell.write(data);
    s.inPending += data;
    s.cancelIn?.();
    s.cancelIn = null;
    if (s.inPending.length >= CHUNK_CHARS) this.flushIn(s);
    else
      s.cancelIn = this.clock.after(/[\r\n]/.test(data) ? FLUSH_MS : INPUT_IDLE_MS, () =>
        this.flushIn(s),
      );
  }

  private emitChunks(s: Session, dir: "in" | "out", text: string): void {
    for (let i = 0; i < text.length; ) {
      let end = Math.min(i + CHUNK_CHARS, text.length);
      // Ne coupe pas une paire de substitution UTF-16.
      const last = text.charCodeAt(end - 1);
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
      s.recorder.emit({ kind: "terminal.data", dir, data: text.slice(i, end) });
      i = end;
    }
  }

  private flushOut(s: Session): void {
    s.cancelOut?.();
    s.cancelOut = null;
    const text = s.outPending;
    s.outPending = "";
    if (text !== "") this.emitChunks(s, "out", text);
  }

  private flushIn(s: Session): void {
    s.cancelIn?.();
    s.cancelIn = null;
    const text = s.inPending;
    s.inPending = "";
    if (text !== "") this.emitChunks(s, "in", text);
  }

  private async resize(s: Session, cols: number, rows: number): Promise<void> {
    try {
      await s.shell.resize(cols, rows);
    } catch {
      return;
    }
    s.recorder.emit({ kind: "terminal.resized", cols, rows });
  }

  /** Fin du flux : journal clos avec le code de sortie, `exit` aux abonnés. */
  private end(s: Session): void {
    if (s.finished) return;
    s.finished = true;
    const done = this.finish(s).finally(() => this.finishing.delete(done));
    this.finishing.add(done);
  }

  private async finish(s: Session): Promise<void> {
    const rest = s.decoder.end();
    if (rest !== "") this.output(s, Buffer.from(rest));
    this.flushIn(s);
    this.flushOut(s);
    const code = await s.shell.exitCode().catch(() => null);
    s.recorder.emit({
      kind: "terminal.closed",
      code,
      durationMs: Math.max(0, this.clock.now() - s.startedAt),
    });
    s.recorder.close();
    await s.journal.close().catch(() => undefined);
    s.exit = { code };
    this.audit({ kind: "terminal.close", frame: s.frame, id: s.id, exitCode: code });
    for (const sink of s.subs) send(sink, s.frame, { type: "exit", code });
    // Avec des abonnés, le message de fin est livré ; sans abonné, la session attend sa réabonnement.
    if (s.subs.size > 0 || s.expired) this.drop(s);
  }

  /** Ferme tous les shells (arrêt du serveur). Les journaux se terminent dans `settled()`. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const s of [...this.sessions.values()]) {
      s.expired = true;
      if (!s.finished) s.shell.close();
    }
  }

  /** Résolu quand toutes les fins de session en cours ont écrit leur journal. */
  async settled(): Promise<void> {
    while (this.finishing.size > 0) await Promise.all([...this.finishing]);
  }
}
