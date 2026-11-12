/**
 * Vue `studio` (Projets et réglages), partie A : projets, fournisseurs et capacités, apparence.
 * Les contrôleurs de `logic/` sont réutilisés tels quels ; l'état vit sur le disque du serveur (dossier de
 * configuration du cœur) et dans l'état serveur (`settings`). Chaque dialogue de l'extension (saisie, choix,
 * modale) passe par `HostUi` : sans réponse humaine, rien n'est fait.
 *
 * Gestes de l'extension sans équivalent web, ignorés et comptés par le canal : ouverture d'un dossier, terminal
 * d'éditeur, explorateur (`openWorkspace`, `prepareMission`, `openCours`). Gestes de la partie B (Burp,
 * intégrations, audit, comptes de test, exports, preuves, trouvailles) : non branchés ici, donc ignorés aussi.
 *
 * Invariants : le dossier d'un projet reste sous `<données>/projects` (aucun chemin hôte libre) ; les secrets
 * saisis vont au coffre et ne figurent ni dans un message, ni dans l'audit ; la politique du dépôt n'est
 * approuvée qu'après confirmation humaine affichant son empreinte.
 */
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  activeProject,
  agentProfileLabel,
  CodedError,
  MCP_CATALOG,
  type ProviderOption,
  readFindings,
  readProjects,
} from "@warband/core";
import { formatError, getUiLocale, setUiLocale, t } from "@warband/messages";
import { cleanText } from "@warband/vscode/logic/approval";
import { capabilitySettings, providerChoices } from "@warband/vscode/logic/chat-capabilities";
import type { CockpitViewPayload } from "@warband/vscode/logic/cockpit";
import type {
  EngineAuth,
  EngineController,
  EngineHandlers,
} from "@warband/vscode/logic/controller";
import { ModelProbeError } from "@warband/vscode/logic/model-load-error";
import { paletteOf } from "@warband/vscode/logic/palette";
import {
  activateSelectedProject,
  createManagedSelectedProject,
  manageSelectedProject,
  readProjectChoices,
} from "@warband/vscode/logic/project-controls";
import { readProjectSummary, saveProjectSummary } from "@warband/vscode/logic/project-summary";
import { probeProviderConnection } from "@warband/vscode/logic/provider-connection";
import {
  repoPolicyPath,
  repoPolicyState,
  trustRepoPolicy,
} from "@warband/vscode/logic/repo-policy";
import type { TokenChoice } from "@warband/vscode/logic/session";
import { type ChatSettings, resolveSettings } from "@warband/vscode/logic/settings";
import {
  parseStudioMessage,
  type StudioMessage,
  type StudioPage,
} from "@warband/vscode/logic/studio";
import { terminalPromptOf } from "@warband/vscode/logic/terminal-prompt";
import {
  addPoolKey,
  applySettingsPatch,
  listTokens,
  readSettingsObject,
  setToken,
} from "./config.js";
import { SETTINGS_KEY } from "./deps.js";
import type { BridgeContext } from "./hostui.js";
import type { Sink } from "./hub.js";
import { hasControl } from "./layout.js";
import { isPoolProvider, MAX_POOL_KEYS, type PoolProvider } from "./rotation.js";
import {
  MAX_SECRET,
  type OpenWindowView,
  openWindowMessage,
  type TokenKindName,
  type TokenProvider,
} from "./shell-messages.js";

/** Clés d'état propres au studio (hors `settings`, donc hors de portée de `settingsSet`). */
export const WORKSPACE_ROOT_KEY = "studio.workspaceRoot";
export const PROVIDER_CATALOG_KEY = "studio.providerCatalog";

/** Plafond de fournisseurs retenus du catalogue et d'octets de l'extrait de politique affiché. */
const MAX_CATALOG = 200;
const POLICY_EXCERPT = 1200;
const CONFIRM_MAX = 1990;

/** Ce que le studio demande au hub (effets de bord hors de la vue). */
export interface StudioHooks {
  /** Projet actif ou liste modifiés : Bypass coupé (sauf renommage), vues reconstruites, comptes de test relus. */
  projectChanged(opts: { resetBypass: boolean }): Promise<void>;
  /** Réglages modifiés : diffusion `settings {values}` à la coquille. */
  settingsChanged(values: Record<string, unknown>): void;
  /** Jeton enregistré : sessions informées, liste `tokens` diffusée (jamais de valeur). */
  tokensChanged(): Promise<void>;
  /** Réserve de clés modifiée (déjà écrite) : diffusion et sessions informées. */
  poolChanged(provider: PoolProvider): void;
  /** Activation des fournisseurs modifiée : sélections des chats recalculées. */
  capabilitiesChanged(): void;
}

