/**
 * Messages de chat « d'hôte » du serveur web (lot M4) : ce que l'extension VS Code traite dans
 * `handleChatMessage` hors envoi et approbation. Mentions `@` (fichiers du projet) et `#` (terminaux web),
 * bascules de capacités, fournisseur, export du fil, ouverture de fenêtres, liaison conteneur↔projet
 * (ADR 0047), terminaux et pièces jointes par dialogue.
 *
 * Règles communes :
 * - rien n'est fait pour un message invalide (le pont l'a déjà compté) ; un message valide mais sans effet
 *   possible est accepté sans suite, jamais une approbation ou une autorisation implicite ;
 * - le client ne fournit jamais un chemin hôte : ni mention (chemin relatif revalidé), ni pièce jointe
 *   (identifiant d'upload), ni export (nom construit par le serveur) ;
 * - aucun secret dans un message sortant ou un export : sorties de terminal et textes passent par le masqueur.
 */
import {
  activeProject,
  createRedactor,
  errorInfo,
  type Finding,
  parseMentions,
  promptForTargets,
  readFindings,
  readProjects,
  type StoredProject,
  secretsFromEnv,
  shortContainerName,
} from "@warband/core";
import { formatReason, t } from "@warband/messages";
import type { WebviewMessage } from "@warband/vscode/logic/approval";
import type { ChatView } from "@warband/vscode/logic/chat";
import { applyCapabilityToggle, providerChoices } from "@warband/vscode/logic/chat-capabilities";
import { containerMentions } from "@warband/vscode/logic/cockpit";
import { killchainSummary, lastToolOutput } from "@warband/vscode/logic/mentions";
import { unlinkedContainerMentions } from "@warband/vscode/logic/project-container-link";
import type { ChatSession } from "@warband/vscode/logic/session";
import {
  classifyMessageHashes,
  lastCommand,
  parseHashes,
  readableTerminal,
  shellToken,
  TERMINAL_TAIL_CHARS,
  withTerminalContext,
} from "@warband/vscode/logic/termlog";
import { pickAttachment } from "./attachments.js";
import { buildChatExport, type ChatExportDeps, ChatExportError } from "./chat-export.js";
import { applySettingsPatch } from "./config.js";
import type { ContainerItem } from "./containers.js";
import { readChatSettings } from "./deps.js";
import type { BridgeContext } from "./hostui.js";
import type { Sink } from "./hub.js";
import { hasControl } from "./layout.js";
import { listProjectFiles, mentionRoot, resolveProjectFile } from "./mentions.js";
import { type OpenWindowMessage, openWindowMessage } from "./shell-messages.js";
import type { CockpitBackend } from "./views.js";

/** Cadre de chat tel que le voit ce module : identifiant, abonnés et session. */
export interface ChatFrame {
  id: string;
  subs: ReadonlySet<Sink>;
  session: ChatSession;
}

/** Terminal web ouvert : cadre, conteneur et fin du tampon de sortie, déjà masquée. */
export interface TerminalSnapshot {
  frame: string;
  container: string;
  finished: boolean;
  raw: string;
}

export interface ChatExtrasDeps {
  ctx: BridgeContext;
  configDir: string;
  /** Racine des projets du serveur : un dossier de projet doit s'y trouver pour être proposé en `@`. */
  projectsRoot: string;
  /** Dossier des journaux de runs, et index de l'historique (export du fil). */
  runsDir: string;
  historyIndex(): unknown;
  secretValues(): Promise<string[]>;
  /** Conteneurs gérés (liste du démon, sans le conteneur du serveur). */
  containers(): Promise<ContainerItem[]>;
  /** Liaison d'un conteneur au projet actif (même opération que le cockpit). */
  cockpit: Pick<CockpitBackend, "link">;
  terminals(tailChars: number): Promise<TerminalSnapshot[]>;
  /** Cadres de chat vivants. */
  frames(): Iterable<ChatFrame>;
  /** Réglages modifiés : diffusion à la coquille. */
  settingsChanged(values: Record<string, unknown>): void;
  now?(): Date;
}

/** Plafond de noms conservés par proposition de liaison. */
const MAX_PROPOSED = 20;
/** Plafond d'un texte d'export brut (déjà borné par le validateur du chat). */
const CONTROL_FREE = (s: string) => !hasControl(s);

type LinkProposal = { projectId: string; names: Set<string> };

