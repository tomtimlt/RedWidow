import type { EngineEvent } from "@warband/core";
import type { BypassEngineLink, BypassSend } from "@warband/vscode/logic/bypass";
import type { ChatView } from "@warband/vscode/logic/chat";
import { capabilitySettings } from "@warband/vscode/logic/chat-capabilities";
import type { EngineController, EngineControllerOptions } from "@warband/vscode/logic/controller";
import type { Provider } from "@warband/vscode/logic/effort";
import { createJournalFiles } from "@warband/vscode/logic/historyStore";
import type { ChatSessionDeps, TokenChoice } from "@warband/vscode/logic/session";
import type { ChatSettings } from "@warband/vscode/logic/settings";
import { resolveSettings } from "@warband/vscode/logic/settings";
import type { ServerStorage } from "../storage/index.js";
import { isPoolProvider, type PoolProvider } from "./rotation.js";

/** Clé d'état de l'index de l'historique (équivalent serveur du `globalState` de VS Code). */
export const HISTORY_INDEX_KEY = "history.index";
/** Préfixe des préférences des chats dans l'état. */
export const PREFS_PREFIX = "prefs.";
/** Réglages machine (objet `{ clé: valeur }`, mêmes clés que `warband.*` dans VS Code). */
export const SETTINGS_KEY = "settings";

/** Clé du coffre pour le jeton d'un fournisseur ; le type (`api-key` | `subscription`) est dans l'état. */
export const tokenSecretKey = (provider: string): string => `provider.${provider}.token`;
export const tokenKindKey = (provider: string): string => `provider.${provider}.kind`;

