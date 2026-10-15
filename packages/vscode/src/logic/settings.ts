import { CodedError } from "@john-studio/core";
import { MAX_SANDBOX_TIMEOUT_SEC, type SandboxParams } from "./protocol.js";

export const DEFAULT_SANDBOX_TIMEOUT_SEC = 600;

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
    out.sandbox = { image: image.trim(), timeoutSec: timeout };
  }
  return out;
}
