import { isIP } from "node:net";
import type { ProgramSheet } from "./sheet.js";
import { argvNetworkTargets, shellNetworkTargets } from "./shell-hosts.js";

/** Outil réservé de l'étape suivante (ADR 0040) : requête HTTP faite par le moteur. */
export const HTTP_REQUEST_TOOL = "mcp__web__http_request";

interface IpRange {
  family: 4 | 6;
  /** Adresse de réseau (bits d'hôte à zéro) puis dernière adresse de la plage. */
  first: bigint;
  last: bigint;
}

function parseIPv4(text: string): bigint | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    value = (value << 8n) | BigInt(part);
  }
  return value;
}

function parseIPv6(text: string): bigint | null {
  let head = text;
  let tail = "";
  const gap = text.indexOf("::");
  if (gap !== -1) {
    if (text.indexOf("::", gap + 1) !== -1) return null;
    head = text.slice(0, gap);
    tail = text.slice(gap + 2);
  }
  const groups = (s: string): string[] | null => {
    if (s === "") return [];
    const out = s.split(":");
    const last = out[out.length - 1] ?? "";
    if (last.includes(".")) {
      const v4 = parseIPv4(last);
      if (v4 === null) return null;
      out.splice(out.length - 1, 1, (v4 >> 16n).toString(16), (v4 & 0xffffn).toString(16));
    }
    return out.every((g) => /^[0-9a-f]{1,4}$/.test(g)) ? out : null;
  };
  const h = groups(head);
  const t = groups(tail);
  if (h === null || t === null) return null;
  const missing = 8 - h.length - t.length;
  if (gap === -1 ? missing !== 0 : missing < 1) return null;
  let value = 0n;
  for (const g of [...h, ...Array<string>(gap === -1 ? 0 : missing).fill("0"), ...t]) {
    value = (value << 16n) | BigInt(`0x${g}`);
  }
  return value;
}

/** Adresse seule ou CIDR `adresse/préfixe` → plage ; `null` si ce n'est ni l'un ni l'autre. */
function parseRange(text: string): IpRange | null {
  const [addr, prefixText, ...rest] = text.split("/");
  if (addr === undefined || rest.length > 0) return null;
  const family = isIP(addr);
  if (family !== 4 && family !== 6) return null;
  const bits = family === 4 ? 32 : 128;
  const value = family === 4 ? parseIPv4(addr) : parseIPv6(addr.toLowerCase());
  if (value === null) return null;
  let prefix = bits;
  if (prefixText !== undefined) {
    if (!/^\d{1,3}$/.test(prefixText) || Number(prefixText) > bits) return null;
    prefix = Number(prefixText);
  }
  const hostBits = BigInt(bits - prefix);
  const first = (value >> hostBits) << hostBits;
  return { family, first, last: first | ((1n << hostBits) - 1n) };
}

const within = (inner: IpRange, outer: IpRange): boolean =>
  inner.family === outer.family && inner.first >= outer.first && inner.last <= outer.last;

const overlaps = (a: IpRange, b: IpRange): boolean =>
  a.family === b.family && a.first <= b.last && b.first <= a.last;

/**
 * Hôte d'une cible textuelle (hôte, `hôte:port`, URL, adresse, CIDR), en minuscules, sans crochets
 * ni point final ; `null` si rien d'exploitable.
 */
export function hostOfTarget(value: string): string | null {
  let text = value.trim();
  if (text === "") return null;
  if (text.includes("://")) {
    try {
      text = new URL(text).hostname;
    } catch {
      return null;
    }
  } else if (parseRange(text.toLowerCase()) === null) {
    text = text.replace(/^[^@/\s]*@/, "");
    const bracket = /^\[([^\]]+)\](?::\d*)?(\/.*)?$/.exec(text);
    if (bracket?.[1] !== undefined) text = bracket[1];
    else text = text.replace(/\/.*$/, "").replace(/^([^:]*):\d*$/, "$1");
  }
  text = text
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  return text === "" ? null : text;
}

