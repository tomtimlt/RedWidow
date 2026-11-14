/**
 * Vue `studio`, partie B : Burp, intégrations MCP du projet, audit, comptes de test, cours et espace de
 * travail, fournisseur compatible OpenAI personnalisé, profil, diagnostic, liens du guide gratuit et gestes
 * de la Kill chain (réutilisés tels quels depuis `KillchainHost`, jamais dupliqués).
 *
 * Règles communes :
 * - chaque dialogue passe par `HostUi` (`ui.pick`, `ui.input`, `ui.confirm`, `ui.external`) adressé à
 *   l'émetteur du geste ; sans réponse humaine rien n'est écrit ;
 * - aucune adresse libre : Burp et les services MCP ne se joignent que sur `127.0.0.1` (port, transport et
 *   chemin validés) ; un fournisseur compatible OpenAI exige https (http seulement pour localhost et les
 *   hôtes internes autorisés par `REDWIDOW_PROVIDER_HTTP_HOSTS`) ;
 * - les secrets (clés) vont au coffre ; aucun n'apparaît dans un message, un audit ou une sortie.
 */
import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  AGENT_PROFILES,
  AuditStore,
  type AuditView,
  activeProject,
  type BurpBackend,
  CodedError,
  createRedactor,
  type IntegrationConfig,
  MCP_CATALOG,
  readProjects,
  type StoredProject,
  safeEnv,
  secretsFromEnv,
} from "@warband/core";
import { formatError, t } from "@warband/messages";
import { cleanText } from "@warband/vscode/logic/approval";
import { exportAuditBundle } from "@warband/vscode/logic/audit-export";
import { reviewAuditTest } from "@warband/vscode/logic/audit-review";
import { FREE_GUIDE_LINKS } from "@warband/vscode/logic/free-guide";
import { parseOpencodeProviders } from "@warband/vscode/logic/opencode-providers";
import { integrationMap } from "@warband/vscode/logic/project-integrations";
import { type ChatSettings, parseConfiguredIntegrations } from "@warband/vscode/logic/settings";
import type { StudioMessage } from "@warband/vscode/logic/studio";
import type { AccountStore } from "./accounts.js";
import { addPoolKey, applySettingsPatch } from "./config.js";
import type { BridgeContext } from "./hostui.js";
import type { Sink } from "./hub.js";
import type { GestureChannel, KillchainHost } from "./killchain.js";
import { hasControl } from "./layout.js";
import { mentionRoot } from "./mentions.js";
import { newChatFrame } from "./program.js";
import { openWindowMessage } from "./shell-messages.js";

/** Clé d'état des services MCP par projet (hors `settings` : `settingsSet` ne l'atteint pas). */
export const INTEGRATIONS_KEY = "studio.integrationsByProject";

/** Délais et plafonds. */
export const BURP_TEST_MS = 20_000;
export const DIAGNOSTIC_MS = 30_000;
export const DIAGNOSTIC_MAX_BYTES = 64 * 1024;
const MAX_ZIP_BYTES = 60 * 1024 * 1024;
const FIRST_MCP_PORT = 9877;
/** Hôtes en http admis d'office pour un fournisseur compatible OpenAI (boucle locale et hôte du conteneur). */
const INTERNAL_HTTP_HOSTS = ["localhost", "127.0.0.1", "[::1]", "host.docker.internal"];

/** Messages du studio propres au web (absents du parseur de l'extension). */
export type StudioExtraMessage =
  | { type: "chooseProfile" }
  | { type: "configureIntegrations" }
  | { type: "diagnostic" };

/** Forme exacte, sans champ supplémentaire : tout écart donne `null`. */
export function parseStudioExtra(m: Record<string, unknown>): StudioExtraMessage | null {
  if (Object.keys(m).length !== 1) return null;
  return m.type === "chooseProfile" || m.type === "configureIntegrations" || m.type === "diagnostic"
    ? { type: m.type }
    : null;
}

/** Résultat d'une exécution du diagnostic (sortie standard et d'erreur brutes, déjà bornées par l'exécuteur). */
export interface DiagnosticRun {
  code: number | null;
  output: string;
}

/** Ce que la partie B demande à l'hôte du studio. */
export interface ExtraLink {
  emit(sink: Sink, msg: Record<string, unknown>): void;
  alive(sink: Sink): boolean;
  frameOf(sink: Sink): string;
  push(opts?: { feedbackTo?: Sink; feedback?: Record<string, unknown> }): Promise<void>;
  settings(): ChatSettings;
  locale(): "fr" | "en";
  /** Un changement de projet est en cours ou des tours de chat tournent. */
  busy(): boolean;
  reloadCatalog(): void;
}

