/**
 * HostUi : l'équivalent web des dialogues de VS Code (`showQuickPick`, `showInputBox`, `showOpenDialog`,
 * modales de confirmation, `openExternal`), ADR 0055. Le serveur pose une question à la coquille (message
 * shell `dialog`) et attend `dialogResult`. Même modèle que `MissionHub.ask` : sans réponse humaine la
 * promesse reste en attente ; seuls l'arrêt, l'annulation ou le plafond la résolvent, par `null`/`false`,
 * jamais par une valeur implicite. Une réponse n'est acceptée que d'un socket qui a reçu la question.
 */
import { randomUUID } from "node:crypto";
import type { DownloadStore } from "../downloads.js";
import type { ServerStorage } from "../storage/index.js";
import {
  DEFAULT_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  normalizeAccept,
  type UploadStore,
} from "../uploads.js";
import type { Sink } from "./hub.js";

/** Plafond de dialogues en attente, de caractères d'une saisie (octets) et d'éléments d'un choix. */
export const MAX_PENDING_DIALOGS = 32;
export const MAX_INPUT_BYTES = 4096;
export const MAX_PICK_ITEMS = 500;
export const MAX_URL = 2048;

/** Valeur d'un `dialogResult` après validation de forme (le contenu est vérifié par `HostUi`). */
export type DialogValue = string | string[] | boolean | null;

export interface PickItem {
  id: string;
  label: string;
  detail?: string;
}

type Spec =
  | { kind: "pick"; title: string; items: PickItem[]; multi: boolean }
  | { kind: "input"; title: string; label: string; secret: boolean; value?: string }
  | { kind: "confirm"; title: string; text: string; danger: boolean }
  | { kind: "file"; title: string; accept: string[]; maxBytes: number }
  | { kind: "external"; url: string; label: string };

interface Pending {
  id: string;
  spec: Spec;
  /** Socket émetteur du geste ; `null` : tous les sockets shell. */
  target: Sink | null;
  /** Sockets qui ont reçu la question : seuls habilités à répondre, et à recevoir `dialogClosed`. */
  sentTo: Set<Sink>;
  settle(value: DialogValue): void;
}

const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length >= 1 && v.length <= max;

/** URL ouvrable : http(s) seulement, bornée, sans contrôle ; sinon `null`. */
export function safeExternalUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refus volontaire des contrôles
  if (/[\u0000- \u007f-\u009f]/.test(raw)) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? raw : null;
  } catch {
    return null;
  }
}

export class HostUi {
  private readonly pending = new Map<string, Pending>();
  private disposed = false;

  constructor(
    private readonly options: {
      /** Sockets de la coquille abonnés (vue `shell`). */
      shell: () => ReadonlySet<Sink>;
      uploads: UploadStore;
    },
  ) {}

  /** Choix dans une liste : id retenu (ou liste d'ids si `multi`), `null` si annulé. */
  pick(o: { title: string; items: PickItem[]; multi?: false }, to?: Sink): Promise<string | null>;
  pick(o: { title: string; items: PickItem[]; multi: true }, to?: Sink): Promise<string[] | null>;
  pick(
    o: { title: string; items: PickItem[]; multi?: boolean },
    to?: Sink,
  ): Promise<string | string[] | null> {
    const ids = new Set<string>();
    const valid =
      text(o.title, 200) &&
      Array.isArray(o.items) &&
      o.items.length >= 1 &&
      o.items.length <= MAX_PICK_ITEMS &&
      o.items.every(
        (i) =>
          text(i.id, 200) &&
          !ids.has(i.id) &&
          !!ids.add(i.id) &&
          text(i.label, 300) &&
          (i.detail === undefined || text(i.detail, 600)),
      );
    if (!valid) return Promise.resolve(null);
    const items = o.items.map((i) => ({
      id: i.id,
      label: i.label,
      ...(i.detail !== undefined && { detail: i.detail }),
    }));
    return this.ask(
      { kind: "pick", title: o.title, items, multi: o.multi === true },
      to,
    ) as Promise<string | string[] | null>;
  }

