import { type Finding, stripControl } from "@warband/core";
import { createUiTranslator, getUiLocale, type Locale } from "@warband/messages";

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
  locale: Locale = getUiLocale(),
): string {
  const t = createUiTranslator(() => locale);
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
    t`# Rapport de mission — ${text(project.name)}`,
    "",
    t("**Brouillon à relire et compléter avant diffusion.**"),
    "",
    t`Projet : ${text(project.id)} · Export : ${date.toISOString()}`,
    "",
    t("## Cadre de la mission"),
    "",
    t("- Objectif et périmètre autorisé : à compléter."),
    t("- Dates et conditions d’évaluation : à compléter."),
    t(
      "- Ce document reprend les notes du projet ; il ne déduit aucune vulnérabilité d’un simple accès.",
    ),
    t(
      "- Les identifiants et le loot sont exclus. Le journal, les sorties brutes et les captures ne sont pas joints.",
    ),
    "",
    t("## Synthèse"),
    "",
    t`${visible.filter((finding) => finding.state === "confirmed").length} élément(s) confirmé(s), ${visible.filter((finding) => finding.state === "hypothesis").length} hypothèse(s), ${visible.filter((finding) => finding.state === "failed").length} essai(s) en échec parmi les notes exportées.`,
    "",
    t("## Chemin retenu"),
    "",
    t(
      "Le marquage des liens décrit le parcours retenu par l’agent ou l’utilisateur ; il ne constitue pas une preuve supplémentaire.",
    ),
    "",
  ];
  const edges = visible.flatMap((finding) =>
    (finding.pathFrom ?? [])
      .filter((id) => finding.from?.includes(id) && nodes.has(id))
      .map(
        (id) =>
          `- ${text(nodes.get(id)?.label ?? "")} → ${text(finding.label)} (${t(STATES[finding.state])}).`,
      ),
  );
  lines.push(...(edges.length ? edges : [t("Aucun lien exportable marqué.")]));
  for (const state of ["confirmed", "hypothesis", "failed"] as const) {
    lines.push(
      "",
      `## ${state === "confirmed" ? t("Éléments confirmés") : state === "hypothesis" ? t("Hypothèses à vérifier") : t("Essais non concluants")}`,
      "",
    );
    const rows = visible.filter((finding) => finding.state === state);
    if (!rows.length) lines.push(t("Aucun élément exporté."));
    for (const finding of rows)
      lines.push(
        `### ${text(finding.label)}`,
        "",
        t`- Référence : ${text(finding.id)} ; type : ${t(TYPES[finding.kind])} ; état : ${t(STATES[state])}.`,
        ...(finding.tactic ? [t`- Tactique ATT&CK : ${finding.tactic}.`] : []),
        ...(finding.technique ? [t`- Technique ATT&CK : ${finding.technique}.`] : []),
        t("- Preuve, chemin d’artefact et reproduction : à référencer après vérification."),
        t(
          "- Impact, gravité/CVSS et recommandation : à évaluer si cet élément décrit une vulnérabilité.",
        ),
        "",
      );
  }
  lines.push(
    t("## Conclusion et suites"),
    "",
    t(
      "Objectifs démontrés, limites, pistes restantes et nettoyage : à compléter à partir des preuves.",
    ),
    "",
    t("## Préparation du rapport final"),
    "",
    t(
      "Ce Markdown peut être repris dans les notes SysReptor. Pour produire un rapport final, choisir un modèle, renseigner les champs requis et joindre uniquement les preuves vérifiées et autorisées. Ce fichier n’est pas une archive native d’import SysReptor.",
    ),
    "",
  );
  return lines.join("\n");
}

/** Vue de notes : aucune gravité n'est déduite du type ou de l'état d'une trouvaille. */
export function missionReportPreview(
  project: { id: string; name: string },
  findings: readonly Finding[],
  locale: Locale = getUiLocale(),
) {
  const t = createUiTranslator(() => locale);
  return {
    id: -1,
    kind: "report" as const,
    projectId: project.id,
    title: t`Notes du projet — ${stripControl(project.name)}`,
    description: t(
      "Brouillon à compléter. Les notes ne constituent pas une liste de vulnérabilités. Gravité, preuves et remédiations restent à évaluer. Identifiants et loot exclus.",
    ),
    findings: findings
      .filter((finding) => finding.kind !== "credential" && finding.kind !== "loot")
      .map((finding) => ({
        label: stripControl(finding.label),
        severity: "unrated" as const,
        detail: [
          t(TYPES[finding.kind]),
          t(STATES[finding.state]),
          finding.tactic,
          finding.technique,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
  };
}