export interface BridgeDepsContext {
  storage: ServerStorage;
  /** Identifiant du cadre : sépare les préférences et le mode apprentissage de chaque chat. */
  frame: string;
  /** Dossier de travail de l'agent. */
  cwd: string;
  /** Script du moteur et son premier argument (racine des binaires). */
  enginePath: string;
  engineArgs: string[];
  /** Question posée à l'humain via la coquille ; ne se résout que par sa réponse (ou `false` à l'arrêt). */
  ask(question: { kind: "always" | "delete"; text: string; frame: string }): Promise<boolean>;
  onView(view: ChatView): void;
  onLog?(text: string): void;
  onProviders?: ChatSessionDeps["onProviders"];
  /** Comptes de test du projet actif (stockage serveur, ADR 0052) ; absent : aucun compte. */
  getTestAccounts?: ChatSessionDeps["getTestAccounts"];
  /** Enregistre un identifiant de l'agent dans le coffre du serveur ; sa présence annonce la capacité au moteur. */
  onCredential?: ChatSessionDeps["onCredential"];
  onObservedEvent?(event: EngineEvent | null): void;
  /**
   * Réserve de clés (ADR 0052, point 6) : clé active d'un fournisseur ; `undefined` sans réserve utilisable,
   * le comportement habituel s'applique alors. La valeur ne sort que dans l'environnement du moteur.
   */
  poolKey?(provider: PoolProvider): Promise<{ id: string; value: string } | undefined>;
  /** Signale la clé de réserve (identifiant) retenue pour un fournisseur ; `null` : aucune. */
  onPoolKey?(provider: PoolProvider, id: string | null): void;
  bypass?: { attach(send: BypassSend): BypassEngineLink; reset?(): void };
  /** Contrôleur injectable (tests) ; défaut : celui de `logic/session` (moteur forké). */
  createController?(options: EngineControllerOptions): EngineController;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Construit les dépendances d'une session de chat à partir du stockage du serveur (ADR 0052, point 5).
 * Remplace ce que `extension.ts` tire de VS Code. Aucun secret n'est journalisé ni copié hors du coffre.
 */
export function buildChatDeps(ctx: BridgeDepsContext): ChatSessionDeps {
  const { state, secrets, paths } = ctx.storage;

  const readSettings = (): ChatSettings => {
    const raw = state.get(SETTINGS_KEY);
    const get = (key: string): unknown => (isRecord(raw) ? raw[key] : undefined);
    // Défauts de logic/settings.ts ; `resolveSettings` lève `CodedError` sur une valeur invalide.
    return { capabilities: capabilitySettings(get), ...resolveSettings(get) };
  };

  const getToken = async (provider: Provider = "claude"): Promise<TokenChoice | undefined> => {
    if (isPoolProvider(provider) && ctx.poolKey) {
      const pooled = await ctx.poolKey(provider);
      ctx.onPoolKey?.(provider, pooled?.id ?? null);
      if (pooled) {
        const { value } = pooled;
        if (provider === "opencode")
          return { auth: { name: "OPENCODE_API_KEY", value }, mode: "auto" };
        return provider === "openai"
          ? { auth: { name: "OPENAI_API_KEY", value }, mode: "api-key" }
          : { auth: { name: "ANTHROPIC_API_KEY", value }, mode: "api-key" };
      }
    }
    // OpenCode utilise son authentification propre (dossiers XDG de l'hôte) : aucun jeton à fournir.
    if (provider === "opencode") return { mode: "auto" };
    const value = await secrets.get(tokenSecretKey(provider));
    if (!value) return undefined;
    const kind = state.get(tokenKindKey(provider));
    if (provider === "openai")
      // Stub : l'abonnement ChatGPT passe par l'hôte VS Code (navigateur local), indisponible ici.
      return kind === "api-key"
        ? { auth: { name: "OPENAI_API_KEY", value }, mode: "api-key" }
        : undefined;
    return kind === "api-key"
      ? { auth: { name: "ANTHROPIC_API_KEY", value }, mode: "api-key" }
      : { auth: { name: "CLAUDE_CODE_OAUTH_TOKEN", value }, mode: "subscription" };
  };

  return {
    cwd: ctx.cwd,
    enginePath: ctx.enginePath,
    engineArgs: ctx.engineArgs,
    readSettings,
    getToken,
    // Sans jeton, le chat est grisé : aucune authentification implicite du binaire sur un serveur.
    requireProvider: true,
    confirmAlways: (text) => ctx.ask({ kind: "always", text, frame: ctx.frame }),
    onView: ctx.onView,
    ...(ctx.onLog && { onLog: ctx.onLog }),
    ...(ctx.onProviders && { onProviders: ctx.onProviders }),
    ...(ctx.getTestAccounts && { getTestAccounts: ctx.getTestAccounts }),
    ...(ctx.onCredential && { onCredential: ctx.onCredential }),
    ...(ctx.onObservedEvent && { onObservedEvent: ctx.onObservedEvent }),
    ...(ctx.createController && { createController: ctx.createController }),
    ...(ctx.bypass && { bypass: ctx.bypass }),
    prefsKey: `chat.${ctx.frame}`,
    learningKey: `learning.${ctx.frame}`,
    // Préférences et cache des modèles : `prefs.<clé>` dans l'état persistant.
    store: {
      get: (key) => state.get(`${PREFS_PREFIX}${key}`),
      set: (key, value) => state.set(`${PREFS_PREFIX}${key}`, value),
    },
    history: {
      key: HISTORY_INDEX_KEY,
      owner: ctx.frame,
      // Index commun à tous les cadres : la clé de session est ignorée, une seule clé d'état sert.
      index: {
        get: () => state.get(HISTORY_INDEX_KEY),
        set: (_key, value) => state.set(HISTORY_INDEX_KEY, value),
        // Synchrone : lecture puis écriture sans intercalage, donc sans écrasement entre cadres.
        update: (_key, change) =>
          state.set(HISTORY_INDEX_KEY, change(state.get(HISTORY_INDEX_KEY))),
        subscribe: (listener) => state.subscribe(HISTORY_INDEX_KEY, () => listener()),
      },
      files: createJournalFiles(paths.runs),
      confirmDelete: (text) => ctx.ask({ kind: "delete", text, frame: ctx.frame }),
    },
    // Stubs inertes, faute d'équivalent serveur :
    // - (`getTestAccounts` est fourni par le hub : coffre et état du serveur) ;
    // - `readHistoryProjects` : projets actifs de l'extension (fichier de configuration local), non portés ;
    // - `onMissionContext` : instantané de mission pour le panneau VS Code, sans vue côté web ;
    // - `sdkVersion` : absent, donc cache des modèles keyé « unknown » (invalidé au changement d'hôte).
  };
}
