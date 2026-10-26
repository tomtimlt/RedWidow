import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentRunner,
  type ApprovalOutcome,
  type AuthMode,
  CodedError,
  capOutput,
  DEFAULT_MAX_RESULT_BYTES,
  type EngineEvent,
  type EventOf,
  EXTERNAL_DIRECTORY_TOOL,
  EXTERNAL_PATTERNS_FIELD,
  errorInfo,
  type ListModelsInput,
  type ModelOption,
  type Reason,
  type RunContext,
  type RunInput,
  type RunSummary,
  reason,
  resolveBinary,
  ToolCallRegistry,
  withWebResearchGuidance,
} from "@warband/core";
import { formatReason } from "@warband/messages";
import { createSdkApi } from "./api.js";
import { assertOfficialOpenaiConfig, assertSafeConfig, buildConfig } from "./config.js";
import {
  DEFAULT_NATIVE_TOOLS,
  isUnevaluable,
  KNOWN_NATIVE_TOOLS,
  normalizeInput,
  policyToolName,
} from "./names.js";
import { launchServer, serverEnv } from "./server.js";
import { startToolServer, type ToolGuard } from "./tool-server.js";
import type { OpencodeToolset } from "./toolset.js";
import type {
  ClientInit,
  OpencodeApi,
  OpencodeEvent,
  PermissionResponse,
  PromptBody,
} from "./types.js";

type Obj = Record<string, unknown>;

export interface OpencodeRunnerOptions {
  /** Binaire `opencode` (défaut : `opencode`, cherché dans `PATH`). */
  binary?: string;
  /** Se connecte à un serveur existant au lieu d'en lancer un (la config imposée ne peut alors pas lui être transmise). */
  baseUrl?: string;
  serverPassword?: string;
  /** Configuration OpenCode de l'utilisateur, fusionnée AU-DESSOUS des réglages de sécurité du moteur. */
  config?: Obj;
  /** Serveurs MCP du moteur (ex. `dockerToolset()`), construits à chaque run. */
  toolsets?: OpencodeToolset[];
  /** Expose l'outil natif `bash` (désactivé par défaut). Reste soumis à la politique. */
  bash?: boolean;
  /** Outils natifs exposés, noms OpenCode (défaut : read, glob, grep). */
  builtinTools?: string[];
  /** Fournisseur par défaut quand `RunInput.model` n'a pas de préfixe `fournisseur/`. */
  provider?: string;
  /** Variables copiées depuis l'environnement vers le serveur lancé (clés des fournisseurs). */
  passEnv?: string[];
  /** Variables posées telles quelles dans l'environnement du serveur lancé. */
  env?: Record<string, string>;
  /** Environnement source (défaut : `process.env`). Sert aux tests. */
  processEnv?: NodeJS.ProcessEnv;
  /** Plafond (octets UTF-8) du texte complet d'un `tool.result` (défaut : 64 Kio). */
  maxResultBytes?: number;
  /** Délai de démarrage du serveur lancé, en ms (défaut : 30 s). */
  startTimeoutMs?: number;
  /** Fabrique de client : remplace le lancement du serveur (tests, faux client). */
  createClient?: (init: ClientInit) => OpencodeApi | Promise<OpencodeApi>;
}

/** Préfixe des refus renvoyés au modèle ; le motif suit. */
const REFUSAL_PREFIX = "Refusé par warband : ";

/** Événements du flux sans intérêt pour le journal (bruit d'infrastructure d'OpenCode). */
const IGNORED_EVENT =
  /^(server|plugin|catalog|integration|reference|installation|file|lsp|vcs|pty|tui|mcp|project|worktree|todo|command|workspace)\./;
const IGNORED_EXACT = new Set([
  "session.updated",
  "session.diff",
  "session.created",
  "session.compacted",
  "session.deleted",
  "message.removed",
  "message.part.delta",
  "message.part.removed",
  "permission.replied",
]);

const obj = (value: unknown): Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Obj) : {};
const str = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/** `fournisseur/modèle` → `{providerID, modelID}` ; lève `opencode.invalidModel`. */
export function parseModel(
  value: string,
  provider?: string,
): { providerID: string; modelID: string } {
  const slash = value.indexOf("/");
  if (slash > 0 && slash < value.length - 1) {
    return { providerID: value.slice(0, slash), modelID: value.slice(slash + 1) };
  }
  if (provider !== undefined && slash === -1 && value !== "") {
    return { providerID: provider, modelID: value };
  }
  throw new CodedError("opencode.invalidModel", { value });
}

async function runtimeCatalog(api: OpencodeApi, signal?: AbortSignal): Promise<Obj> {
  if (!api.listProviders) throw new CodedError("opencode.noModel");
  return obj(await api.listProviders(signal));
}