export class ChatExtras {
  private readonly proposed = new Map<string, LinkProposal>();
  private readonly picking = new Set<string>();
  private capabilityWrite: Promise<void> = Promise.resolve();

  constructor(private readonly deps: ChatExtrasDeps) {}

  // -------------------------------------------------------------------------------------------
  // Projet actif, conteneurs, terminaux
  // -------------------------------------------------------------------------------------------

  private async activeProject(): Promise<StoredProject | null> {
    const file = await readProjects(this.deps.configDir).catch(() => null);
    return file === null ? null : activeProject(file);
  }

  /** Noms courts pour le menu `@`. Échec de lecture : liste vide (le menu n'invente rien). */
  async containersMessage(): Promise<Record<string, unknown>> {
    try {
      const [items, project] = await Promise.all([this.deps.containers(), this.activeProject()]);
      return {
        type: "containers",
        items: containerMentions(items.map((c) => ({ name: c.name, state: c.state }))),
        linkedCount: items.filter((c) => project?.containers.includes(c.name) === true).length,
      };
    } catch {
      return { type: "containers", items: [] };
    }
  }

  /** Terminaux ouverts avec leur jeton `#` (`nom`, `nom-2`…) et leur sortie lisible, déjà masquée. */
  private async terminalList(): Promise<
    { token: string; label: string; container: string; text: string }[]
  > {
    const snapshots = await this.deps.terminals(TERMINAL_TAIL_CHARS * 4).catch(() => []);
    const counts = new Map<string, number>();
    const out: { token: string; label: string; container: string; text: string }[] = [];
    for (const s of snapshots) {
      const index = (counts.get(s.container) ?? 0) + 1;
      counts.set(s.container, index);
      const label = shortContainerName(s.container);
      const token = shellToken(label, index);
      if (token === null) continue;
      out.push({
        token,
        label,
        container: s.container,
        text: readableTerminal(s.raw, TERMINAL_TAIL_CHARS),
      });
    }
    return out;
  }

  /** Message `terminals` du menu `#` : jeton, libellé, dernière commande (ou « session n »). */
  async terminalsMessage(): Promise<Record<string, unknown>> {
    const perContainer = new Map<string, number>();
    const items = (await this.terminalList()).map((term) => {
      const n = (perContainer.get(term.container) ?? 0) + 1;
      perContainer.set(term.container, n);
      return {
        token: term.token,
        label: term.label,
        hint: lastCommand(term.text) || `session ${n}`,
      };
    });
    return { type: "terminals", items };
  }

  /** `ready` d'un cadre : conteneurs et terminaux (même ordre que l'extension). */
  async ready(frame: ChatFrame, to: Sink): Promise<void> {
    to.send("chat", frame.id, await this.containersMessage());
    to.send("chat", frame.id, await this.terminalsMessage());
  }

  // -------------------------------------------------------------------------------------------
  // Envoi : propositions de liaison (`@`) et contexte des terminaux (`#`)
  // -------------------------------------------------------------------------------------------

  /**
   * Avant un envoi : propose la liaison des conteneurs cités par `@` et pas encore liés au projet actif
   * (une mention ne donne jamais une permission), puis renvoie les extraits des terminaux ouverts cités
   * par `#`. Un `#` inconnu est ignoré. Rien n'est ouvert ni créé.
   */
  async beforeSend(
    frame: ChatFrame,
    text: string,
    to: Sink,
  ): Promise<{ token: string; container: string; text: string }[]> {
    this.proposed.delete(frame.id);
    to.send("chat", frame.id, { type: "containerLinks", items: [] });
    const project = await this.activeProject();
    if (project !== null && parseMentions(promptForTargets(text)).length > 0) {
      const rows = await this.deps.containers().catch(() => [] as ContainerItem[]);
      const names = unlinkedContainerMentions(text, rows, project.containers).slice(
        0,
        MAX_PROPOSED,
      );
      this.proposed.set(frame.id, { projectId: project.id, names: new Set(names) });
      to.send("chat", frame.id, {
        type: "containerLinks",
        items: names.map((name) => ({
          name,
          message: formatReason({ code: "exegol.containerDenied", params: { name, unlinked: 1 } }),
        })),
      });
    }
    const hashes = parseHashes(text);
    if (hashes.length === 0) return [];
    const open = await this.terminalList();
    const { open: wanted } = classifyMessageHashes(
      hashes,
      (token) => open.some((term) => term.token === token),
      [],
    );
    return wanted.flatMap((token) => {
      const term = open.find((entry) => entry.token === token);
      return term === undefined ? [] : [{ token, container: term.container, text: term.text }];
    });
  }

