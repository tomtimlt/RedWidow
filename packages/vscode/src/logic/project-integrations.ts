import type { IntegrationConfig } from "@warband/core";
import { t } from "@warband/messages";
import { parseConfiguredIntegrations } from "./settings.js";
/** Réglage utilisateur machine, indexé par UUID : aucune configuration de dépôt exécutée. */
export function integrationMap(raw: unknown): Record<string, IntegrationConfig[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length > 32)
    throw Error(t("Catalogue de projets invalide."));
  const out: Record<string, IntegrationConfig[]> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))
      throw Error(t("Identité de projet invalide."));
    const parsed = parseConfiguredIntegrations(value);
    if (!parsed) throw Error(t("Connexion MCP de projet invalide."));
    out[id] = parsed;
  }
  return out;
}
export function projectIntegrations(raw: unknown, id: string | null): IntegrationConfig[] {
  const map = integrationMap(raw);
  return id === null ? [] : (map[id] ?? []);
}
