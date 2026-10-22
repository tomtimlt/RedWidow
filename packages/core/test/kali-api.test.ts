import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatError, formatReason } from "@warband/messages";
import { describe, expect, it } from "vitest";
import type { LabelPrefixContainer } from "../src/docker/client.js";
import type { DockerToolContext } from "../src/docker/tool-specs.js";
import {
  CodedError,
  createExegolTargets,
  createKaliApi,
  createRecorder,
  KALI_EXEC_TIMEOUT_MS,
  KALI_EXECUTE_TOOL,
  KALI_HTTP_SCRIPT,
  KALI_SERVER_NAME,
  KALI_TOOL_PREFIX,
  kaliToolSpecs,
} from "../src/index.js";

const START = (name: string) => [
  "exec",
  "--detach",
  "--workdir",
  "/workspace",
  name,
  "kali-server-mcp",
  "--ip",
  "127.0.0.1",
  "--port",
  "5000",
];

const FORBIDDEN = ["--publish", "-p", "--privileged", "--network", "--volume", "--mount", "-v"];

const MKDIR = (name: string) => ["exec", "-u", "root", name, "mkdir", "-p", "/workspace"];

const commandOf = (argv: readonly string[]): string =>
  argv[4] === "mkdir" ? "mkdir" : (argv[5] ?? "");

const ctx: DockerToolContext = { parentId: null, correlation: undefined, signal: undefined };

const kali = (name: string, state: "running" | "stopped" = "running", workspace?: string) =>
  ({
    state,
    name,
    image: "kalilinux/kali-rolling",
    family: "kali" as const,
    ...(workspace !== undefined && { workspace }),
  }) satisfies LabelPrefixContainer;

const lab: LabelPrefixContainer = {
  state: "running",
  name: "lab",
  image: "exegol",
  workspace: "/host/lab",
  family: "exegol",
};

interface Logged {
  argv: string[];
  stdin: string;
}

async function harness(
  mode: "up" | "down" | "binary" | "nomkdir",
  rows: readonly LabelPrefixContainer[],
  dedicated = "kali-box",
) {
  const dir = await mkdtemp(join(tmpdir(), "warband-kali-"));
  const script = join(dir, "docker.mjs");
  const log = join(dir, "calls.log");
  await writeFile(
    script,
    `import { appendFileSync, readFileSync } from "node:fs";
let stdin = "";
try { stdin = readFileSync(0, "utf8"); } catch { stdin = ""; }
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, stdin }) + "\\n");
const mode = ${JSON.stringify(mode)};
if (argv[4] === "mkdir") {
  if (mode === "nomkdir") { process.stderr.write("mkdir: échec\\n"); process.exit(1); }
  process.exit(0);
}
if (argv[5] === "kali-server-mcp") process.exit(mode === "binary" ? 127 : 0);
if (mode === "up") { process.stdout.write("{\\"ok\\":true}\\n"); process.exit(0); }
process.stderr.write("connect\\n");
process.exit(2);
`,
  );
  const targets = createExegolTargets();
  targets.note("", dedicated);
  const api = createKaliApi({
    recorder: createRecorder(),
    binary: process.execPath,
    argsPrefix: [script],
    pauseMs: 0,
  });
  const specs = kaliToolSpecs({ listLabelPrefix: async () => [...rows] }, api, targets);
  const calls = async (): Promise<Logged[]> => {
    const text = await readFile(log, "utf8").catch(() => "");
    return text
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as Logged);
  };
  const tool = (name: string) => {
    const found = specs.find((s) => s.name === name);
    if (found === undefined) throw new Error(name);
    return found;
  };
  return { specs, calls, tool };
}

describe("outils Kali", () => {
  it("enregistre exactement les douze noms", async () => {
    const { specs } = await harness("up", [kali("kali-box", "running", "/host/kali")]);
    expect(specs.map((s) => s.name)).toEqual([
      "nmap_scan",
      "gobuster_scan",
      "dirb_scan",
      "nikto_scan",
      "sqlmap_scan",
      "metasploit_run",
      "hydra_attack",
      "john_crack",
      "wpscan_analyze",
      "enum4linux_scan",
      "server_health",
      "execute_command",
    ]);
    expect(specs).toHaveLength(12);
    expect(KALI_SERVER_NAME).toBe("kali");
    expect(KALI_TOOL_PREFIX).toBe("mcp__kali__");
    expect(KALI_EXECUTE_TOOL).toBe("mcp__kali__execute_command");
    expect(KALI_EXEC_TIMEOUT_MS).toBe(600_000);
  });

  it("libellés de kali.unavailable", () => {
    const reason = { code: "kali.unavailable" as const, params: { name: "kali-box" } };
    expect(formatReason(reason)).toBe("serveur Kali indisponible dans le conteneur : kali-box");
    expect(formatReason(reason, "en")).toBe("Kali server unavailable in the container: kali-box");
  });
});

