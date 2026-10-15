import { CodedError } from "@john-studio/core";

export const DEFAULT_SANDBOX_TIMEOUT_SEC = 600;
export const MAX_SANDBOX_TIMEOUT_SEC = 1800;

export const SANDBOX_NETWORKS = ["none", "bridge"] as const;
export type SandboxCliNetwork = (typeof SANDBOX_NETWORKS)[number];

export const SANDBOX_MEMORY_VALUES = ["1g", "2g", "3g", "4g", "5g", "6g", "7g", "8g"] as const;
export type SandboxCliMemory = (typeof SANDBOX_MEMORY_VALUES)[number];

export const DEFAULT_SANDBOX_NETWORK: SandboxCliNetwork = "none";
export const DEFAULT_SANDBOX_MEMORY: SandboxCliMemory = "2g";
export const DEFAULT_SANDBOX_CPUS = 2;

export interface SandboxCliOptions {
  sandbox?: boolean | undefined;
  sandboxImage?: string | undefined;
  sandboxTimeout?: number | undefined;
  sandboxNetwork?: string | undefined;
  sandboxMemory?: string | undefined;
  sandboxCpus?: number | undefined;
}

export interface ResolvedSandboxOptions {
  image: string;
  timeoutSec: number;
  network: SandboxCliNetwork;
  memory: SandboxCliMemory;
  cpus: number;
}

const sandboxRequired = () =>
  new CodedError("sandbox.invalidArgument", { field: "sandbox", reason: "required" });

const hasSandboxOnlyOptions = (o: SandboxCliOptions): boolean =>
  o.sandboxImage !== undefined ||
  o.sandboxTimeout !== undefined ||
  o.sandboxNetwork !== undefined ||
  o.sandboxMemory !== undefined ||
  o.sandboxCpus !== undefined;

/**
 * Options du bac à sable : aucune image par défaut (`--sandbox` sans `--sandbox-image` est refusé).
 * `--sandbox-image` / options associées sans `--sandbox` sont refusés plutôt qu'ignorés en silence.
 */
export function resolveSandboxOptions(o: SandboxCliOptions): ResolvedSandboxOptions | undefined {
  if (o.sandbox !== true) {
    if (hasSandboxOnlyOptions(o)) throw sandboxRequired();
    return undefined;
  }
  if (o.sandboxImage === undefined || o.sandboxImage === "")
    throw new CodedError("sandbox.imageUnsupported", { reason: "missing" });

  const network = o.sandboxNetwork ?? DEFAULT_SANDBOX_NETWORK;
  if (!(SANDBOX_NETWORKS as readonly string[]).includes(network)) {
    throw new CodedError("sandbox.invalidArgument", { field: "sandboxNetwork", reason: "format" });
  }

  const memory = o.sandboxMemory ?? DEFAULT_SANDBOX_MEMORY;
  if (!(SANDBOX_MEMORY_VALUES as readonly string[]).includes(memory)) {
    throw new CodedError("sandbox.invalidArgument", { field: "sandboxMemory", reason: "format" });
  }

  const cpus = o.sandboxCpus ?? DEFAULT_SANDBOX_CPUS;
  if (!Number.isInteger(cpus) || cpus < 1 || cpus > 8) {
    throw new CodedError("sandbox.invalidArgument", { field: "sandboxCpus", reason: "range" });
  }

  return {
    image: o.sandboxImage,
    timeoutSec: o.sandboxTimeout ?? DEFAULT_SANDBOX_TIMEOUT_SEC,
    network: network as SandboxCliNetwork,
    memory: memory as SandboxCliMemory,
    cpus,
  };
}

/** OpenCode + réseau bridge : serveur local joignable depuis le conteneur (fail-closed avant createSandbox). */
export function assertSandboxNetworkAllowed(
  agent: "claude" | "opencode",
  network: SandboxCliNetwork,
): void {
  if (agent === "opencode" && network === "bridge") {
    throw new CodedError("sandbox.networkUnsafe", { reason: "adapterServer" });
  }
}
