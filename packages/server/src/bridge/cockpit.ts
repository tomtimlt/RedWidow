/**
 * Gestes du cockpit qui, dans l'extension, passent par des dialogues natifs ou des terminaux VS Code
 * (ADR 0050, 0053, 0055) : création d'un Kali ou d'un Exegol, VPN, dossier partagé, suppression, terminal,
 * images. Chaque dialogue devient un `HostUi`. Le client ne fournit jamais un chemin de l'hôte :
 * - la configuration VPN est téléversée (`ui.file`), stockée sous `<données>/vpn/<aléa>.ovpn` (0600) et
 *   désignée seulement par ce chemin interne ;
 * - le dossier partagé n'est plus choisi (ADR 0056) : c'est `<données>/containers/<nom du conteneur>`, créé avec lui ;
 * - la suppression d'un conteneur exige une confirmation humaine (`danger`) ;
 * - Exegol est créé par sa CLI exécutée par le serveur (absente : message clair, aucun processus lancé).
 * Une seule opération longue à la fois (garantie par `ViewHosts`), annulable par `cancelOperation`.
 */
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  CodedError,
  createRecorder,
  createRedactor,
  errorInfo,
  lookupContainer,
  resolveBinary,
  runProcess,
  secretsFromEnv,
} from "@warband/core";
import { formatError, t } from "@warband/messages";
import { cleanText } from "@warband/vscode/logic/approval";
import {
  type CockpitMessage,
  linkedTerminalChoices,
  parseCockpitMessage,
} from "@warband/vscode/logic/cockpit";
import { type ExegolCreateOptions, prepareExegolCreate } from "@warband/vscode/logic/exegol-create";
import { validateSharedFolder } from "@warband/vscode/logic/shared-folder";
import { isContainerRef } from "../docker/containers.js";
import type { ContainerHost } from "./containers.js";
import type { BridgeContext } from "./hostui.js";
import { DEFAULT_EXEGOL_TAG, type ImageHost, type InstallProgress, isExegolTag } from "./images.js";
import { openWindowMessage } from "./shell-messages.js";
import type { CockpitBackend, ViewSink } from "./views.js";
import {
  countFolderProjects,
  discardFolder,
  provisionFolder,
  removeFolderAndProjects,
} from "./workspaces.js";

/** Plafond d'une configuration VPN téléversée (octets) et de sous-dossiers proposés. */
export const VPN_MAX_BYTES = 1024 * 1024;

/** Attente maximale de l'apparition d'un Exegol créé (comme l'extension : 30 min). */
const EXEGOL_TIMEOUT_MS = 30 * 60_000;
const EXEGOL_POLL_MS = 2000;
/**
 * Garde-fou d'inactivité : la CLI lancée sans terminal peut rester bloquée sur une invite (abonnement, mise à jour…).
 * Sans aucune sortie depuis ce délai et sans conteneur apparu (un téléchargement affiche sa progression, donc
 * rafraîchit le délai), l'opération est arrêtée avec les dernières lignes de sortie masquées.
 */
const EXEGOL_STALL_MS = 5 * 60_000;
/** Dernières lignes de sortie montrées à l'utilisateur (caractères) et mémoire tampon brute (caractères). */
const OUTPUT_SHOWN_CHARS = 2048;
const OUTPUT_KEPT_CHARS = 16_384;
/** Délai laissé à une opération annulée pour s'arrêter (SIGTERM, puis SIGKILL à 5 s) avant de rendre la main. */
const CANCEL_GRACE_MS = 6000;
/**
 * Entrée standard de la CLI : des refus (« n ») en nombre borné, jamais une acceptation. Une invite
 * [Y/n] d'abonnement, de mise à jour ou de contrat reçoit donc « non » ; la CLI avance sans ou s'arrête.
 */
const EXEGOL_REFUSALS = "n\n".repeat(32);