export interface StudioDeps {
  configDir: string;
  ctx: BridgeContext;
  /** Racine des dossiers de projets (`<données>/projects`) : seule racine admise. */
  projectsRoot: string;
  /** Dossier de travail du moteur pour les sondages. */
  cwd: string;
  /** Des tours de chat tournent : aucune modification de projet. */
  busy(): boolean;
  /** Conteneurs affichés (pages Projet et Conteneurs) ; absent : indisponible. */
  containers?(): Promise<CockpitViewPayload>;
  getToken(provider: "claude" | "openai" | "opencode"): Promise<TokenChoice | undefined>;
  /** Moteur de sondage (catalogue, test de connexion). */
  controller(
    auth: EngineAuth | undefined,
    handlers: EngineHandlers,
  ): Pick<EngineController, "models" | "kill">;
  hooks: StudioHooks;
}

type CatalogStatus = "idle" | "loading" | "ready" | "unavailable";

interface Feedback {
  summarySaved?: string;
  summaryFailed?: string;
  summaryError?: string;
  projectError?: string;
  workspaceRootError?: string;
  projectCreated?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isProviderOption = (v: unknown): v is ProviderOption =>
  isRecord(v) &&
  typeof v.id === "string" &&
  v.id.length >= 1 &&
  v.id.length <= 100 &&
  typeof v.name === "string" &&
  v.name.length <= 200;

export class StudioHost {
  private readonly subs = new Map<Sink, { frame: string; page: StudioPage }>();
  private changing = false;
  private catalogStatus: CatalogStatus = "idle";
  private catalogError: string | undefined;
  private catalogRequest: Promise<void> | undefined;
  private capabilityWrite: Promise<void> = Promise.resolve();
  private readonly connectionTests = new Set<string>();
  private disposed = false;

  constructor(private readonly deps: StudioDeps) {}

  unsubscribe(sink: Sink): void {
    this.subs.delete(sink);
  }

  dispose(): void {
    this.disposed = true;
    this.subs.clear();
  }

  private get storage() {
    return this.deps.ctx.storage;
  }

  private locale(): "fr" | "en" {
    return readSettingsObject(this.storage).locale === "en" ? "en" : "fr";
  }

  /** Langue de l'interface au démarrage du hub : celle de l'état serveur. */
  applyLocale(): void {
    setUiLocale(this.locale());
  }

  private emit(sink: Sink, msg: Record<string, unknown>): void {
    const sub = this.subs.get(sink);
    if (sub !== undefined) sink.send("studio", sub.frame, msg);
  }

  private emitAll(msg: Record<string, unknown>): void {
    for (const sink of this.subs.keys()) this.emit(sink, msg);
  }

  /**
   * Message de la vue `studio`. `ready` abonne le destinataire au cadre annoncé et lui envoie l'état ;
   * le reste exige cet abonnement et le même cadre. `false` : invalide, sans équivalent, ou non abonné.
   */
  async handle(frame: string, msg: Record<string, unknown>, sink: Sink): Promise<boolean> {
    if (this.disposed) return false;
    const m = parseStudioMessage(msg);
    if (m === null) return false;
    if (m.type === "ready") {
      this.subs.set(sink, { frame, page: "project" });
      await this.push({ only: sink });
      return true;
    }
    const sub = this.subs.get(sink);
    if (sub === undefined || sub.frame !== frame) return false;
    switch (m.type) {
      case "rendered":
        return true;
      case "refresh":
        await this.push({ only: sink });
        return true;
      case "open":
        if (m.page === "killchain") return this.openWindow(sink, "killchain");
        sub.page = m.page;
        await this.push({ only: sink });
        return true;
      case "openCockpit":
        return this.openWindow(sink, "cockpit");
      case "openProgram":
        return this.openWindow(sink, "program");
      case "openEngagement":
        return this.openWindow(sink, "engagement");
      case "openKillchain":
        return this.openWindow(sink, "killchain");
      case "createProject":
      case "activateProject":
        return this.selectProject(m, sink);
      case "renameProject":
      case "deleteProject":
      case "unlink":
        return this.manageProject(m, sink);
      case "setWorkspaceRoot":
        return this.setWorkspaceRoot(m.value, sink);
      case "saveSummary":
        return this.saveSummary(m.projectId, m.text, sink);
      case "setCapability":
        return this.setCapability(m.id, m.enabled, sink);
      case "refreshProviderCatalog":
        void this.loadCatalog(true);
        await this.push({ only: sink });
        return true;
      case "configureProvider":
        return this.configureProvider(m.id, sink);
      case "testProviderConnection":
        return this.testConnection(m.id, sink);
      case "setLocale":
        return this.setLocale(m.locale, sink);
      case "setPalette":
        return this.setAppearance("palette", m.palette, sink);
      case "setTerminalPrompt":
        return this.setAppearance("terminalPrompt", m.value, sink);
      case "trustRepoPolicy":
        return this.trustPolicy(sink);
      default:
        // Partie B (Burp, intégrations, audit, comptes de test, exports, preuves…) et gestes d'éditeur.
        return false;
    }
  }

