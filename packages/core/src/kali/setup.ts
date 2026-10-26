import {
  assertArgsPrefix,
  assertBinary,
  assertOperand,
  createDockerClient,
} from "../docker/client.js";
import { resolveBinary } from "../process/resolve.js";
import { runProcess } from "../process/run.js";
import { CodedError } from "../reason.js";
import type { Recorder } from "../recorder.js";
import { createKaliApi } from "./api.js";
import { KALI_NMAP_COMPATIBILITY_SCRIPT } from "./nmap-compat.js";

export type KaliPreparationStage = "checking" | "installing" | "starting" | "ready";

export interface KaliPreparationOptions {
  recorder: Recorder;
  binary?: string;
  argsPrefix?: readonly string[];
  signal?: AbortSignal;
  onStage?: (stage: KaliPreparationStage) => void;
}

/** Préparation explicite de l'hôte ; jamais accessible comme outil d'un agent. */
export async function prepareKaliContainer(
  container: string,
  { recorder, binary = "docker", argsPrefix = [], signal, onStage }: KaliPreparationOptions,
): Promise<void> {
  const name = assertOperand(container, "container");
  assertBinary(binary);
  const prefix = assertArgsPrefix(argsPrefix);
  const file = resolveBinary(binary);
  if (file === null) throw new CodedError("process.notFound", { binary });
  const deadline = AbortSignal.timeout(600_000);
  const effectiveSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const docker = createDockerClient({ recorder, binary, argsPrefix: prefix });
  let stage: KaliPreparationStage = "checking";
  const setStage = (next: KaliPreparationStage) => {
    stage = next;
    onStage?.(next);
  };
  const fail = (reason?: string) =>
    new CodedError("kali.unavailable", { name, stage, ...(reason !== undefined && { reason }) });
  const listedKali = async () => {
    effectiveSignal.throwIfAborted();
    const rows = await docker.listLabelPrefix({ signal: effectiveSignal, timeoutMs: 15_000 });
    const row = rows.find((r) => r.name === name);
    if (row?.family !== "kali") throw new CodedError("exegol.containerDenied", { name });
    if (row.state !== "running") throw new CodedError("project.notRunning", { name });
  };
  const exec = (command: readonly string[]) =>
    runProcess([file, ...prefix, "exec", "-u", "root", name, ...command], {
      recorder,
      signal: effectiveSignal,
      timeoutMs: 600_000,
    });
  setStage("checking");
  await listedKali();
  const check = await exec([
    "sh",
    "-c",
    "command -v python3 >/dev/null && command -v kali-server-mcp >/dev/null || exit 42",
  ]);
  if (check.code !== 0) {
    if (check.code !== 42) throw fail("prereqCheck");
    const supported = await exec([
      "sh",
      "-c",
      "grep -Eq '^ID=(\"kali\"|kali)$' /etc/os-release && command -v apt-get >/dev/null",
    ]);
    if (supported.code !== 0) throw fail("unsupportedImage");
    await listedKali();
    setStage("installing");
    const update = await exec(["env", "DEBIAN_FRONTEND=noninteractive", "apt-get", "update"]);
    if (update.code !== 0) throw fail();
    const install = await exec([
      "env",
      "DEBIAN_FRONTEND=noninteractive",
      "apt-get",
      "install",
      "-y",
      "--no-install-recommends",
      "python3",
      "mcp-kali-server",
    ]);
    if (install.code !== 0) throw fail();
    const verified = await exec([
      "sh",
      "-c",
      "command -v python3 >/dev/null && command -v kali-server-mcp >/dev/null || exit 42",
    ]);
    if (verified.code !== 0) throw fail("prereqCheck");
  }
  await listedKali();
  const nmap = await exec(["python3", "-c", KALI_NMAP_COMPATIBILITY_SCRIPT]);
  if (nmap.code !== 0) throw new CodedError("kali.nmapUnavailable", { name });
  setStage("starting");
  // Le premier lancement du paquet fraîchement installé peut être plus lent
  // qu'un appel normal : laisser au serveur le temps d'initialiser ses modules.
  const api = createKaliApi({ recorder, binary, argsPrefix: prefix, pauseMs: 1_000 });
  const lines = await api
    .call(name, { method: "GET", path: "/health" }, { signal: effectiveSignal })
    .catch(() => {
      throw fail("serverHealth");
    });
  let health: unknown;
  try {
    health = JSON.parse(lines.join("\n"));
  } catch {
    throw fail("serverHealth");
  }
  if (
    typeof health !== "object" ||
    health === null ||
    !("status" in health) ||
    health.status !== "healthy"
  ) {
    throw fail("serverHealth");
  }
  setStage("ready");
}
