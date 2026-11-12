/**
 * Gestes du cockpit qui, dans l'extension, passent par des dialogues natifs ou des terminaux VS Code
 * (ADR 0050, 0053, 0055) : création d'un Kali ou d'un Exegol, VPN, dossier partagé, suppression, terminal,
 * images. Chaque dialogue devient un `HostUi`. Le client ne fournit jamais un chemin de l'hôte :
 * - la configuration VPN est téléversée (`ui.file`), stockée sous `<données>/vpn/<aléa>.ovpn` (0600) et
 *   désignée seulement par ce chemin interne ;
 * - le dossier partagé est un sous-dossier de `<données>/projects` choisi dans une liste (`ui.pick`) ;
 * - la suppression d'un conteneur exige une confirmation humaine (`danger`) ;
 * - Exegol est créé par sa CLI exécutée par le serveur (absente : message clair, aucun processus lancé).
 * Une seule opération longue à la fois (garantie par `ViewHosts`), annulable par `cancelOperation`.
 */
import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import {
  activeProject,
  CodedError,
  createRecorder,
  errorInfo,
  lookupContainer,
  readProjects,
  resolveBinary,
  runProcess,
} from "@warband/core";
import { formatError, t } from "@warband/messages";
import { cleanText } from "@warband/vscode/logic/approval";
import { type CockpitMessage, linkedTerminalChoices } from "@warband/vscode/logic/cockpit";
import { type ExegolCreateOptions, prepareExegolCreate } from "@warband/vscode/logic/exegol-create";
import { resolveCreationFolder, validateSharedFolder } from "@warband/vscode/logic/shared-folder";
import { isContainerRef } from "../docker/containers.js";
import type { ContainerHost } from "./containers.js";
import type { BridgeContext } from "./hostui.js";
import { openWindowMessage } from "./shell-messages.js";
import type { CockpitBackend, ViewSink } from "./views.js";

/** Plafond d'une configuration VPN téléversée (octets) et de sous-dossiers proposés. */
export const VPN_MAX_BYTES = 1024 * 1024;
const MAX_FOLDERS = 200;
/** Attente maximale de l'apparition d'un Exegol créé (comme l'extension : 30 min). */
const EXEGOL_TIMEOUT_MS = 30 * 60_000;
const EXEGOL_POLL_MS = 2000;

/** Exegol côté serveur : détection du binaire, préparation des arguments, exécution (injectable : tests). */
export interface ExegolPort {
  installed(): boolean;
  prepare(options: ExegolCreateOptions): Promise<{ shellPath: string; shellArgs: string[] }>;
  /** Exécute `exegol start …` sans terminal ; renvoie son code de sortie. Annulable. */
  run(shellPath: string, argv: readonly string[], signal: AbortSignal): Promise<number | null>;
  /** Période (ms) du sondage de l'apparition du conteneur. */
  pollMs?: number;
}