  /** Consigne affichée, puis extraits des terminaux cités (voir `withTerminalContext`). */
  withContext(
    text: string,
    sections: { token: string; container: string; text: string }[],
  ): string {
    return withTerminalContext(text, sections);
  }

  // -------------------------------------------------------------------------------------------
  // Pièces jointes par dialogue
  // -------------------------------------------------------------------------------------------

  /**
   * Dialogue de téléversement chez l'émetteur, puis `attachmentPicked {requestId, attachment}` (texte ou
   * image validés) ou `attachmentRefused {requestId, reason}`. Un seul dialogue à la fois par cadre.
   */
  async attachPick(frame: ChatFrame, requestId: string, to: Sink): Promise<boolean> {
    if (this.picking.has(frame.id)) return false;
    this.picking.add(frame.id);
    try {
      const result = await pickAttachment(this.deps.ctx, to);
      to.send(
        "chat",
        frame.id,
        result.ok
          ? { type: "attachmentPicked", requestId, attachment: result.attachment }
          : { type: "attachmentRefused", requestId, reason: result.reason },
      );
      return true;
    } finally {
      this.picking.delete(frame.id);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Messages de chat
  // -------------------------------------------------------------------------------------------

  /**
   * Traite un message déjà validé (`parseWebviewMessage`). `false` : sans suite possible (ignoré et compté
   * par l'appelant) ; `true` : accepté, avec ou sans effet.
   */
  async handle(frame: ChatFrame, message: WebviewMessage, from: Sink): Promise<boolean> {
    const s = frame.session;
    switch (message.type) {
      case "addProvider":
      case "openSystem":
        // L'ouverture de « Fournisseurs » est faite par la coquille : rien à faire côté serveur.
        return true;
      case "openCockpit":
        return this.open(from, openWindowMessage("cockpit"));
      case "openKillchain":
        return this.open(from, openWindowMessage("killchain"));
      case "openMonitor":
        return this.open(from, openWindowMessage("viewer", frame.id, { mode: "monitor" }));
      case "watch":
        return CONTROL_FREE(message.toolUseId)
          ? this.open(
              from,
              openWindowMessage("viewer", frame.id, {
                mode: "watch",
                toolUseId: message.toolUseId,
              }),
            )
          : false;
      case "refreshTerminals":
        from.send("chat", frame.id, await this.terminalsMessage());
        return true;
      case "timelineExchange":
        await s.timelineExchange(message.direction, message.id, message.source);
        return true;
      case "setProvider": {
        const entry = providerChoices(this.settings()).find((p) => p.backend === message.provider);
        if (entry) await s.selectProvider(entry.id);
        return true;
      }
      case "setCapability":
        return this.setCapability(frame, message.toggle, from);
      case "mentionQuery":
        return this.mentionQuery(frame, message.query, from);
      case "mentionAttach":
        return this.mentionAttach(frame, message, from);
      case "linkMention":
        return this.linkMention(frame, message.name, from);
      case "ignoreLinkMention": {
        this.proposed.get(frame.id)?.names.delete(message.name);
        this.sendLinks(frame, from);
        return true;
      }
      case "exportChat":
        return this.exportChat(frame, from);
      case "exportText":
        return this.exportText(frame, message.text, from);
      default:
        return false;
    }
  }

  private open(to: Sink, message: OpenWindowMessage): boolean {
    to.send("shell", "shell", { ...message });
    return true;
  }

  private settings() {
    return readChatSettings(this.deps.ctx.storage);
  }

  // -------------------------------------------------------------------------------------------
  // Capacités (skills, MCP, Burp, recherche web)
  // -------------------------------------------------------------------------------------------

  /**
   * Bascule d'une capacité du chat, comme l'extension : écriture de l'ajout ou du retrait dans `chat.*`, puis
   * sélection de la conversation. Refus (`capabilityState.error`) : session occupée, en lecture seule, plafond
   * de connecteurs, ou serveur MCP / Burp non configuré (la configuration MCP complète est celle de la vue
   * studio). Reflet à la vue par `capabilityState` et par la vue du chat (`capabilities.selection`).
   */
  private setCapability(
    frame: ChatFrame,
    toggle: Extract<WebviewMessage, { type: "setCapability" }>["toggle"],
    from: Sink,
  ): Promise<boolean> {
    const run = this.capabilityWrite.then(async () => {
      const state = (error: boolean) =>
        from.send("chat", frame.id, {
          type: "capabilityState",
          kind: toggle.kind,
          ...(toggle.id !== undefined && { id: toggle.id }),
          enabled: toggle.enabled,
          error,
        });
      try {
        const view = frame.session.view();
        const current = view.capabilities?.selection;
        if (view.busy || view.readonly || !current) return state(true);
        const settings = this.settings();
        const caps = settings.capabilities;
        if (!caps) return state(true);
        if (toggle.enabled) {
          if (
            toggle.kind === "integration" &&
            !settings.integrations?.some((m) => m.id === toggle.id)
          )
            return state(true);
          if (toggle.kind === "burp" && !settings.burp) return state(true);
        }
        const outcome = applyCapabilityToggle(caps, current, toggle);
        if (!outcome) return state(true);
        if (outcome.writes.length > 0) {
          const patch = Object.fromEntries(outcome.writes.map((w) => [w.key, w.value]));
          const values = applySettingsPatch(this.deps.ctx.storage, patch);
          if (values === null) return state(true);
          this.deps.ctx.audit({ kind: "settings.set", keys: Object.keys(patch) });
          this.deps.settingsChanged(values);
        }
        frame.session.setSelection(outcome.selection);
        // Les autres conversations se recalent sur les capacités désormais autorisées.
        for (const other of this.deps.frames())
          if (other.id !== frame.id)
            other.session.setSelection(other.session.view().capabilities?.selection);
        state(false);
      } catch {
        state(true);
      }
    });
    this.capabilityWrite = run;
    return run.then(() => true);
  }

  // -------------------------------------------------------------------------------------------
  // Mentions
  // -------------------------------------------------------------------------------------------

  /** Racine des mentions `@` : dossier du projet actif, sous la racine projets du serveur. */
  private async root(): Promise<{ root: string | null; project: StoredProject | null }> {
    const project = await this.activeProject();
    if (project === null) return { root: null, project };
    return { root: await mentionRoot(project.workspace, this.deps.projectsRoot), project };
  }

  /** Notes Kill Chain du projet actif, pour `@killchain` ; sans projet ou sans note : indisponible. */
  private async findings(
    project: StoredProject | null,
  ): Promise<{ ok: true; findings: Finding[] } | { ok: false; why: "no-project" | "empty" }> {
    if (project === null) return { ok: false, why: "no-project" };
    try {
      const findings = await readFindings(this.deps.configDir, project.id);
      return findings.length > 0 ? { ok: true, findings } : { ok: false, why: "empty" };
    } catch {
      return { ok: false, why: "empty" };
    }
  }

  private async mentionQuery(frame: ChatFrame, query: string, from: Sink): Promise<boolean> {
    const { root, project } = await this.root();
    const files = root === null ? [] : await listProjectFiles(root, query);
    const findings = await this.findings(project);
    from.send("chat", frame.id, {
      type: "mentionResults",
      query,
      files,
      killchain: findings.ok ? { available: true } : { available: false, why: findings.why },
      sortie: lastToolOutput(frame.session.view().items).ok
        ? { available: true }
        : { available: false, why: "empty" },
    });
    return true;
  }

  private async mentionAttach(
    frame: ChatFrame,
    message: Extract<WebviewMessage, { type: "mentionAttach" }>,
    from: Sink,
  ): Promise<boolean> {
    const refuse = (reason: string) =>
      from.send("chat", frame.id, { type: "mentionRefused", requestId: message.requestId, reason });
    let resolved:
      | ReturnType<typeof lastToolOutput>
      | Awaited<ReturnType<typeof resolveProjectFile>>;
    if (message.kind === "file") {
      const { root } = await this.root();
      if (root === null) return refuse("path"), true;
      resolved = await resolveProjectFile(root, message.path);
    } else if (message.kind === "sortie") {
      resolved = lastToolOutput(frame.session.view().items);
    } else {
      const found = await this.findings((await this.root()).project);
      resolved = found.ok ? killchainSummary(found.findings) : { ok: false, reason: "empty" };
    }
    if (!resolved.ok) return refuse(resolved.reason), true;
    from.send("chat", frame.id, {
      type: "mentionAttached",
      requestId: message.requestId,
      kind: message.kind,
      name: resolved.attachment.name,
      text: resolved.attachment.text,
    });
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Liaison conteneur ↔ projet (ADR 0047)
  // -------------------------------------------------------------------------------------------

  private sendLinks(frame: ChatFrame, to: Sink): void {
    to.send("chat", frame.id, {
      type: "containerLinks",
      items: [...(this.proposed.get(frame.id)?.names ?? [])].map((name) => ({ name })),
    });
  }

  /**
   * Liaison proposée par une mention. Même contrôle que l'extension : le nom doit figurer dans la proposition
   * faite pour le projet lu à l'envoi, qui doit rester le projet actif ; en plus, le conteneur doit toujours
   * être géré, et un humain confirme (`ui.confirm`) : sans réponse affirmative, rien n'est lié.
   */
  private async linkMention(frame: ChatFrame, name: string, from: Sink): Promise<boolean> {
    const proposal = this.proposed.get(frame.id);
    const project = await this.activeProject();
    if (!proposal?.names.has(name) || project === null || project.id !== proposal.projectId)
      return false;
    const managed = await this.deps.containers().catch(() => [] as ContainerItem[]);
    if (!managed.some((c) => c.name === name)) {
      proposal.names.delete(name);
      this.sendLinks(frame, from);
      return true;
    }
    const accepted = await this.deps.ctx.ui.confirm(
      {
        title: t("Lier le conteneur au projet"),
        text: t`Autoriser l'agent à utiliser le conteneur « ${name} » pour le projet « ${project.name} » ? Les outils de l'agent pourront y exécuter des commandes (chaque commande reste soumise à la gate).`,
      },
      from,
    );
    if (!accepted) return true;
    // La confirmation est humaine et peut être longue : proposition et projet sont revérifiés.
    const again = await this.activeProject();
    if (
      this.proposed.get(frame.id) !== proposal ||
      !proposal.names.has(name) ||
      again?.id !== proposal.projectId
    )
      return true;
    try {
      await this.deps.cockpit.link(name);
    } catch (error) {
      from.send("chat", frame.id, { type: "error", code: errorInfo(error).code });
      return true;
    }
    this.deps.ctx.audit({
      kind: "container.link",
      container: name,
      project: project.id,
      via: "chat",
    });
    proposal.names.delete(name);
    this.sendLinks(frame, from);
    const message = await this.containersMessage();
    for (const other of this.deps.frames())
      for (const sink of other.subs) sink.send("chat", other.id, message);
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Exports
  // -------------------------------------------------------------------------------------------

  private exportDeps(): ChatExportDeps {
    return {
      configDir: this.deps.configDir,
      runsDir: this.deps.runsDir,
      historyIndex: () => this.deps.historyIndex(),
      secretValues: () => this.deps.secretValues(),
    };
  }

  /** Fil de la conversation affichée en Markdown, offert en téléchargement à l'émetteur. */
  private async exportChat(frame: ChatFrame, from: Sink): Promise<boolean> {
    const view: Pick<ChatView, "readonly" | "history"> = frame.session.view();
    try {
      const file = await buildChatExport(this.exportDeps(), view);
      const id = await this.deps.ctx.downloads.offer({
        filename: file.filename,
        mime: "text/markdown",
        body: Buffer.from(file.markdown, "utf8"),
        to: from,
      });
      if (id === null) throw new ChatExportError("view.failed");
      this.deps.ctx.audit({ kind: "chat.export", frame: frame.id });
    } catch (error) {
      from.send("chat", frame.id, {
        type: "error",
        code: error instanceof ChatExportError ? error.code : "view.failed",
      });
    }
    return true;
  }

  /** Texte brut (Monitor, Sortie) renvoyé par la page : remasqué, puis offert en téléchargement. */
  private async exportText(frame: ChatFrame, text: string, from: Sink): Promise<boolean> {
    try {
      const redact = createRedactor({
        values: [...secretsFromEnv(process.env), ...(await this.deps.secretValues())],
      });
      const stamp = (this.deps.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
      const id = await this.deps.ctx.downloads.offer({
        filename: `sortie-${stamp}.txt`,
        mime: "text/plain",
        body: Buffer.from(redact(text), "utf8"),
        to: from,
      });
      if (id === null) throw new ChatExportError("view.failed");
    } catch {
      from.send("chat", frame.id, { type: "error", code: "view.failed" });
    }
    return true;
  }
}
