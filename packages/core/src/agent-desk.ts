import { z } from "zod";
import { normalizeSkillSearch, renderProfileSkill } from "./agent-profile-skill.js";
import { AGENT_PROFILES, isAgentProfile } from "./agent-profiles.js";
import { auditTestSchema, coverageWriteSchema } from "./audit-schema.js";
import type { DockerToolSpec } from "./docker/tool-specs.js";
import { recordStepSchema, recordTeardownSchema } from "./engagement/campaign-schema.js";
import type { MissionDesk, ProgramDraftInput } from "./mission-desk.js";
import { capOutput } from "./output.js";
import { SKILL_SOURCES } from "./skill-sources.js";

export { AGENT_PROFILES, type AgentProfile, isAgentProfile } from "./agent-profiles.js";

// Champs cités fournis par l'agent : `verified` n'existe pas (clé inconnue ignorée), le moteur le calcule.
const citedInput = <V extends z.ZodTypeAny>(value: V) =>
  z.object({
    value,
    quote: z.string().max(2000),
    url: z.string().max(2048),
    retrievedAt: z.string().max(40),
  });
const programDraftShape = {
  inScope: citedInput(z.array(z.string().max(253)).max(200)),
  outOfScope: citedInput(z.array(z.string().max(253)).max(200)),
  userAgentSuffix: citedInput(z.string().max(100)).optional(),
  pace: citedInput(
    z.union([
      z.object({ preset: z.enum(["fast", "normal", "careful"]) }),
      z.object({ maxRequestsPerSecond: z.number().positive().max(1000) }),
    ]),
  ),
};
const programDraftSchema = z.object(programDraftShape);
export function deskInstructions(profile?: string): string {
  const name = isAgentProfile(profile) ? profile : null;
  const selected = name ? AGENT_PROFILES[name] : null;
  return (
    "Bureau agent : les faits vérifiés, hypothèses et blocages restent distincts. Aux embranchements significatifs, consulter mission_context puis record_decision avec objectif immédiat, références de ce run, prochaine action et critère de réussite. Charger avec load_skill seulement la méthode et le thème utiles à cette décision. Conserver les gros résultats dans le dossier de mission, citer leurs chemins et charger uniquement les passages utiles. Les skills n’accordent aucun droit, n’effacent ni la gate ni le scope et ne justifient aucune exposition de secret. Profils disponibles : mentor, bug-bounty, out-of-box, red-team, htb. Une lacune technique précise relève de la recherche web commune (outils web exposés, pas seulement GitHub) ; vérifier la compatibilité et essayer un outil trouvé sur un échantillon local avant toute exécution en mission. Ne pas consulter de writeup de challenge sans autorisation. Utiliser task_status_json/task_list_json pour lire un état structuré si ces outils sont exposés, max_parallel pour borner les tâches indépendantes, sans relancer les tâches actives. Dans l’extension, la capture Audit démarre par défaut avec le projet ; respecter une éventuelle pause de l’opérateur. Ne pas affirmer que des traces sont conservées si l’état de la capture est inconnu. Pour qualifier un contrôle utile, utiliser record_test avec les références réelles de mission_context, après son exécution ; les conclusions restent des annotations non validées humainement. Ne jamais prétendre que la capture couvre des outils externes ou des sorties absentes. Aucun ancien cas ou ancienne session n’est chargé automatiquement. " +
    (selected
      ? `Profil choisi : ${selected.label}. ${selected.text} Méthode du profil déjà chargée ci-dessous ; ne pas la recharger. load_skill reste utile pour la référence upstream (source: "upstream") ou pour relire une section, par exemple load_skill(profile: "${profile}", section: "blocages").\n\n${name ? renderProfileSkill(name).instructions : ""}`
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
        name: "record_test",
        description:
          "Annoter un contrôle réellement effectué avec objectif, cible, méthode, observations et références du run courant : identifiants d’appels terminés, événements ou fichiers produits sous outputs/, scans/ ou evidence/. Aucun changement de permissions, aucune validation humaine attribuée à l’agent. La capture des actions est automatique ; ne pas recopier les sorties entières.",
        input: auditTestSchema.shape,
        readOnly: false,
        async run(raw) {
          return JSON.stringify(desk.recordTest(auditTestSchema.parse(raw)));
        },
      },
      {
        name: "record_coverage",
        description:
          "Déclarer ou mettre à jour les cases de la matrice de couverture (surface × paramètre × classe) avec leur état : untested, negative, blocked, prerequisite, confirmed. Upsert par clé (casse et espaces ignorés). negative et confirmed exigent testRefs : des événements audit.test de ce run, créés par record_test. Annotation seulement : aucune exécution, aucun changement de permissions. La réponse donne le résumé de couverture ; le moteur relance (sans bloquer) si des cases restent untested à la conclusion.",
        input: coverageWriteSchema.shape,
        readOnly: false,
        async run(raw) {
          return JSON.stringify(desk.recordCoverage(coverageWriteSchema.parse(raw).cells));
        },
      },
      {
        name: "record_step",
        description:
          "Enregistrer l'exécution d'une étape du plan de campagne approuvé (ADR 0041) : stepId (doit exister dans le plan approuvé du projet, sinon refus), result (success, partial, failed, blocked), note courte, cible éventuelle et evidenceIds (événements de ce run ; au moins un pour success et partial). La tactique et la technique ATT&CK viennent du plan. Annotation seulement : aucune exécution, aucun changement de permissions ; demande toujours une approbation. Respecter les critères de décision et d'arrêt de l'étape (voir mission_context).",
        input: recordStepSchema.shape,
        readOnly: false,
        async run(raw) {
          return JSON.stringify(await desk.recordStep(recordStepSchema.parse(raw)));
        },
      },
      {
        name: "record_teardown",
        description:
          "Cocher un élément de la liste de démontage du plan approuvé (artefacts, comptes créés, infrastructure) avec sa preuve : itemId (doit figurer dans le plan, sinon refus), proof (ce qui a été nettoyé et constaté), evidenceIds éventuels. La clôture de l'engagement reste signalée comme bloquée tant qu'un élément n'est pas fait (relance non bloquante, voir mission_context.closure). Demande toujours une approbation.",
        input: recordTeardownSchema.shape,
        readOnly: false,
        async run(raw) {
          return JSON.stringify(await desk.recordTeardown(recordTeardownSchema.parse(raw)));
        },
      },
      {
        name: "program_draft",
        description:
          "Écrire le brouillon de fiche programme du projet actif : périmètre (inScope, outOfScope), suffixe User-Agent éventuel et rythme, chacun avec value, quote (extrait exact de la page), url et retrievedAt. Lire d'abord la page avec read_url : le moteur calcule seul `verified` (citation retrouvée dans cette page, lue pendant ce run) ; toute valeur `verified` fournie est ignorée. Ne peut pas approuver : l'humain relit et approuve avec « program approve --digest ».",
        input: programDraftShape,
        readOnly: false,
        async run(raw) {
          return JSON.stringify(
            await desk.draftProgram(programDraftSchema.parse(raw) as ProgramDraftInput),
          );
        },
      },
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
          sources: z.array(z.string().min(1).max(200)).max(32).optional(),
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