/** Exegol côté serveur : détection du binaire, préparation des arguments, exécution (injectable : tests). */
export interface ExegolPort {
  installed(): boolean;
  prepare(options: ExegolCreateOptions): Promise<{ shellPath: string; shellArgs: string[] }>;
  /**
   * Exécute `exegol start …` sans terminal ; renvoie son code de sortie. Annulable (SIGTERM puis SIGKILL).
   * `onOutput` reçoit chaque morceau de sortie brute (stdout et stderr), pour le garde-fou d'inactivité.
   */
  run(
    shellPath: string,
    argv: readonly string[],
    signal: AbortSignal,
    onOutput?: (chunk: Buffer) => void,
  ): Promise<number | null>;
  /**
   * Contrat d'utilisation enregistré ? `exegol version` sans terminal (entrée fermée) : sans acceptation la CLI
   * affiche l'invite du contrat et sort en erreur (code 1), sans jamais attendre ; acceptée : code 0.
   */
  eulaAccepted(signal: AbortSignal): Promise<boolean>;
  /** Enregistre l'acceptation (`exegol version --accept-eula`), APRÈS confirmation humaine seulement. */
  acceptEula(signal: AbortSignal): Promise<number | null>;
  /** Période (ms) du sondage de l'apparition du conteneur. */
  pollMs?: number;
  /** Silence (ms) au-delà duquel la CLI est jugée bloquée sur une invite (défaut : 5 min ; tests). */
  stallMs?: number;
}

/**
 * Sortie de la CLI gardée pour le diagnostic : séquences ANSI et contrôles retirés, secrets masqués, bornée.
 * Le masquage porte sur toute la mémoire tampon (un secret n'est pas coupé par la troncature).
 */
export class OutputTail {
  private text = "";
  private readonly decoder = new StringDecoder("utf8");
  private readonly redact = createRedactor({ values: secretsFromEnv() });

  push(chunk: Buffer): void {
    this.text += this.decoder.write(chunk);
    if (this.text.length > OUTPUT_KEPT_CHARS) this.text = this.text.slice(-OUTPUT_KEPT_CHARS);
  }

  /** Dernières lignes lisibles, masquées, au plus 2 Kio. */
  shown(): string {
    const clean = this.text
      // biome-ignore lint/suspicious/noControlCharactersInRegex: retrait volontaire des séquences ANSI
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
      .replace(/\r\n?/g, "\n")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: retrait volontaire des contrôles
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim();
    return this.redact(clean).slice(-OUTPUT_SHOWN_CHARS).trim();
  }
}

/** Durée maximale d'une commande de contrat (la CLI ne fait aucun accès réseau pour `version`). */
const EULA_TIMEOUT_MS = 20_000;

async function exegolVersion(args: readonly string[], signal: AbortSignal) {
  const bin = resolveBinary("exegol");
  if (bin === null) return null;
  const recorder = createRecorder();
  try {
    // Arguments fixes ; `safeEnv` par défaut (HOME du serveur : la CLI y range son `.datastore`).
    return await runProcess([bin, "version", ...args], {
      recorder,
      parentId: null,
      signal,
      timeoutMs: EULA_TIMEOUT_MS,
      maxCapturedLines: 20,
      maxJournaledLines: 20,
    });
  } finally {
    recorder.close();
  }
}

export function defaultExegol(): ExegolPort {
  return {
    installed: () => resolveBinary("exegol") !== null,
    prepare: (options) => prepareExegolCreate(options),
    async eulaAccepted(signal) {
      const result = await exegolVersion([], signal);
      return result !== null && result.code === 0 && !result.stdout.some((l) => /EULA/i.test(l));
    },
    async acceptEula(signal) {
      return (await exegolVersion(["--accept-eula"], signal))?.code ?? null;
    },
    async run(shellPath, argv, signal, onOutput) {
      const recorder = createRecorder();
      try {
        const result = await runProcess([shellPath, ...argv], {
          recorder,
          parentId: null,
          signal,
          stdin: EXEGOL_REFUSALS,
          ...(onOutput !== undefined && { onOutput: (_stream, chunk) => onOutput(chunk) }),
          timeoutMs: EXEGOL_TIMEOUT_MS,
          maxCapturedLines: 200,
          maxJournaledLines: 200,
        });
        return result.code;
      } finally {
        recorder.close();
      }
    },
  };
}

export interface CockpitGesturesDeps {
  ctx: Pick<BridgeContext, "ui" | "uploads" | "audit">;
  backend: CockpitBackend;
  containers: ContainerHost;
  /** `<données>/containers` : racine unique des dossiers partagés, un par conteneur (ADR 0056). */
  containersRoot: string;
  /** `<données>` : les configurations VPN sont rangées sous `<données>/vpn`. */
  dataRoot: string;
  configDir: string;
  exegol: ExegolPort;
  /** Images (Kali, Exegol) et contrat Exegol, partagés avec la coquille (ADR 0057). */
  images: ImageHost;
  locale(): "fr" | "en";
  /** Journal de la sortie du serveur : une ligne par début, fin ou erreur d'opération, jamais un secret. */
  log?(line: string): void;
  emit(sink: ViewSink, msg: Record<string, unknown>): void;
  emitAll(msg: Record<string, unknown>): void;
  /** Recharge la vue du cockpit pour tous les abonnés. */
  refresh(): Promise<void>;
}

