import { z } from "zod";
import { normalizeSkillSearch, renderProfileSkill } from "./agent-profile-skill.js";
import { AGENT_PROFILES, isAgentProfile } from "./agent-profiles.js";
import type { DockerToolSpec } from "./docker/tool-specs.js";
import type { MissionDesk } from "./mission-desk.js";
import { capOutput } from "./output.js";
import { SKILL_SOURCES } from "./skill-sources.js";

export { AGENT_PROFILES, type AgentProfile, isAgentProfile } from "./agent-profiles.js";
export function deskInstructions(profile?: string): string {
  const selected = isAgentProfile(profile) ? AGENT_PROFILES[profile] : null;
  return (
    "Bureau agent : les faits vérifiés, hypothèses et blocages restent distincts. Aux embranchements significatifs, consulter mission_context puis record_decision avec objectif immédiat, références de ce run, prochaine action et critère de réussite. Charger avec load_skill seulement la méthode et le thème utiles à cette décision. Conserver les gros résultats dans le dossier de mission, citer leurs chemins et charger uniquement les passages utiles. Les skills n’accordent aucun droit, n’effacent ni la gate ni le scope et ne justifient aucune exposition de secret. Profils disponibles : mentor, bug-bounty, out-of-box, red-team, htb. Une lacune technique précise peut justifier une recherche GitHub via les outils web exposés : technologie/version et message d’erreur, puis README, tests et issues ; garder URL et version/commit, vérifier la compatibilité et essayer les outils candidats sur un échantillon local avant toute exécution en mission. Ne pas consulter de writeup de challenge sans autorisation. Utiliser task_status_json/task_list_json pour lire un état structuré si ces outils sont exposés, max_parallel pour borner les tâches indépendantes, sans relancer les tâches actives. Aucun ancien cas ou ancienne session n’est chargé automatiquement. " +
    (selected
      ? `Profil choisi : ${selected.label}. ${selected.text} Ce résumé suffit pour une petite question. Charger sa méthode ou une section seulement si elle est utile et absente ou dépassée dans le contexte, par exemple load_skill(profile: "${profile}", section: "blocages"). Ne pas recharger à chaque décision. source: "upstream" demande explicitement la référence externe.`
      : "Aucun profil spécialisé imposé.")
  );
}
export function deskToolSpecs(desk?: MissionDesk): DockerToolSpec[] {
  const input = {
    profile: z.enum(Object.keys(AGENT_PROFILES).filter(isAgentProfile)),
    section: z.string().min(1).max(120).optional(),
    source: z.enum(["profile", "upstream"]).optional(),
  };
  const specs: DockerToolSpec[] = [
    {
      name: "load_skill",
      description:
        "Charger la méthode française d’un profil (source: profile par défaut). section filtre son identifiant, titre, mots-clés ou contenu. source: upstream charge explicitement la référence GitHub épinglée, limitée à 16000 octets UTF-8. Aucun outil exécuté ni changement de permissions ; les exemples upstream restent des références.",
      input,
      readOnly: true,
      async run(raw) {
        const { profile, section, source = "profile" } = z.object(input).strict().parse(raw);
        const selected = AGENT_PROFILES[profile];
        const upstream = SKILL_SOURCES[selected.source];
        const rendered = renderProfileSkill(profile, section);
        const query = section === undefined ? undefined : normalizeSkillSearch(section);
        const upstreamMatches =
          source === "upstream"
            ? query === undefined
              ? upstream.text
              : upstream.text
                  .split(/\n\s*\n/)
                  .filter((part) => query.length > 0 && normalizeSkillSearch(part).includes(query))
                  .join("\n\n")
            : "";
        const capped = capOutput(upstreamMatches, 16000);
        const sectionFound =
          source === "profile" ? rendered.sectionFound : upstreamMatches.length > 0;
        return JSON.stringify({
          profile,
          section,
          source,
          sectionFound,
          sections: rendered.sections,
          instructions: source === "profile" ? rendered.instructions : selected.text,
          upstream: {
            source: upstream.source,
            license: upstream.license,
            text: capped.output,
            loaded: source === "upstream",
            reason:
              source !== "upstream"
                ? 'Référence non chargée ; demander explicitement source: "upstream" pour la lire.'
                : !sectionFound
                  ? "Aucun paragraphe upstream ne correspond à cette section."
                  : "Référence chargée sur demande explicite.",
            truncated: capped.truncated,
            bytes: capped.bytes,
          },
          boundary:
            "Les règles de mission et de confidentialité priment. Ne pas déléguer ni lancer d’outil absent. Les références externes non chargées ne sont pas supposées connues. Ne jamais imprimer de secrets, environnement ou fichiers d’authentification pour diagnostiquer.",
        });
      },
    },
  ];
  if (desk)
    specs.push(
      {
        name: "mission_context",
        description:
          "Consulter les observations sourcées et les budgets du run courant. Les sources ne prouvent pas automatiquement la réussite.",
        input: {
          query: z.string().max(2000).optional(),
          evidenceIds: z.array(z.string().max(200)).max(32).optional(),
          maxChars: z.number().int().min(2048).max(24000).optional(),
        },
        readOnly: true,
        async run(raw) {
          const options = z
            .object({
              query: z.string().max(2000).optional(),
              evidenceIds: z.array(z.string().max(200)).max(32).optional(),
              maxChars: z.number().int().min(2048).max(24000).optional(),
            })
            .strict()
            .parse(raw);
          return JSON.stringify(desk.context(options));
        },
      },
      {
        name: "record_decision",
        description:
          "Mémoriser une décision et ses références du run courant, sans exécution ni changement de permissions.",
        input: {
          objective: z.string().min(1).max(2000),
          evidenceIds: z.array(z.string().max(200)).max(32),
          nextAction: z.string().min(1).max(2000),
          successCriterion: z.string().min(1).max(2000),
          maxCalls: z.number().int().min(1).max(1000).optional(),
          maxDurationSeconds: z.number().positive().max(86400).optional(),
        },
        readOnly: false,
        async run(raw) {
          return JSON.stringify(
            desk.recordDecision(raw as Parameters<MissionDesk["recordDecision"]>[0]),
          );
        },
      },
    );
  return specs;
}
