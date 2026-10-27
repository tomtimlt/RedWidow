import { CodedError } from "@warband/core";
import { KNOWN_NATIVE_TOOLS } from "./names.js";

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Agents intégrés d'OpenCode : leurs permissions propres l'emportent sur celles du niveau supérieur. */
const BUILTIN_AGENTS = ["build", "plan", "general", "explore"] as const;

/**
 * Permissions imposées. Le joker `*` seul ne suffit pas (vérifié sur 1.19.0) :
 * une clé précise de la configuration globale (`bash: "allow"`) ou la
 * permission propre à un agent l'emporte sur lui. Chaque outil connu est donc
 * forcé explicitement : `ask` s'il est activé (la gate tranche), `deny` sinon.
 */
export function forcedPermission(enabled: ReadonlySet<string>): Record<string, "ask" | "deny"> {
  const permission: Record<string, "ask" | "deny"> = { "*": "ask" };
  for (const tool of KNOWN_NATIVE_TOOLS) permission[tool] = enabled.has(tool) ? "ask" : "deny";
  // `write` et `patch` passent par la permission `edit`.
  permission.edit = enabled.has("edit") || enabled.has("write") ? "ask" : "deny";
  // Hors de l'espace de travail : c'est la gate qui juge (chemin hors espace → ask, sensible → deny).
  permission.external_directory = "ask";
  permission.doom_loop = "ask";
  return permission;
}

export interface ForcedConfigInput {
  /** Configuration de l'utilisateur, placée AU-DESSOUS des réglages de sécurité. */
  user: Obj | undefined;
  enabledTools: ReadonlySet<string>;
  /** Serveurs MCP du moteur (distants, jeton Bearer). */
  mcp: Record<string, unknown>;
  maxTurns: number | undefined;
  provider?: string;
  /** Skill constant local lu par toutes les sessions du serveur géré, sous-agents compris. */
  methodologyPath?: string;
}

/**
 * Configuration transmise au serveur (`OPENCODE_CONFIG_CONTENT`). Les réglages
 * de sécurité écrasent ceux de l'utilisateur ; ses `plugin` et `permission`
 * sont écartés, ses serveurs MCP et agents conservés (permissions d'agent forcées).
 */
export function buildConfig({
  user,
  enabledTools,
  mcp,
  maxTurns,
  provider,
  methodologyPath,
}: ForcedConfigInput): Obj {
  const permission = forcedPermission(enabledTools);
  const { plugin: _plugin, permission: _permission, ...rest } = user ?? {};
  const userAgents = isObj(rest.agent) ? rest.agent : {};
  const agent: Obj = { ...userAgents };
  for (const name of new Set<string>([...BUILTIN_AGENTS, ...Object.keys(userAgents)])) {
    const own = isObj(userAgents[name]) ? userAgents[name] : {};
    agent[name] = {
      ...own,
      permission,
      ...(name === "build" && maxTurns !== undefined && { maxSteps: maxTurns }),
    };
  }
  return {
    ...rest,
    ...(methodologyPath !== undefined && {
      instructions: [
        ...(Array.isArray(rest.instructions) ? rest.instructions : []),
        methodologyPath,
      ],
    }),
    ...(provider !== undefined && { enabled_providers: [provider] }),
    ...(provider === "openai" && {
      provider: { ...(isObj(rest.provider) ? rest.provider : {}), openai: {} },
    }),
    share: "disabled",
    autoupdate: false,
    snapshot: false,
    formatter: false,
    lsp: false,
    permission,
    agent,
    mcp: { ...(isObj(rest.mcp) ? rest.mcp : {}), ...mcp },
  };
}

/** Un `allow` quelque part dans un arbre de permissions (chaîne, ou motifs par commande). */
function findAllow(node: unknown, path: string): string | null {
  if (node === "allow") return path;
  if (!isObj(node)) return null;
  for (const [key, value] of Object.entries(node)) {
    const found = findAllow(value, `${path}.${key}`);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Vérifie la configuration EFFECTIVE du serveur (fail-closed). Refuse :
 *  - un `permission` sans joker `*` à `ask`/`deny`, ou contenant un `allow` ;
 *  - un `allow` dans la permission d'un agent ;
 *  - des `plugin` (code exécuté sans passer par les permissions) ou des hooks.
 * Lève `opencode.unsafeConfig` avec le réglage fautif.
 */
export function assertSafeConfig(effective: Obj): void {
  const unsafe = (setting: string): never => {
    throw new CodedError("opencode.unsafeConfig", { setting });
  };
  const permission = effective.permission;
  const wildcard = isObj(permission) ? permission["*"] : undefined;
  if (wildcard !== "ask" && wildcard !== "deny") unsafe("permission.*");
  const allowed = findAllow(permission, "permission");
  if (allowed !== null) unsafe(allowed);
  if (isObj(effective.agent)) {
    for (const [name, agent] of Object.entries(effective.agent)) {
      const found = isObj(agent) ? findAllow(agent.permission, `agent.${name}.permission`) : null;
      if (found !== null) unsafe(found);
    }
  }
  if (Array.isArray(effective.plugin) && effective.plugin.length > 0) unsafe("plugin");
  const hooks = isObj(effective.experimental) ? effective.experimental.hook : undefined;
  if (isObj(hooks) && Object.keys(hooks).length > 0) unsafe("experimental.hook");
}

/** Liste fermée des seuls réglages admis pour le fournisseur officiel. */
export function assertOfficialOpenaiConfig(effective: Obj): void {
  const reject: () => never = () => {
    throw new Error(
      "Configuration OpenAI personnalisée incompatible avec ce mode ; utilisez OpenCode ou retirez les surcharges.",
    );
  };
  if (effective.provider === undefined) return;
  if (!isObj(effective.provider)) reject();
  const provider = (effective.provider as Obj).openai;
  if (provider === undefined) return;
  if (!isObj(provider)) reject();
  if (Object.keys(provider).some((key) => !["name", "npm", "options"].includes(key))) reject();
  if (provider.name !== undefined && typeof provider.name !== "string") reject();
  if (provider.npm !== undefined && provider.npm !== "@ai-sdk/openai") reject();
  if (provider.options === undefined) return;
  if (!isObj(provider.options)) reject();
  if (Object.keys(provider.options).some((key) => key !== "baseURL")) reject();
  if (
    provider.options.baseURL !== undefined &&
    provider.options.baseURL !== "https://api.openai.com/v1"
  )
    reject();
}
