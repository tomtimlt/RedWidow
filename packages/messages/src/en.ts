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
  "docker.hostAccess": (p) => `container with host access (${text(p.flag)}): do it by hand`,
  "path.sensitive": (p) => `sensitive path: ${text(p.path)}`,
  "path.outside": (p) => `path outside the workspace: ${text(p.path)}`,
  "approval.noAsker": (_p, c) => `${c.cause ?? "?"} (no interactive approver)`,
  "approval.interrupted": (_p, c) => `approval interrupted: ${c.cause ?? "?"}`,
  "approval.timeout": (p, c) => `no answer within ${text(p.seconds)} s: denied (${c.cause ?? "?"})`,
  "approval.remembered": (_p, c) => `allowed for the session (${c.cause ?? "?"})`,
  "auth.missingApiKey": () => "--auth api-key requires ANTHROPIC_API_KEY, which is not set",
  "shell.unclosedQuote": (p) => `unclosed quote ${text(p.quote)}`,
  "shell.trailingBackslash": () => "trailing backslash",
  "error.unknown": (p) => (p.message === undefined ? "unknown error" : text(p.message)),
  legacy: (p) => text(p.text),
};

export const events: EventStrings = {
  run: "run",
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
  turn: "turn",
};

export const en: Messages = { reasons, events };
