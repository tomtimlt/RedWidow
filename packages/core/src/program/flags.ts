/**
 * Drapeaux attendus d'une commande shell vers un hôte du périmètre (ADR 0040, lot 7) : User-Agent
 * portant le suffixe de la fiche, et débit compatible avec le rythme de la fiche. Analyse « au
 * mieux » des arguments déjà extraits par `shell-hosts.ts` ; un drapeau introuvable ou mal formé
 * compte comme absent (fail-closed : on redemande l'accord).
 */

import { PACE_PRESETS } from "../pace/controller.js";
import type { ProgramSheet } from "./sheet.js";
import type { NetworkCall } from "./shell-hosts.js";

/** Un drapeau attendu et manquant (ou incompatible) pour un binaire. */
export interface MissingFlag {
  binary: string;
  /** Description du drapeau attendu (affichée telle quelle dans la raison). */
  flag: string;
}

interface FlagSpec {
  /** Options dont la valeur est le User-Agent. */
  uaFlags: readonly string[];
  /** Options dont la valeur est un en-tête `Nom: valeur`. */
  headerFlags: readonly string[];
  /** `--script-args` de nmap : `http.useragent=…` dans une liste séparée par des virgules. */
  scriptArgs?: boolean;
  /** Options de débit en requêtes (ou paquets) par seconde. */
  rateFlags: readonly string[];
  /** Options de délai entre requêtes : débit = 1 / délai. */
  delayFlags: readonly string[];
  delayUnit: "seconds" | "duration" | "nmap";
  /** Drapeaux attendus, sans texte d'affichage (paramètres de la raison). */
  uaHint: string;
  rateHint?: string;
}

const SPECS: Readonly<Record<string, FlagSpec>> = {
  curl: {
    uaFlags: ["-A", "--user-agent"],
    headerFlags: ["-H", "--header"],
    rateFlags: [],
    delayFlags: [],
    delayUnit: "seconds",
    uaHint: '-A "<User-Agent>"',
  },
  wget: {
    uaFlags: ["-U", "--user-agent"],
    headerFlags: ["--header"],
    rateFlags: [],
    delayFlags: [],
    delayUnit: "seconds",
    uaHint: '--user-agent="<User-Agent>"',
  },
  sqlmap: {
    uaFlags: ["-A", "--user-agent"],
    headerFlags: [],
    rateFlags: [],
    delayFlags: ["--delay"],
    delayUnit: "seconds",
    uaHint: '--user-agent="<User-Agent>"',
    rateHint: "--delay <s>",
  },
  ffuf: {
    uaFlags: [],
    headerFlags: ["-H"],
    rateFlags: ["-rate"],
    delayFlags: ["-p"],
    delayUnit: "seconds",
    uaHint: '-H "User-Agent: <User-Agent>"',
    rateHint: "-rate <n>",
  },
  nuclei: {
    uaFlags: [],
    headerFlags: ["-H", "-header"],
    rateFlags: ["-rl", "-rate-limit"],
    delayFlags: [],
    delayUnit: "seconds",
    uaHint: '-H "User-Agent: <User-Agent>"',
    rateHint: "-rl <n>",
  },
  httpx: {
    uaFlags: [],
    headerFlags: ["-H", "-header"],
    rateFlags: ["-rl", "-rate-limit"],
    delayFlags: [],
    delayUnit: "seconds",
    uaHint: '-H "User-Agent: <User-Agent>"',
    rateHint: "-rl <n>",
  },
  gobuster: {
    uaFlags: ["-a", "--useragent", "--user-agent"],
    headerFlags: ["-H", "--headers"],
    rateFlags: [],
    delayFlags: ["--delay"],
    delayUnit: "duration",
    uaHint: '-a "<User-Agent>"',
    rateHint: "--delay <duration>",
  },
  nmap: {
    uaFlags: [],
    headerFlags: [],
    scriptArgs: true,
    rateFlags: ["--max-rate"],
    delayFlags: ["--scan-delay"],
    delayUnit: "nmap",
    uaHint: '--script-args http.useragent="<User-Agent>"',
    rateHint: "--max-rate <n>",
  },
};

/** Requêtes par seconde autorisées par la fiche (préréglage ou plafond explicite). */
export function sheetRate(sheet: ProgramSheet): number {
  const pace = sheet.pace.value;
  return "preset" in pace ? PACE_PRESETS[pace.preset] : pace.maxRequestsPerSecond;
}

const EPSILON = 1e-9;

/** Nombre décimal strict (pas d'exposant, pas de signe) ; `null` sinon. */
function decimal(text: string): number | null {
  return /^\d+(?:\.\d+)?$|^\.\d+$/.test(text) ? Number(text) : null;
}

