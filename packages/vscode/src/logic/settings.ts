import {
  type BurpConfig,
  CodedError,
  type IntegrationConfig,
  isBurpConfig,
  parseIntegrations,
} from "@warband/core";
import type { UltracodeLimits } from "./effort.js";

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
  if (get("burp.enabled") === true) {
    const config = { port: get("burp.port") ?? 9876, transport: get("burp.transport") ?? "sse" };
    if (!isBurpConfig(config)) throw new CodedError("burp.invalidConfig");
    out.burp = config;
  }
  const integrations = get("integrations");
  if (integrations !== undefined) {
    const parsed = parseIntegrations(integrations);
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
