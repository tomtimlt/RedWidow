import { COVERAGE_STATES, type CoverageState, coverageKey } from "../audit-schema.js";
import type { EngineEvent } from "../events.js";

/**
 * Analyse d'un journal d'événements pour expliquer l'arrêt ou la stagnation d'un run.
 * Fonction pure sur des événements déjà masqués : aucun texte d'affichage ici (codes et
 * paramètres), les libellés vivent dans la CLI.
 */

/** Plafond « à 16 Kio » d'une ligne ou d'une sortie : une sortie de cette taille a sans doute été coupée. */
export const CUT_MIN_BYTES = 16000;
export const CUT_MAX_BYTES = 16 * 1024;

export interface TraceOptions {
  /** Taille des listes « plus longs silences » et « plus gros résultats tronqués ». */
  topN: number;
  /** Nombre d'appels identiques (approche) à partir duquel on signale une répétition. */
  repeatMin: number;
  /** Fenêtre finale (nombre de derniers résultats d'outil) pour la classe A. */
  tailWindow: number;
  /** Diversité d'approches au plus égale à cette valeur = « peu de diversité » (classe C). */
  lowDiversityMax: number;
  /** Caractères comparés pour juger deux résultats « de même début ». */
  headChars: number;
}

export const DEFAULT_TRACE_OPTIONS: TraceOptions = {
  topN: 5,
  repeatMin: 4,
  tailWindow: 5,
  lowDiversityMax: 3,
  headChars: 200,
};

export type TraceEndCode =
  | "turn-finished"
  | "run-error"
  | "quota"
  | "aborted"
  | "journal-truncated"
  | "incomplete";

export type TruncationSign = "flag" | "lineMarker" | "cut16k";
export type BlockClass = "A" | "B" | "C";

export interface TraceTruncatedResult {
  seq: number;
  tool: string;
  /** Commande ou entrée de l'appel, abrégée. */
  command: string;
  /** Taille d'origine (octets) si le drapeau `truncated` la donne, sinon `null`. */
  originalBytes: number | null;
  /** Taille du texte journalisé (octets). */
  loggedBytes: number;
  signs: TruncationSign[];
}

export interface TraceRepeat {
  approach: string;
  calls: number;
  /** Plus grand nombre de résultats « quasi identiques » (même taille ou même début). */
  similarResults: number;
}

export interface TraceWebSearch {
  seq: number;
  ts: string;
  query: string;
  /** Appels d'outil faits avant cette recherche. */
  callsBefore: number;
}

export interface TraceCoverage {
  total: number;
  counts: Record<CoverageState, number>;
  /** Cases `untested` ou `blocked` restantes. */
  remaining: { surface: string; parameter?: string; testClass: string; state: CoverageState }[];
}

export interface TraceReport {
  runId: string | null;
  events: number;
  volume: {
    turns: number;
    calls: number;
    callsByTool: Record<string, number>;
    durationMs: number;
    longestGaps: { afterSeq: number; ms: number }[];
  };
  ending: {
    lastEvent: { kind: string; seq: number } | null;
    endCode: TraceEndCode;
    lastDecisionSeq: number | null;
    callsSinceLastDecision: number;
  };
  truncation: {
    results: number;
    truncated: number;
    /** Résultats tronqués parmi les `tailWindow` derniers résultats d'outil. */
    truncatedInTail: number;
    droppedProcessLines: number;
    top: TraceTruncatedResult[];
  };
  repetition: { approaches: number; repeated: TraceRepeat[] };
  web: {
    searches: TraceWebSearch[];
    coverage: TraceCoverage | null;
    derivation: {
      derived: number;
      generic: number;
      percent: number;
      genericPaths: { path: string; calls: number }[];
      techniqueFamilies: string[];
    };
  };
  blockClass: {
    dominant: BlockClass | null;
    scores: Record<BlockClass, boolean>;
  };
}

