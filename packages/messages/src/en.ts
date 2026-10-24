import type { Catalog, EventStrings, Messages } from "./catalog.js";

const text = (v: string | number | undefined): string => (v === undefined ? "?" : String(v));

/** Catalogue minimal : les codes absents se replient sur le français, puis sur `code + params`. */
export const reasons: Catalog = {
  "policy.rule": (p) => `rule #${text(p.index)} ${text(p.decision)} ${text(p.target)}`,
  "policy.rule.custom": (p) => text(p.text),
  "policy.default": (p) => `no rule for tool ${text(p.tool)}`,
  "bash.unparseable": (_p, c) => `unparseable command: ${c.cause ?? "?"}`,
  "bash.empty": () => "empty command",
  "bash.missingCommand": () => "missing command",
  "bash.noRule": (p) => `no rule for "${text(p.command)}"`,
  "process.commandTooLong": (p) =>
    `command line too long for the system (${text(p.length)} characters)`,
  "sandbox.tampered": (p) => `sandbox tampered with (${text(p.field)}): execution denied`,
  "sandbox.interpreter": (p) =>
    `interpreter or wrapper in the sandbox (${text(p.program)}): approval required`,
  "sandbox.tarRejected": (p) =>
    `tar archive rejected (${text(p.reason)})${p.entry === undefined ? "" : `: ${text(p.entry)}`}, nothing written`,
  "sandbox.unavailable": () => "sandbox unavailable",
  "sandbox.networkUnsafe": (p) =>
    p.reason === "adapterServer"
      ? "bridge network refused: adapter local server reachable from the container"
      : `bridge network refused: Docker API exposed on 127.0.0.1:${text(p.port)}`,
  "sandbox.execTimeout": (p) =>
    `timeout of ${text(p.seconds)} s exceeded: sandbox ${p.restarted === 1 ? "restarted" : "out of service"}. Partial output:\n${text(p.output)}`,
  "sandbox.execAborted": (p) =>
    `execution cancelled: sandbox ${p.restarted === 1 ? "restarted" : "out of service"}. Partial output:\n${text(p.output)}`,
  "sandbox.unknownContainer": () => "container not in the sandbox registry: denied",
  "policy.invalid.commandWildcard": (p) =>
    `invalid policy: rules[${text(p.index)}].command, "*" must be a whole token (no partial wildcard)`,
  "docker.hostAccess": (p) => `container with host access (${text(p.flag)}): do it by hand`,
  "docker.invalidArgument": (p) => `invalid argument (${text(p.field)}): ${text(p.reason)}`,
  "docker.invalidBinary": (p) =>
    `invalid docker binary: "${text(p.binary)}" (bare name or absolute path expected)`,
  "binary.shimUnsupported": (p) =>
    `the ${text(p.shim)} script (.cmd/.bat shim) is never run: pass the absolute path of the ${text(p.binary)} .exe`,
  "docker.unexpectedOutput": (p) =>
    `unexpected docker ${text(p.command)} output${p.line === undefined ? "" : ` (line ${text(p.line)})`}: docker only, podman is not supported`,
  "project.notFound": (p) => `container not found: ${text(p.name)}`,
  "project.notExegol": (p) => `not an Exegol container: ${text(p.name)}`,
  "project.notRunning": (p) => `container not running: ${text(p.name)}`,
  "project.noWorkspace": (p) => `container without /workspace mount: ${text(p.name)}`,
  "project.invalid": () => "invalid project: unreadable or incomplete project.json",
  "project.absent": () => "no linked project (project.json missing)",
  "cours.absent": () => "no course installed (course folder missing)",
  "exegol.containerDenied": (p) =>
    `container not allowed for this message: ${text(p.name)} (project allowlist, named with @, or designated by #)`,
  "kali.unavailable": (p) => `Kali server unavailable in the container: ${text(p.name)}`,
  "shell.unanalyzable": (p) =>
    `shell cannot be analysed safely (${text(p.tool)}): never auto-approved nor remembered`,
  "sdk.unexpectedTool": (p) =>
    `unexpected shell tool announced by the SDK (${text(p.tool)}): run stopped`,
  "path.sensitive": (p) => `sensitive path: ${text(p.path)}`,
  "path.outside": (p) => `path outside the workspace: ${text(p.path)}`,
  "path.unsupported": (p) =>
    `path cannot be analysed safely, denied (${text(p.form)}): ${text(p.path)}`,
  "approval.noAsker": (_p, c) => `${c.cause ?? "?"} (no interactive approver)`,
  "approval.interrupted": (_p, c) => `approval interrupted: ${c.cause ?? "?"}`,
  "approval.timeout": (p, c) => `no answer within ${text(p.seconds)} s: denied (${c.cause ?? "?"})`,
  "approval.remembered": (_p, c) => `allowed for the session (${c.cause ?? "?"})`,
  "approval.bypassed": (_p, c) => `auto-approved by the bypass (${c.cause ?? "?"})`,
  "bypass.enabled": () => "approval bypass enabled",
  "bypass.disabled": () => "approval bypass disabled",
  "bypass.expired": () => "approval bypass expired",
  "auth.missingApiKey": () => "--auth api-key requires ANTHROPIC_API_KEY, which is not set",
  "budget.exceeded": (p) => `spending limit exceeded: $${text(p.spent)} spent of $${text(p.limit)}`,
  "opencode.noModel": () =>
    'no model: pass --model provider/model (or set "model" in the OpenCode configuration)',
  "extension.binaryMismatch": () =>
    "claude binary missing or tampered with (SHA-256 mismatch): denied",
  "ipc.invalidMessage": (p) => `invalid engine message (${text(p.field)}): ignored`,
  "ipc.unsupportedVersion": (p) =>
    `unsupported protocol version (${text(p.version)}, expected ${text(p.known)})`,
  "ipc.startTimeout": (p) => `engine did not start within ${text(p.seconds)} s`,
  "ipc.engineExited": (p) =>
    `engine exited (${p.signal === undefined ? `code ${text(p.code)}` : `signal ${text(p.signal)}`})`,
  "shell.unclosedQuote": (p) => `unclosed quote ${text(p.quote)}`,
  "shell.trailingBackslash": () => "trailing backslash",
  "error.unknown": (p) => (p.message === undefined ? "unknown error" : text(p.message)),
  legacy: (p) => text(p.text),
};

export const events: EventStrings = {
  run: "run",
  user: "user",
  thinking: "thinking",
  thinkingMasked: "thinking (hidden)",
  deniedBySdk: "denied by the SDK",
  retry: "retry",
  task: "task",
  rateLimit: "usage limit",
  session: "session",
  tools: "tools",
  turns: "turns",
  journalTruncated: "journal truncated",
  lostEvents: "events lost",
  lines: "l.",
  authSubscription: "subscription",
  authApiKey: "API key",
  authCloud: "cloud provider",
  authUnknown: "unknown",
  authentication: "authentication",
  authenticating: "authenticating",
  approvalRequested: "approval requested",
  bypass: "bypass",
  turn: "turn",
  sandbox: "sandbox",
};

export const en: Messages = { reasons, events };
