import { request as httpRequest, type RequestOptions } from "node:http";
import { StringDecoder } from "node:string_decoder";
import { resolveBinary } from "../process/resolve.js";
import { type ProcessResult, runProcess } from "../process/run.js";
import { CodedError } from "../reason.js";
import type { Recorder } from "../recorder.js";
import { assertBinary, assertOperand, type DockerError, dockerFailure } from "./client.js";

export const WARBAND_KALI_IMAGE = "warband/kali:complete-1";
export const KALI_BASE_IMAGE = "kalilinux/kali-rolling:latest";
export const WARBAND_KALI_DOCKERFILE = `FROM ${KALI_BASE_IMAGE}
WORKDIR /workspace
RUN printf 'Acquire::Retries "2";\\nAcquire::http::Timeout "30";\\nAcquire::https::Timeout "30";\\n' > /etc/apt/apt.conf.d/80warband-network \\
    && for source in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list; do \\
        if [ -f "$source" ]; then sed -i 's|://http\\.kali\\.org/kali|://kali.download/kali|g' "$source"; fi; \\
    done \\
    && printf '#!/bin/sh\\nexit 101\\n' > /usr/sbin/policy-rc.d \\
    && chmod +x /usr/sbin/policy-rc.d \\
    && apt-get update \\
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends kali-linux-headless python3 mcp-kali-server nmap libcap2-bin curl bind9-dnsutils iproute2 jq subfinder httpx-toolkit nuclei \\
    && if [ -f /usr/lib/nmap/nmap ]; then setcap cap_net_bind_service,cap_net_raw=eip /usr/lib/nmap/nmap; fi \\
    && apt-get clean && rm -rf /var/lib/apt/lists/*
CMD ["/bin/bash"]
`;

export interface DockerImageLayer {
  id: string;
  status: string;
  phase: "download" | "extract" | "other";
  current?: number;
  total?: number;
  speedBytesPerSecond?: number;
}
export interface DockerImageProgress {
  stage: "pull" | "build";
  status: string;
  layers: DockerImageLayer[];
  complete: boolean;
}
export interface DockerImageOptions {
  recorder: Recorder;
  signal?: AbortSignal;
  binary?: string;
  onProgress?: (progress: DockerImageProgress) => void;
  /** Injection réservée au code et aux tests ; jamais issue de la configuration utilisateur. */
  endpoint?: string;
  request?: typeof httpRequest;
  /** Délai sans octets reçus du démon ; défaut : deux minutes. */
  inactivityTimeoutMs?: number;
}
const unexpected = () => new CodedError("docker.unexpectedOutput", { command: "images/create" });
const abort = (signal?: AbortSignal) => signal?.throwIfAborted();

/** Erreur `docker.failed` complète (binaire, code, dernières lignes d'erreur) : jamais de « ? » à l'affichage. */
function failed(command: string, result: ProcessResult, options: DockerImageOptions): DockerError {
  return dockerFailure(options.binary ?? "docker", command, result);
}

async function command(args: string[], options: DockerImageOptions, stdin?: string) {
  abort(options.signal);
  const binary = options.binary ?? "docker";
  assertBinary(binary);
  const file = resolveBinary(binary);
  if (!file) throw new CodedError("process.notFound", { binary });
  const result = await runProcess([file, ...args], {
    recorder: options.recorder,
    ...(options.signal && { signal: options.signal }),
    ...(stdin !== undefined && { stdin }),
    timeoutMs: 30 * 60 * 1000,
    maxCapturedLines: 100,
    maxJournaledLines: 2000,
    maxLineLength: 4096,
  });
  abort(options.signal);
  return result;
}

async function endpoint(options: DockerImageOptions): Promise<string> {
  if (options.endpoint) return options.endpoint;
  // DOCKER_CONTEXT prend le pas sur DOCKER_HOST, comme dans le client Docker.
  if (!process.env.DOCKER_CONTEXT && process.env.DOCKER_HOST) return process.env.DOCKER_HOST;
  const result = await command(
    ["context", "inspect", "--format", "{{json .Endpoints.docker}}"],
    options,
  );
  if (result.code !== 0) throw failed("context inspect", result, options);
  try {
    const value = JSON.parse(result.stdout.join("\n")) as { Host?: unknown };
    if (typeof value.Host === "string") return value.Host;
  } catch {
    /* Le contenu du contexte ne doit pas être recopié dans l'erreur. */
  }
  throw unexpected();
}