const LINE_MARKER = /lignes? tronqu[ée]es?|lines? truncated|\[…[^\]]*(tronqu|truncat)/iu;
const WEB_SEARCH_TOOL = /(?:^|__)(?:search_web|WebSearch)$/u;

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function clip(value: string, max = 160): string {
  const flat = value.replace(/\s+/gu, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Commande d'un appel (Bash, execute_command, exec…), le cas échéant. */
function commandOf(input: Record<string, unknown>): string | undefined {
  return text(input.command) ?? text(input.cmd);
}

/** Premier mot significatif d'une commande : variables d'environnement et chemin ignorés. */
function firstWord(command: string): string {
  const words = command.trim().split(/\s+/u);
  const word = words.find((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/u.test(w)) ?? words[0] ?? "";
  return word.split("/").pop() ?? word;
}

function urlKey(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    return `${u.host}${u.pathname}`;
  } catch {
    return undefined;
  }
}

/** « Approche » d'un appel : outil + premier mot de commande, ou outil + hôte et chemin d'URL. */
export function approachKey(tool: string, input: Record<string, unknown>): string {
  const command = commandOf(input);
  if (command !== undefined) return `${tool} ${firstWord(command)}`;
  const url = text(input.url);
  const key = url === undefined ? undefined : urlKey(url);
  return key === undefined ? tool : `${tool} ${key}`;
}

function describeInput(input: Record<string, unknown>): string {
  const command = commandOf(input);
  if (command !== undefined) return clip(command);
  const url = text(input.url);
  if (url !== undefined) return clip(url);
  return clip(JSON.stringify(input));
}

function endCodeOf(events: readonly EngineEvent[]): TraceEndCode {
  const last = events[events.length - 1];
  if (last === undefined) return "incomplete";
  if (last.kind === "journal.truncated") return "journal-truncated";
  const errors = events.filter((e) => e.kind === "error");
  const quota = events.some(
    (e) =>
      (e.kind === "rate.limited" && e.status !== "allowed" && e.status !== "allowed_warning") ||
      (e.kind === "error" && /rate|quota/iu.test(e.code)),
  );
  const finished = events.findLast((e) => e.kind === "run.finished");
  const turn = events.findLast((e) => e.kind === "turn.finished");
  const failed =
    (finished?.kind === "run.finished" && finished.status === "error") ||
    (finished === undefined && turn?.kind === "turn.finished" && turn.status === "error");
  if (failed) {
    if (quota) return "quota";
    if (errors.some((e) => e.kind === "error" && /abort|cancel/iu.test(e.code))) return "aborted";
    return "run-error";
  }
  if (finished !== undefined || turn !== undefined) return "turn-finished";
  if (quota) return "quota";
  return errors.length > 0 ? "run-error" : "incomplete";
}

/** Plus grand groupe de résultats de même taille ou de même début. */
function similarCount(results: readonly { bytes: number; head: string }[]): number {
  const bySize = new Map<number, number>();
  const byHead = new Map<string, number>();
  for (const r of results) {
    bySize.set(r.bytes, (bySize.get(r.bytes) ?? 0) + 1);
    byHead.set(r.head, (byHead.get(r.head) ?? 0) + 1);
  }
  return Math.max(0, ...bySize.values(), ...byHead.values());
}

export function analyzeTrace(
  events: readonly EngineEvent[],
  options: Partial<TraceOptions> = {},
): TraceReport {
  const opt = { ...DEFAULT_TRACE_OPTIONS, ...options };
  const sorted = [...events].sort((a, b) => a.seq - b.seq);

  const requested = new Map<
    string,
    { seq: number; tool: string; input: Record<string, unknown> }
  >();
  const callsByTool: Record<string, number> = {};
  const approaches = new Map<
    string,
    { calls: number; results: { bytes: number; head: string }[] }
  >();
  const resultsInOrder: TraceTruncatedResult[] = [];
  const searches: TraceWebSearch[] = [];
  const cells = new Map<string, TraceCoverage["remaining"][number]>();
  const observedPaths = new Set<string>();
  const observedTokens = new Set<string>();
  const genericPaths = new Map<string, number>();
  const techniqueFamilies = new Set<string>();
  let derived = 0,
    generic = 0;
  let calls = 0;
  let turns = 0;
  let lastDecisionSeq: number | null = null;
  let callsSinceDecision = 0;
  let droppedProcessLines = 0;
  let finishedTurns = 0;

  for (const e of sorted) {
    switch (e.kind) {
      case "tool.requested": {
        if (/http_request$/.test(e.tool) && typeof e.input.url === "string") {
          try {
            const url = new URL(e.input.url);
            const parameters = [...url.searchParams];
            const known =
              observedPaths.has(url.pathname) ||
              parameters.some(
                ([key, value]) =>
                  observedTokens.has(key) || (value !== "" && observedTokens.has(value)),
              );
            if (known) derived++;
            else {
              generic++;
              genericPaths.set(url.pathname, (genericPaths.get(url.pathname) ?? 0) + 1);
            }
            const signature = `${url.pathname} ${parameters.map(([key]) => key).join(" ")}`;
            const family = /cache/i.test(signature)
              ? "cache"
              : /login|auth|session|token/i.test(signature)
                ? "authentification"
                : /order|cart|pay|checkout|workflow/i.test(signature)
                  ? "logique métier"
                  : /user|account|role|\bid\b/i.test(signature)
                    ? "contrôle d’accès"
                    : /\.env|robots|favicon|health/i.test(signature)
                      ? "reconnaissance"
                      : "observation HTTP";
            techniqueFamilies.add(family);
          } catch {
            /* URL invalide : aucune classification inventée. */
          }
        } else if (commandOf(e.input))
          techniqueFamilies.add(`shell:${firstWord(commandOf(e.input) ?? "")}`);
        calls++;
        callsSinceDecision++;
        requested.set(e.toolUseId, { seq: e.seq, tool: e.tool, input: e.input });
        callsByTool[e.tool] = (callsByTool[e.tool] ?? 0) + 1;
        const key = approachKey(e.tool, e.input);
        const entry = approaches.get(key) ?? { calls: 0, results: [] };
        entry.calls++;
        approaches.set(key, entry);
        if (WEB_SEARCH_TOOL.test(e.tool)) {
          const query = text(e.input.query) ?? text(e.input.q) ?? "";
          searches.push({ seq: e.seq, ts: e.ts, query: clip(query), callsBefore: calls - 1 });
        }
        break;
      }
      case "tool.result": {
        for (const match of e.output.matchAll(/https?:\/\/[^\s"'<>\\]+/g)) {
          try {
            observedPaths.add(new URL(match[0]).pathname);
          } catch {}
        }
        for (const match of e.output.matchAll(
          /(?<![\w/:])\/(?!\/)[a-zA-Z0-9_~!$&()*+;=:@%.,/?#-]*/g,
        ))
          observedPaths.add(match[0].replace(/[.,;]+$/, ""));
        for (const match of e.output.matchAll(/[a-zA-Z0-9_~-]+/g)) observedTokens.add(match[0]);
        const call = requested.get(e.toolUseId);
        const loggedBytes = Buffer.byteLength(e.output);
        const signs: TruncationSign[] = [];
        if (e.truncated) signs.push("flag");
        if (LINE_MARKER.test(e.output)) signs.push("lineMarker");
        if (!e.truncated && loggedBytes >= CUT_MIN_BYTES && loggedBytes <= CUT_MAX_BYTES)
          signs.push("cut16k");
        resultsInOrder.push({
          seq: e.seq,
          tool: call?.tool ?? "?",
          command: call ? describeInput(call.input) : "",
          originalBytes: e.truncated ? e.bytes : null,
          loggedBytes,
          signs,
        });
        if (call) {
          approaches
            .get(approachKey(call.tool, call.input))
            ?.results.push({ bytes: e.bytes, head: e.output.slice(0, opt.headChars) });
        }
        break;
      }
      case "mission.decision":
        lastDecisionSeq = e.seq;
        callsSinceDecision = 0;
        break;
      case "turn.finished":
        finishedTurns++;
        turns = Math.max(turns, e.turns);
        break;
      case "run.finished":
        turns = Math.max(turns, e.turns);
        break;
      case "process.exited":
        droppedProcessLines += e.droppedLines ?? 0;
        break;
      case "audit.coverage":
        for (const cell of e.cells) {
          cells.set(coverageKey(cell), {
            surface: cell.surface,
            ...(cell.parameter !== undefined && { parameter: cell.parameter }),
            testClass: cell.testClass,
            state: cell.state,
          });
        }
        break;
      default:
        break;
    }
  }

  // Volume.
  const gaps: { afterSeq: number; ms: number }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (!prev || !cur) continue;
    const ms = Date.parse(cur.ts) - Date.parse(prev.ts);
    if (Number.isFinite(ms) && ms > 0) gaps.push({ afterSeq: prev.seq, ms });
  }
  gaps.sort((a, b) => b.ms - a.ms);
  const first = sorted[0];
  const lastEvent = sorted[sorted.length - 1];
  const spanMs = first && lastEvent ? Date.parse(lastEvent.ts) - Date.parse(first.ts) : 0;
  const durationMs = Number.isFinite(spanMs) ? Math.max(0, spanMs) : 0;

  // Troncatures.
  const truncatedAll = resultsInOrder.filter((r) => r.signs.length > 0);
  const truncatedInTail = resultsInOrder
    .slice(-opt.tailWindow)
    .filter((r) => r.signs.length > 0).length;
  const top = [...truncatedAll]
    .sort((a, b) => (b.originalBytes ?? b.loggedBytes) - (a.originalBytes ?? a.loggedBytes))
    .slice(0, opt.topN);

  // Répétition.
  const repeated: TraceRepeat[] = [];
  for (const [approach, entry] of approaches) {
    if (entry.calls < opt.repeatMin) continue;
    const similar = similarCount(entry.results);
    if (similar >= opt.repeatMin)
      repeated.push({ approach, calls: entry.calls, similarResults: similar });
  }
  repeated.sort((a, b) => b.calls - a.calls);

  // Couverture.
  let coverage: TraceCoverage | null = null;
  if (cells.size > 0) {
    const counts = Object.fromEntries(COVERAGE_STATES.map((s) => [s, 0])) as Record<
      CoverageState,
      number
    >;
    const remaining: TraceCoverage["remaining"] = [];
    for (const cell of cells.values()) {
      counts[cell.state]++;
      if (cell.state === "untested" || cell.state === "blocked") remaining.push(cell);
    }
    coverage = { total: cells.size, counts, remaining };
  }

  // Classe de blocage (indicative, priorité A > B > C).
  const endCode = endCodeOf(sorted);
  const scores: Record<BlockClass, boolean> = {
    A: truncatedInTail > 0,
    B: endCode === "turn-finished" && (coverage?.remaining.length ?? 0) > 0,
    C: searches.length === 0 && approaches.size <= opt.lowDiversityMax,
  };
  const dominant: BlockClass | null = scores.A ? "A" : scores.B ? "B" : scores.C ? "C" : null;

  return {
    runId: first?.runId ?? null,
    events: sorted.length,
    volume: {
      turns: turns > 0 ? turns : finishedTurns,
      calls,
      callsByTool,
      durationMs,
      longestGaps: gaps.slice(0, opt.topN),
    },
    ending: {
      lastEvent: lastEvent ? { kind: lastEvent.kind, seq: lastEvent.seq } : null,
      endCode,
      lastDecisionSeq,
      callsSinceLastDecision: callsSinceDecision,
    },
    truncation: {
      results: resultsInOrder.length,
      truncated: truncatedAll.length,
      truncatedInTail,
      droppedProcessLines,
      top,
    },
    repetition: { approaches: approaches.size, repeated },
    web: {
      searches,
      coverage,
      derivation: {
        derived,
        generic,
        percent: derived + generic === 0 ? 0 : Math.round((100 * derived) / (derived + generic)),
        genericPaths: [...genericPaths]
          .map(([path, calls]) => ({ path, calls }))
          .sort((a, b) => b.calls - a.calls || a.path.localeCompare(b.path))
          .slice(0, 5),
        techniqueFamilies: [...techniqueFamilies].sort(),
      },
    },
    blockClass: { dominant, scores },
  };
}