  private openWindow(sink: Sink, view: OpenWindowView): boolean {
    sink.send("shell", "shell", { ...openWindowMessage(view) });
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // État affiché
  // -------------------------------------------------------------------------------------------

  private readSettings(): ChatSettings {
    const raw = this.storage.state.get(SETTINGS_KEY);
    const get = (key: string): unknown => (isRecord(raw) ? raw[key] : undefined);
    let settings: ChatSettings = {};
    try {
      settings = resolveSettings(get);
    } catch (error) {
      if (!(error instanceof CodedError)) throw error;
    }
    const stored = this.storage.state.get(PROVIDER_CATALOG_KEY);
    const providerCatalog = Array.isArray(stored) ? stored.filter(isProviderOption) : [];
    return { capabilities: capabilitySettings(get), ...settings, providerCatalog };
  }

  /** Racine des projets : le réglage s'il reste sous la racine du serveur, sinon cette racine. */
  private workspaceRoot(): string {
    const stored = this.storage.state.get(WORKSPACE_ROOT_KEY);
    if (typeof stored === "string") {
      try {
        return this.checkRoot(stored);
      } catch {
        // Valeur altérée : retour à la racine du serveur.
      }
    }
    return resolve(this.deps.projectsRoot);
  }

  /** Chemin résolu, qui doit rester sous `<données>/projects` (lui-même admis). Sinon `path.outside`. */
  private checkRoot(value: string): string {
    const base = resolve(this.deps.projectsRoot);
    const resolved = resolve(base, value);
    const rel = relative(base, resolved);
    if (rel.startsWith("..") || isAbsolute(rel))
      throw new CodedError("path.outside", { path: cleanText(value, 200) });
    return resolved;
  }

  private async push(opts: { only?: Sink; feedback?: Feedback; feedbackTo?: Sink }): Promise<void> {
    const targets = opts.only !== undefined ? [opts.only] : [...this.subs.keys()];
    if (targets.length === 0) return;
    const config = this.deps.configDir;
    const locale = this.locale();
    const [choicesResult, summaryResult, findings, tokens] = await Promise.all([
      readProjectChoices(config).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      ),
      readProjectSummary(config).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      ),
      readProjects(config)
        .then(async (file) => {
          const active = file === null ? null : activeProject(file);
          return active === null ? [] : await readFindings(config, active.id);
        })
        .catch((): unknown[] => []),
      listTokens(this.storage),
    ]);
    let choices: Awaited<ReturnType<typeof readProjectChoices>> = { activeId: null, projects: [] };
    let projectError = opts.feedback?.projectError;
    if ("error" in choicesResult)
      projectError = t`Projets indisponibles : ${formatError(choicesResult.error, locale)}`;
    else choices = choicesResult.value;
    let projectSummary: Awaited<ReturnType<typeof readProjectSummary>> = null;
    let summaryError = opts.feedback?.summaryError;
    if ("error" in summaryResult)
      summaryError = t`Résumé indisponible : ${formatError(summaryResult.error, locale)}`;
    else projectSummary = summaryResult.value;
    const settings = this.readSettings();
    const raw = readSettingsObject(this.storage);
    const active = choices.projects.find((p) => p.id === choices.activeId);
    if (
      this.catalogStatus === "idle" &&
      targets.some((s) => this.subs.get(s)?.page === "providers")
    )
      void this.loadCatalog();