/** Pull public via le démon sélectionné ; les contextes distants restent dans la CLI. */
export async function pullDockerImage(image: string, options: DockerImageOptions): Promise<void> {
  assertOperand(image, "image");
  abort(options.signal);
  const host = await endpoint(options);
  if (!host.startsWith("unix://") && !host.startsWith("npipe://")) {
    options.onProgress?.({ stage: "pull", status: "cli", layers: [], complete: false });
    const result = await command(["pull", image], options);
    if (result.code !== 0) throw failed("pull", result, options);
    options.onProgress?.({ stage: "pull", status: "complete", layers: [], complete: true });
    return;
  }
  const socketPath = host.startsWith("unix://")
    ? host.slice(7)
    : host.slice(8).replaceAll("/", "\\");
  const layers = new Map<string, DockerImageLayer>();
  const samples = new Map<string, { current: number; time: number }>();
  let completed = false;
  const emit = (status: string) =>
    options.onProgress?.({
      stage: "pull",
      status,
      layers: [...layers.values()],
      complete: completed,
    });
  const parse = (line: string) => {
    if (!line.trim()) return;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw unexpected();
    }
    if (!row || typeof row !== "object" || Array.isArray(row)) throw unexpected();
    if (row.error || row.errorDetail)
      throw new CodedError("docker.failed", {
        binary: options.binary ?? "docker",
        command: "pull",
        exitCode: "null",
        stderr: String(
          row.error ?? (row.errorDetail as { message?: unknown })?.message ?? "",
        ).slice(0, 4096),
      });
    if (typeof row.status !== "string") return;
    const status = row.status.slice(0, 512);
    if (typeof row.id === "string") {
      if (layers.size >= 512 && !layers.has(row.id)) throw unexpected();
      const phase =
        status === "Downloading" ? "download" : status === "Extracting" ? "extract" : "other";
      const layer: DockerImageLayer = { id: row.id.slice(0, 128), status, phase };
      const detail = row.progressDetail as { current?: unknown; total?: unknown } | undefined;
      if (
        detail &&
        typeof detail.current === "number" &&
        Number.isFinite(detail.current) &&
        detail.current >= 0
      )
        layer.current = detail.current;
      if (
        detail &&
        typeof detail.total === "number" &&
        Number.isFinite(detail.total) &&
        detail.total > 0
      )
        layer.total = detail.total;
      if (phase === "download" && layer.current !== undefined) {
        const now = performance.now();
        const previous = samples.get(row.id);
        if (previous && now > previous.time && layer.current >= previous.current)
          layer.speedBytesPerSecond =
            ((layer.current - previous.current) * 1000) / (now - previous.time);
        samples.set(row.id, { current: layer.current, time: now });
      } else samples.delete(row.id);
      layers.set(row.id, layer);
    }
    if (
      status.startsWith("Status: Downloaded newer image") ||
      status.startsWith("Status: Image is up to date")
    )
      completed = true;
    emit(status);
  };
  await new Promise<void>((resolve, reject) => {
    const requestOptions: RequestOptions = {
      socketPath,
      method: "POST",
      path: `/images/create?fromImage=${encodeURIComponent(image)}`,
      ...(options.signal && { signal: options.signal }),
    };
    const req = (options.request ?? httpRequest)(requestOptions, (response) => {
      if (response.statusCode !== 200) {
        response.destroy();
        reject(
          new CodedError("docker.failed", {
            binary: options.binary ?? "docker",
            command: "pull",
            exitCode: response.statusCode ?? 0,
            stderr: `HTTP ${response.statusCode ?? 0}`,
          }),
        );
        return;
      }
      const decoder = new StringDecoder("utf8");
      let buffer = "";
      response.on("data", (chunk: Buffer) => {
        try {
          buffer += decoder.write(chunk);
          let newline = buffer.indexOf("\n");
          while (newline !== -1) {
            if (newline > 64 * 1024) throw unexpected();
            parse(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");
          }
          if (buffer.length > 64 * 1024) throw unexpected();
        } catch (error) {
          req.destroy();
          reject(error);
        }
      });
      response.on("error", reject);
      response.on("end", () => {
        try {
          buffer += decoder.end();
          parse(buffer);
          abort(options.signal);
          if (!completed) throw unexpected();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
    req.setTimeout(options.inactivityTimeoutMs ?? 120_000, () => {
      req.destroy(
        new CodedError("docker.failed", {
          binary: options.binary ?? "docker",
          command: "pull",
          exitCode: "timeout",
          stderr: "",
        }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

/** Prépare uniquement l'image locale ; aucune publication de registre. */
export async function ensureWarbandKaliImage(options: DockerImageOptions): Promise<string> {
  const existing = await command(["image", "inspect", WARBAND_KALI_IMAGE], options);
  if (existing.code === 0) return WARBAND_KALI_IMAGE;
  await pullDockerImage(KALI_BASE_IMAGE, options);
  abort(options.signal);
  options.onProgress?.({ stage: "build", status: "build", layers: [], complete: false });
  const result = await command(
    ["build", "--progress", "plain", "--pull=false", "-t", WARBAND_KALI_IMAGE, "-"],
    options,
    WARBAND_KALI_DOCKERFILE,
  );
  if (result.code !== 0) throw failed("build", result, options);
  options.onProgress?.({ stage: "build", status: "complete", layers: [], complete: true });
  return WARBAND_KALI_IMAGE;
}
