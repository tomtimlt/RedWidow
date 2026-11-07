import { AGENT_PROFILES, MCP_CATALOG } from "@warband/core";
import type { Provider } from "./effort.js";
import type { ChatSettings } from "./settings.js";

/** Activation machine distincte de la sélection éphémère de chaque conversation. */
export interface CapabilitySettings {
  providers: string[];
  skills: string[];
  integrations: string[];
  webSearch: boolean;
}
export interface ChatSelection {
  profile: string | null;
  integrations: string[];
  burp: boolean;
  webSearch: boolean;
}
export const emptySelection = (): ChatSelection => ({
  profile: null,
  integrations: [],
  burp: false,
  webSearch: false,
});
export const isCapabilityId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z0-9._-]{0,98}$/.test(value);
export function capabilitySettings(get: (key: string) => unknown): CapabilitySettings {
  const ids = (key: string, fallback: string[]) => {
    const raw = get(key);
    return raw === undefined
      ? fallback
      : Array.isArray(raw) && raw.length <= 512 && raw.every(isCapabilityId)
        ? [...new Set(raw)]
        : [];
  };
  return {
    providers: ids("chat.providers", ["claude", "openai", "opencode"]),
    skills: ids("chat.skills", Object.keys(AGENT_PROFILES)),
    integrations: ids("chat.integrations", []),
    webSearch: get("chat.webSearch") === undefined || get("chat.webSearch") === true,
  };
}
export function parseChatSelection(raw: unknown): ChatSelection | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (
    Object.keys(r).length !== 4 ||
    Object.keys(r).some((k) => !["profile", "integrations", "burp", "webSearch"].includes(k)) ||
    !(
      r.profile === null ||
      (isCapabilityId(r.profile) && Object.hasOwn(AGENT_PROFILES, r.profile))
    ) ||
    !Array.isArray(r.integrations) ||
    r.integrations.length > 4 ||
    !r.integrations.every((id) => MCP_CATALOG.some((m) => m.id === id)) ||
    new Set(r.integrations).size !== r.integrations.length ||
    typeof r.burp !== "boolean" ||
    typeof r.webSearch !== "boolean"
  )
    return null;
  return {
    profile: r.profile,
    integrations: [...r.integrations] as string[],
    burp: r.burp,
    webSearch: r.webSearch,
  };
}
/** Bascule d'une capacité depuis le chat : activer ou retirer, avec écriture dans `chat.*` côté hôte. */
export interface CapabilityToggle {
  kind: "skill" | "integration" | "burp" | "webSearch";
  /** Identifiant connu (profil ou catalogue MCP) ; absent pour Burp et la recherche web. */
  id?: string;
  enabled: boolean;
}
export function parseCapabilityToggle(raw: unknown): CapabilityToggle | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.enabled !== "boolean") return null;
  const keys = Object.keys(r);
  if (r.kind === "burp" || r.kind === "webSearch")
    return keys.length === 2 && keys.every((k) => k === "kind" || k === "enabled")
      ? { kind: r.kind, enabled: r.enabled }
      : null;
  if (
    keys.length === 3 &&
    keys.every((k) => k === "kind" || k === "id" || k === "enabled") &&
    typeof r.id === "string" &&
    ((r.kind === "skill" && Object.hasOwn(AGENT_PROFILES, r.id)) ||
      (r.kind === "integration" && MCP_CATALOG.some((m) => m.id === r.id)))
  )
    return { kind: r.kind, id: r.id, enabled: r.enabled };
  return null;
}
/**
 * Effet d'une bascule : réglages `chat.*` à écrire (ajout ou retrait) et nouvelle sélection de la
 * conversation. Un retrait désactive aussi la capacité pour les prochaines conversations.
 * Retourne `null` si la bascule est refusée (4 connecteurs au plus par conversation).
 */