  /** Saisie de texte (`secret` : champ masqué) ; `null` si annulée. */
  input(
    o: { title: string; label: string; secret?: boolean; value?: string },
    to?: Sink,
  ): Promise<string | null> {
    if (
      !text(o.title, 200) ||
      !text(o.label, 300) ||
      (o.value !== undefined && Buffer.byteLength(o.value) > MAX_INPUT_BYTES)
    )
      return Promise.resolve(null);
    return this.ask(
      {
        kind: "input",
        title: o.title,
        label: o.label,
        secret: o.secret === true,
        ...(o.value !== undefined && { value: o.value }),
      },
      to,
    ) as Promise<string | null>;
  }

  /** Confirmation : `true` seulement sur réponse affirmative d'un humain. */
  async confirm(o: { title: string; text: string; danger?: boolean }, to?: Sink): Promise<boolean> {
    if (!text(o.title, 200) || !text(o.text, 2000)) return false;
    const v = await this.ask(
      { kind: "confirm", title: o.title, text: o.text, danger: o.danger === true },
      to,
    );
    return v === true;
  }

  /**
   * Fichier à téléverser : renvoie un identifiant d'upload (`uploads.take`) ou `null`. `accept` : extensions
   * (liste non vide) ; `maxBytes` ramené à [1 ; 25 Mio], défaut 5 Mio.
   */
  file(
    o: { title: string; accept: readonly string[]; maxBytes?: number },
    to?: Sink,
  ): Promise<string | null> {
    const accept = normalizeAccept(o.accept);
    if (!text(o.title, 200) || accept === null) return Promise.resolve(null);
    const wanted = o.maxBytes ?? DEFAULT_UPLOAD_BYTES;
    const maxBytes =
      Number.isInteger(wanted) && wanted >= 1
        ? Math.min(wanted, MAX_UPLOAD_BYTES)
        : DEFAULT_UPLOAD_BYTES;
    return this.ask({ kind: "file", title: o.title, accept, maxBytes }, to) as Promise<
      string | null
    >;
  }

  /** Ouverture d'un lien externe, confirmée par l'humain : `true` s'il l'a ouvert. URL http(s) seulement. */
  async external(o: { url: string; label: string }, to?: Sink): Promise<boolean> {
    const url = safeExternalUrl(o.url);
    if (url === null || !text(o.label, 300)) return false;
    return (await this.ask({ kind: "external", url, label: o.label }, to)) === true;
  }

  private message(p: Pending): Record<string, unknown> {
    return { type: "dialog", id: p.id, ...p.spec };
  }

  private targets(p: Pending): Sink[] {
    const shell = this.options.shell();
    return p.target !== null && shell.has(p.target) ? [p.target] : [...shell];
  }

  private ask(spec: Spec, to: Sink | undefined): Promise<DialogValue> {
    const none: DialogValue = spec.kind === "confirm" || spec.kind === "external" ? false : null;
    if (this.disposed || this.pending.size >= MAX_PENDING_DIALOGS) return Promise.resolve(none);
    return new Promise<DialogValue>((done) => {
      const p: Pending = {
        id: randomUUID(),
        spec,
        target: to !== undefined && this.options.shell().has(to) ? to : null,
        sentTo: new Set(),
        settle: done,
      };
      this.pending.set(p.id, p);
      for (const sink of this.targets(p)) {
        p.sentTo.add(sink);
        sink.send("shell", "shell", this.message(p));
      }
    });
  }

  /** Coquille (re)connectée : elle reçoit les dialogues en attente qui la concernent. */
  attach(sink: Sink): void {
    for (const p of this.pending.values()) {
      if ((p.target !== null && p.target !== sink) || p.sentTo.has(sink)) continue;
      p.sentTo.add(sink);
      sink.send("shell", "shell", this.message(p));
    }
  }

