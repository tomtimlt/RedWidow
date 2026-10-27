import { type Finding, stripControl } from "@warband/core";

const TYPES = {
  host: "Hôte",
  site: "Site",
  step: "Étape",
  credential: "Identifiant",
  loot: "Loot",
};
const STATES = { confirmed: "Confirmé", hypothesis: "Hypothèse", failed: "Échec" };

/** Brouillon de notes Markdown pour SysReptor ou un autre rédacteur, sans gravité ou preuve inventée. */
export function missionReport(
  project: { id: string; name: string },
  findings: Finding[],
  date: Date,
): string {
  const text = (value: string) =>
    stripControl(value)
      .replace(/[\r\n]/g, " ")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/([\\`*_{}[\]<>()#!|>])/g, "\\$1");
  const visible = findings.filter(
    (finding) => finding.kind !== "credential" && finding.kind !== "loot",
  );
  const nodes = new Map(visible.map((finding) => [finding.id, finding]));
  const lines = [
    `# Rapport de mission — ${text(project.name)}`,
    "",
    "**Brouillon à relire et compléter avant diffusion.**",
    "",
    `Projet : ${text(project.id)} · Export : ${date.toISOString()}`,
    "",
    "## Cadre de la mission",
    "",
    "- Objectif et périmètre autorisé : à compléter.",
    "- Dates et conditions d’évaluation : à compléter.",
    "- Ce document reprend les notes du projet ; il ne déduit aucune vulnérabilité d’un simple accès.",
    "- Les identifiants et le loot sont exclus. Le journal, les sorties brutes et les captures ne sont pas joints.",
    "",
    "## Synthèse",
    "",
    `${visible.filter((finding) => finding.state === "confirmed").length} élément(s) confirmé(s), ${visible.filter((finding) => finding.state === "hypothesis").length} hypothèse(s), ${visible.filter((finding) => finding.state === "failed").length} essai(s) en échec parmi les notes exportées.`,
    "",
    "## Chemin retenu",
    "",
    "Le marquage des liens décrit le parcours retenu par l’agent ou l’utilisateur ; il ne constitue pas une preuve supplémentaire.",
    "",
  ];
  const edges = visible.flatMap((finding) =>
    (finding.pathFrom ?? [])
      .filter((id) => finding.from?.includes(id) && nodes.has(id))
      .map(
        (id) =>
          `- ${text(nodes.get(id)?.label ?? "")} → ${text(finding.label)} (${STATES[finding.state]}).`,
      ),
  );
  lines.push(...(edges.length ? edges : ["Aucun lien exportable marqué."]));
  for (const state of ["confirmed", "hypothesis", "failed"] as const) {
    lines.push(
      "",
      `## ${state === "confirmed" ? "Éléments confirmés" : state === "hypothesis" ? "Hypothèses à vérifier" : "Essais non concluants"}`,
      "",
    );
    const rows = visible.filter((finding) => finding.state === state);
    if (!rows.length) lines.push("Aucun élément exporté.");
    for (const finding of rows)
      lines.push(
        `### ${text(finding.label)}`,
        "",
        `- Référence : ${text(finding.id)} ; type : ${TYPES[finding.kind]} ; état : ${STATES[state]}.`,
        ...(finding.tactic ? [`- Tactique ATT&CK : ${finding.tactic}.`] : []),
        ...(finding.technique ? [`- Technique ATT&CK : ${finding.technique}.`] : []),
        "- Preuve, chemin d’artefact et reproduction : à référencer après vérification.",
        "- Impact, gravité/CVSS et recommandation : à évaluer si cet élément décrit une vulnérabilité.",
        "",
      );
  }
  lines.push(
    "## Conclusion et suites",
    "",
    "Objectifs démontrés, limites, pistes restantes et nettoyage : à compléter à partir des preuves.",
    "",
    "## Préparation du rapport final",
    "",
    "Ce Markdown peut être repris dans les notes SysReptor. Pour produire un rapport final, choisir un modèle, renseigner les champs requis et joindre uniquement les preuves vérifiées et autorisées. Ce fichier n’est pas une archive native d’import SysReptor.",
    "",
  );
  return lines.join("\n");
}