export function applyCapabilityToggle(
  caps: CapabilitySettings,
  selection: ChatSelection,
  toggle: CapabilityToggle,
): { writes: { key: string; value: unknown }[]; selection: ChatSelection } | null {
  const next: ChatSelection = { ...selection, integrations: [...selection.integrations] };
  const writes: { key: string; value: unknown }[] = [];
  const list = (key: "skills" | "integrations", id: string) => {
    const has = caps[key].includes(id);
    if (toggle.enabled && !has) writes.push({ key: `chat.${key}`, value: [...caps[key], id] });
    if (!toggle.enabled && has)
      writes.push({ key: `chat.${key}`, value: caps[key].filter((v) => v !== id) });
  };
  if (toggle.kind === "skill" && toggle.id) {
    list("skills", toggle.id);
    if (toggle.enabled) next.profile = toggle.id;
    else if (next.profile === toggle.id) next.profile = null;
  } else if (toggle.kind === "integration" && toggle.id) {
    if (toggle.enabled && !next.integrations.includes(toggle.id)) {
      if (next.integrations.length >= 4) return null;
      next.integrations.push(toggle.id);
    }
    if (!toggle.enabled) next.integrations = next.integrations.filter((v) => v !== toggle.id);
    list("integrations", toggle.id);
  } else if (toggle.kind === "burp") {
    next.burp = toggle.enabled;
    list("integrations", "burp");
  } else if (toggle.kind === "webSearch") {
    next.webSearch = toggle.enabled;
    if (toggle.enabled !== caps.webSearch)
      writes.push({ key: "chat.webSearch", value: toggle.enabled });
  } else return null;
  return { writes, selection: next };
}
export function allowedSelection(settings: ChatSettings, selection: ChatSelection): ChatSelection {
  const caps = settings.capabilities;
  return {
    profile:
      selection.profile && caps?.skills.includes(selection.profile) ? selection.profile : null,
    integrations: selection.integrations.filter(
      (id) => caps?.integrations.includes(id) && settings.integrations?.some((m) => m.id === id),
    ),
    burp: selection.burp && caps?.integrations.includes("burp") === true && !!settings.burp,
    webSearch: selection.webSearch && caps?.webSearch === true,
  };
}
export function selectedSettings(settings: ChatSettings, selection: ChatSelection): ChatSettings {
  // Les appels historiques sans registre gardent leur contrat ; l'extension fournit toujours le registre.
  if (!settings.capabilities) return settings;
  const selected = allowedSelection(settings, selection);
  const { profile: _profile, burp: _burp, integrations: _integrations, ...rest } = settings;
  return {
    ...rest,
    webSearch: selected.webSearch,
    ...(selected.profile && { profile: selected.profile }),
    ...(selected.burp && { burp: settings.burp }),
    integrations: settings.integrations?.filter((m) => selected.integrations.includes(m.id)) ?? [],
  };
}
export interface ProviderChoice {
  id: string;
  label: string;
  backend: Provider;
  prefix?: string;
  runtimeId?: string;
  connected?: boolean;
}
export function providerChoices(settings: ChatSettings, enabledOnly = true): ProviderChoice[] {
  const all: ProviderChoice[] = [
    { id: "claude", label: "Claude", backend: "claude" },
    { id: "openai", label: "OpenAI · ChatGPT / API", backend: "openai" },
    { id: "opencode", label: "OpenCode", backend: "opencode" },
    ...(settings.providerCatalog ?? [])
      .filter((p) => !p.id.startsWith("venator-"))
      .map((p) => ({
        id: p.id === "google" ? "google" : `oc-${p.id}`,
        label: p.name,
        backend: "opencode" as const,
        prefix: `${p.id}/`,
        runtimeId: p.id,
        connected: p.connected,
      })),
    ...Object.entries(settings.opencodeProviders ?? {}).map(([id, p]) => ({
      id,
      label: p.name ?? id,
      backend: "opencode" as const,
      prefix: `${id}/`,
      runtimeId: id,
      connected: settings.providerCatalog?.find((p) => p.id === id)?.connected ?? false,
    })),
  ];
  return enabledOnly ? all.filter((p) => settings.capabilities?.providers.includes(p.id)) : all;
}