  /** Socket fermé : un dialogue qui lui était réservé est reposé à toutes les coquilles restantes. */
  detach(sink: Sink): void {
    for (const p of this.pending.values()) {
      p.sentTo.delete(sink);
      if (p.target !== sink) continue;
      p.target = null;
      for (const s of this.targets(p)) {
        p.sentTo.add(s);
        s.send("shell", "shell", this.message(p));
      }
    }
  }

  /** Contraintes d'un dialogue `file` en attente (route d'upload) ; `undefined` sinon. */
  fileSpec(id: string): { accept: string[]; maxBytes: number } | undefined {
    const s = this.pending.get(id)?.spec;
    return s?.kind === "file" ? { accept: s.accept, maxBytes: s.maxBytes } : undefined;
  }

  /** Valeur conforme au `kind` du dialogue (ids existants, taille, identifiant d'upload de ce dialogue). */
  private valid(p: Pending, value: Exclude<DialogValue, null>): boolean {
    const s = p.spec;
    switch (s.kind) {
      case "pick": {
        const known = new Set(s.items.map((i) => i.id));
        if (s.multi)
          return (
            Array.isArray(value) &&
            new Set(value).size === value.length &&
            value.every((v) => known.has(v))
          );
        return typeof value === "string" && known.has(value);
      }
      case "input":
        return typeof value === "string" && Buffer.byteLength(value) <= MAX_INPUT_BYTES;
      case "confirm":
      case "external":
        return typeof value === "boolean";
      case "file":
        return typeof value === "string" && this.options.uploads.owns(value, p.id);
    }
  }

  /**
   * Réponse d'une coquille. `false` (ignorée, le dialogue reste ouvert ou n'existe plus) si le dialogue est
   * inconnu ou clos, si `from` ne l'a pas reçu, ou si la valeur est invalide. `null` = annulation.
   */
  answer(id: string, value: DialogValue, from: Sink): boolean {
    const p = this.pending.get(id);
    if (!p?.sentTo.has(from)) return false;
    if (value !== null && !this.valid(p, value)) return false;
    this.pending.delete(id);
    if (p.spec.kind === "file" && value === null) void this.options.uploads.discardDialog(id);
    p.settle(value ?? (p.spec.kind === "confirm" || p.spec.kind === "external" ? false : null));
    for (const s of p.sentTo) s.send("shell", "shell", { type: "dialogClosed", id });
    return true;
  }

  /** Arrêt : tout dialogue en attente est refusé (`null`/`false`) et ses fichiers supprimés. */
  dispose(): void {
    this.disposed = true;
    for (const p of [...this.pending.values()]) {
      this.pending.delete(p.id);
      if (p.spec.kind === "file") void this.options.uploads.discardDialog(p.id);
      p.settle(p.spec.kind === "confirm" || p.spec.kind === "external" ? false : null);
    }
  }
}

/**
 * Contexte transmis aux modules du pont (`bridge/*`) : tout ce qu'un module peut utiliser pour parler à
 * l'humain ou échanger des fichiers. Créé une fois par `MissionHub` (`hub.context`).
 * - `ui` : dialogues (pick, input, confirm, file, external) ; passer `to` (socket du geste) quand il est connu.
 * - `uploads` : `take(id)` pour un identifiant renvoyé par `ui.file` (usage unique, `release()` ensuite).
 * - `downloads` : `offer({filename, mime, body})` pour un export ; la coquille déclenche le téléchargement.
 * - `storage`, `audit` : coffre/état du serveur et journal d'audit (jamais de valeur secrète).
 */
export interface BridgeContext {
  readonly ui: HostUi;
  readonly uploads: UploadStore;
  readonly downloads: DownloadStore;
  readonly storage: ServerStorage;
  audit(entry: Record<string, unknown>): void;
}
