import {
  type BurpConfig,
  CodedError,
  type IntegrationConfig,
  isBurpConfig,
  MCP_CATALOG,
  type ProviderOption,
  parseIntegrations,
} from "@warband/core";
import type { CapabilitySettings } from "./chat-capabilities.js";
import type { UltracodeLimits } from "./effort.js";
import { type OpencodeProviders, parseOpencodeProviders } from "./opencode-providers.js";

/** Configuration conservée sans exposer plus de quatre services à un runner. */
export function parseConfiguredIntegrations(raw: unknown): IntegrationConfig[] | null {
  if (!Array.isArray(raw) || raw.length > MCP_CATALOG.length) return null;
  const result: IntegrationConfig[] = [];
  for (const item of raw) {
    const parsed = parseIntegrations([item]);
    const next = parsed?.[0];
    if (!next || result.some((m) => m.id === next.id || m.port === next.port)) return null;
    result.push(next);
  }
  return result;
}

/** Forme de `WorkspaceConfiguration.inspect` : les valeurs d'espace de travail n'y sont jamais lues. */
export interface Inspected {
  globalValue?: unknown;
  defaultValue?: unknown;
  workspaceValue?: unknown;
  workspaceFolderValue?: unknown;
}

/**
 * Valeur d'un réglage sensible : utilisateur (machine) puis défaut. `.vscode/settings.json` est
 * hostile (ADR 0004) : `workspaceValue` / `workspaceFolderValue` sont ignorés, même si présents.
 */
export function machineValue(info: Inspected | undefined): unknown {
  return info?.globalValue ?? info?.defaultValue;
}

export interface ChatSettings {
  providerCatalog?: ProviderOption[];
  capabilities?: CapabilitySettings;
  webSearch?: boolean;
  opencodeProviders?: OpencodeProviders;
  burp?: BurpConfig;
  integrations?: IntegrationConfig[];
  profile?: string;
  model?: string;
  maxTurns?: number;
  /** Plafonds du préréglage Ultracode (absents = pas de plafond). */
  ultracode?: UltracodeLimits;
}

/** Lit et valide les réglages (`get` renvoie la valeur machine de `warband.<clé>`). Lève `CodedError`. */
export function resolveSettings(get: (key: string) => unknown): ChatSettings {
  const out: ChatSettings = {};
  const providers = get("opencodeProviders");
  if (providers !== undefined) {
    const parsed = parseOpencodeProviders(providers);
    if (!parsed)
      throw new CodedError("sandbox.invalidArgument", {
        field: "opencodeProviders",
        reason: "invalid",
      });
    if (Object.keys(parsed).length) out.opencodeProviders = parsed;
  }
  if (get("burp.enabled") === true) {
    const config = { port: get("burp.port") ?? 9876, transport: get("burp.transport") ?? "sse" };
    if (!isBurpConfig(config)) throw new CodedError("burp.invalidConfig");
    out.burp = config;
  }
  const integrations = get("integrations");
  if (integrations !== undefined) {
    const parsed = parseConfiguredIntegrations(integrations);
    if (!parsed) throw new CodedError("integration.invalidConfig");
    if (parsed.length) out.integrations = parsed;
  }
  const profile = get("profile");
  if (
    typeof profile === "string" &&
    ["mentor", "bug-bounty", "out-of-box", "red-team", "htb"].includes(profile)
  )
    out.profile = profile;
  const model = get("model");
  if (typeof model === "string" && model.trim() !== "") out.model = model.trim();
  const maxTurns = get("maxTurns");
  if (maxTurns !== undefined && maxTurns !== 0) {
    if (typeof maxTurns !== "number" || !Number.isInteger(maxTurns) || maxTurns < 1) {
      throw new CodedError("sandbox.invalidArgument", { field: "maxTurns", reason: "range" });
    }
    out.maxTurns = maxTurns;
  }
  const ultra: UltracodeLimits = {};
  const uTurns = get("ultracode.maxTurns");
  if (uTurns !== undefined && uTurns !== 0) {
    if (typeof uTurns !== "number" || !Number.isInteger(uTurns) || uTurns < 1) {
      throw new CodedError("sandbox.invalidArgument", {
        field: "ultracode.maxTurns",
        reason: "range",
      });
    }
    ultra.maxTurns = uTurns;
  }
  const uBudget = get("ultracode.maxBudgetUsd");
  if (uBudget !== undefined && uBudget !== 0) {
    if (typeof uBudget !== "number" || !Number.isFinite(uBudget) || uBudget <= 0) {
      throw new CodedError("sandbox.invalidArgument", {
        field: "ultracode.maxBudgetUsd",
        reason: "range",
      });
    }
    ultra.maxBudgetUsd = uBudget;
  }
  if (Object.keys(ultra).length > 0) out.ultracode = ultra;
  return out;
}