    for (const sink of targets) {
      const sub = this.subs.get(sink);
      if (sub === undefined) continue;
      const wantsDocker = sub.page === "project" || sub.page === "containers";
      let docker: { value?: CockpitViewPayload; failed: boolean } = { failed: !wantsDocker };
      if (wantsDocker && this.deps.containers !== undefined) {
        try {
          docker = { value: await this.deps.containers(), failed: false };
        } catch {
          docker = { failed: true };
        }
      } else if (wantsDocker) docker = { failed: true };
      const repoPolicy =
        sub.page === "project" && active !== undefined
          ? await repoPolicyState(active.workspace, config)
          : undefined;
      const own = opts.only === sink || opts.feedbackTo === sink;
      const feedback = own ? (opts.feedback ?? {}) : {};
      this.emit(sink, { type: "locale", locale });
      this.emit(sink, {
        ...(docker.value ?? { containers: [] }),
        type: "view",
        dockerLoading: false,
        dockerUnavailable: docker.failed,
        projectId: choices.activeId,
        page: sub.page,
        findings,
        sources: [],
        ...(repoPolicy !== undefined && { repoPolicy }),
        projectSummary,
        projectChoices: choices,
        capabilities: settings.capabilities,
        terminalPrompt: terminalPromptOf(raw.terminalPrompt),
        palette: paletteOf(raw.palette),
        providerCatalog: providerChoices(settings, false).map(
          ({ id, label, runtimeId, connected }) => ({
            id,
            label,
            ...(runtimeId && { runtimeId }),
            ...(connected !== undefined && { connected }),
          }),
        ),
        providerCatalogStatus: this.catalogStatus,
        providerCatalogError: this.catalogError,
        // Présence seule d'un jeton : jamais la valeur.
        providerAuth: {
          claude: tokens.find((x) => x.provider === "claude")?.present === true,
          openai: tokens.find((x) => x.provider === "openai")?.present === true,
        },
        limits: {
          maxTurns: settings.maxTurns ?? null,
          ultracodeMaxTurns: settings.ultracode?.maxTurns ?? null,
          ultracodeMaxBudgetUsd: settings.ultracode?.maxBudgetUsd ?? null,
        },
        mcpCatalog: MCP_CATALOG,
        mcpConfigured: settings.integrations ?? [],
        projectWorkspaceRoot: this.workspaceRoot(),
        agentProfile: agentProfileLabel(settings.profile),
        burpEnabled: raw["burp.enabled"] === true,
        burpStatus: "",
        projectBusy: this.changing || this.deps.busy(),
        ...feedback,
        ...(summaryError !== undefined && { summaryError }),
        ...(projectError !== undefined && { projectError }),
      });
    }
  }

  // -------------------------------------------------------------------------------------------
  // Projets
  // -------------------------------------------------------------------------------------------

  private async busyRefusal(sink: Sink, text: string): Promise<boolean> {
    await this.push({ only: sink, feedback: { projectError: text } });
    return true;
  }

  /** Création ou activation : jamais pendant des tours de chat ; Bypass coupé ; vues reconstruites. */
  private async selectProject(
    m: Extract<StudioMessage, { type: "createProject" | "activateProject" }>,
    sink: Sink,
  ): Promise<boolean> {
    if (this.changing || this.deps.busy())
      return this.busyRefusal(sink, t("Arrêtez les tours en cours avant de changer de projet."));
    this.changing = true;
    let created: string | undefined;
    let projectError: string | undefined;
    let selected = false;
    try {
      if (m.type === "activateProject") {
        await activateSelectedProject(this.deps.configDir, m.projectId);
        // La politique du dépôt n'est pas touchée : elle reste à approuver (`trustRepoPolicy`).
        this.deps.ctx.audit({ kind: "project.activate", id: m.projectId });
      } else {
        const project = await createManagedSelectedProject(
          this.deps.configDir,
          m.name,
          this.workspaceRoot(),
        );
        created = project.id;
        this.deps.ctx.audit({ kind: "project.create", id: project.id });
      }
      selected = true;
      await this.deps.hooks.projectChanged({ resetBypass: true });
    } catch (error) {
      projectError = formatError(error, this.locale());
    } finally {
      this.changing = false;
    }
    await this.push({
      feedbackTo: sink,
      feedback: {
        ...(created !== undefined && { projectCreated: created }),
        ...(projectError !== undefined && { projectError }),
      },
    });
    return selected || projectError !== undefined;
  }