export interface ExtraDeps {
  configDir: string;
  ctx: BridgeContext;
  containersRoot: string;
  accounts: AccountStore;
  killchain(): KillchainHost;
  secretValues(): Promise<string[]>;
  chatFrames(): string[];
  enginePath: string;
  binRoot: string;
  hooks: {
    settingsChanged(values: Record<string, unknown>): void;
    accountsChanged(): void;
    poolChanged(provider: "opencode"): void;
  };
  /** Injectables (tests) : clients MCP, diagnostic, délais, hôtes http admis. */
  burpBackend?(config: { port: number; transport: "sse" | "http" }): BurpBackend;
  integrationBackend?(config: IntegrationConfig): BurpBackend;
  diagnostic?(): Promise<DiagnosticRun>;
  burpTestMs?: number;
  allowHttpHosts?: readonly string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const validPort = (v: string): number | null =>
  /^[0-9]{1,5}$/.test(v) && Number(v) >= 1 && Number(v) <= 65535 ? Number(v) : null;

/** Longueur de l'identifiant de projet dans le nom du ZIP d'audit. */
const MAX_ZIP_NAME = 8;

export class StudioExtra {
  private readonly audits: { store?: AuditStore } = {};
  private burpStatusText = "";
  private burpTesting = false;
  private diagnosing = false;
  private disposed = false;

  constructor(
    private readonly deps: ExtraDeps,
    private readonly link: ExtraLink,
  ) {}

  dispose(): void {
    this.disposed = true;
    void this.audits.store?.close().catch(() => undefined);
  }

  get burpStatus(): string {
    return this.burpStatusText;
  }

  private get store() {
    return this.deps.ctx.storage;
  }

  private auditStore(): AuditStore {
    this.audits.store ??= new AuditStore(this.deps.configDir);
    return this.audits.store;
  }

  /** Message d'erreur sans détail système : seuls les codes du cœur sont détaillés. */
  private safe(error: unknown): string {
    return error instanceof CodedError
      ? cleanText(formatError(error, this.link.locale()), 400)
      : t("Opération impossible.");
  }

  private async active(): Promise<StoredProject | null> {
    const file = await readProjects(this.deps.configDir).catch(() => null);
    return file === null ? null : activeProject(file);
  }

  /** Le projet visé doit être le projet ACTIF (comme l'extension) ; sinon `project.absent`. */
  private async requireActive(projectId: string): Promise<StoredProject> {
    const active = await this.active();
    if (active === null || active.id !== projectId) throw new CodedError("project.absent");
    return active;
  }

  // -------------------------------------------------------------------------------------------
  // Aiguillage
  // -------------------------------------------------------------------------------------------