/** Variantes effectives : aucun niveau déduit du nom du modèle ni alias d'effort Claude. */
function reasoningVariants(model: Obj): string[] {
  if (obj(model.capabilities).reasoning === false || model.reasoning === false) return [];
  return Object.entries(obj(model.variants))
    .slice(0, 64)
    .filter(
      ([key, value]) =>
        /^[A-Za-z0-9_.-]{1,64}$/.test(key) &&
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        obj(value).disabled !== true,
    )
    .map(([key]) => key);
}

/** Résout uniquement les défauts annoncés pour les fournisseurs connectés du catalogue. */
function findRuntimeDefaultModel(catalog: Obj, provider?: string) {
  const providers = Array.isArray(catalog.all) ? catalog.all.map(obj) : [];
  const connected = Array.isArray(catalog.connected) ? catalog.connected : [];
  const defaults = obj(catalog.default);
  for (const id of connected) {
    if (typeof id !== "string" || (provider !== undefined && id !== provider)) continue;
    const modelID = str(defaults[id]);
    if (!modelID) continue;
    const entry = providers.find((candidate) => candidate.id === id);
    const present = Object.entries(obj(entry?.models)).some(
      ([key, raw]) => (str(obj(raw).id) ?? key) === modelID,
    );
    if (!present) continue;
    return parseModel(`${id}/${modelID}`);
  }
  return undefined;
}

function runtimeDefaultModel(catalog: Obj, provider?: string) {
  const model = findRuntimeDefaultModel(catalog, provider);
  if (model === undefined) throw new CodedError("opencode.noModel");
  return model;
}

/** Demande de permission normalisée (formes `permission.asked` du binaire et `permission.updated` du SDK). */
export interface PermissionRequest {
  id: string;
  sessionID: string;
  /** Clé de permission (`read`, `edit`, `bash`, `external_directory`, `docker_ps`…). */
  permission: string;
  patterns: string[];
  metadata: Obj;
  messageID?: string;
  callID?: string;
}

export function parsePermission(properties: Obj): PermissionRequest | null {
  const id = str(properties.id);
  const sessionID = str(properties.sessionID);
  const permission = str(properties.permission) ?? str(properties.type);
  if (id === undefined || sessionID === undefined || permission === undefined) return null;
  const tool = obj(properties.tool);
  const rawPatterns = properties.patterns ?? properties.pattern;
  const patterns = (Array.isArray(rawPatterns) ? rawPatterns : [rawPatterns]).filter(
    (p): p is string => typeof p === "string",
  );
  const messageID = str(tool.messageID) ?? str(properties.messageID);
  const callID = str(tool.callID) ?? str(properties.callID);
  return {
    id,
    sessionID,
    permission,
    patterns,
    metadata: obj(properties.metadata),
    ...(messageID !== undefined && { messageID }),
    ...(callID !== undefined && { callID }),
  };
}

/** Appel d'outil suivi depuis les parties `tool` du flux. */
interface Call {
  key: string;
  toolUseId: string;
  tool: string;
  input: Obj;
  sessionID: string;
  requested: EventOf<"tool.requested"> | undefined;
  finished: boolean;
}

export function createOpencodeRunner(options: OpencodeRunnerOptions = {}): AgentRunner {
  return {
    run: (input, ctx) => runWithOpencode(options, input, ctx),
    listModels: (input) => probeModels(options, input),
  };
}