interface Selection {
  /** Chemin interne d'une configuration VPN stockée (jamais montré), et son libellé. */
  vpn?: { path: string; label: string };
}

/** Erreur dont le message est un texte fixe du code (jamais un détail du démon ni un chemin). */
class FixedMessage extends Error {}

/** Opération longue en cours (une seule à la fois pour tout le cockpit). */
interface Running {
  kind: string;
  /** Nom du conteneur visé (déjà validé), pour le journal. */
  name: string | undefined;
  stage: string;
  layers: InstallProgress["layers"];
  startedAt: number;
  controller: AbortController;
}

/** Types de messages du cockpit : un message invalide de l'un d'eux reçoit une réponse d'erreur (jamais un silence). */
const COCKPIT_TYPES = new Set([
  "refresh",
  "rendered",
  "openWorkspace",
  "openProgram",
  "openEngagement",
  "terminal",
  "link",
  "setPrimary",
  "start",
  "stop",
  "remove",
  "createExegol",
  "createKali",
  "listImages",
  "pickSharedFolder",
  "pickVpn",
  "cancelOperation",
]);

/** Valeurs minimales valides par type : sert à isoler le champ fautif d'un message refusé par le parseur. */
function baseline(type: string): Record<string, unknown> {
  if (type === "createKali") return { type, name: "x", image: "kali" };
  if (["createExegol", "link", "setPrimary", "start", "stop", "remove"].includes(type))
    return { type, name: "x" };
  return { type };
}

/** Champ fautif d'un message cockpit invalide (nom borné et sûr), ou `undefined` s'il est inconnu. */
export function invalidField(msg: Record<string, unknown>): string | undefined {
  const type = String(msg.type);
  const base = baseline(type);
  // Un champ obligatoire absent est le premier fautif.
  for (const key of Object.keys(base)) if (key !== "type" && msg[key] === undefined) return key;
  for (const [key, value] of Object.entries(msg)) {
    if (key === "type") continue;
    if (parseCockpitMessage({ ...base, [key]: value }) === null)
      return /^[A-Za-z0-9_.-]{1,40}$/.test(key) ? key : undefined;
  }
  return undefined;
}

/** Nom sûr pour une ligne de journal : un nom de conteneur valide, sinon `?` (jamais du texte libre du client). */
const loggedName = (name: string | undefined): string =>
  name !== undefined && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/.test(name) ? name : "?";

export class CockpitGestures {
  private readonly selections = new Map<ViewSink, Selection>();
  private current: Running | undefined;

  constructor(private readonly deps: CockpitGesturesDeps) {}

  /**
   * Annule l'opération en cours : signal d'arrêt (la CLI ou le processus reçoit SIGTERM, puis SIGKILL après 5 s),
   * puis `operation {busy:false}` à la fin. Sans opération en cours : `busy:false` immédiat pour la page.
   */
  cancel(sink: ViewSink): boolean {
    if (this.current === undefined) this.clearError(sink);
    else this.current.controller.abort();
    return true;
  }

  /** Une opération occupe le cockpit : réponse immédiate `cockpit.busy` à l'émetteur, l'autre n'est pas touchée. */
  rejectIfBusy(sink: ViewSink): boolean {
    const c = this.current;
    if (c === undefined) return false;
    const minutes = Math.max(0, Math.floor((Date.now() - c.startedAt) / 60_000));
    this.fail(sink, new CodedError("cockpit.busy", { stage: c.stage, minutes }));
    return true;
  }

  /** Message invalide d'un type connu : réponse d'erreur affichable avec le champ fautif ; type inconnu : `false`. */
  rejectInvalid(msg: Record<string, unknown>, sink: ViewSink): boolean {
    if (typeof msg.type !== "string" || !COCKPIT_TYPES.has(msg.type)) return false;
    const field = invalidField(msg);
    this.fail(
      sink,
      new CodedError("cockpit.invalidMessage", field === undefined ? {} : { field }),
      {
        ...(field !== undefined && { field }),
      },
    );
    return true;
  }

  /**
   * État réel pour une page qui se (re)connecte ou se rafraîchit : l'opération en cours ou `busy:false` ; avec
   * `initial`, le dossier partagé automatique (ADR 0056) pour que « Créer » ne dépende pas de « Choisir… ».
   */
  sendState(sink: ViewSink, initial = false): void {
    const c = this.current;
    this.deps.emit(
      sink,
      c === undefined
        ? { type: "operation", busy: false, stage: "", layers: [] }
        : {
            type: "operation",
            busy: true,
            stage: c.stage,
            layers: c.layers,
            startedAt: c.startedAt,
          },
    );
    if (initial) this.sendSharedFolder(sink);
  }