export function defaultExegol(): ExegolPort {
  return {
    installed: () => resolveBinary("exegol") !== null,
    prepare: (options) => prepareExegolCreate(options),
    async run(shellPath, argv, signal) {
      const recorder = createRecorder();
      try {
        const result = await runProcess([shellPath, ...argv], {
          recorder,
          parentId: null,
          signal,
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
  /** `<données>/projects` : seule racine des dossiers partageables. */
  projectsRoot: string;
  /** `<données>` : les configurations VPN sont rangées sous `<données>/vpn`. */
  dataRoot: string;
  configDir: string;
  exegol: ExegolPort;
  locale(): "fr" | "en";
  emit(sink: ViewSink, msg: Record<string, unknown>): void;
  emitAll(msg: Record<string, unknown>): void;
  /** Recharge la vue du cockpit pour tous les abonnés. */
  refresh(): Promise<void>;
}

interface Selection {
  /** Chemin interne d'une configuration VPN stockée (jamais montré), et son libellé. */
  vpn?: { path: string; label: string };
  /** Chemin réel d'un sous-dossier de `<données>/projects`, et son nom. */
  shared?: { real: string; name: string };
}

/** Erreur dont le message est un texte fixe du code (jamais un détail du démon ni un chemin). */
class FixedMessage extends Error {}

export class CockpitGestures {
  private readonly selections = new Map<ViewSink, Selection>();
  private abort: AbortController | undefined;

  constructor(private readonly deps: CockpitGesturesDeps) {}

  /** Annule l'opération en cours, s'il y en a une. */
  cancel(): boolean {
    this.abort?.abort();
    return true;
  }

  /** Socket fermé : sa configuration VPN non utilisée est supprimée. */
  unsubscribe(sink: ViewSink): void {
    void this.dropVpn(sink);
    this.selections.delete(sink);
  }

  dispose(): void {
    this.abort?.abort();
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
        return this.operation(t("Création du conteneur Kali…"), async () => {
          await this.deps.containers.createKali(message.name);
          this.deps.ctx.audit({ kind: "containerCreate", container: message.name });
          return t("Conteneur créé.");
        });
      case "createExegol":
        return this.operation(t("Préparation Exegol…"), (signal, report) =>
          this.createExegol(sink, message, signal, report),
        );
      case "remove":
        return this.operation(t("Suppression du conteneur…"), (signal) =>
          this.remove(sink, message.name, signal),
        );
      default:
        return false;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Opération longue
  // ------------------------------------------------------------------------------------------

  private async operation(
    stage: string,
    body: (
      signal: AbortSignal,
      report: (progress: { stage?: string; message?: string }) => void,
    ) => Promise<string | undefined>,
  ): Promise<boolean> {
    const controller = new AbortController();
    this.abort = controller;
    const send = (extra: Record<string, unknown>) =>
      this.deps.emitAll({ type: "operation", layers: [], ...extra });
    send({ busy: true, stage });
    try {
      const notice = await body(controller.signal, (p) =>
        send({
          busy: true,
          stage: p.stage ?? stage,
          ...(p.message !== undefined && { message: p.message }),
        }),
      );
      send({ busy: false, stage: "", ...(notice !== undefined && { message: notice }) });
    } catch (error) {
      if (controller.signal.aborted) send({ busy: false, stage: "" });
      else {
        const { text, code } = this.operationError(error);
        send({ busy: false, stage: "", error: text, code });
      }
    } finally {
      this.abort = undefined;
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

  // ------------------------------------------------------------------------------------------
  // Gestes simples
  // ------------------------------------------------------------------------------------------

  private async listImages(sink: ViewSink): Promise<boolean> {
    try {
      this.deps.emit(sink, { type: "images", images: await this.deps.backend.images() });
    } catch (error) {
      this.deps.emit(sink, { type: "error", code: this.operationError(error).code });
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
      this.deps.emit(sink, { type: "error", code: this.operationError(error).code });
    } finally {
      await taken.release();
    }
    return true;
  }

  /** Sous-dossiers (réels, non cachés, ni liens) de la racine des projets. */
  private async folders(): Promise<string[]> {
    const names: string[] = [];
    const root = this.deps.projectsRoot;
    for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (names.length >= MAX_FOLDERS) break;
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      if (!(await lstat(join(root, entry.name)).catch(() => null))?.isDirectory()) continue;
      names.push(entry.name);
    }
    return names.sort((a, b) => a.localeCompare(b));
  }

  /** Dossier partagé : choisi parmi les sous-dossiers de `<données>/projects`, jamais un chemin libre. */
  private async pickSharedFolder(sink: ViewSink): Promise<boolean> {
    try {
      const names = await this.folders();
      if (names.length === 0) throw new CodedError("folder.none");
      const picked = await this.deps.ctx.ui.pick(
        {
          title: t("Dossier partagé"),
          items: names.map((n) => ({ id: n, label: cleanText(n, 120) })),
        },
        sink,
      );
      if (picked === null || !names.includes(picked)) return true;
      const real = await this.sharedReal(picked);
      this.selection(sink).shared = { real, name: picked };
      this.deps.emit(sink, { type: "pickedSharedFolder", path: picked });
    } catch (error) {
      this.deps.emit(sink, { type: "error", code: this.operationError(error).code });
    }
    return true;
  }

  /** Chemin réel d'un sous-dossier de la racine des projets, revalidé (lien, sortie de la racine, données sensibles). */
  private async sharedReal(name: string): Promise<string> {
    try {
      const root = await realpath(this.deps.projectsRoot);
      const real = await validateSharedFolder(join(root, name));
      if (!real.startsWith(`${root}${sep}`)) throw new Error("hors racine");
      return real;
    } catch {
      throw new CodedError("folder.invalid");
    }
  }

  // ------------------------------------------------------------------------------------------
  // Suppression
  // ------------------------------------------------------------------------------------------

  private async remove(
    sink: ViewSink,
    name: string,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    const result = await this.deps.backend.remove(name, {
      signal,
      confirm: (info) =>
        this.deps.ctx.ui.confirm(
          {
            title: t("Supprimer le conteneur"),
            text: t`Supprimer ${cleanText(info.name, 120)} (${info.family}) ?${info.force ? t(" Il est en cours et sera arrêté de force.") : ""} Les fichiers internes non montés seront perdus. Les images, volumes et dossiers hôtes sont conservés. Projets associés : ${info.projects.map((p) => cleanText(p.name, 80)).join(", ") || t("aucun")}.`,
            danger: true,
          },
          sink,
        ),
    });
    if (result.status === "cancelled") return undefined;
    this.deps.ctx.audit({ kind: "containerRemove", container: name });
    if (result.status === "partial")
      throw new FixedMessage(
        t("Le conteneur est supprimé, mais ses associations restent à nettoyer."),
      );
    return undefined;
  }

  // ------------------------------------------------------------------------------------------
  // Création d'un Exegol
  // ------------------------------------------------------------------------------------------

  private async createExegol(
    sink: ViewSink,
    m: Extract<CockpitMessage, { type: "createExegol" }>,
    signal: AbortSignal,
    report: (progress: { stage?: string; message?: string }) => void,
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
    if (selection.shared === undefined) throw new CodedError("exegol.folderMissing");
    signal.throwIfAborted();

    const file = await readProjects(this.deps.configDir);
    const project = (file && activeProject(file)) || undefined;
    let source: string;
    let linkable: boolean;
    try {
      // Revalide juste avant la création : le dossier mémorisé doit être encore le même.
      const again = await this.sharedReal(selection.shared.name);
      ({ source, link: linkable } = await resolveCreationFolder(again, project));
    } catch {
      throw new CodedError("folder.invalid");
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
    const running = exegol
      .run(prepared.shellPath, prepared.shellArgs, child.signal)
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
        await new Promise<void>((done) => {
          const timer = setTimeout(done, exegol.pollMs ?? EXEGOL_POLL_MS);
          timer.unref?.();
          signal.addEventListener("abort", () => (clearTimeout(timer), done()), { once: true });
        });
      }
      if (real === null) throw new CodedError("project.notRunning", { name: m.name });
    } catch (error) {
      if (selection.vpn !== undefined && m.vpn === true) await this.dropVpn(sink);
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
    if (project === undefined || !linkable)
      return t(
        "Conteneur créé. Il n'est pas lié au projet : son dossier n'est pas dans le dossier partagé.",
      );
    await this.deps.backend.link(real);
    return t("Conteneur créé et lié au projet.");
  }
}