/** Catalogue runtime : aucune session, aucun prompt et aucun serveur d'outils. */
async function probeModels(
  options: OpencodeRunnerOptions,
  { cwd, auth, signal }: ListModelsInput,
): Promise<ModelOption[]> {
  const processEnv = options.processEnv ?? process.env;
  const credentials = await authEnvironment(options, auth);
  const abort = new AbortController();
  const onAbort = () => abort.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  let api: OpencodeApi | undefined;
  let stopServer: (() => Promise<void>) | undefined;
  let isolatedConfig: string | undefined;
  try {
    abort.signal.throwIfAborted();
    const config = buildConfig({
      user: options.config,
      enabledTools: new Set(),
      mcp: {},
      maxTurns: undefined,
      ...(options.provider !== undefined && { provider: options.provider }),
    });
    if (options.createClient) {
      api = await options.createClient({ directory: cwd, config, signal: abort.signal });
    } else if (options.baseUrl) {
      api = createSdkApi({
        baseUrl: options.baseUrl,
        directory: cwd,
        ...(options.serverPassword !== undefined && { password: options.serverPassword }),
      });
    } else {
      const binary = resolveBinary(options.binary ?? "opencode", { env: processEnv });
      if (binary === null)
        throw new CodedError("process.notFound", { binary: options.binary ?? "opencode" });
      if (options.provider === "openai") {
        isolatedConfig = await mkdtemp(join(tmpdir(), "warband-openai-config-"));
        credentials.env.XDG_CONFIG_HOME = isolatedConfig;
      }
      const password = randomBytes(24).toString("hex");
      const server = await launchServer({
        binary,
        cwd,
        env: serverEnv({ processEnv, config, password, ...credentials }),
        signal: abort.signal,
        ...(options.startTimeoutMs !== undefined && { timeoutMs: options.startTimeoutMs }),
      });
      stopServer = server.close;
      api = createSdkApi({ baseUrl: server.url, directory: cwd, password });
    }
    const effective = await api.getConfig(abort.signal);
    assertSafeConfig(effective);
    if (options.provider === "openai") assertOfficialOpenaiConfig(effective);
    abort.signal.throwIfAborted();
    if (!api.listProviders) throw new Error("OpenCode : catalogue des fournisseurs indisponible");
    const catalog = obj(await api.listProviders(abort.signal));
    abort.signal.throwIfAborted();
    const providers = Array.isArray(catalog.all) ? catalog.all : [];
    const connected = new Set(Array.isArray(catalog.connected) ? catalog.connected : []);
    const models: ModelOption[] = [];
    for (const raw of providers) {
      const provider = obj(raw);
      const id = str(provider.id);
      if (!id || !connected.has(id) || (options.provider && id !== options.provider)) continue;
      for (const [key, rawModel] of Object.entries(obj(provider.models))) {
        const model = obj(rawModel);
        const modelId = str(model.id) ?? key;
        if (!modelId) continue;
        models.push({
          value: `${id}/${modelId}`,
          displayName: str(model.name) ?? modelId,
          reasoningVariants: reasoningVariants(model),
        });
      }
    }
    const defaultModel = findRuntimeDefaultModel(catalog, options.provider);
    let configuredIndex = -1;
    const configuredValue = str(effective.model);
    if (configuredValue !== undefined) {
      try {
        const configured = parseModel(configuredValue, options.provider);
        configuredIndex = models.findIndex(
          (model) => model.value === `${configured.providerID}/${configured.modelID}`,
        );
      } catch (error) {
        if (!(error instanceof CodedError) || error.code !== "opencode.invalidModel") throw error;
      }
    }
    const defaultIndex =
      configuredIndex >= 0
        ? configuredIndex
        : defaultModel
          ? models.findIndex(
              (model) => model.value === `${defaultModel.providerID}/${defaultModel.modelID}`,
            )
          : -1;
    if (defaultIndex > 0) {
      const [preferred] = models.splice(defaultIndex, 1);
      if (preferred) models.unshift(preferred);
    }
    return models;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    abort.abort();
    try {
      await api?.close?.();
    } finally {
      try {
        await stopServer?.();
      } finally {
        if (isolatedConfig) await rm(isolatedConfig, { recursive: true, force: true });
      }
    }
  }
}

/** Le mode abonnement écarte la clé API ; le mode API exige une clé explicite. */
async function authEnvironment(options: OpencodeRunnerOptions, auth?: AuthMode) {
  const env = { ...options.env };
  let passEnv = options.passEnv ?? [];
  if (options.provider === "openai") {
    if (options.baseUrl !== undefined) {
      throw new Error(
        "Le mode OpenAI officiel nécessite un serveur local isolé lancé par Warband.",
      );
    }
    delete env.OPENCODE_CONFIG;
    delete env.OPENCODE_CONFIG_DIR;
    passEnv = passEnv.filter(
      (name) => !["OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR"].includes(name.toUpperCase()),
    );
    const key = env.OPENAI_API_KEY ?? (options.processEnv ?? process.env).OPENAI_API_KEY;
    if (auth === "api-key" && !key) throw new CodedError("auth.missingApiKey");
    if (auth === "api-key") env.OPENCODE_AUTH_CONTENT = "{}";
    if (auth === "subscription") {
      const source = { ...(options.processEnv ?? process.env), ...options.env };
      if (!(await hasOpenaiOAuth(source))) {
        throw new Error(
          "Connexion ChatGPT requise : connectez OpenAI avec OpenCode avant de continuer.",
        );
      }
      delete env.OPENCODE_AUTH_CONTENT;
      delete env.OPENAI_API_KEY;
      passEnv = passEnv.filter(
        (name) => !["OPENAI_API_KEY", "OPENCODE_AUTH_CONTENT"].includes(name.toUpperCase()),
      );
    } else if (key) {
      env.OPENAI_API_KEY = key;
    }
  }
  return { env, passEnv };
}

/** Lecture bornée : aucun identifiant du cache ne sort de cette fonction. */
async function hasOpenaiOAuth(env: NodeJS.ProcessEnv): Promise<boolean> {
  const data = env.XDG_DATA_HOME || join(env.HOME || homedir(), ".local", "share");
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    file = await open(join(data, "opencode", "auth.json"), "r");
    const maxBytes = 1024 * 1024;
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > maxBytes) return false;
    return obj(obj(JSON.parse(buffer.toString("utf8", 0, length))).openai).type === "oauth";
  } catch {
    return false;
  } finally {
    await file?.close().catch(() => undefined);
  }
}

async function* promptTexts(prompt: string | AsyncIterable<string>): AsyncGenerator<string> {
  if (typeof prompt === "string") yield prompt;
  else yield* prompt;
}

