import type { Catalog, EventStrings, Messages } from "./catalog.js";

const text = (v: string | number | undefined): string => (v === undefined ? "?" : String(v));

/** Paramètres techniques rendus dans la langue de l'interface. */
const PATH_FORMS: Readonly<Record<string, string>> = {
  unc: "network path (UNC)",
  device: "device path (\\\\?\\ or \\\\.\\)",
  ads: "alternate data stream (colon in name)",
  "drive-relative": "drive-relative path (C:file)",
  "trailing-dot-space": "name ending in a dot or space",
  "reserved-name": "reserved device name (CON, NUL, COM1…)",
  "env-var": "unexpanded environment variable (%VAR%)",
  "short-name": "unresolved 8.3 short name (~1)",
  unresolvable: "path cannot be resolved safely",
};
const HAZARDS: Readonly<Record<string, string>> = {
  substitution: "command substitution",
  expansion: "expansion not resolved statically",
  redirect: "redirection",
  assignment: "leading variable assignment",
  background: "background execution",
  indirection: "executes another command (bash -c, env, xargs, find -exec…)",
};
const OPERANDS: Readonly<Record<string, string>> = {
  container: "container",
  name: "name",
  image: "image",
  target: "target",
  since: "since",
};
const ARGUMENT_REASONS: Readonly<Record<string, string>> = {
  nul: "contains a NUL character",
  tooMany: "too many items (maximum 256)",
  tooLarge: "too large (maximum 32 KiB)",
  notStrings: "array of strings expected",
  notString: "string expected",
  program: "program must not be empty or start with '-'",
  delimiter: "forbidden character in mount",
  relative: "relative or non-absolute path",
  root: "filesystem root",
  socket: "Docker socket",
  missing: "directory not found",
  unsupported: "path cannot be analysed",
  sensitive: "sensitive path",
  notDirectory: "directory expected",
};
const IMAGE_REASONS: Readonly<Record<string, string>> = {
  missing: "no image provided: use --sandbox-image or user configuration",
  absent: "image not present locally; the engine never downloads images",
  noSleep: "image must provide sleep",
  init: "image must provide mkdir and chmod",
};
const SANDBOX_ARGUMENT_REASONS: Readonly<Record<string, string>> = {
  ...ARGUMENT_REASONS,
  empty: "empty",
  notAbsolute: "absolute path expected",
  outside: "outside /work or contains '..'",
  range: "outside allowed bounds",
  format: "unsupported format",
  required: "--sandbox option required",
};
const TAR_REASONS: Readonly<Record<string, string>> = {
  symlink: "symbolic link",
  hardlink: "hard link",
  special: "unsupported entry type (device, FIFO…)",
  traversal: "path outside root (..)",
  absolute: "absolute path",
  name: "invalid entry name",
  nameTooLong: "entry name too long",
  winName: "reserved Windows name or data stream",
  tooLarge: "size exceeds limit",
  tooManyEntries: "too many entries",
  pax: "unsupported pax header",
  malformed: "malformed archive",
  checksum: "invalid checksum",
  truncated: "truncated archive",
  multiRoot: "multiple roots",
  duplicate: "duplicate entry",
  conflict: "a file is used as a parent directory",
  destExists: "destination already exists",
  destDenied: "destination outside workspace",
  sensitive: "sensitive path",
  notRegular: "neither a regular file nor a directory",
};

