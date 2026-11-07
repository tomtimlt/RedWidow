import { type Reason, reason } from "./reason.js";
import { READ_URL_TOOL, SEARCH_WEB_TOOL } from "./web/guard.js";

/** Appel d'outil terminé du run, tel que le bureau de mission le retient (texte déjà masqué). */
export interface ResearchEvent {
  tool: string;
  /** Arguments de l'appel sérialisés (requête, URL…). */
  input: string;
  output: string;
  isError: boolean;
}
export interface ResearchState {
  events: readonly ResearchEvent[];
  /** Les outils web (`search_web`, `read_url`) sont exposés à l'agent. */
  webToolsExposed: boolean;
}

/** Seuils par défaut (niveau `standard`) ; le niveau d'encadrement peut les remplacer. */
const MAX_TECHS = 4;
const REPEAT_THRESHOLD = 2;
export interface ResearchOptions {
  /** Répétitions d'une même erreur, ou de refus 403 / WAF, à partir desquelles on relance. */
  repeatThreshold: number;
  /** Technologies relancées au plus à la fois. */
  maxTechs: number;
}
// Noms qui ressemblent à « nom/x.y » sans désigner une pile de la cible (clients, moteurs de rendu).
const NOT_A_STACK = new Set([
  "mozilla",
  "applewebkit",
  "chrome",
  "safari",
  "gecko",
  "firefox",
  "edge",
  "curl",
  "wget",
  "http",
  "https",
  "python-requests",
  "go-http-client",
]);
const BLOCKED =
  /\bHTTP\/[\d.]+\s+403\b|\b403\s+forbidden\b|\bstatus[:= ]+403\b|\bforbidden\b|\bmod_?security\b|\bweb application firewall\b|\bwaf\b|\brequest blocked\b/i;

const isWeb = (tool: string): boolean => tool === SEARCH_WEB_TOOL || tool === READ_URL_TOOL;

interface Tech {
  name: string;
  version?: string;
}

function parseProduct(text: string): Tech | null {
  const match = /^\s*([A-Za-z][\w.+-]{1,40})(?:[/ ]v?(\d[\w.-]*))?/.exec(text);
  const name = match?.[1];
  if (name === undefined || NOT_A_STACK.has(name.toLowerCase())) return null;
  return match?.[2] === undefined ? { name } : { name, version: match[2] };
}

/** Technologies ou versions identifiées dans une sortie : en-têtes, balise generator, « nom/x.y.z ». */
export function detectTechnologies(output: string): Tech[] {
  const found: Tech[] = [];
  const add = (tech: Tech | null) => {
    if (tech === null || found.some((t) => t.name.toLowerCase() === tech.name.toLowerCase()))
      return;
    found.push(tech);
  };
  for (const header of output.matchAll(/^\s*(?:server|x-powered-by):[ \t]*([^\r\n]+)/gim))
    add(parseProduct(header[1] ?? ""));
  for (const meta of output.matchAll(/<meta\b[^>]*>/gi)) {
    if (!/name\s*=\s*["']generator["']/i.test(meta[0])) continue;
    add(parseProduct(/content\s*=\s*["']([^"']+)["']/i.exec(meta[0])?.[1] ?? ""));
  }
  for (const m of output.matchAll(/(?<![\w./-])([A-Za-z][\w+-]{1,30})\/(\d+\.\d+(?:\.\d+)*)\b/g)) {
    const name = m[1] ?? "";
    if (!NOT_A_STACK.has(name.toLowerCase())) add({ name, version: m[2] ?? "" });
  }
  return found;
}

function normalizedError(event: ResearchEvent): string {
  return `${event.tool}|${event.output.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim().slice(0, 200)}`;
}

/**
 * Détecteur pur de relances de recherche web (ADR 0039). Ne bloque rien : renvoie des motifs
 * (code + paramètres) que le bureau de mission place dans `mission_context` et dans les réponses
 * de `record_decision` / `record_test`. Ordre : technologie, erreur répétée, blocage, aucune recherche.
 */
export function researchTriggers(
  state: ResearchState,
  options: Partial<ResearchOptions> = {},
): Reason[] {
  const { events } = state;
  const repeatThreshold = options.repeatThreshold ?? REPEAT_THRESHOLD;
  const maxTechs = options.maxTechs ?? MAX_TECHS;
  const triggers: Reason[] = [];
  const searched = (after: number, needle?: string): boolean =>
    events.some(
      (e, i) =>
        i > after &&
        isWeb(e.tool) &&
        (needle === undefined || e.input.toLowerCase().includes(needle.toLowerCase())),
    );

  // (a) technologie identifiée, sans recherche web ultérieure qui la mentionne.
  const seen = new Map<string, { tech: Tech; at: number }>();
  events.forEach((e, at) => {
    if (isWeb(e.tool)) return;
    for (const tech of detectTechnologies(e.output)) {
      const key = tech.name.toLowerCase();
      const known = seen.get(key);
      if (known === undefined) seen.set(key, { tech, at });
      else if (known.tech.version === undefined && tech.version !== undefined)
        known.tech.version = tech.version;
    }
  });
  let techs = 0;
  for (const { tech, at } of seen.values()) {
    if (techs >= maxTechs) break;
    if (searched(at, tech.name)) continue;
    techs++;
    triggers.push(
      reason("research.techUnsearched", {
        tech: tech.name,
        ...(tech.version !== undefined && { version: tech.version }),
      }),
    );
  }

  // (b) même erreur au moins `repeatThreshold` fois (hors outils web), sans recherche après la dernière occurrence.
  const errors = new Map<string, { tool: string; count: number; last: number }>();
  events.forEach((e, i) => {
    if (!e.isError || isWeb(e.tool)) return;
    const key = normalizedError(e);
    const entry = errors.get(key) ?? { tool: e.tool, count: 0, last: i };
    entry.count++;
    entry.last = i;
    errors.set(key, entry);
  });
  const worst = [...errors.values()]
    .filter((e) => e.count >= repeatThreshold && !searched(e.last))
    .sort((a, b) => b.count - a.count)[0];
  if (worst)
    triggers.push(reason("research.repeatedError", { tool: worst.tool, count: worst.count }));

  // (c) refus 403 / WAF répétés.
  let blocks = 0;
  let lastBlock = -1;
  events.forEach((e, i) => {
    if (isWeb(e.tool) || !BLOCKED.test(e.output)) return;
    blocks++;
    lastBlock = i;
  });
  if (blocks >= repeatThreshold && !searched(lastBlock))
    triggers.push(reason("research.blocked", { count: blocks }));

  // (d) aucune recherche web dans le run alors que les outils web sont exposés.
  if (state.webToolsExposed && !events.some((e) => isWeb(e.tool)))
    triggers.push(reason("research.noSearch"));
  return triggers;
}

/** Texte d'une décision qui annonce un arrêt ou une conclusion (heuristique : relance seulement). */
export function isClosingText(text: string): boolean {
  return /\b(?:arr[êe]t\w*|cl[ôo]tur\w*|conclu\w*|terminer|abandon\w*|fin de (?:la )?mission|stop|close|closing|give up)\b/i.test(
    text,
  );
}