  /** Renommage, retrait ou déliaison : dialogue HostUi adressé à l'émetteur ; sans réponse, inchangé. */
  private async manageProject(
    m: Extract<StudioMessage, { type: "renameProject" | "deleteProject" | "unlink" }>,
    sink: Sink,
  ): Promise<boolean> {
    if (this.changing || this.deps.busy())
      return this.busyRefusal(sink, t("Arrêtez les tours en cours avant de modifier un projet."));
    this.changing = true;
    let projectError: string | undefined;
    let changed = false;
    try {
      const projectId =
        m.type === "unlink"
          ? (await readProjectChoices(this.deps.configDir)).activeId
          : m.projectId;
      if (projectId) {
        const rename = m.type === "renameProject";
        let invalidName = false;
        changed = await manageSelectedProject(
          this.deps.configDir,
          projectId,
          rename ? "rename" : "remove",
          {
            busy: () => this.deps.busy(),
            isCurrent: () => !this.disposed && this.subs.has(sink),
            rename: async (name) => {
              const value = await this.deps.ctx.ui.input(
                {
                  title: t`Renommer le projet`,
                  label: t(
                    "Le dossier, les conversations et les conteneurs gardent leur identité.",
                  ),
                  value: name,
                },
                sink,
              );
              if (value === null) return undefined;
              if (!value.trim() || value.trim().length > 80 || /[\p{Cc}\p{Cf}]/u.test(value)) {
                invalidName = true;
                return undefined;
              }
              return value;
            },
            confirmRemove: (name) =>
              this.deps.ctx.ui.confirm(
                {
                  title: t("Retirer le projet"),
                  text: t`Retirer le projet « ${cleanText(name, 80)} » ? Le dossier, les conteneurs, les journaux, les trouvailles et les notes restent sur le disque. Aucun autre projet ne sera activé automatiquement.`,
                  danger: true,
                },
                sink,
              ),
          },
        );
        if (invalidName)
          projectError = t("Saisissez un nom de 1 à 80 caractères, sans caractères de contrôle.");
        if (changed) {
          this.deps.ctx.audit({
            kind: rename ? "project.rename" : "project.remove",
            id: projectId,
          });
          await this.deps.hooks.projectChanged({ resetBypass: !rename });
        }
      }
    } catch (error) {
      projectError = formatError(error, this.locale());
    } finally {
      this.changing = false;
    }
    await this.push({
      feedbackTo: sink,
      feedback: projectError !== undefined ? { projectError } : {},
    });
    return true;
  }

  private async saveSummary(projectId: string, text: string, sink: Sink): Promise<boolean> {
    let feedback: Feedback;
    try {
      await saveProjectSummary(this.deps.configDir, projectId, text);
      feedback = { summarySaved: projectId };
    } catch (error) {
      feedback = {
        summaryFailed: projectId,
        summaryError: t`Résumé non enregistré : ${formatError(error, this.locale())}`,
      };
    }
    await this.push({ feedbackTo: sink, feedback });
    return true;
  }