/** Hôtes visés par un appel et indicateur « cible non extractible » (ADR 0040). */
export interface ProgramTargets {
  hosts: string[];
  /** Outil réseau connu appelé sans hôte extractible (variable, `-iL fichier`, substitution…). */
  unresolved: boolean;
}

/** Outils dont l'argument est une commande shell, ou un argv direct (Bash, Kali, Exegol). */
const SHELL_COMMAND_TOOLS = new Set(["Bash", "mcp__kali__execute_command"]);
const ARGV_TOOLS = /^mcp__(?:kali|exegol)__(?:task_start|exec)$/;

/** Vrai pour les outils dont la cible se lit dans une commande shell ou un argv. */
export const isProgramShellTool = (tool: string): boolean =>
  SHELL_COMMAND_TOOLS.has(tool) || ARGV_TOOLS.test(tool);

const uniqueHosts = (targets: readonly string[]): string[] => [
  ...new Set(targets.map(hostOfTarget).filter((h): h is string => h !== null)),
];

/**
 * Cibles d'un appel d'outil réseau connu, ou `null` si l'outil n'est pas couvert : `read_url`,
 * `http_request`, champs `target` / `url` des outils Kali dédiés, commandes shell et argv des
 * outils réseau connus (curl, wget, httpx, nmap, sqlmap, ffuf, nuclei, gobuster).
 */
export function programTargets(
  tool: string,
  input: Record<string, unknown>,
): ProgramTargets | null {
  if (tool === "mcp__web__read_url" || tool === HTTP_REQUEST_TOOL) {
    return {
      hosts: typeof input.url === "string" ? uniqueHosts([input.url]) : [],
      unresolved: false,
    };
  }
  if (SHELL_COMMAND_TOOLS.has(tool) && typeof input.command === "string") {
    const found = shellNetworkTargets(input.command);
    return { hosts: uniqueHosts(found.targets), unresolved: found.unresolved };
  }
  if (ARGV_TOOLS.test(tool) && Array.isArray(input.argv)) {
    const argv = input.argv.filter((a): a is string => typeof a === "string");
    const found = argvNetworkTargets(argv);
    return { hosts: uniqueHosts(found.targets), unresolved: found.unresolved };
  }
  if (tool.startsWith("mcp__kali__")) {
    // Un champ `target` peut porter plusieurs cibles séparées par des espaces (nmap).
    const targets: string[] = [];
    if (typeof input.target === "string") targets.push(...input.target.split(/\s+/));
    if (typeof input.url === "string") targets.push(input.url);
    const extra = typeof input.additional_args === "string" ? input.additional_args : "";
    // `nmap_scan` avec `-iL` / `-iR` dans additional_args : liste non extractible.
    const unresolved = tool === "mcp__kali__nmap_scan" && /(?:^|\s)-i[LR](?:\s|$)/.test(extra);
    if (targets.length > 0 || unresolved) return { hosts: uniqueHosts(targets), unresolved };
  }
  return null;
}

/** Hôtes visés par un appel d'outil réseau connu, ou `null` si l'outil n'est pas couvert. */
export function programHosts(tool: string, input: Record<string, unknown>): string[] | null {
  return programTargets(tool, input)?.hosts ?? null;
}

function matches(pattern: string, host: string): boolean {
  const p = parseRange(pattern);
  const h = parseRange(host);
  if (p !== null || h !== null) return p !== null && h !== null && within(h, p);
  if (pattern.startsWith("*."))
    return host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1;
  return host === pattern;
}

function excluded(pattern: string, host: string): boolean {
  const p = parseRange(pattern);
  const h = parseRange(host);
  // Une cible CIDR qui recoupe seulement une exclusion n'est pas dans le périmètre.
  if (p !== null && h !== null) return overlaps(h, p);
  return matches(pattern, host);
}

/** Exclusion prioritaire ; hôte non listé = hors périmètre. */
export function hostInScope(sheet: ProgramSheet, host: string): boolean {
  if (sheet.outOfScope.value.some((pattern) => excluded(pattern, host))) return false;
  return sheet.inScope.value.some((pattern) => matches(pattern, host));
}
