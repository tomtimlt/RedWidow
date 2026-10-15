import { CodedError } from "@john-studio/core";
import type { UltracodeLimits } from "./effort.js";
import {
  MAX_SANDBOX_TIMEOUT_SEC,
  SANDBOX_MEMORY_VALUES,
  SANDBOX_NETWORKS,
  type SandboxNetwork,
  type SandboxParams,
} from "./protocol.js";

export const DEFAULT_SANDBOX_TIMEOUT_SEC = 600;
export const DEFAULT_SANDBOX_NETWORK: SandboxNetwork = "none";
export const DEFAULT_SANDBOX_MEMORY = "2g";
export const DEFAULT_SANDBOX_CPUS = 2;

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
  model?: string;
  maxTurns?: number;
  sandbox?: SandboxParams;
  /** Plafonds du préréglage Ultracode (absents = pas de plafond). */
  ultracode?: UltracodeLimits;
}

/** Lit et valide les réglages (`get` renvoie la valeur machine de `john.<clé>`). Lève `CodedError`. */
export function resolveSettings(get: (key: string) => unknown): ChatSettings {
  const out: ChatSettings = {};
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
  if (get("sandbox.enabled") === true) {
    const image = get("sandbox.image");
    if (typeof image !== "string" || image.trim() === "") {
      throw new CodedError("sandbox.imageUnsupported", { reason: "missing" });
    }
    const timeout = get("sandbox.timeoutSec") ?? DEFAULT_SANDBOX_TIMEOUT_SEC;
    if (
      typeof timeout !== "number" ||
      !Number.isInteger(timeout) ||
      timeout < 1 ||
      timeout > MAX_SANDBOX_TIMEOUT_SEC
    ) {
      throw new CodedError("sandbox.invalidArgument", { field: "sandboxTimeout", reason: "range" });
    }
    const network = get("sandbox.network") ?? DEFAULT_SANDBOX_NETWORK;
    if (!(SANDBOX_NETWORKS as readonly string[]).includes(String(network))) {
      throw new CodedError("sandbox.invalidArgument", {
        field: "sandboxNetwork",
        reason: "format",
      });
    }
    const memory = get("sandbox.memory") ?? DEFAULT_SANDBOX_MEMORY;
    if (!(SANDBOX_MEMORY_VALUES as readonly string[]).includes(String(memory))) {
      throw new CodedError("sandbox.invalidArgument", { field: "sandboxMemory", reason: "format" });
    }
    const cpus = get("sandbox.cpus") ?? DEFAULT_SANDBOX_CPUS;
    if (typeof cpus !== "number" || !Number.isInteger(cpus) || cpus < 1 || cpus > 8) {
      throw new CodedError("sandbox.invalidArgument", { field: "sandboxCpus", reason: "range" });
    }
    out.sandbox = {
      image: image.trim(),
      timeoutSec: timeout,
      network: network as SandboxNetwork,
      memory: String(memory),
      cpus,
    };
  }
  return out;
}