  /** La racine reste sous `<données>/projects` : un chemin qui en sort est refusé, jamais enregistré. */
  private async setWorkspaceRoot(value: string, sink: Sink): Promise<boolean> {
    let feedback: Feedback = {};
    try {
      const resolved = this.checkRoot(value);
      this.storage.state.set(
        WORKSPACE_ROOT_KEY,
        resolved === resolve(this.deps.projectsRoot) ? undefined : resolved,
      );
      this.deps.ctx.audit({ kind: "studio.workspaceRoot" });
    } catch (error) {
      feedback = { workspaceRootError: formatError(error, this.locale()) };
    }
    await this.push({ feedbackTo: sink, feedback });
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Fournisseurs
  // -------------------------------------------------------------------------------------------

  /** Seule l'activation des fournisseurs se règle ici, comme dans l'extension. */
  private setCapability(id: string, enabled: boolean, sink: Sink): Promise<boolean> {
    const run = this.capabilityWrite.then(async () => {
      const state = (error: boolean) =>
        this.emit(sink, { type: "capabilityState", id, enabled, error });
      try {
        const settings = this.readSettings();
        if (!providerChoices(settings, false).some((p) => p.id === id)) {
          state(true);
          return;
        }
        const list = settings.capabilities?.providers ?? [];
        const values = applySettingsPatch(this.storage, {
          "chat.providers": enabled
            ? [...new Set([...list, id])]
            : list.filter((entry) => entry !== id),
        });
        if (values === null) {
          state(true);
          return;
        }
        this.deps.ctx.audit({ kind: "settings.set", keys: ["chat.providers"] });
        this.deps.hooks.settingsChanged(values);
        state(false);
        this.deps.hooks.capabilitiesChanged();
        await this.push({});
      } catch {
        state(true);
      }
    });
    this.capabilityWrite = run;
    return run.then(() => true);
  }

  private loadCatalog(force = false): Promise<void> {
    if (this.catalogRequest) return this.catalogRequest;
    if (!force && this.catalogStatus !== "idle") return Promise.resolve();
    this.catalogStatus = "loading";
    this.catalogError = undefined;
    this.catalogRequest = (async () => {
      let catalog: ProviderOption[] | undefined;
      const probe = this.deps.controller(undefined, {
        onProviders: (providers) => {
          catalog = providers;
        },
      });
      try {
        await probe.models({
          cwd: this.deps.cwd,
          provider: "opencode",
          auth: "auto",
          opencodeProviders: this.readSettings().opencodeProviders ?? {},
          timeoutMs: 45000,
        });
        if (catalog !== undefined)
          this.storage.state.set(
            PROVIDER_CATALOG_KEY,
            catalog.filter(isProviderOption).slice(0, MAX_CATALOG),
          );
        this.catalogStatus = "ready";
      } catch (error) {
        this.catalogStatus = "unavailable";
        this.catalogError = cleanText(formatError(error, this.locale()), 1000);
      } finally {
        probe.kill();
        this.catalogRequest = undefined;
        this.deps.hooks.capabilitiesChanged();
        if (!this.disposed) void this.push({});
      }
    })();
    return this.catalogRequest;
  }

  /**
   * Clé d'un fournisseur : choix du type puis saisie masquée (HostUi). La valeur va au coffre (jeton ou
   * réserve de clés) par les opérations de `config.ts` ; elle ne figure dans aucun message ni audit.
   */
  private async configureProvider(id: string, sink: Sink): Promise<boolean> {
    const entry = providerChoices(this.readSettings(), false).find((p) => p.id === id);
    if (entry === undefined) return false;
    let kind: TokenKindName = "api-key";
    if (entry.backend === "claude") {
      const picked = await this.deps.ctx.ui.pick(
        {
          title: t`Connexion de ${entry.label}`,
          items: [
            { id: "api-key", label: t("Clé API") },
            {
              id: "subscription",
              label: t("Jeton d'abonnement"),
              detail: t("Généré par « claude setup-token »."),
            },
          ],
        },
        sink,
      );
      if (picked !== "api-key" && picked !== "subscription") return true;
      kind = picked;
    }
    const value = await this.deps.ctx.ui.input(
      { title: t`Clé de ${entry.label}`, label: t("Clé API"), secret: true },
      sink,
    );
    if (value === null) return true;
    const key = value.trim();
    if (key.length < 1 || key.length > MAX_SECRET || /\s/.test(key) || hasControl(key)) return true;
    if (entry.backend === "claude" || entry.backend === "openai") {
      const provider: TokenProvider = entry.backend;
      await setToken(this.storage, provider, kind, key);
      this.deps.ctx.audit({ kind: "token.set", provider });
      await this.deps.hooks.tokensChanged();
    } else if (isPoolProvider(entry.backend)) {
      const label = cleanText(entry.label, 40).trim() || entry.backend;
      const poolId = await addPoolKey(this.storage, entry.backend, label, key, Date.now());
      if (poolId === null) {
        await this.push({
          feedbackTo: sink,
          feedback: { projectError: t`Réserve de clés pleine (${MAX_POOL_KEYS} au plus).` },
        });
        return true;
      }
      this.deps.ctx.audit({ kind: "pool.add", provider: entry.backend, id: poolId, label });
      this.deps.hooks.poolChanged(entry.backend);
    }
    await this.push({});
    return true;
  }

  private async testConnection(id: string, sink: Sink): Promise<boolean> {
    if (this.connectionTests.has(id)) return false;
    this.connectionTests.add(id);
    const post = (pending: boolean, text?: string, error = false) =>
      this.emit(sink, { type: "providerConnectionResult", id, pending, text, error });
    try {
      post(true);
      const result = await probeProviderConnection(id, {
        settings: this.readSettings(),
        cwd: this.deps.cwd,
        getToken: (provider) => this.deps.getToken(provider as "claude" | "openai" | "opencode"),
        create: (auth, handlers) => this.deps.controller(auth, handlers),
      });
      const declared =
        result.connected === null
          ? t("Statut de connexion non annoncé.")
          : result.connected
            ? t("Connexion déclarée par le fournisseur.")
            : t("Connexion non déclarée par le fournisseur.");
      post(
        false,
        [
          t`Catalogue accessible : ${result.models} modèle(s).`,
          declared,
          t("Aucune génération testée."),
        ].join("\n"),
      );
    } catch (error) {
      post(
        false,
        cleanText(
          formatError(error instanceof ModelProbeError ? error.reason : error, this.locale()),
          8000,
        ),
        true,
      );
    } finally {
      this.connectionTests.delete(id);
    }
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Apparence
  // -------------------------------------------------------------------------------------------

  private async setLocale(locale: "fr" | "en", sink: Sink): Promise<boolean> {
    const values = applySettingsPatch(this.storage, { locale });
    if (values === null) {
      this.emit(sink, { type: "locale", locale: this.locale() });
      return true;
    }
    setUiLocale(locale);
    this.deps.ctx.audit({ kind: "settings.set", keys: ["locale"] });
    this.deps.hooks.settingsChanged(values);
    this.emitAll({ type: "locale", locale: getUiLocale() });
    await this.push({});
    return true;
  }

  private async setAppearance(
    key: "palette" | "terminalPrompt",
    value: string,
    sink: Sink,
  ): Promise<boolean> {
    const values = applySettingsPatch(this.storage, { [key]: value });
    const current = (v: Record<string, unknown>) =>
      key === "palette" ? paletteOf(v.palette) : terminalPromptOf(v.terminalPrompt);
    if (values === null) {
      const now = current(readSettingsObject(this.storage));
      if (key === "palette") {
        this.emit(sink, { type: "palette", value: now });
        this.emit(sink, { type: "paletteError" });
      } else this.emit(sink, { type: "terminalPrompt", value: now, error: true });
      return true;
    }
    this.deps.ctx.audit({ kind: "settings.set", keys: [key] });
    this.deps.hooks.settingsChanged(values);
    this.emitAll({
      type: key === "palette" ? "palette" : "terminalPrompt",
      value: current(values),
    });
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Politique du dépôt
  // -------------------------------------------------------------------------------------------

  /**
   * Approbation de la politique du dépôt du projet actif, par un geste humain : modale HostUi qui affiche
   * l'empreinte et un extrait du fichier. Sans réponse, la politique n'est pas approuvée (invariant).
   */
  private async trustPolicy(sink: Sink): Promise<boolean> {
    const file = await readProjects(this.deps.configDir).catch(() => null);
    const active = file === null ? null : activeProject(file);
    let projectError: string | undefined;
    if (active === null) projectError = t("Aucun projet actif : pas de politique du dépôt.");
    else {
      try {
        const result = await trustRepoPolicy(active.workspace, {
          configDir: this.deps.configDir,
          // Le dossier appartient au serveur ; la modale humaine reste l'unique porte.
          isWorkspaceTrusted: () => true,
          show: async () => undefined,
          confirm: async (text) => {
            const excerpt = await readFile(repoPolicyPath(active.workspace), "utf8")
              .then((s) => cleanText(s, POLICY_EXCERPT))
              .catch(() => "");
            return this.deps.ctx.ui.confirm(
              {
                title: t("Approuver la politique du dépôt"),
                text: `${text}\n\n${excerpt}`.slice(0, CONFIRM_MAX),
              },
              sink,
            );
          },
        });
        switch (result.status) {
          case "absent":
            projectError = t("Aucune politique du dépôt (.warband/policy.json).");
            break;
          case "invalid":
            projectError = t`Politique du dépôt invalide, rien n'a été approuvé : ${cleanText(result.message, 300)}`;
            break;
          case "changed":
            projectError = t(
              "La politique a changé avant l'approbation : rien n'a été approuvé. Relisez-la.",
            );
            break;
          case "trusted":
            this.deps.ctx.audit({
              kind: "repoPolicy.trust",
              project: active.id,
              digest: result.digest,
            });
            break;
          default:
            break;
        }
      } catch (error) {
        projectError = t`Approbation impossible : ${formatError(error, this.locale())}`;
      }
    }
    await this.push({
      feedbackTo: sink,
      feedback: projectError !== undefined ? { projectError } : {},
    });
    return true;
  }
}