  /** `undefined` : message qui n'est pas de la partie B (le studio poursuit). */
  async handle(
    m: StudioMessage | StudioExtraMessage,
    sink: Sink,
    frame: string,
  ): Promise<boolean | undefined> {
    switch (m.type) {
      case "configureBurp":
        return this.configureBurp(sink);
      case "testBurp":
        return this.testBurp(sink);
      case "configureMcp":
        return this.configureMcp(m.id, sink);
      case "configureIntegrations":
        return this.configureIntegrations(sink);
      case "saveTestAccount":
      case "deleteTestAccount":
        return this.testAccount(m, sink);
      case "setAuditEnabled":
      case "reviewAuditTest":
      case "exportAudit":
        return this.audit(m, sink);
      case "openFreeGuideLink":
        await this.deps.ctx.ui.external(
          { url: FREE_GUIDE_LINKS[m.key], label: t("Ouvrir le guide dans un nouvel onglet") },
          sink,
        );
        return true;
      case "openWorkspace":
        return this.openFiles(sink, false);
      case "openCours":
        return this.openFiles(sink, true);
      case "prepareMission":
        sink.send("shell", "shell", {
          ...openWindowMessage("chat", newChatFrame(new Set(this.deps.chatFrames()))),
        });
        return true;
      case "openReport": {
        try {
          await this.requireActive(m.projectId);
          sink.send("shell", "shell", {
            ...openWindowMessage("viewer", "report", { mode: "report" }),
          });
        } catch (error) {
          await this.link.push({ feedbackTo: sink, feedback: { projectError: this.safe(error) } });
        }
        return true;
      }
      case "openEvidence":
      case "exportKillchain":
      case "exportReport":
      case "exportAttackFlow":
      case "setPathEdge":
      case "deleteFinding": {
        // Mêmes fonctions que la vue Kill chain ; les réponses vont au cadre du studio.
        const chan: GestureChannel = {
          send: (msg) => this.link.emit(sink, msg),
          alive: () => !this.disposed && this.link.alive(sink) && this.link.frameOf(sink) === frame,
        };
        const ok = await this.deps.killchain().gesture(m, sink, chan);
        if (ok && m.type !== "openEvidence") await this.link.push({});
        return ok;
      }
      case "chooseProfile":
        return this.chooseProfile(sink);
      case "diagnostic":
        return this.diagnostic(sink);
      case "configureProvider":
        return m.id === "add" ? this.addProvider(sink) : undefined;
      default:
        return undefined;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Champs de la vue
  // -------------------------------------------------------------------------------------------

  /** Services MCP configurés pour le projet : relus de l'état, valeur altérée ignorée. */
  private integrationMap(): Record<string, IntegrationConfig[]> {
    try {
      return integrationMap(this.store.state.get(INTEGRATIONS_KEY) ?? {});
    } catch {
      return {};
    }
  }

  integrationsOf(projectId: string | null): IntegrationConfig[] {
    return projectId === null ? [] : (this.integrationMap()[projectId] ?? []);
  }

  /** Champs ajoutés à la vue selon la page : audit, comptes de test (sans secret), services MCP. */
  async viewFields(page: string, projectId: string | null): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {
      mcpConfigured: this.integrationsOf(projectId),
      burpStatus: this.burpStatusText,
    };
    if (projectId === null) return out;
    if (page === "audit") {
      try {
        out.audit = (await this.auditStore().view(projectId, {
          compact: true,
        })) satisfies AuditView;
      } catch (error) {
        out.auditError = this.safe(error);
      }
    }
    if (page === "accounts")
      out.testAccounts = this.deps.accounts
        .list()
        .filter((a) => a.programme === projectId)
        .map((a) => ({
          label: a.label,
          host: "",
          kind: a.kind === "cookie" ? "cookie" : "password",
        }));
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // Burp
  // -------------------------------------------------------------------------------------------

  private async burpFeedback(sink: Sink, text: string, error = false): Promise<void> {
    this.burpStatusText = text;
    this.link.emit(sink, { type: "burpResult", text, error });
    await this.link.push({});
  }

  /**
   * Connexion Burp : choix activer/désactiver, port, transport. L'hôte n'est jamais saisi : le client MCP du
   * moteur ne joint que `127.0.0.1`. Réglages `burp.*` écrits d'un bloc, validés par le cœur.
   */
  private async configureBurp(sink: Sink): Promise<boolean> {
    if (this.link.busy()) {
      await this.burpFeedback(
        sink,
        t("Arrêtez les tours en cours avant de configurer Burp."),
        true,
      );
      return true;
    }
    const ui = this.deps.ctx.ui;
    const choice = await ui.pick(
      {
        title: "Burp Suite MCP",
        items: [
          {
            id: "enable",
            label: t("Activer ou configurer la connexion locale"),
            detail: t("Extension MCP officielle requise dans Burp Suite"),
          },
          { id: "disable", label: t("Désactiver la connexion") },
        ],
      },
      sink,
    );
    if (choice === null) return true;
    let patch: Record<string, unknown>;
    if (choice === "disable") patch = { "burp.enabled": false };
    else {
      const raw = await ui.input(
        {
          title: t("Port MCP Burp sur 127.0.0.1"),
          label: t("Port affiché dans l'onglet MCP de Burp (1 à 65535)."),
          value: String(this.link.settings().burp?.port ?? 9876),
        },
        sink,
      );
      if (raw === null) return true;
      const port = validPort(raw.trim());
      if (port === null) {
        await this.burpFeedback(sink, t("Port entier entre 1 et 65535 requis."), true);
        return true;
      }
      const transport = await ui.pick(
        {
          title: t("Transport MCP Burp"),
          items: [
            { id: "sse", label: t("SSE — serveur officiel"), detail: "/sse" },
            {
              id: "http",
              label: "Streamable HTTP",
              detail: t("/mcp, si proposé par votre serveur"),
            },
          ],
        },
        sink,
      );
      if (transport !== "sse" && transport !== "http") return true;
      if (this.link.busy()) {
        await this.burpFeedback(
          sink,
          t("Un tour a démarré. Arrêtez-le avant de modifier cette connexion."),
          true,
        );
        return true;
      }
      patch = { "burp.port": port, "burp.transport": transport, "burp.enabled": true };
    }
    const values = applySettingsPatch(this.store, patch);
    if (values === null) {
      await this.burpFeedback(sink, t("Réglages Burp invalides : rien n'a été enregistré."), true);
      return true;
    }
    this.deps.ctx.audit({
      kind: "burp.configure",
      enabled: patch["burp.enabled"] === true,
      ...(patch["burp.port"] !== undefined && { port: patch["burp.port"] }),
      ...(patch["burp.transport"] !== undefined && { transport: patch["burp.transport"] }),
    });
    this.deps.hooks.settingsChanged(values);
    await this.burpFeedback(
      sink,
      choice === "disable"
        ? t("Connexion Burp désactivée.")
        : t(
            "Connexion configurée. Testez-la, puis envoyez une nouvelle consigne. Les tours suivants utilisent ces réglages.",
          ),
    );
    return true;
  }

  /** Test de connexion depuis le serveur : catalogue d'outils seulement, délai borné, aucun outil exécuté. */
  private async testBurp(sink: Sink): Promise<boolean> {
    const config = this.link.settings().burp;
    if (config === undefined) {
      await this.burpFeedback(sink, t("Connexion Burp désactivée : configurez-la avant le test."));
      return true;
    }
    if (this.burpTesting) return true;
    this.burpTesting = true;
    try {
      const backend =
        this.deps.burpBackend?.(config) ??
        (await import("@warband/vscode/engine/burp-client")).createBurpBackend(config);
      const result = await this.listWithin(
        backend,
        this.deps.burpTestMs ?? BURP_TEST_MS,
        "burp.timeout",
      );
      const count = Array.isArray(result.tools) ? result.tools.length : 0;
      await this.burpFeedback(
        sink,
        t`MCP Burp joignable : ${count} outils dans cette page de catalogue. Aucun outil Burp exécuté, aucun appel au modèle.`,
      );
    } catch (error) {
      await this.burpFeedback(sink, this.safe(error), true);
    } finally {
      this.burpTesting = false;
    }
    return true;
  }

  /** `backend.list` borné dans le temps : le délai interrompt l'appel et rejette, même si le client ne répond jamais. */
  private async listWithin(
    backend: BurpBackend,
    ms: number,
    timeoutCode: "burp.timeout" | "integration.timeout",
  ): Promise<{ tools?: unknown[] }> {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new CodedError(timeoutCode));
      }, ms);
    });
    try {
      const result = await Promise.race([backend.list({}, abort.signal), timeout]);
      return isRecord(result) ? (result as { tools?: unknown[] }) : {};
    } finally {
      clearTimeout(timer);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Services MCP du projet
  // -------------------------------------------------------------------------------------------

  private saveIntegrations(projectId: string, next: IntegrationConfig[]): boolean {
    const parsed = parseConfiguredIntegrations(next);
    if (parsed === null) return false;
    this.store.state.set(INTEGRATIONS_KEY, { ...this.integrationMap(), [projectId]: parsed });
    return true;
  }

  private async integrationError(sink: Sink, text: string): Promise<boolean> {
    await this.link.push({ feedbackTo: sink, feedback: { integrationError: text } });
    return true;
  }

  /**
   * Services MCP locaux d'un projet : choix multiple parmi le catalogue. Un service retiré de la sélection
   * perd sa configuration ; un nouveau reçoit un port libre (à partir de 9877), SSE sur `/sse` (réglable
   * ensuite par `configureMcp`). Quatre services au plus.
   */
  private async configureIntegrations(sink: Sink): Promise<boolean> {
    const active = await this.active();
    if (active === null)
      return this.integrationError(
        sink,
        t("Choisissez un projet avant de configurer ses services MCP."),
      );
    const current = this.integrationsOf(active.id);
    const picked = await this.deps.ctx.ui.pick(
      {
        title: t("Catalogue MCP — services externes locaux"),
        multi: true,
        items: MCP_CATALOG.map((e) => ({
          id: e.id,
          label: e.label,
          detail:
            `${current.some((c) => c.id === e.id) ? t("configuré") : t("non configuré")} · ${e.description}`.slice(
              0,
              590,
            ),
        })),
      },
      sink,
    );
    if (picked === null) return true;
    if (picked.length > 4)
      return this.integrationError(sink, t("Quatre services MCP au plus par projet."));
    const next: IntegrationConfig[] = [];
    const used = new Set<number>(current.filter((c) => picked.includes(c.id)).map((c) => c.port));
    for (const id of picked) {
      const existing = current.find((c) => c.id === id);
      if (existing !== undefined) {
        next.push(existing);
        continue;
      }
      let port = FIRST_MCP_PORT;
      while (used.has(port)) port++;
      used.add(port);
      next.push({ id: id as IntegrationConfig["id"], port, transport: "sse", path: "/sse" });
    }
    if (!this.saveIntegrations(active.id, next))
      return this.integrationError(
        sink,
        t("Configuration invalide : identifiants et ports distincts requis."),
      );
    this.deps.ctx.audit({ kind: "integrations.set", project: active.id, ids: picked });
    await this.link.push({ feedbackTo: sink });
    return true;
  }

  /**
   * Saisie guidée d'un service MCP local (déjà démarré par l'utilisateur) : le serveur ne lance aucune
   * commande. Hôte fixe `127.0.0.1`, port, transport et chemin validés ; le point d'accès exact est confirmé
   * par l'humain avant l'écriture.
   */
  private async configureMcp(id: string, sink: Sink): Promise<boolean> {
    const entry = MCP_CATALOG.find((e) => e.id === id);
    if (entry === undefined) return false;
    const active = await this.active();
    if (active === null)
      return this.integrationError(
        sink,
        t("Choisissez un projet avant de configurer ses services MCP."),
      );
    const ui = this.deps.ctx.ui;
    const current = this.integrationsOf(active.id);
    const existing = current.find((c) => c.id === entry.id);
    const action = await ui.pick(
      {
        title: entry.label,
        items: [
          { id: "configure", label: t("Configurer le service local") },
          { id: "test", label: t("Tester le catalogue réel") },
          { id: "remove", label: t("Supprimer la configuration") },
          { id: "source", label: t("Voir le dépôt source") },
        ],
      },
      sink,
    );
    if (action === null) return true;
    if (action === "source") {
      await ui.external({ url: entry.source, label: t`Dépôt source de ${entry.label}` }, sink);
      return true;
    }
    if (action === "remove") {
      if (existing === undefined) return true;
      this.saveIntegrations(
        active.id,
        current.filter((c) => c.id !== entry.id),
      );
      this.deps.ctx.audit({ kind: "integrations.remove", project: active.id, id: entry.id });
      await this.link.push({ feedbackTo: sink });
      return true;
    }
    if (action === "test") {
      if (existing === undefined)
        return this.integrationError(
          sink,
          t(
            "Configurez le service avant le test : le serveur n'installe ni ne démarre aucun programme externe.",
          ),
        );
      try {
        const backend =
          this.deps.integrationBackend?.(existing) ??
          (await import("@warband/vscode/engine/integration-client")).createIntegrationBackend(
            existing,
          );
        const result = await this.listWithin(
          backend,
          this.deps.burpTestMs ?? BURP_TEST_MS,
          "integration.timeout",
        );
        const count = Array.isArray(result.tools) ? result.tools.length : 0;
        this.link.emit(sink, {
          type: "integrationResult",
          id: entry.id,
          text: t`${entry.label} : ${count} outils annoncés. Aucun outil distant exécuté.`,
          error: false,
        });
      } catch (error) {
        this.link.emit(sink, {
          type: "integrationResult",
          id: entry.id,
          text: this.safe(error),
          error: true,
        });
      }
      return true;
    }
    // Configurer : port, transport, chemin, confirmation du point d'accès exact.
    const rawPort = await ui.input(
      {
        title: t`${entry.label} — port local 127.0.0.1`,
        label: t("Port entre 1 et 65535"),
        value: String(existing?.port ?? FIRST_MCP_PORT),
      },
      sink,
    );
    if (rawPort === null) return true;
    const port = validPort(rawPort.trim());
    if (port === null)
      return this.integrationError(sink, t("Port entier entre 1 et 65535 requis."));
    const transport = await ui.pick(
      {
        title: t("Transport du service déjà démarré"),
        items: [
          { id: "http", label: "http" },
          { id: "sse", label: "sse" },
        ],
      },
      sink,
    );
    if (transport !== "http" && transport !== "sse") return true;
    const rawPath = await ui.input(
      {
        title: t("Chemin MCP local"),
        label: t("Chemin local simple, sans URL ni paramètre"),
        value: existing?.path ?? (transport === "http" ? "/mcp" : "/sse"),
      },
      sink,
    );
    if (rawPath === null) return true;
    const next = [
      ...current.filter((c) => c.id !== entry.id),
      { id: entry.id, port, transport, path: rawPath.trim() },
    ];
    const parsed = parseConfiguredIntegrations(next);
    if (parsed === null)
      return this.integrationError(
        sink,
        t("Configuration invalide : identifiants et ports distincts requis."),
      );
    const saved = parsed.find((c) => c.id === entry.id);
    if (saved === undefined) return true;
    const endpoint = `http://127.0.0.1:${saved.port}${saved.path}`;
    const ok = await ui.confirm(
      {
        title: t`Enregistrer ${entry.label}`,
        text: t`Le serveur se connectera à ce point d'accès local (transport ${saved.transport}) pendant les missions : ${endpoint}. Il ne lance aucun programme.`,
        danger: true,
      },
      sink,
    );
    if (!ok) return true;
    if (!this.saveIntegrations(active.id, parsed))
      return this.integrationError(
        sink,
        t("Configuration invalide : identifiants et ports distincts requis."),
      );
    this.deps.ctx.audit({
      kind: "integrations.configure",
      project: active.id,
      id: entry.id,
      port: saved.port,
      transport: saved.transport,
    });
    await this.link.push({ feedbackTo: sink });
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Comptes de test du projet
  // -------------------------------------------------------------------------------------------

  /** `saveTestAccount` / `deleteTestAccount` : mêmes opérations que `accountAdd` / `accountRemove` (coffre). */
  private async testAccount(
    m: Extract<StudioMessage, { type: "saveTestAccount" | "deleteTestAccount" }>,
    sink: Sink,
  ): Promise<boolean> {
    let accountError: string | undefined;
    try {
      if (this.link.busy()) throw new CodedError("project.absent");
      const active = await this.requireActive(m.projectId);
      const label = m.type === "saveTestAccount" ? m.account.label : m.label;
      const same = this.deps.accounts
        .list()
        .filter((a) => a.programme === active.id && a.label === label);
      if (m.type === "saveTestAccount") {
        // Remplacement : l'ancien compte n'est perdu que si le nouveau est enregistré (sinon rétabli).
        const olds: {
          programme: string;
          label: string;
          login: string;
          secret: string;
          kind?: "cookie" | "password";
        }[] = [];
        for (const a of same) {
          const secret = await this.deps.accounts.reveal(a.id);
          if (secret !== null)
            olds.push({
              programme: a.programme,
              label: a.label,
              login: a.login,
              secret,
              ...(a.kind === "cookie" || a.kind === "password" ? { kind: a.kind } : {}),
            });
          await this.deps.accounts.remove(a.id);
        }
        const meta = await this.deps.accounts.add({
          programme: active.id,
          label,
          login: m.account.identifier,
          secret: m.account.secret,
          kind: m.account.kind === "cookie" ? "cookie" : "password",
        });
        if (meta === null) {
          for (const old of olds) await this.deps.accounts.add(old);
          accountError = t("Impossible d'enregistrer les comptes de test.");
        } else
          this.deps.ctx.audit({
            kind: "account.add",
            id: meta.id,
            programme: meta.programme,
            label: meta.label,
          });
      } else {
        for (const a of same) {
          await this.deps.accounts.remove(a.id);
          this.deps.ctx.audit({ kind: "account.remove", id: a.id });
        }
      }
      this.deps.hooks.accountsChanged();
    } catch (error) {
      accountError = this.safe(error);
    }
    await this.link.push({
      feedbackTo: sink,
      feedback: accountError !== undefined ? { accountError } : {},
    });
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------------------------

  private async audit(
    m: Extract<StudioMessage, { type: "setAuditEnabled" | "reviewAuditTest" | "exportAudit" }>,
    sink: Sink,
  ): Promise<boolean> {
    let auditError: string | undefined;
    try {
      const active = await this.requireActive(m.projectId);
      const current = async () => {
        await this.requireActive(m.projectId);
      };
      const store = this.auditStore();
      if (m.type === "setAuditEnabled") {
        await store.setEnabled(active.id, m.enabled);
        this.deps.ctx.audit({ kind: "audit.enabled", project: active.id, enabled: m.enabled });
      } else if (m.type === "reviewAuditTest") {
        await reviewAuditTest({
          store,
          projectId: active.id,
          testId: m.testId,
          claim: m.claim,
          isCurrent: current,
        });
        this.deps.ctx.audit({ kind: "audit.review", project: active.id });
      } else await this.exportAudit(active, sink, current);
    } catch (error) {
      auditError =
        error instanceof Error && error.message === "download"
          ? t("Export impossible : trop d'exports en cours ou fichier trop volumineux.")
          : this.safe(error);
    }
    await this.link.push({
      feedbackTo: sink,
      feedback: auditError !== undefined ? { auditError } : {},
    });
    return true;
  }

  /** Dossier d'audit en ZIP (journaux déjà masqués par le cœur) offert au seul émetteur ; rien n'est gardé sur disque. */
  private async exportAudit(
    project: StoredProject,
    sink: Sink,
    current: () => Promise<void>,
  ): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "rw-audit-"));
    try {
      const destination = join(dir, "audit.zip");
      await exportAuditBundle({
        store: this.auditStore(),
        projectId: project.id,
        projectName: project.name,
        destination,
        locale: this.link.locale(),
        beforeCommit: current,
      });
      if ((await stat(destination)).size > MAX_ZIP_BYTES) throw new Error("download");
      const id = await this.deps.ctx.downloads.offer({
        filename: `venator-audit-${project.id.slice(0, MAX_ZIP_NAME)}.zip`,
        mime: "application/zip",
        body: await readFile(destination),
        to: sink,
      });
      if (id === null) throw new Error("download");
      this.deps.ctx.audit({ kind: "audit.export", project: project.id });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  // -------------------------------------------------------------------------------------------
  // Espace de travail, cours, mission
  // -------------------------------------------------------------------------------------------

  /**
   * `openWorkspace` : explorateur du projet actif. `openCours` : dossier `cours` du projet, créé sous la
   * racine réelle des projets s'il manque (jamais suivi s'il est un lien ou un fichier).
   */
  private async openFiles(sink: Sink, cours: boolean): Promise<boolean> {
    try {
      const active = await this.active();
      if (active === null) throw new CodedError("project.absent");
      if (cours) {
        const root = await mentionRoot(active.workspace, this.deps.containersRoot);
        if (root === null) throw new CodedError("path.outside", { path: "cours" });
        const dir = join(root, "cours");
        const st = await lstat(dir).catch(() => null);
        if (st === null) await mkdir(dir, { mode: 0o755 });
        else if (!st.isDirectory()) throw new CodedError("path.outside", { path: "cours" });
        sink.send("shell", "shell", { ...openWindowMessage("files", "main", { path: "cours" }) });
      } else sink.send("shell", "shell", { ...openWindowMessage("files", "main") });
    } catch (error) {
      await this.link.push({ feedbackTo: sink, feedback: { projectError: this.safe(error) } });
    }
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Profil
  // -------------------------------------------------------------------------------------------

  private async chooseProfile(sink: Sink): Promise<boolean> {
    const picked = await this.deps.ctx.ui.pick(
      {
        title: t("Profil par défaut du projet"),
        items: Object.entries(AGENT_PROFILES).map(([id, p]) => ({ id, label: p.label })),
      },
      sink,
    );
    if (picked === null) return true;
    const values = applySettingsPatch(this.store, { profile: picked });
    if (values === null) {
      await this.link.push({
        feedbackTo: sink,
        feedback: { projectError: t("Profil invalide : rien n'a été enregistré.") },
      });
      return true;
    }
    this.deps.ctx.audit({ kind: "settings.set", keys: ["profile"] });
    this.deps.hooks.settingsChanged(values);
    await this.link.push({});
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Fournisseur compatible OpenAI personnalisé
  // -------------------------------------------------------------------------------------------

  private httpAllowed(host: string): boolean {
    const extra = this.deps.allowHttpHosts ?? [];
    return INTERNAL_HTTP_HOSTS.includes(host) || extra.includes(host);
  }

  /** https seulement ; http pour localhost, l'hôte du conteneur et les hôtes autorisés par réglage. */
  private validBaseUrl(raw: string): boolean {
    try {
      const url = new URL(raw);
      if (url.protocol === "https:") return true;
      return url.protocol === "http:" && this.httpAllowed(url.hostname);
    } catch {
      return false;
    }
  }

  /**
   * Ajout d'un fournisseur : nom, URL de base, modèles, clé facultative (saisie masquée, vers le coffre,
   * jamais dans un message ni un audit). La configuration passe par `parseOpencodeProviders`.
   */
  private async addProvider(sink: Sink): Promise<boolean> {
    const ui = this.deps.ctx.ui;
    const fail = async (text: string) => {
      await this.link.push({ feedbackTo: sink, feedback: { projectError: text } });
      return true;
    };
    const name = await ui.input(
      { title: t("Nom du fournisseur"), label: t("Nom requis (128 caractères maximum).") },
      sink,
    );
    if (name === null) return true;
    const label = name.trim();
    if (label === "" || label.length > 128 || hasControl(label))
      return fail(t("Nom requis (128 caractères maximum)."));
    const baseURL = await ui.input(
      {
        title: t("URL de l'API compatible OpenAI"),
        label: t("URL https de l'API (sans secret ni paramètre)."),
      },
      sink,
    );
    if (baseURL === null) return true;
    const url = baseURL.trim();
    if (hasControl(url) || !this.validBaseUrl(url))
      return fail(
        t("URL refusée : https est exigé (http seulement pour un hôte interne autorisé)."),
      );
    const modelIds = await ui.input(
      { title: t("Identifiants des modèles"), label: t("Identifiants séparés par des virgules.") },
      sink,
    );
    if (modelIds === null) return true;
    const key = await ui.input(
      {
        title: t("Clé API du fournisseur"),
        label: t("Laissez vide pour un fournisseur sans clé (local)."),
        secret: true,
      },
      sink,
    );
    const secret = key === null ? "" : key.trim();
    if (secret !== "" && (secret.length > 8192 || /\s/.test(secret) || hasControl(secret)))
      return fail(t("Clé invalide : rien n'a été enregistré."));
    const id = `venator-${label
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .slice(0, 40)}`;
    const existing = this.link.settings().opencodeProviders ?? {};
    if (Object.hasOwn(existing, id)) return fail(t("Ce nom de fournisseur existe déjà."));
    const parsed = parseOpencodeProviders({
      ...existing,
      [id]: {
        name: label,
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: url },
        models: Object.fromEntries(
          modelIds
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
            .map((x) => [x, { name: x, tool_call: true }]),
        ),
      },
    });
    if (parsed === null)
      return fail(
        t(
          "URL ou modèles invalides. Utilisez une URL sans secret ni paramètre et au moins un modèle.",
        ),
      );
    const values = applySettingsPatch(this.store, { opencodeProviders: parsed });
    if (values === null) return fail(t("Fournisseur invalide : rien n'a été enregistré."));
    if (secret !== "") {
      const poolId = await addPoolKey(
        this.store,
        "opencode",
        cleanText(label, 40),
        secret,
        Date.now(),
      );
      if (poolId === null) return fail(t("Réserve de clés pleine : clé non enregistrée."));
      this.deps.hooks.poolChanged("opencode");
    }
    this.deps.ctx.audit({ kind: "provider.add", id, keyed: secret !== "" });
    this.deps.hooks.settingsChanged(values);
    this.link.reloadCatalog();
    await this.link.push({});
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Diagnostic
  // -------------------------------------------------------------------------------------------

  private runDiagnostic(): Promise<DiagnosticRun> {
    if (this.deps.diagnostic !== undefined) return this.deps.diagnostic();
    const script = join(dirname(this.deps.enginePath), "diagnostic.js");
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [script, this.deps.binRoot], {
        env: safeEnv(process.env),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let output = "";
      const take = (d: Buffer) => {
        if (output.length < DIAGNOSTIC_MAX_BYTES * 2) output += d.toString();
      };
      child.stdout.on("data", take);
      child.stderr.on("data", take);
      const timer = setTimeout(() => child.kill("SIGKILL"), DIAGNOSTIC_MS);
      child.on("error", () => {
        clearTimeout(timer);
        resolve({ code: null, output });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, output });
      });
    });
  }

  /** Diagnostic du moteur (empreinte et version du binaire) : sortie masquée, bornée à 64 Kio, à l'émetteur seul. */
  private async diagnostic(sink: Sink): Promise<boolean> {
    if (this.diagnosing) return true;
    this.diagnosing = true;
    try {
      const run = await this.runDiagnostic();
      const redact = createRedactor({
        values: [...secretsFromEnv(process.env), ...(await this.deps.secretValues())],
      });
      // Borne en octets (UTF-8) : l'ellipsis de `cleanText` et les caractères multioctets restent sous le plafond.
      const text = Buffer.from(
        cleanText(
          `${redact(run.output)}\n${t`moteur terminé (code ${String(run.code)})`}`,
          DIAGNOSTIC_MAX_BYTES - 8,
        ),
      )
        .subarray(0, DIAGNOSTIC_MAX_BYTES - 4)
        .toString("utf8");
      this.link.emit(sink, { type: "diagnosticResult", text, error: run.code !== 0 });
    } catch (error) {
      this.link.emit(sink, { type: "diagnosticResult", text: this.safe(error), error: true });
    } finally {
      this.diagnosing = false;
    }
    return true;
  }
}
