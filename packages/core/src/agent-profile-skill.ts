import { AGENT_PROFILES, type AgentProfile } from "./agent-profiles.js";
import { SKILL_SOURCES } from "./skill-sources.js";

/** Même recherche pour les profils français et les références upstream. */
export function normalizeSkillSearch(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/gu, " ");
}

export interface RenderedProfileSkill {
  instructions: string;
  sectionFound: boolean;
  /** Index complet dans l’ordre canonique, même si la recherche ne trouve rien. */
  sections: { id: string; title: string }[];
}

/** Rendu commun au chargement à la demande et au corps des artefacts SKILL.md. */
export function renderProfileSkill(profile: AgentProfile, section?: string): RenderedProfileSkill {
  const selected = AGENT_PROFILES[profile];
  const query = section === undefined ? undefined : normalizeSkillSearch(section);
  const exact = selected.sections.find((entry) => normalizeSkillSearch(entry.id) === query);
  const matches = exact
    ? [exact]
    : selected.sections.filter(
        (entry) =>
          query === undefined ||
          (query.length > 0 &&
            [entry.id, entry.title, ...entry.keywords, entry.text].some((part) =>
              normalizeSkillSearch(part).includes(query),
            )),
      );
  const sections = selected.sections.map(({ id, title }) => ({ id, title }));
  const index = `Sections disponibles : ${sections.map(({ id, title }) => `${id} (${title})`).join(" ; ")}.`;
  const instructions =
    matches.length === 0
      ? `# ${selected.label}\n\nAucune section ne correspond à ${JSON.stringify(section)}. Préciser un identifiant ou un thème de l’index.\n\n${index}`
      : [
          `# ${selected.label}`,
          selected.text,
          index,
          ...matches.map(({ id, title, text }) => `## ${title} [${id}]\n\n${text}`),
        ].join("\n\n");
  return { instructions, sectionFound: matches.length > 0, sections };
}

/** L’enveloppe est propre au fichier ; son corps est exactement load_skill.instructions. */
export function renderProfileSkillArtifact(profile: AgentProfile): string {
  const selected = AGENT_PROFILES[profile];
  const upstream = SKILL_SOURCES[selected.source];
  return [
    "---",
    `name: warband-${profile}`,
    `description: Profil méthodologique ${selected.label} pour une mission autorisée.`,
    `license: ${upstream.license}`,
    "---",
    "",
    renderProfileSkill(profile).instructions,
    "",
    "Le contrat commun Warband, la confidentialité, le scope et la gate priment. Ce profil ne crée aucun outil, ne lance aucune commande et ne remplace pas une preuve.",
    "",
    `Source de méthode : ${upstream.source}`,
    "",
    'Adaptation Warband en français ; charger explicitement la référence upstream avec mcp__desk__load_skill et source: "upstream". Attribution et licence complète dans le dossier parent.',
    "",
  ].join("\n");
}
