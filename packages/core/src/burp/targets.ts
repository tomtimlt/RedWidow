/**
 * Classification des outils du serveur MCP Burp (ADR 0030, ADR 0055) pour le contrôle de périmètre
 * de la gate. Burp est multiplexé : l'appel est `mcp__burp__call_tool` avec `name` (outil Burp réel)
 * et `arguments`. La table est explicite et ferme par défaut : un outil absent est traité comme
 * ciblé sans hôte extractible (`program.host_unresolved`).
 */

/** Outil multiplexé de Burp tel qu'il passe par la gate. */
export const BURP_CALL_TOOL = "mcp__burp__call_tool";

/** Valeurs brutes visées par un appel Burp et indicateur « cible non extractible ». */
export interface BurpTargets {
  /** Hôte, URL ou `hôte:port` bruts ; la normalisation est faite par `hostOfTarget`. */
  candidates: string[];
  unresolved: boolean;
}

/**
 * Outils qui envoient ou préparent une requête vers un hôte, avec les champs lus. `host` : champ
 * `targetHostname` ; `content` : requête HTTP brute (URL absolue de la ligne de requête et lignes
 * `Host:`) ; `h2` : pseudo-en-têtes et en-têtes HTTP/2 (`:authority`, `host`).
 */
const TARGETED: Record<string, readonly ("host" | "content" | "h2")[]> = {
  send_http1_request: ["host", "content"],
  send_http2_request: ["host", "h2"],
  create_repeater_tab: ["host", "content"],
  send_to_intruder: ["host", "content"],
  // Modifient la configuration (dont le scope de Burp) : jamais d'hôte extractible, donc fermés.
  set_project_options: [],
  set_user_options: [],
};

/** Outils sans cible : encodage local, lecture de l'historique, de la configuration, état du proxy. */
const UNTARGETED = new Set([
  "url_encode",
  "url_decode",
  "base64encode",
  "base64decode",
  "generate_random_string",
  "output_project_options",
  "output_user_options",
  "get_proxy_http_history",
  "get_proxy_http_history_regex",
  "get_proxy_websocket_history",
  "get_proxy_websocket_history_regex",
  "get_scanner_issues",
  "get_active_editor_contents",
  "set_active_editor_contents",
  "set_proxy_intercept_state",
  "set_task_execution_engine_state",
  "create_collaborator_payload",
  "get_collaborator_interactions",
]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** URL absolue de la ligne de requête et valeurs de toutes les lignes `Host:` d'une requête brute. */
function rawRequestHosts(content: string): string[] {
  const out: string[] = [];
  const lines = content.split(/\r?\n/);
  const requestLine = /^[A-Za-z]+\s+(\S+)/.exec(lines[0] ?? "");
  if (requestLine?.[1] !== undefined && requestLine[1].includes("://")) out.push(requestLine[1]);
  for (const line of lines) {
    if (line === "") break; // fin des en-têtes
    const host = /^host\s*:\s*(.*)$/i.exec(line);
    if (host?.[1] !== undefined) out.push(host[1].trim());
  }
  return out;
}

function h2Hosts(args: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const field of [args.pseudoHeaders, args.headers]) {
    if (!isRecord(field)) continue;
    for (const [key, value] of Object.entries(field)) {
      if (typeof value === "string" && /^:?(authority|host)$/i.test(key)) out.push(value.trim());
    }
  }
  return out;
}

/** Cibles d'un appel `call_tool` Burp, ou `null` pour un outil sans cible (inchangé). */
export function burpTargets(input: Record<string, unknown>): BurpTargets | null {
  const name = typeof input.name === "string" ? input.name : "";
  if (UNTARGETED.has(name)) return null;
  const fields = Object.hasOwn(TARGETED, name) ? TARGETED[name] : undefined;
  if (fields === undefined || !isRecord(input.arguments)) {
    return { candidates: [], unresolved: true };
  }
  const args = input.arguments;
  const candidates: string[] = [];
  let unresolved = false;
  if (fields.includes("host")) {
    if (typeof args.targetHostname === "string" && args.targetHostname.trim() !== "")
      candidates.push(args.targetHostname);
    else if (args.targetHostname !== undefined) unresolved = true;
  }
  if (fields.includes("content") && typeof args.content === "string")
    candidates.push(...rawRequestHosts(args.content));
  if (fields.includes("h2")) candidates.push(...h2Hosts(args));
  if (candidates.length === 0) unresolved = true;
  return { candidates, unresolved };
}