/** Catalogue anglais complet, vérifié contre `REASON_CODES`. */
export const reasons: Catalog = {
  "integration.invalidConfig": () => "Invalid local MCP configuration.",
  "integration.invalidResponse": () =>
    "Local MCP response rejected: invalid origin, size or format.",
  "integration.unavailable": () =>
    "Local MCP service unavailable. Check its state before retrying an action.",
  "integration.timeout": () =>
    "MCP timed out; an action may still be running. Check its state before retrying.",
  "burp.invalidConfig": () =>
    "Invalid Burp MCP configuration: local port and SSE or HTTP transport required.",
  "burp.invalidResponse": () => "Burp MCP response rejected: invalid origin, format or size.",
  "burp.unavailable": () =>
    "Burp MCP connection failed or was interrupted. Check Burp and its local MCP extension. An action may still be running; check its state before retrying.",
  "burp.timeout": () =>
    "Burp MCP timed out. An action may still be running; check its state in Burp before retrying.",
  "opencode.httpFailed": (p) =>
    `OpenCode request failed: ${text(p.operation)} (HTTP ${text(p.status)})`,
  "kali.taskRequired": () =>
    "Full-port scan not started: use mcp__kali__task_start with nmap argv, then task_status. Synchronous scans are not tracked by task_list and may keep running after an MCP timeout.",
  "task.invalidResponse": () => "invalid task response; check existing tasks before starting again",
  "policy.rule": (p) => `rule #${text(p.index)} ${text(p.decision)} ${text(p.target)}`,
  "policy.rule.custom": (p) => text(p.text),
  "policy.default": (p) => `no rule for tool ${text(p.tool)}`,
  "bash.unparseable": (_p, c) => `unparseable command: ${c.cause ?? "?"}`,
  "bash.empty": () => "empty command",
  "bash.missingCommand": () => "missing command",
  "bash.noRule": (p) => `no rule for "${text(p.command)}"`,
  "process.commandTooLong": (p) =>
    `command line too long for the system (${text(p.length)} characters)`,
  "sandbox.tampered": (p) =>
    `sandbox tampered with (${text(p.field)}): execution denied, never remembered`,
  "sandbox.interpreter": (p) =>
    `interpreter or wrapper in the sandbox (${text(p.program)}): the actual command cannot be verified, approval required`,
  "sandbox.tarRejected": (p) =>
    `tar archive rejected (${TAR_REASONS[text(p.reason)] ?? text(p.reason)})${p.entry === undefined ? "" : `: ${text(p.entry)}`}, nothing written`,
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
  "docker.invalidArgument": (p) =>
    `invalid argument (${text(p.field)}): ${ARGUMENT_REASONS[text(p.reason)] ?? text(p.reason)}`,
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
  "finding.busy": () => "Project findings are busy. Retry after the current operation completes.",
  "web.invalidUrl": () => "Web tools require a public HTTP(S) URL without credentials.",
  "web.unavailable": (p) =>
    `The web request failed${p.status ? ` (HTTP ${p.status})` : ""}. Retry or check the connection.`,
  "web.timeout": (p) => `The web request exceeded ${text(p.seconds)} seconds.`,
  "web.dnsFailed": (p) =>
    `Web DNS resolution failed (${text(p.code)}). Check the network or proxy.`,
  "web.tlsFailed": (p) =>
    `HTTPS certificate verification failed (${text(p.code)}). Check trusted certificates and the proxy.`,
  "web.connectionFailed": (p) =>
    `Web connection failed (${text(p.code)}). Check the network or proxy.`,
  "web.rateLimited": () => "The web service is rate limited (HTTP 429). Retry later.",
  "web.tooLarge": () => "The page exceeds the 1 MiB read limit.",
  "web.unsupportedType": () => "This web content type is not supported.",
  "web.reference_source": (p) => `read allowed: reference source (${text(p.host)}), HTTPS only`,
  "web.query_sensitive": (p) =>
    `${text(p.tool)}: the query or URL could leak to a third party (finding: ${text(p.finding)}; secret, masked value or private address), approval required on every call`,
  "web.redirectOffList": (p) =>
    `redirect to ${text(p.host)}, outside the reference sources: read stopped; call read_url on the target to submit it for approval`,
  "web.searchFailed": () => "The search service returned no usable response.",
  "kali.nmapUnavailable": () =>
    "Nmap cannot execute in this container. Check its Linux capabilities and Docker restrictions.",
  "finding.notFound": () => "Finding not found in the active project.",
  "finding.invalidLinks": () => "Invalid finding links: unknown reference or causal cycle.",
  "finding.labelInvalid": (p) =>
    `invalid finding label: use a title of 1 to ${text(p.max)} characters; keep details in the results file and retry note with a short title.`,
  "project.invalid": () => "invalid project: unreadable or incomplete project.json",
  "program.unreadable": (p) =>
    p.part === "approval"
      ? "program sheet: unreadable approval, sheet not applied"
      : "program sheet: unreadable draft, sheet not applied",
  "program.invalid": (p) =>
    `invalid program sheet${p.field ? ` (field: ${text(p.field)})` : ""}: expected host patterns, URL, date, suffix and pace`,
  "program.absent": () => "no program sheet to handle for this project",
  "project.absent": () => "no active project",
  "project.readFailed": () => "could not read the active project this turn",
  "cours.absent": () => "no course installed (course folder missing)",
  "exegol.containerDenied": (p) =>
    `container not allowed for this message: ${text(p.name)} (project allowlist, named with @, or designated by #)`,
  "kali.unavailable": (p) => {
    const name = text(p.name);
    if (p.reason === "unsupportedImage")
      return `Cannot prepare ${name}: a Kali image with APT is required to install the missing server`;
    if (p.stage === "installing")
      return `Kali server installation failed in ${name}: see RedWidow output`;
    if (p.stage === "checking")
      return `Kali prerequisite check failed in ${name}: see RedWidow output`;
    return `Kali server unavailable in the container: ${name}`;
  },
  "shell.unanalyzable": (p) =>
    `shell cannot be analysed safely (${text(p.tool)}): never auto-approved nor remembered`,
  "sdk.unexpectedTool": (p) =>
    `unexpected shell tool announced by the SDK (${text(p.tool)}): run stopped`,
  "path.sensitive": (p) => `sensitive path: ${text(p.path)}`,
  "path.outside": (p) => `path outside the workspace: ${text(p.path)}`,
  "path.unsupported": (p) =>
    `path cannot be analysed safely, denied (${PATH_FORMS[text(p.form)] ?? text(p.form)}): ${text(p.path)}`,
  "approval.noAsker": (_p, c) => `${c.cause ?? "?"} (no interactive approver)`,
  "approval.interrupted": (_p, c) => `approval interrupted: ${c.cause ?? "?"}`,
  "approval.timeout": (p, c) => `no answer within ${text(p.seconds)} s: denied (${c.cause ?? "?"})`,
  "approval.remembered": (_p, c) => `allowed for the session (${c.cause ?? "?"})`,
  "approval.bypassed": (_p, c) => `auto-approved by the bypass (${c.cause ?? "?"})`,
  "approval.override": (_p, c) =>
    `refusal overridden by the bypass, under the user's responsibility (${c.cause ?? "?"})`,
  "bypass.enabled": () => "approval bypass enabled",
  "bypass.disabled": () => "approval bypass disabled",
  "bypass.expired": () => "approval bypass expired",
  "auth.missingApiKey": () => "--auth api-key requires ANTHROPIC_API_KEY, which is not set",
  "budget.exceeded": (p) => `spending limit exceeded: $${text(p.spent)} spent of $${text(p.limit)}`,
  "opencode.noModel": () =>
    'no model: pass --model provider/model (or set "model" in the OpenCode configuration)',
  "opencode.invalidVariant": () =>
    "reasoning variant unavailable for the selected OpenCode model: select Auto or refresh the catalog",
  "opencode.unsupportedEffort": () =>
    "Claude effort levels are not supported by OpenCode: select a catalog variant",
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

  "bash.hazard": (p) =>
    `cannot be auto-approved: ${text(p.hazards)
      .split(",")
      .map((h) => HAZARDS[h] ?? h)
      .join(", ")}`,
  "guard.unrouted": (p) =>
    `call not routed through the guard (canUseTool called without a PreToolUse decision: ${text(p.tool)}, ${text(p.toolUseId)})`,
  "auth.failed": () =>
    "authentication failed: run 'claude' then /login (or 'claude setup-token' and export CLAUDE_CODE_OAUTH_TOKEN), or set ANTHROPIC_API_KEY",
  "auth.orgNotAllowed": () =>
    "the signed-in account's organization is not allowed: sign in again with /login (allowed account) or set ANTHROPIC_API_KEY",
  "provider.authFailed": (p) =>
    `authentication rejected by provider ${text(p.provider)}: run 'opencode auth login' or pass its key with --pass-env <VARIABLE>`,
  "provider.error": (p) =>
    `model provider error (${text(p.name)}): ${text(p.message)}${p.status === undefined ? "" : ` [HTTP ${text(p.status)}]`}`,
  "opencode.unsafeConfig": (p) =>
    `OpenCode configuration is too permissive (${text(p.setting)}): warband requires 'ask' or 'deny' for every tool`,
  "opencode.invalidModel": (p) =>
    `invalid model: '${text(p.value)}' (expected format: provider/model)`,
  "opencode.serverFailed": (p) => `OpenCode server failed to start: ${text(p.detail)}`,
  "opencode.serverTimeout": (p) => `OpenCode server did not respond within ${text(p.seconds)} s`,
  "opencode.sessionNotFound": (p) => `OpenCode session not found: ${text(p.id)}`,
  "opencode.pathUnknown": (p) =>
    `path for tool ${text(p.tool)} not found: denied because safeguards cannot be applied`,
  "opencode.replyFailed": (p) =>
    `OpenCode permission reply rejected by the server (HTTP ${text(p.status)}): session interrupted`,
  "policy.invalid.object": () => "invalid policy: object expected",
  "policy.invalid.default": (p) => `invalid policy: default '${text(p.value)}'`,
  "policy.invalid.rules": () => "invalid policy: rules must be an array",
  "policy.invalid.ruleObject": (p) => `invalid policy: rules[${text(p.index)}] object expected`,
  "policy.invalid.ruleField": (p) => `invalid policy: rules[${text(p.index)}].${text(p.field)}`,
  "policy.repo.untrusted": (p) =>
    `repository policy ignored (not trusted): ${text(p.path)} [sha256 ${text(p.digest)}]. After review: warband policy trust`,
  "policy.repo.modified": (p) =>
    `repository policy ignored (changed since approval): ${text(p.path)} [sha256 ${text(p.digest)}]. After review: warband policy trust`,
  "docker.failed": (p) =>
    `${text(p.binary)} ${text(p.command)} failed (code ${text(p.exitCode)}): ${text(p.stderr)}`,
  "docker.invalidOperand": (p) =>
    `invalid ${OPERANDS[text(p.label)] ?? text(p.label)}: '${text(p.value)}'`,
  "docker.invalidTail": (p) => `invalid tail: ${text(p.value)}`,
  "docker.invalidPort": (p) => `invalid port: '${text(p.value)}'`,
  "docker.invalidEnvKey": (p) => `invalid variable: '${text(p.key)}'`,
  "process.emptyArgv": () => "empty argv",
  "process.notFound": (p) => `binary not found: ${text(p.binary)}`,
  "sandbox.imageUnsupported": (p) =>
    `unusable sandbox image (${IMAGE_REASONS[text(p.reason)] ?? text(p.reason)})`,
  "sandbox.invalidArgument": (p) =>
    `invalid argument (${text(p.field)}): ${SANDBOX_ARGUMENT_REASONS[text(p.reason)] ?? text(p.reason)}`,
  "journal.invalidJson": (p) => `invalid JSON: ${text(p.message)}`,
  "event.notObject": () => "object expected",
  "event.unknownKind": (p) => `unknown kind: ${text(p.kind)}`,
  "event.invalidVersion": () => "invalid v",
  "event.unsupportedVersion": (p) =>
    `unsupported schema version ${text(p.version)} (known: ${text(p.known)})`,
  "event.missingField": (p) => `${text(p.field)} missing`,
  "event.invalidField": (p) => `invalid ${text(p.field)}`,
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
  programSheet: "program sheet",
  turn: "turn",
  sandbox: "sandbox",
};

export const en: Messages = { reasons, events };