async function runWithOpencode(
  options: OpencodeRunnerOptions,
  input: RunInput,
  { recorder, gate, signal }: RunContext,
): Promise<RunSummary> {
  const { cwd } = input;
  const credentials = await authEnvironment(options, input.auth);
  const processEnv = options.processEnv ?? process.env;
  // Échecs avant tout lancement : rien n'est émis ni démarré.
  const requestedModel =
    input.model === undefined ? undefined : parseModel(input.model, options.provider);
  const binaryPath =
    options.createClient || options.baseUrl
      ? null
      : resolveBinary(options.binary ?? "opencode", { env: processEnv });
  if (!options.createClient && !options.baseUrl && binaryPath === null) {
    throw new CodedError("process.notFound", { binary: options.binary ?? "opencode" });
  }

  const abort = new AbortController();
  const onAbort = () => abort.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();

  const root = recorder.emit({
    kind: "run.started",
    prompt: typeof input.prompt === "string" ? input.prompt : "",
    cwd,
  });

  const unhandled: Record<string, number> = {};
  const count = (key: string) => {
    unhandled[key] = (unhandled[key] ?? 0) + 1;
  };
  const maxResultBytes = options.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES;

  let summary: RunSummary = {
    status: "error",
    turns: 0,
    costUsd: 0,
    result: null,
    unhandledMessages: unhandled,
  };

  // --- outils ---------------------------------------------------------------
  const enabledTools = new Set(
    (options.builtinTools ?? DEFAULT_NATIVE_TOOLS).filter((name) => name !== "bash"),
  );
  if (options.bash === true) enabledTools.add("bash");
  const toolsOff: Record<string, false> = {};
  // Constat sur 1.19.0 : `write`, `edit` et `patch` se pilotent ensemble par l'indicateur `edit`.
  const editGroup = ["write", "edit", "multiedit"].some((name) => enabledTools.has(name));
  for (const name of KNOWN_NATIVE_TOOLS) {
    if (!enabledTools.has(name) && !(name === "edit" && editGroup)) toolsOff[name] = false;
  }

  const registry = new ToolCallRegistry();
  const serverNames = (options.toolsets ?? []).map((set) => set.name);
  const calls = new Map<string, Call>();
  const usedIds = new Map<string, string>();
  const decisions = new Map<string, Promise<ApprovalOutcome>>();
  const inflight = new Set<Promise<unknown>>();

  let api: OpencodeApi | undefined;
  let stopServer: (() => Promise<void>) | undefined;
  let isolatedConfig: string | undefined;
  let toolServer: Awaited<ReturnType<typeof startToolServer>> | undefined;
  let sessionId: string | undefined;
  let ownsServer = true;
  const family = new Set<string>();

  // --- budget ---------------------------------------------------------------
  const stepCosts = new Map<string, number>(); // partId → coût
  const messageCosts = new Map<string, number>(); // messageId → coût annoncé
  const messageOfStep = new Map<string, string>();
  const totalCost = () => {
    const perMessage = new Map<string, number>();
    for (const [part, cost] of stepCosts) {
      const message = messageOfStep.get(part) ?? part;
      perMessage.set(message, (perMessage.get(message) ?? 0) + cost);
    }
    let total = 0;
    for (const message of new Set([...perMessage.keys(), ...messageCosts.keys()])) {
      total += Math.max(perMessage.get(message) ?? 0, messageCosts.get(message) ?? 0);
    }
    return total;
  };
  let budgetTripped = false;

  // --- tours ----------------------------------------------------------------
  interface Turn {
    started: boolean;
    failed: boolean;
    text: string | null;
    done: () => void;
  }
  let turn: Turn | undefined;
  const userMessages = new Set<string>();
  const assistantMessages = new Set<string>();
  const emittedParts = new Set<string>();
  const reportedErrors = new Set<string>();
  const retries = new Set<number>();
  let aborting = false;

  const fail = (info: Reason, parentId = root.id) => {
    recorder.emit({ kind: "error", ...info }, parentId);
  };

  const mine = (sessionID: string | undefined) =>
    sessionID !== undefined && (ownsServer || family.has(sessionID));

  const toolUseIdFor = (key: string, callID: string) => {
    const owner = usedIds.get(callID);
    if (owner === undefined || owner === key) {
      usedIds.set(callID, key);
      return callID;
    }
    const unique = `${callID}@${key.split("/")[0]}`;
    usedIds.set(unique, key);
    return unique;
  };

  const requestedFor = (call: Call, normalized: Obj, policyTool: string) => {
    call.requested ??= recorder.emit(
      { kind: "tool.requested", toolUseId: call.toolUseId, tool: policyTool, input: normalized },
      root.id,
    ) as EventOf<"tool.requested">;
    return call.requested;
  };

  /** Enregistre/complète un appel à partir d'une partie `tool` (ou de son rechargement). */
  const trackCall = (part: Obj): Call | undefined => {
    const callID = str(part.callID);
    const messageID = str(part.messageID);
    const tool = str(part.tool);
    if (callID === undefined || messageID === undefined || tool === undefined) return undefined;
    const key = `${messageID}/${callID}`;
    const state = obj(part.state);
    let call = calls.get(key);
    if (!call) {
      call = {
        key,
        toolUseId: toolUseIdFor(key, callID),
        tool,
        input: {},
        sessionID: str(part.sessionID) ?? sessionId ?? "",
        requested: undefined,
        finished: false,
      };
      calls.set(key, call);
    }
    if (Object.keys(obj(state.input)).length > 0) call.input = obj(state.input);
    return call;
  };

  const emitRequested = (call: Call) => {
    const policyTool = policyToolName(call.tool, serverNames);
    return requestedFor(call, normalizeInput(policyTool, call.input), policyTool);
  };

  // --- permissions ----------------------------------------------------------
  /** Décision unique par appel d'outil : `external_directory` et la permission de l'outil la partagent. */
  const decideCall = (
    call: Call,
    extra: Obj,
    externalPatterns?: readonly string[],
  ): Promise<ApprovalOutcome> => {
    // Un `external_directory` qui arrive après la décision de l'outil n'a pas été vu par elle : décision à part
    // (même sans motif : le cœur plafonne alors à `ask`).
    const memoKey =
      externalPatterns !== undefined && decisions.has(call.key) ? `${call.key}#ext` : call.key;
    const known = decisions.get(memoKey);
    if (known) return known;
    const policyTool = policyToolName(call.tool, serverNames);
    const normalized = {
      ...normalizeInput(policyTool, call.input, extra),
      // Bases statiques des motifs `external_directory` : contrôlées comme n'importe quel chemin par le cœur.
      // Toujours transmis pour un `external_directory`, même vide : le cœur ne l'autorise jamais seul.
      ...(externalPatterns !== undefined && { [EXTERNAL_PATTERNS_FIELD]: [...externalPatterns] }),
    };
    const event = requestedFor(call, normalized, policyTool);
    const decision: Promise<ApprovalOutcome> = isUnevaluable(policyTool, normalized)
      ? Promise.resolve().then(() => {
          const outcome: ApprovalOutcome = {
            decision: "deny",
            reason: reason("opencode.pathUnknown", { tool: policyTool }),
            source: "policy",
          };
          recorder.emit(
            {
              kind: "approval.decided",
              toolUseId: call.toolUseId,
              decision: "deny",
              source: "policy",
              reason: outcome.reason,
            },
            event.id,
          );
          return outcome;
        })
      : gate
          .decide(
            { toolUseId: call.toolUseId, tool: policyTool, input: normalized },
            abort.signal,
            event.id,
          )
          .then((outcome) => {
            if (outcome.decision === "allow") {
              registry.register(policyTool, call.input, {
                toolUseId: call.toolUseId,
                eventId: event.id,
              });
            }
            return outcome;
          });
    decisions.set(memoKey, decision);
    return decision;
  };

  const callFor = async (request: PermissionRequest): Promise<Call | undefined> => {
    if (request.messageID === undefined || request.callID === undefined) return undefined;
    const key = `${request.messageID}/${request.callID}`;
    const known = calls.get(key);
    if (known && Object.keys(known.input).length > 0) return known;
    // Le flux n'a pas (encore) livré l'entrée de l'appel : on la relit.
    try {
      const parts = await api?.messageParts(request.sessionID, request.messageID);
      for (const part of parts ?? []) {
        const p = obj(part);
        if (p.type === "tool" && p.callID === request.callID) trackCall(p);
      }
    } catch {
      // Entrée introuvable : l'appelant refusera.
    }
    return calls.get(key);
  };

  const respond = async (request: PermissionRequest, response: PermissionResponse) => {
    if (!api) return;
    try {
      const status = await api.reply({ id: request.id, sessionID: request.sessionID }, response);
      if (status >= 200 && status < 300) return;
      // 404 : la demande n'existe plus. OpenCode rejette d'office les demandes en attente d'une
      // session après un refus ; rien ne s'exécute sans réponse « once », donc c'est sans danger.
      if (aborting || status === 404) return;
      fail(reason("opencode.replyFailed", { status }));
    } catch (err) {
      if (aborting) return;
      fail(errorInfo(err));
    }
    // Sans réponse, l'outil resterait bloqué : on interrompt la session (fail-closed).
    aborting = true;
    if (sessionId) await api.abort(sessionId).catch(() => undefined);
  };

  const onPermission = async (request: PermissionRequest) => {
    let allow = false;
    try {
      const call = await callFor(request);
      if (call) {
        const outcome = await decideCall(
          call,
          request.metadata,
          request.permission === EXTERNAL_DIRECTORY_TOOL ? request.patterns : undefined,
        );
        allow = outcome.decision === "allow";
      } else if (request.callID === undefined) {
        // Permission sans appel d'outil (ex. boucle détectée) : la gate tranche sur la clé brute.
        const toolUseId = request.id;
        const tool = policyToolName(request.permission, serverNames);
        const input = { patterns: request.patterns, ...request.metadata };
        const event = recorder.emit({ kind: "tool.requested", toolUseId, tool, input }, root.id);
        const outcome = await gate.decide({ toolUseId, tool, input }, abort.signal, event.id);
        allow = outcome.decision === "allow";
      } else {
        recorder.emit({
          kind: "approval.decided",
          toolUseId: request.callID,
          decision: "deny",
          source: "policy",
          reason: reason("opencode.pathUnknown", { tool: request.permission }),
        });
      }
    } catch (err) {
      fail(errorInfo(err));
    }
    await respond(request, allow ? "once" : "reject");
  };

  // --- garde des appels MCP (défense en profondeur) -------------------------
  const guard: ToolGuard = async ({ toolName, args, signal: callSignal }) => {
    const claimed = registry.claim(toolName, args);
    if (claimed) {
      return { allowed: true, ctx: { parentId: claimed.eventId, correlation: "inferred" } };
    }
    // Aucune décision préalable (permission OpenCode contournée ?) : la gate tranche ici.
    const toolUseId = `mcp-${randomUUID()}`;
    const inputObj = obj(args);
    const event = recorder.emit(
      { kind: "tool.requested", toolUseId, tool: toolName, input: inputObj },
      root.id,
    );
    const outcome = await gate.decide(
      { toolUseId, tool: toolName, input: inputObj },
      callSignal ?? abort.signal,
      event.id,
    );
    if (outcome.decision !== "allow") {
      return { allowed: false, message: `${REFUSAL_PREFIX}${formatReason(outcome.reason)}` };
    }
    return { allowed: true, ctx: { parentId: event.id, correlation: "exact" } };
  };

  // --- traduction des événements -------------------------------------------
  const finishTurn = () => {
    const current = turn;
    if (current?.started) current.done();
  };

  const onToolPart = (part: Obj) => {
    const call = trackCall(part);
    if (!call) return;
    const state = obj(part.state);
    const status = str(state.status);
    if (status === undefined || status === "pending") return;
    const requested = emitRequested(call);
    if ((status === "completed" || status === "error") && !call.finished) {
      call.finished = true;
      const output =
        status === "completed" ? String(state.output ?? "") : String(state.error ?? "");
      recorder.emit(
        {
          kind: "tool.result",
          toolUseId: call.toolUseId,
          isError: status === "error",
          ...capOutput(output, maxResultBytes),
        },
        requested.id,
      );
    }
  };

  const onPart = (part: Obj) => {
    const type = str(part.type);
    const id = str(part.id) ?? "";
    const messageID = str(part.messageID);
    if (type === "tool") return onToolPart(part);
    if (type === "text" || type === "reasoning") {
      const time = obj(part.time);
      const text = typeof part.text === "string" ? part.text : "";
      const assistant = messageID !== undefined && assistantMessages.has(messageID);
      if (time.end === undefined || emittedParts.has(id) || !assistant || text.trim() === "")
        return;
      emittedParts.add(id);
      if (type === "text") {
        if (turn) turn.text = text;
        recorder.emit({ kind: "agent.text", text }, root.id);
      } else {
        recorder.emit({ kind: "agent.thinking", text, redacted: false }, root.id);
      }
      return;
    }
    if (type === "step-finish") {
      stepCosts.set(id, typeof part.cost === "number" ? part.cost : 0);
      if (messageID !== undefined) messageOfStep.set(id, messageID);
      checkBudget();
      return;
    }
    if (type === "retry") {
      const attempt = typeof part.attempt === "number" ? part.attempt : 0;
      onRetry(
        attempt,
        str(obj(obj(part.error).data).message) ?? "erreur",
        0,
        obj(obj(part.error).data).statusCode,
      );
      return;
    }
    if (type === "step-start") return;
    count(`message.part.updated/${type ?? "?"}`);
  };

  const onRetry = (attempt: number, message: string, delayMs: number, status?: unknown) => {
    if (retries.has(attempt)) return;
    retries.add(attempt);
    recorder.emit(
      {
        kind: "api.retry",
        attempt,
        // OpenCode n'annonce pas le nombre maximal d'essais : 0 = inconnu.
        maxRetries: 0,
        delayMs,
        errorStatus: typeof status === "number" ? status : null,
        error: message,
      },
      root.id,
    );
  };

  const checkBudget = () => {
    const limit = input.maxBudgetUsd;
    if (limit === undefined || budgetTripped) return;
    const spent = totalCost();
    if (spent <= limit) return;
    budgetTripped = true;
    fail(reason("budget.exceeded", { limit, spent: Number(spent.toFixed(6)) }));
    if (turn) turn.failed = true;
    if (sessionId) void api?.abort(sessionId).catch(() => undefined);
  };

  const onSessionError = (error: Obj) => {
    const name = str(error.name) ?? "UnknownError";
    const data = obj(error.data);
    const message = (str(data.message) ?? name).split("\n")[0] ?? name;
    if (turn) {
      turn.started = true;
      turn.failed = true;
    }
    if (name === "MessageAbortedError") return; // volontaire (annulation, budget) : déjà signalé
    const key = `${name}:${message}`;
    if (reportedErrors.has(key)) return;
    reportedErrors.add(key);
    if (name === "ProviderAuthError") {
      fail(reason("provider.authFailed", { provider: str(data.providerID) ?? "?" }));
      return;
    }
    const status = typeof data.statusCode === "number" ? data.statusCode : undefined;
    fail(reason("provider.error", { name, message, ...(status !== undefined && { status }) }));
  };

  const handle = (event: OpencodeEvent) => {
    const p = event.properties;
    switch (event.type) {
      case "permission.asked":
      case "permission.updated": {
        const request = parsePermission(p);
        if (!request) return count(event.type);
        if (!mine(request.sessionID)) return;
        const task = onPermission(request).finally(() => inflight.delete(task));
        inflight.add(task);
        return;
      }
      case "session.created":
      case "session.updated": {
        const info = obj(p.info);
        const id = str(info.id);
        const parent = str(info.parentID);
        if (id !== undefined && parent !== undefined && family.has(parent)) family.add(id);
        return;
      }
      case "message.updated": {
        const info = obj(p.info);
        const id = str(info.id);
        if (id === undefined || !mine(str(info.sessionID))) return;
        if (info.role === "user") {
          if (!userMessages.has(id)) {
            userMessages.add(id);
            if (turn && str(info.sessionID) === sessionId) turn.started = true;
          }
        } else if (info.role === "assistant") {
          assistantMessages.add(id);
          if (typeof info.cost === "number") {
            messageCosts.set(id, info.cost);
            checkBudget();
          }
          const error = obj(info.error);
          if (str(error.name) !== undefined) onSessionError(error);
        }
        return;
      }
      case "message.part.updated":
        if (mine(str(obj(p.part).sessionID))) onPart(obj(p.part));
        return;
      case "session.status": {
        const status = obj(p.status);
        if (status.type === "retry" && mine(str(p.sessionID))) {
          const next = typeof status.next === "number" ? status.next : Date.now();
          onRetry(
            typeof status.attempt === "number" ? status.attempt : 0,
            str(status.message) ?? "erreur",
            Math.max(0, next - Date.now()),
          );
        }
        return;
      }
      case "session.error":
        if (mine(str(p.sessionID))) onSessionError(obj(p.error));
        return;
      case "session.idle":
        if (str(p.sessionID) === sessionId) finishTurn();
        return;
      default:
        if (IGNORED_EXACT.has(event.type) || IGNORED_EVENT.test(event.type)) return;
        count(event.type);
    }
  };

  // --- exécution ------------------------------------------------------------
  let pump: Promise<void> | undefined;
  try {
    if (input.effort !== undefined) throw new CodedError("opencode.unsupportedEffort");
    // Outils du moteur, servis en MCP HTTP local.
    const mcp: Obj = {};
    const specs = (options.toolsets ?? []).map((set) => ({
      name: set.name,
      ...(set.instructions && { instructions: set.instructions }),
      tools: set.create({ recorder }),
    }));
    const webAvailable = specs.some(
      (set) =>
        set.name === "web" &&
        ["search_web", "read_url"].every((name) => set.tools.some((tool) => tool.name === name)),
    );
    const systemPrompt = withWebResearchGuidance(input.systemPrompt, webAvailable);
    if (specs.length > 0) {
      const token = randomBytes(32).toString("hex");
      toolServer = await startToolServer({ toolsets: specs, token, guard });
      for (const set of specs) {
        mcp[set.name] = {
          type: "remote",
          url: toolServer.url(set.name),
          headers: { Authorization: `Bearer ${token}` },
          enabled: true,
        };
      }
    }
    const config = buildConfig({
      user: options.config,
      enabledTools,
      mcp,
      maxTurns: input.maxTurns,
      ...(options.provider !== undefined && { provider: options.provider }),
    });

    if (options.createClient) {
      api = await options.createClient({ directory: cwd, config, signal: abort.signal });
    } else if (options.baseUrl) {
      ownsServer = false;
      api = createSdkApi({
        baseUrl: options.baseUrl,
        directory: cwd,
        ...(options.serverPassword !== undefined && { password: options.serverPassword }),
      });
    } else {
      if (options.provider === "openai") {
        isolatedConfig = await mkdtemp(join(tmpdir(), "warband-openai-config-"));
        credentials.env.XDG_CONFIG_HOME = isolatedConfig;
      }
      const password = randomBytes(24).toString("hex");
      const server = await launchServer({
        binary: binaryPath as string,
        cwd,
        env: serverEnv({
          processEnv,
          config,
          password,
          ...credentials,
        }),
        signal: abort.signal,
        ...(options.startTimeoutMs !== undefined && { timeoutMs: options.startTimeoutMs }),
      });
      stopServer = server.close;
      api = createSdkApi({ baseUrl: server.url, directory: cwd, password });
    }

    const effective = await api.getConfig(abort.signal);
    assertSafeConfig(effective);
    if (options.provider === "openai") assertOfficialOpenaiConfig(effective);
    const defaultModel = str(effective.model);
    const catalog =
      input.variant !== undefined || (requestedModel === undefined && defaultModel === undefined)
        ? await runtimeCatalog(api, abort.signal)
        : undefined;
    const model =
      requestedModel ??
      (defaultModel !== undefined
        ? parseModel(defaultModel, options.provider)
        : runtimeDefaultModel(catalog ?? {}, options.provider));
    if (input.variant !== undefined) {
      const providers = Array.isArray(catalog?.all) ? catalog.all.map(obj) : [];
      const connected = Array.isArray(catalog?.connected) ? catalog.connected : [];
      const provider = providers.find((entry) => entry.id === model.providerID);
      const entry = Object.entries(obj(provider?.models)).find(
        ([key, raw]) => (str(obj(raw).id) ?? key) === model.modelID,
      );
      if (
        !connected.includes(model.providerID) ||
        !entry ||
        !reasoningVariants(obj(entry[1])).includes(input.variant)
      ) {
        throw new CodedError("opencode.invalidVariant");
      }
    }

    const events = await api.subscribe(abort.signal);
    let streamEnded: () => void = () => undefined;
    const ended = new Promise<void>((resolve) => {
      streamEnded = resolve;
    });
    pump = (async () => {
      try {
        for await (const event of events) handle(event);
      } catch (err) {
        if (!abort.signal.aborted) fail(errorInfo(err));
      } finally {
        streamEnded();
      }
    })();

    const resumeId = input.resume ?? input.sessionId;
    if (resumeId !== undefined) {
      if (!(await api.hasSession(resumeId))) {
        throw new CodedError("opencode.sessionNotFound", { id: resumeId });
      }
      sessionId = resumeId;
    } else {
      sessionId = await api.createSession();
    }
    family.add(sessionId);
    recorder.emit(
      {
        kind: "session.started",
        sessionId,
        model: `${model.providerID}/${model.modelID}`,
        tools: [
          ...enabledTools,
          ...specs.flatMap((set) => set.tools.map((t) => `mcp__${set.name}__${t.name}`)),
        ],
      },
      root.id,
    );

    for await (const text of promptTexts(input.prompt)) {
      if (abort.signal.aborted || budgetTripped) break;
      let finish: () => void = () => undefined;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      turn = { started: false, failed: false, text: null, done: finish };
      retries.clear();
      const body: PromptBody = {
        text,
        model,
        ...(input.variant !== undefined && { variant: input.variant }),
        tools: toolsOff,
        ...(systemPrompt !== undefined && { system: systemPrompt }),
      };
      await api.prompt(sessionId, body);
      const aborted = new Promise<void>((resolve) => {
        if (abort.signal.aborted) resolve();
        abort.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      await Promise.race([finished, ended, aborted]);
      const current = turn;
      if (abort.signal.aborted) {
        aborting = true;
        await api.abort(sessionId).catch(() => undefined);
        break;
      }
      if (!current.started && !current.failed) {
        // Le flux s'est interrompu avant la fin du tour.
        fail(reason("opencode.serverFailed", { detail: "flux d'événements interrompu" }));
        current.failed = true;
      }
      await Promise.allSettled([...inflight]);
      const turns = summary.turns + 1;
      summary = {
        status: current.failed ? "error" : "success",
        turns,
        costUsd: totalCost(),
        result: current.text,
        sessionId,
        unhandledMessages: unhandled,
      };
      recorder.emit(
        {
          kind: "turn.finished",
          turns,
          costUsd: summary.costUsd,
          status: summary.status,
          result: summary.result,
        },
        root.id,
      );
      if (current.failed) break;
    }
  } catch (err) {
    fail(errorInfo(err));
    summary = { ...summary, status: "error" };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    aborting = true;
    abort.abort();
    await Promise.allSettled([...inflight]);
    if (sessionId && api && !ownsServer) await api.abort(sessionId).catch(() => undefined);
    await pump?.catch(() => undefined);
    try {
      await api?.close?.();
    } finally {
      try {
        await stopServer?.();
      } finally {
        try {
          await toolServer?.close();
        } finally {
          if (isolatedConfig) await rm(isolatedConfig, { recursive: true, force: true });
        }
      }
    }
  }

  if (sessionId !== undefined && summary.sessionId === undefined)
    summary = { ...summary, sessionId };
  summary = { ...summary, costUsd: totalCost() };
  recorder.emit({ kind: "run.finished", ...summary }, root.id);
  return summary;
}

export type { EngineEvent };