  /** Socket fermé : sa configuration VPN non utilisée est supprimée. */
  unsubscribe(sink: ViewSink): void {
    void this.dropVpn(sink);
    this.selections.delete(sink);
  }

  dispose(): void {
    this.current?.controller.abort();
    for (const sink of [...this.selections.keys()]) this.unsubscribe(sink);
  }

  /** Message cockpit propre à cette classe ; `false` : pas le sien. */
  async handle(message: CockpitMessage, sink: ViewSink): Promise<boolean> {
    switch (message.type) {
      case "rendered":
      case "openWorkspace":
        // Télémétrie de rendu ; le dossier du projet n'a pas d'équivalent web (pas d'explorateur de l'hôte).
        return true;
      case "openProgram":
      case "openEngagement":
        sink.send("shell", "shell", {
          ...openWindowMessage(message.type === "openProgram" ? "program" : "engagement"),
        });
        return true;
      case "listImages":
        return this.listImages(sink);
      case "terminal":
        return this.terminal(sink);
      case "pickVpn":
        return this.pickVpn(sink);
      case "pickSharedFolder":
        return this.pickSharedFolder(sink);
      case "createKali":
        // L'image est celle du serveur (`REDWIDOW_KALI_IMAGE`) : la page ne choisit pas l'image à lancer.
        return this.run(
          { kind: message.type, name: message.name },
          t("Création du conteneur Kali…"),
          async (signal, report) => {
            if (!isContainerRef(message.name)) throw new CodedError("container.invalidName");
            // Image absente : installée d'abord, avec sa progression, au lieu d'échouer (ADR 0057).
            await this.deps.images.ensureKali({
              signal,
              onProgress: (p) => report({ stage: p.stage, layers: p.layers }),
            });
            report({ stage: t("Création du conteneur Kali…"), layers: [] });
            await this.deps.containers.createKali(message.name);
            this.deps.ctx.audit({ kind: "containerCreate", container: message.name });
            return t("Conteneur créé.");
          },
        );
      case "createExegol":
        return this.run(
          { kind: message.type, name: message.name },
          t("Préparation Exegol…"),
          (signal, report) => this.createExegol(sink, message, signal, report),
        );
      case "remove":
        return this.run(
          { kind: message.type, name: message.name },
          t("Suppression du conteneur…"),
          (signal) => this.remove(sink, message.name, signal),
        );
      default:
        return false;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Opération longue
  // ------------------------------------------------------------------------------------------

  /**
   * Exécute une opération longue, seule à la fois (l'appelant a vérifié `rejectIfBusy` sans attendre entre-temps).
   * Toute page reçoit `operation` : début, progression, puis fin (`busy:false`, avec `error` + `code` en cas d'échec).
   * Annulée, elle rend la main au plus tard après `CANCEL_GRACE_MS`, même si son corps est bloqué (dialogue).
   */
  async run(
    info: { kind: string; name?: string },
    stage: string,
    body: (
      signal: AbortSignal,
      report: (progress: {
        stage?: string;
        message?: string;
        layers?: InstallProgress["layers"];
      }) => void,
    ) => Promise<string | undefined>,
  ): Promise<boolean> {
    const controller = new AbortController();
    const current: Running = {
      kind: info.kind,
      name: info.name,
      stage,
      layers: [],
      startedAt: Date.now(),
      controller,
    };
    this.current = current;
    const label = `${info.kind} ${loggedName(info.name)}`;
    const log = (line: string) => this.deps.log?.(`cockpit : ${line}`);
    const seconds = () => Math.round((Date.now() - current.startedAt) / 1000);
    const send = (extra: Record<string, unknown>) =>
      this.deps.emitAll({ type: "operation", layers: [], ...extra });
    send({ busy: true, stage, startedAt: current.startedAt });
    log(`début ${label}`);
    const cancelled = Symbol("cancelled");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const aborted = new Promise<typeof cancelled>((done) => {
      controller.signal.addEventListener(
        "abort",
        () => {
          timer = setTimeout(() => done(cancelled), CANCEL_GRACE_MS);
          timer.unref?.();
        },
        { once: true },
      );
    });
    const running = (async () =>
      body(controller.signal, (p) => {
        if (this.current !== current) return;
        current.stage = p.stage ?? stage;
        current.layers = p.layers ?? [];
        send({
          busy: true,
          stage: current.stage,
          startedAt: current.startedAt,
          ...(p.message !== undefined && { message: p.message }),
          ...(p.layers !== undefined && { layers: p.layers }),
        });
      }))();
    try {
      const notice = await Promise.race([running, aborted]);
      if (notice === cancelled) {
        // Le corps ne s'arrête pas à temps : on le laisse finir seul, sa fin tardive est ignorée.
        running.catch(() => undefined);
        log(`annulée ${label} (${seconds()} s)`);
        send({ busy: false, stage: "" });
      } else {
        log(`fin ${label} (${seconds()} s)`);
        send({ busy: false, stage: "", ...(notice !== undefined && { message: notice }) });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        log(`annulée ${label} (${seconds()} s)`);
        send({ busy: false, stage: "" });
      } else {
        const { text, code } = this.operationError(error);
        log(`erreur ${label} (${code}, ${seconds()} s)`);
        send({ busy: false, stage: "", error: text, code });
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (this.current === current) this.current = undefined;
      await this.deps.refresh().catch(() => undefined);
    }
    return true;
  }

  /** Texte d'erreur affichable : jamais un message brut du démon ou d'un processus. */
  private operationError(error: unknown): { text: string; code: string } {
    if (error instanceof CodedError)
      return { text: formatError(error, this.deps.locale()), code: errorInfo(error).code };
    if (error instanceof FixedMessage) return { text: error.message, code: "view.failed" };
    return { text: t("L'opération a échoué."), code: "view.failed" };
  }

  /**
   * Erreur d'un geste simple : la page cockpit ignore `{type:"error"}` et n'affiche que le texte d'une
   * `operation` ; on envoie donc les deux (le code pour les clients, le texte localisé pour l'affichage).
   */
  private fail(sink: ViewSink, error: unknown, extra: Record<string, unknown> = {}): void {
    const { text, code } = this.operationError(error);
    this.deps.emit(sink, { type: "error", code, text, ...extra });
    this.deps.emit(sink, {
      type: "operation",
      busy: false,
      stage: "",
      layers: [],
      error: text,
      code,
      ...extra,
    });
  }

  /** Efface l'erreur affichée après un geste réussi. */
  private clearError(sink: ViewSink): void {
    this.deps.emit(sink, { type: "operation", busy: false, stage: "", layers: [] });
  }

  // ------------------------------------------------------------------------------------------
  // Gestes simples
  // ------------------------------------------------------------------------------------------

  private async listImages(sink: ViewSink): Promise<boolean> {
    try {
      this.deps.emit(sink, { type: "images", images: await this.deps.backend.images() });
    } catch (error) {
      this.fail(sink, error);
    }
    return true;
  }

  /** Terminal du projet : un conteneur lié et démarré ; `ui.pick` s'il y en a plusieurs. */
  private async terminal(sink: ViewSink): Promise<boolean> {
    const view = await this.deps.backend.load();
    const choices = linkedTerminalChoices(view.containers ?? []).filter((c) =>
      isContainerRef(c.name),
    );
    if (choices.length === 0) return true;
    let name = choices[0]?.name;
    if (choices.length > 1) {
      const picked = await this.deps.ctx.ui.pick(
        {
          title: t("Terminal du projet"),
          items: choices.map((c) => ({
            id: c.name,
            label: cleanText(c.short, 120),
            ...(c.primary && { detail: "primary" }),
          })),
        },
        sink,
      );
      if (picked === null || !choices.some((c) => c.name === picked)) return true;
      name = picked;
    }
    if (name === undefined) return true;
    sink.send("shell", "shell", {
      ...openWindowMessage("term", `t-${randomBytes(4).toString("hex")}`, { container: name }),
    });
    return true;
  }

  // ------------------------------------------------------------------------------------------
  // VPN et dossier partagé
  // ------------------------------------------------------------------------------------------

  private selection(sink: ViewSink): Selection {
    let s = this.selections.get(sink);
    if (s === undefined) {
      s = {};
      this.selections.set(sink, s);
    }
    return s;
  }

  private async dropVpn(sink: ViewSink): Promise<void> {
    const vpn = this.selections.get(sink)?.vpn;
    if (vpn === undefined) return;
    delete this.selections.get(sink)?.vpn;
    await rm(vpn.path, { force: true }).catch(() => undefined);
  }

  /** Configuration VPN : fichier `.ovpn` téléversé (texte, ≤ 1 Mio), rangé en 0600 sous `<données>/vpn`. */
  private async pickVpn(sink: ViewSink): Promise<boolean> {
    const id = await this.deps.ctx.ui.file(
      { title: t("Configuration VPN Exegol"), accept: [".ovpn"], maxBytes: VPN_MAX_BYTES },
      sink,
    );
    if (id === null) return true;
    const taken = this.deps.ctx.uploads.take(id);
    if (taken === undefined) return true;
    try {
      const bytes = await readFile(taken.path);
      // Texte seulement : un fichier binaire n'est pas une configuration OpenVPN.
      if (bytes.length === 0 || bytes.length > VPN_MAX_BYTES || bytes.includes(0))
        throw new CodedError("vpn.invalid");
      const dir = join(this.deps.dataRoot, "vpn");
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await chmod(dir, 0o700).catch(() => undefined);
      const path = join(dir, `${randomBytes(16).toString("hex")}.ovpn`);
      await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
      await chmod(path, 0o600).catch(() => undefined);
      await this.dropVpn(sink);
      const label = taken.name;
      this.selection(sink).vpn = { path, label };
      this.deps.emit(sink, { type: "pickedVpn", label });
    } catch (error) {
      this.fail(sink, error);
    } finally {
      await taken.release();
    }
    return true;
  }

  /**
   * « Dossier partagé » de la page cockpit (ADR 0056) : plus de choix, le dossier est celui du futur conteneur
   * (`<données>/containers/<nom>`). La page de l'extension n'active « Créer » qu'avec un libellé non vide : on
   * répond donc par un libellé fixe, qui n'est jamais relu par le serveur (aucun chemin n'est accepté du client).
   */
  private pickSharedFolder(sink: ViewSink): boolean {
    this.clearError(sink);
    this.sendSharedFolder(sink);
    return true;
  }

  /** Libellé fixe du dossier automatique : envoyé dès `ready`, jamais relu (le serveur recalcule `<containers>/<nom>`). */
  private sendSharedFolder(sink: ViewSink): void {
    this.deps.emit(sink, {
      type: "pickedSharedFolder",
      path: t("automatique (containers/<nom>)"),
    });
  }

  // ------------------------------------------------------------------------------------------
  // Suppression
  // ------------------------------------------------------------------------------------------

  private async remove(
    sink: ViewSink,
    name: string,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    // Dossier partagé du conteneur, relevé avant sa suppression (ADR 0056).
    const folder = (await this.deps.containers.list().catch(() => [])).find(
      (c) => c.name === name,
    )?.folder;
    const result = await this.deps.backend.remove(name, {
      signal,
      confirm: (info) =>
        this.deps.ctx.ui.confirm(
          {
            title: t("Supprimer le conteneur"),
            text: t`Supprimer ${cleanText(info.name, 120)} (${info.family}) ?${info.force ? t(" Il est en cours et sera arrêté de force.") : ""} Les fichiers internes non montés seront perdus. Les images et volumes sont conservés. Son dossier partagé aussi, sauf si vous demandez ensuite de le supprimer. Projets associés : ${info.projects.map((p) => cleanText(p.name, 80)).join(", ") || t("aucun")}.`,
            danger: true,
          },
          sink,
        ),
    });
    if (result.status === "cancelled") return undefined;
    this.deps.ctx.audit({ kind: "containerRemove", container: name });
    const notice = folder === undefined ? undefined : await this.removeSharedFolder(sink, folder);
    if (result.status === "partial")
      throw new FixedMessage(
        t("Le conteneur est supprimé, mais ses associations restent à nettoyer."),
      );
    return notice;
  }

  /**
   * Seconde confirmation, explicite : le dossier partagé et ses projets ne sont JAMAIS supprimés par défaut.
   * Sans réponse ou refus : conservés, et l'utilisateur en est prévenu.
   */
  private async removeSharedFolder(sink: ViewSink, folder: string): Promise<string> {
    const { containersRoot, configDir } = this.deps;
    const count = await countFolderProjects(configDir, containersRoot, folder).catch(() => 0);
    const confirmed = await this.deps.ctx.ui.confirm(
      {
        title: t("Supprimer le dossier partagé"),
        text: t`Supprimer aussi le dossier partagé et ses ${count} projets ? Tous les fichiers de ${cleanText(folder, 120)} seront perdus, sans retour possible.`,
        danger: true,
      },
      sink,
    );
    if (!confirmed)
      return t`Conteneur supprimé. Son dossier partagé ${cleanText(folder, 120)} et ses ${count} projets sont conservés.`;
    try {
      await removeFolderAndProjects(configDir, containersRoot, folder);
    } catch (error) {
      // Le conteneur n'existe plus : les fichiers créés en root ne peuvent être retirés que depuis l'hôte.
      if (error instanceof CodedError && error.code === "fs.rootOwned")
        throw new FixedMessage(
          t`Le conteneur est supprimé, mais son dossier partagé ${cleanText(folder, 120)} contient des fichiers créés par root (le conteneur) : supprimez-le depuis l'hôte avec les droits administrateur.`,
        );
      throw new FixedMessage(
        t("Le conteneur est supprimé, mais son dossier partagé n'a pas pu être supprimé."),
      );
    }
    this.deps.ctx.audit({ kind: "containerFolderRemove", container: folder });
    return t("Conteneur, dossier partagé et projets supprimés.");
  }

  // ------------------------------------------------------------------------------------------
  // Création d'un Exegol
  // ------------------------------------------------------------------------------------------

  /**
   * Avant de lancer la CLI : le contrat d'utilisation doit être accepté (dialogue d'acceptation sinon ; refus :
   * rien n'est lancé), puis l'image demandée doit exister (proposition d'installation sinon).
   */
  private async ensureExegolReady(
    sink: ViewSink,
    image: string | undefined,
    signal: AbortSignal,
    report: (progress: { stage?: string; layers?: InstallProgress["layers"] }) => void,
  ): Promise<{ cancelled: string } | undefined> {
    const { images, ctx } = this.deps;
    if (!(await images.eulaAccepted(signal))) {
      // Le contrat n'est JAMAIS accepté à la place de l'utilisateur : dialogue, et refus = rien n'est lancé.
      report({ stage: t("En attente de votre réponse (contrat Exegol)…") });
      if (!(await images.acceptEula(sink))) throw new CodedError("exegol.eulaRequired");
    }
    signal.throwIfAborted();
    const tag = image === undefined || image === "" ? DEFAULT_EXEGOL_TAG : image;
    // Image saisie librement (dépôt, version complète…) : la CLI s'en charge ; seules les étiquettes simples sont gérées ici.
    if (!isExegolTag(tag) || (await images.exegolInstalled(tag)) !== false) return undefined;
    report({ stage: t("En attente de votre réponse (image Exegol)…") });
    const yes = await ctx.ui.confirm(
      {
        title: t("Image Exegol absente"),
        text: t`L'image Exegol « ${tag} » n'est pas installée sur ce serveur. L'installer maintenant ? Le téléchargement peut représenter plusieurs gigaoctets.`,
      },
      sink,
    );
    if (!yes) return { cancelled: t("Création annulée : l'image Exegol n'est pas installée.") };
    await images.install(
      { kind: "exegol", tag },
      { signal, onProgress: (p) => report({ stage: p.stage, layers: p.layers }) },
    );
    report({ stage: t("Création du conteneur Exegol…"), layers: [] });
    return undefined;
  }

  private async createExegol(
    sink: ViewSink,
    m: Extract<CockpitMessage, { type: "createExegol" }>,
    signal: AbortSignal,
    report: (progress: {
      stage?: string;
      message?: string;
      layers?: InstallProgress["layers"];
    }) => void,
  ): Promise<string | undefined> {
    const { exegol } = this.deps;
    // Rien n'est lancé sans la CLI : message clair, aucun processus.
    if (!exegol.installed()) throw new CodedError("exegol.notInstalled");
    const selection = this.selection(sink);
    if (m.vpn === true && selection.vpn === undefined) throw new CodedError("exegol.vpnMissing");
    if ((m.desktop === true || m.vpn === true) && m.network !== undefined && m.network !== "nat")
      throw new CodedError("exegol.needsNat");
    const existing = await this.deps.backend.load();
    if ((existing.containers ?? []).some((c) => c.name === m.name || c.short === m.name))
      throw new CodedError("container.exists");
    if (!isContainerRef(m.name)) throw new CodedError("container.invalidName");
    signal.throwIfAborted();
    const declined = await this.ensureExegolReady(sink, m.image, signal, report);
    if (declined !== undefined) return declined.cancelled;

    // Dossier partagé automatique : `<données>/containers/<nom>` avec la racine RedWidow (ADR 0056).
    // Un dossier déjà présent est refusé (`container.folderExists`) : jamais réutilisé ni écrasé.
    const folderPath = await provisionFolder(this.deps.containersRoot, m.name);
    let source: string;
    try {
      source = await validateSharedFolder(folderPath);
    } catch (error) {
      await discardFolder(folderPath);
      // Motif précis du refus (introuvable, lien symbolique, données sensibles…) : textes fixes de
      // `validateSharedFolder`, sans secret ; le dossier est nommé par son nom de conteneur, jamais par
      // son chemin hôte.
      const reason = error instanceof Error && error.message !== "" ? error.message : "";
      throw new FixedMessage(
        `${t("Dossier partagé automatique refusé")} (containers/${m.name})${reason ? ` : ${reason}` : ""}`,
      );
    }

    let prepared: { shellPath: string; shellArgs: string[] };
    try {
      prepared = await exegol.prepare({
        name: m.name,
        ...(m.image !== undefined && m.image !== "" && { image: m.image }),
        workspacePath: source,
        ...(m.vpn === true && selection.vpn !== undefined && { vpnPath: selection.vpn.path }),
        ...(m.desktop !== undefined && { desktop: m.desktop }),
        ...(m.desktopPort !== undefined && { desktopPort: m.desktopPort }),
        network: m.network ?? "nat",
        gui: false,
        exegolResources: m.shareResources ?? true,
        myResources: m.shareMyResources ?? true,
      });
    } catch (error) {
      await discardFolder(folderPath);
      // Les messages de préparation sont des textes fixes (option non prise en charge, port invalide…).
      throw error instanceof Error && !(error instanceof CodedError)
        ? new FixedMessage(error.message)
        : error;
    }

    report({ stage: t("Création du conteneur Exegol…") });
    const child = new AbortController();
    const stop = () => child.abort();
    signal.addEventListener("abort", stop, { once: true });
    let exit: { code: number | null } | undefined;
    // Sortie de la CLI : sert au garde-fou d'inactivité et au diagnostic (masquée, bornée).
    const tail = new OutputTail();
    let lastOutput = Date.now();
    const stallMs = exegol.stallMs ?? EXEGOL_STALL_MS;
    const running = exegol
      .run(prepared.shellPath, prepared.shellArgs, child.signal, (chunk) => {
        lastOutput = Date.now();
        tail.push(chunk);
      })
      .then((code) => {
        exit = { code };
      })
      .catch(() => {
        exit = { code: null };
      });
    let real: string | null = null;
    try {
      const deadline = Date.now() + EXEGOL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        const rows = (await this.deps.containers.list().catch(() => [])).filter(
          (c) => c.kind === "exegol",
        );
        const name = lookupContainer(m.name, rows);
        if (name !== null && rows.find((c) => c.name === name)?.state === "running") {
          real = name;
          break;
        }
        // La CLI s'est arrêtée sans qu'aucun conteneur n'apparaisse : échec.
        if (exit !== undefined) throw new CodedError("exegol.createFailed");
        // Plus rien depuis longtemps et aucun conteneur : la CLI attend une réponse interactive (abonnement,
        // mise à jour…). Un téléchargement affiche sa progression et rafraîchit `lastOutput`.
        if (Date.now() - lastOutput > stallMs)
          throw new CodedError("exegol.stalled", { output: tail.shown() });
        await new Promise<void>((done) => {
          const timer = setTimeout(done, exegol.pollMs ?? EXEGOL_POLL_MS);
          timer.unref?.();
          signal.addEventListener("abort", () => (clearTimeout(timer), done()), { once: true });
        });
      }
      if (real === null) throw new CodedError("project.notRunning", { name: m.name });
    } catch (error) {
      if (selection.vpn !== undefined && m.vpn === true) await this.dropVpn(sink);
      // Échec, annulation ou garde-fou : la CLI est arrêtée (SIGTERM puis SIGKILL), puis le dossier tout juste
      // créé est retiré s'il est vide et qu'aucun conteneur n'est apparu (`discardFolder` ne supprime jamais un fichier).
      child.abort();
      await running;
      const rows = await this.deps.containers.list().catch(() => null);
      if (
        rows !== null &&
        lookupContainer(
          m.name,
          rows.filter((c) => c.kind === "exegol"),
        ) === null
      )
        await discardFolder(folderPath);
      throw error;
    } finally {
      // Le conteneur vit seul : la CLI (sans terminal) n'a plus d'utilité, elle est arrêtée.
      child.abort();
      signal.removeEventListener("abort", stop);
      await running;
    }
    this.deps.ctx.audit({ kind: "exegolCreate", container: real });
    // Le VPN reste sur le disque (0600) : Exegol le relit aux redémarrages ; il n'est plus « en attente ».
    if (m.vpn === true) delete selection.vpn;
    return t("Conteneur créé.");
  }
}