const UNIT_SECONDS: Readonly<Record<string, number>> = {
  ns: 1e-9,
  us: 1e-6,
  µs: 1e-6,
  ms: 1e-3,
  s: 1,
  m: 60,
  h: 3600,
};

/** Durée Go (`500ms`, `1.5s`, `1m30s`) en secondes ; `null` si illisible. */
function goDuration(text: string): number | null {
  if (text === "" || !/^(?:\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h))+$/.test(text)) return null;
  let total = 0;
  for (const [, n, unit] of text.matchAll(/(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/g)) {
    total += Number(n) * (UNIT_SECONDS[unit as string] ?? 0);
  }
  return total;
}

/** Délai nmap : nombre de secondes seul, ou suffixé `ms`, `s`, `m`, `h`. */
function nmapDuration(text: string): number | null {
  const bare = decimal(text);
  if (bare !== null) return bare;
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(text);
  return m ? Number(m[1]) * (UNIT_SECONDS[m[2] as string] ?? 0) : null;
}

/** Délai en secondes selon l'unité du binaire ; plage `a-b` (ffuf `-p`) : borne basse. */
function delaySeconds(text: string, unit: FlagSpec["delayUnit"]): number | null {
  if (unit === "duration") return goDuration(text);
  if (unit === "nmap") return nmapDuration(text);
  const low = text.split("-")[0] ?? "";
  return decimal(low);
}

/** Valeurs de chaque occurrence d'une option : `-x v`, `--long v`, `--long=v` (et grappes curl). */
function optionValues(args: readonly string[], names: readonly string[], cluster: boolean) {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--") break;
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (names.includes(name)) {
      const value = eq === -1 ? args[++i] : arg.slice(eq + 1);
      if (value !== undefined) values.push(value);
    } else if (cluster && /^-[A-Za-z]{2,}$/.test(arg) && names.includes(`-${arg.slice(-1)}`)) {
      const value = args[++i];
      if (value !== undefined) values.push(value);
    }
  }
  return values;
}

/** User-Agents déclarés par la commande (option dédiée, en-tête, `http.useragent`). */
function userAgents(spec: FlagSpec, args: readonly string[], cluster: boolean): string[] {
  const out = optionValues(args, spec.uaFlags, cluster);
  for (const header of optionValues(args, spec.headerFlags, cluster)) {
    const m = /^\s*user-agent\s*:(.*)$/is.exec(header);
    if (m) out.push((m[1] as string).trim());
  }
  if (spec.scriptArgs) {
    for (const list of optionValues(args, ["--script-args"], false)) {
      const m = /(?:^|[,{\s])http\.useragent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^,}]*))/i.exec(list);
      if (m) out.push((m[1] ?? m[2] ?? m[3] ?? "").trim());
    }
  }
  return out;
}

/** Vrai si une option de débit ou de délai de la commande reste sous le débit de la fiche. */
function rateCompatible(spec: FlagSpec, args: readonly string[], rate: number): boolean {
  for (const value of optionValues(args, spec.rateFlags, false)) {
    const n = decimal(value);
    if (n !== null && n > 0 && n <= rate + EPSILON) return true;
  }
  for (const value of optionValues(args, spec.delayFlags, false)) {
    const d = delaySeconds(value, spec.delayUnit);
    if (d !== null && d > 0 && 1 / d <= rate + EPSILON) return true;
  }
  return false;
}

/**
 * Premier drapeau manquant ou incompatible pour chaque binaire appelé (au plus un par binaire).
 * Sans suffixe dans la fiche, aucune exigence de User-Agent ; curl et wget n'ont pas d'exigence de
 * débit (appels unitaires). Pur : ne regarde ni les hôtes ni la politique.
 */
export function missingProgramFlags(
  sheet: ProgramSheet,
  calls: readonly NetworkCall[],
): MissingFlag[] {
  const suffix = sheet.userAgentSuffix?.value;
  const rate = sheetRate(sheet);
  const found: MissingFlag[] = [];
  for (const call of calls) {
    const spec = SPECS[call.binary];
    if (spec === undefined) continue;
    const add = (flag: string) => {
      if (!found.some((f) => f.binary === call.binary)) found.push({ binary: call.binary, flag });
    };
    const cluster = call.binary === "curl" || call.binary === "wget";
    if (suffix !== undefined) {
      const agents = userAgents(spec, call.args, cluster);
      if (!agents.some((ua) => ua.includes(suffix))) {
        add(spec.uaHint.replace("<User-Agent>", `…${suffix}`));
        continue;
      }
    }
    if (spec.rateHint !== undefined && !rateCompatible(spec, call.args, rate)) {
      add(`${spec.rateHint} (≤ ${rate} req/s)`);
    }
  }
  return found;
}