describe("appel HTTP Kali", () => {
  const rows = [kali("kali-box", "running", "/host/kali"), lab];

  it("santé déjà là : pas de démarrage, corps sans chaîne vide ni container", async () => {
    const { tool, calls } = await harness("up", rows);
    await tool("nmap_scan").run(
      {
        container: "kali-box",
        target: "10.0.0.1",
        ports: "",
        scan_type: "-sV",
        additional_args: "",
      },
      ctx,
    );
    const logged = await calls();
    expect(logged.map((c) => commandOf(c.argv))).toEqual(["mkdir", "python3", "python3"]);
    expect(logged[0]?.argv).toEqual(MKDIR("kali-box"));
    expect(logged[0]?.argv).not.toContain("--workdir");
    const post = logged[2];
    expect(post?.argv.slice(0, 7)).toEqual([
      "exec",
      "--interactive",
      "--workdir",
      "/workspace",
      "kali-box",
      "python3",
      "-c",
    ]);
    expect(post?.argv[7]).toBe(KALI_HTTP_SCRIPT);
    expect(post?.argv[7]).toContain("http://127.0.0.1:5000");
    expect(post?.argv[7]).toContain("timeout=300");
    expect(post?.argv[7]).not.toContain("10.0.0.1");
    expect(post?.argv[7]).not.toContain("kali-box");
    expect(JSON.parse(post?.stdin ?? "")).toEqual({
      method: "POST",
      path: "/api/tools/nmap",
      body: { target: "10.0.0.1", scan_type: "-sV" },
    });
    for (const call of logged) {
      if (call.argv[4] === "mkdir") expect(call.argv[3]).toBe("kali-box");
      else expect(call.argv[4]).toBe("kali-box");
    }
  });

  it("mkdir utilise le nom réel de la liste, pas le jeton court", async () => {
    const { tool, calls } = await harness(
      "up",
      [kali("exegol-frost", "running", "/host/kali")],
      "exegol-frost",
    );
    await tool("server_health").run({ container: "frost" }, ctx);
    const logged = await calls();
    expect(logged[0]?.argv).toEqual(MKDIR("exegol-frost"));
    expect(logged[0]?.argv).not.toContain("frost");
    expect(logged.map((c) => commandOf(c.argv))[0]).toBe("mkdir");
  });

  it("mkdir refusé : kali.unavailable, sans démarrage", async () => {
    const { tool, calls } = await harness("nomkdir", rows);
    const error = await tool("server_health")
      .run({ container: "kali-box" }, ctx)
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(error).toBeInstanceOf(CodedError);
    if (!(error instanceof CodedError)) return;
    expect(error.code).toBe("kali.unavailable");
    expect(error.params).toEqual({ name: "kali-box" });
    expect(formatError(error)).toBe("serveur Kali indisponible dans le conteneur : kali-box");
    const logged = await calls();
    expect(logged.map((c) => commandOf(c.argv))).toEqual(["mkdir"]);
    expect(logged.some((c) => c.argv.includes("kali-server-mcp"))).toBe(false);
  });

  it("nmap envoie scan_type et additional_args en chaînes", async () => {
    const { tool, calls } = await harness("up", rows);
    await tool("nmap_scan").run(
      {
        container: "kali-box",
        target: "10.0.0.1",
        scan_type: "-sT -F",
        ports: "80,443",
        additional_args: "-T4 -Pn",
      },
      ctx,
    );
    const body = JSON.parse((await calls()).at(-1)?.stdin ?? "").body as Record<string, unknown>;
    expect(body).toEqual({
      target: "10.0.0.1",
      scan_type: "-sT -F",
      ports: "80,443",
      additional_args: "-T4 -Pn",
    });
    expect(typeof body.scan_type).toBe("string");
    expect(typeof body.additional_args).toBe("string");
    expect(Array.isArray(body.scan_type)).toBe(false);
    expect(Array.isArray(body.additional_args)).toBe(false);
  });

  it("un tableau pour scan_type ou additional_args ne part pas dans le JSON", async () => {
    const { tool, calls } = await harness("up", rows);
    await expect(
      tool("nmap_scan").run(
        { container: "kali-box", target: "10.0.0.1", scan_type: ["-sT", "-F"] },
        ctx,
      ),
    ).rejects.toThrow();
    await expect(
      tool("gobuster_scan").run(
        { container: "kali-box", url: "http://10.0.0.1", additional_args: ["-q"] },
        ctx,
      ),
    ).rejects.toThrow();
    expect(await calls()).toEqual([]);
  });

  it("additional_args reste une chaîne pour chaque outil qui le déclare", async () => {
    const { tool, calls } = await harness("up", rows);
    const cases: { name: string; args: Record<string, string> }[] = [
      { name: "gobuster_scan", args: { url: "http://10.0.0.1", additional_args: "-q -t 4" } },
      { name: "dirb_scan", args: { url: "http://10.0.0.1", additional_args: "-r -S" } },
      { name: "nikto_scan", args: { target: "10.0.0.1", additional_args: "-Tuning 1" } },
      {
        name: "sqlmap_scan",
        args: { url: "http://10.0.0.1", additional_args: "--batch --level 1" },
      },
      {
        name: "hydra_attack",
        args: {
          target: "10.0.0.1",
          service: "ssh",
          username: "a",
          password: "b",
          additional_args: "-t 4 -f",
        },
      },
      { name: "john_crack", args: { hash_file: "hashes.txt", additional_args: "--fork 2" } },
      { name: "wpscan_analyze", args: { url: "http://10.0.0.1", additional_args: "--stealthy" } },
      { name: "enum4linux_scan", args: { target: "10.0.0.1", additional_args: "-a -u a" } },
    ];
    for (const c of cases) {
      await tool(c.name).run({ container: "kali-box", ...c.args }, ctx);
      const body = JSON.parse((await calls()).at(-1)?.stdin ?? "").body as Record<string, unknown>;
      expect(body.additional_args, c.name).toBe(c.args.additional_args);
      expect(typeof body.additional_args, c.name).toBe("string");
    }
  });

  it("execute_command envoie encore command comme une chaîne", async () => {
    const { tool, calls } = await harness("up", rows);
    await tool("execute_command").run(
      { container: "kali-box", command: "nmap -sT -F 10.0.0.1" },
      ctx,
    );
    const body = JSON.parse((await calls()).at(-1)?.stdin ?? "").body as Record<string, unknown>;
    expect(body).toEqual({ command: "nmap -sT -F 10.0.0.1" });
    expect(typeof body.command).toBe("string");
  });

  it("john envoie format, pas format_type, et omet container", async () => {
    const { tool, calls } = await harness("up", rows);
    await tool("john_crack").run(
      {
        container: "kali-box",
        hash_file: "hashes.txt",
        format: "nt",
        wordlist: "",
        additional_args: "",
        format_type: "raw",
      },
      ctx,
    );
    const logged = await calls();
    const body = JSON.parse(logged.at(-1)?.stdin ?? "").body;
    expect(body).toEqual({ hash_file: "hashes.txt", format: "nt" });
    expect(body).not.toHaveProperty("format_type");
    expect(body).not.toHaveProperty("container");
  });

  it("champ requis manquant ou vide : pas d'exec", async () => {
    const { tool, calls } = await harness("up", rows);
    await expect(tool("nmap_scan").run({ container: "kali-box" }, ctx)).rejects.toThrow();
    await expect(
      tool("nmap_scan").run({ container: "kali-box", target: "" }, ctx),
    ).rejects.toThrow();
    expect(await calls()).toEqual([]);
  });

  it("refuse un Exegol, un absent et un arrêté avant tout exec", async () => {
    const { tool, calls } = await harness("up", rows);
    await expect(
      tool("nmap_scan").run({ container: "lab", target: "10.0.0.1" }, ctx),
    ).rejects.toMatchObject({ code: "exegol.containerDenied" });
    await expect(
      tool("nmap_scan").run({ container: "absent", target: "10.0.0.1" }, ctx),
    ).rejects.toMatchObject({ code: "exegol.containerDenied" });
    const stopped = await harness("up", [kali("kali-box", "stopped", "/host/kali")]);
    await expect(
      stopped.tool("nmap_scan").run({ container: "kali-box", target: "10.0.0.1" }, ctx),
    ).rejects.toMatchObject({ code: "project.notRunning", params: { name: "kali-box" } });
    expect(await calls()).toEqual([]);
    expect(await stopped.calls()).toEqual([]);
  });

  it("santé en échec : un démarrage du nom résolu, puis dix lectures", async () => {
    const { tool, calls } = await harness("down", rows);
    await expect(
      tool("nmap_scan").run({ container: "kali-box", target: "10.0.0.1" }, ctx),
    ).rejects.toMatchObject({ code: "kali.unavailable", params: { name: "kali-box" } });
    const logged = await calls();
    const starts = logged.filter((c) => c.argv[5] === "kali-server-mcp");
    expect(starts).toHaveLength(1);
    expect(starts[0]?.argv).toEqual(START("kali-box"));
    for (const flag of FORBIDDEN) expect(starts[0]?.argv).not.toContain(flag);
    expect(logged.filter((c) => c.argv[4] === "mkdir")).toHaveLength(1);
    expect(logged[0]?.argv).toEqual(MKDIR("kali-box"));
    expect(logged.filter((c) => c.argv[5] === "python3")).toHaveLength(11);
    for (const call of logged) {
      if (call.argv[4] === "mkdir") expect(call.argv[3]).toBe("kali-box");
      else expect(call.argv[4]).toBe("kali-box");
      expect(call.argv).not.toContain("lab");
    }
  });

  it("binaire refusé : kali.unavailable, sans seconde commande", async () => {
    const { tool, calls } = await harness("binary", rows);
    await expect(tool("server_health").run({ container: "kali-box" }, ctx)).rejects.toMatchObject({
      code: "kali.unavailable",
      params: { name: "kali-box" },
    });
    const logged = await calls();
    expect(logged.map((c) => commandOf(c.argv))).toEqual(["mkdir", "python3", "kali-server-mcp"]);
    expect(logged[0]?.argv).toEqual(MKDIR("kali-box"));
    expect(logged[2]?.argv).toEqual(START("kali-box"));
    const flat = logged.flatMap((c) => c.argv).join("\n");
    expect(flat).not.toContain("server.py");
    expect(flat).not.toContain("apt");
  });
});
