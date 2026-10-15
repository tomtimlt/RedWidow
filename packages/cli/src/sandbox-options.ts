import { CodedError } from "@john-studio/core";

export const DEFAULT_SANDBOX_TIMEOUT_SEC = 600;
export const MAX_SANDBOX_TIMEOUT_SEC = 1800;

export interface SandboxCliOptions {
  sandbox?: boolean | undefined;
  sandboxImage?: string | undefined;
  sandboxTimeout?: number | undefined;
}

/**
 * Options du bac à sable : aucune image par défaut (`--sandbox` sans `--sandbox-image` est refusé),
 * aucune option réseau ni privilèges. `--sandbox-image`/`--sandbox-timeout` sans `--sandbox` sont
 * refusés plutôt qu'ignorés en silence.
 */
export function resolveSandboxOptions(
  o: SandboxCliOptions,
): { image: string; timeoutSec: number } | undefined {
  if (o.sandbox !== true) {
    if (o.sandboxImage !== undefined || o.sandboxTimeout !== undefined)
      throw new CodedError("sandbox.invalidArgument", { field: "sandbox", reason: "required" });
    return undefined;
  }
  if (o.sandboxImage === undefined || o.sandboxImage === "")
    throw new CodedError("sandbox.imageUnsupported", { reason: "missing" });
  return {
    image: o.sandboxImage,
    timeoutSec: o.sandboxTimeout ?? DEFAULT_SANDBOX_TIMEOUT_SEC,
  };
}
