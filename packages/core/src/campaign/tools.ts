import { z } from "zod";
import type { DockerToolSpec } from "../docker/tool-specs.js";
import type { CampaignRunRole } from "./port.js";
import { COVERAGE_OUTCOMES } from "./types.js";

const draftSchema = z.object({
  title: z.string().min(1).max(200),
  rationale: z.string().max(2000),
});
const openInput = { intents: z.array(draftSchema).min(1).max(4) };
const closeInput = {
  outcome: z.enum(COVERAGE_OUTCOMES),
  summary: z.string().max(2000),
  evidence: z.array(z.string().min(1).max(200)).max(50),
};

/**
 * Outils de campagne selon le rôle (ADR 0054) : un planificateur ne voit jamais l'outil du
 * worker et inversement. Même statut que `record_decision` (`readOnly: false`, passage par la gate).
 */
export function campaignToolSpecs(multiAgent?: CampaignRunRole): DockerToolSpec[] {
  if (!multiAgent) return [];
  const { port } = multiAgent;
  if (multiAgent.role === "planner") {
    return [
      {
        name: "campaign_open_intent",
        description:
          "Planificateur : ouvrir 1 à 4 intentions d'exploration (title court et distinct, rationale). Un worker prendra chacune. Un titre déjà ouvert, pris ou terminé est refusé en bloc ; le plafond par tour et le budget s'appliquent. Renvoie les intentions créées.",
        input: openInput,
        readOnly: false,
        async run(raw) {
          const { intents } = z.object(openInput).strict().parse(raw);
          return JSON.stringify(await port.openIntents(intents));
        },
      },
      {
        name: "campaign_status",
        description:
          "Planificateur : état de la campagne (compteurs par état, intentions, verdicts et preuves, dépense). Aucune écriture.",
        input: {},
        readOnly: false,
        async run(raw) {
          z.object({})
            .strict()
            .parse(raw ?? {});
          return JSON.stringify(await port.status());
        },
      },
    ];
  }
  return [
    {
      name: "campaign_close_intent",
      description:
        "Worker : fermer l'intention attribuée à ce run avec un verdict (reported, no_issue_found, ruled_out, not_applicable, needs_follow_up), un résumé (2000 caractères max) et les identifiants d'événements de ce run cités en preuve (50 max). À appeler une seule fois, en fin de travail.",
      input: closeInput,
      readOnly: false,
      async run(raw) {
        const closure = z.object(closeInput).strict().parse(raw);
        return JSON.stringify(await port.closeIntent(closure));
      },
    },
  ];
}
