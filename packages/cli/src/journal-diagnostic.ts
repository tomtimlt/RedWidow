import { capOutput, type EngineEvent, type JournalContents } from "@warband/core";
import { formatReason, type Locale } from "@warband/messages";

const MAX_EXCERPTS = 5;
const MAX_EXCERPT_BYTES = 512;

/** Rapport descriptif : les événements sont examinés dans l'ordre du fichier. */
export function formatJournalDiagnostic(
  { events, issues }: JournalContents,
  locale: Locale,
): string {
  const t = (fr: string, en: string) => (locale === "fr" ? fr : en);
  const count = (kind: EngineEvent["kind"]) => events.filter((event) => event.kind === kind).length;
  const last = events.at(-1);
  const state = events.findLast(
    (event) => event.kind === "run.finished" || event.kind === "turn.finished",
  );
  const outputs = events
    .filter(
      (event): event is Extract<EngineEvent, { kind: "tool.result" }> =>
        event.kind === "tool.result" && event.truncated,
    )
    .slice(-MAX_EXCERPTS);
  const lines = [
    t(`Événements valides : ${events.length}`, `Valid events: ${events.length}`),
    `tool.requested : ${count("tool.requested")}`,
    `turn.finished : ${count("turn.finished")}`,
    t(
      `Dernier événement : ${last ? `${last.kind} (${last.ts}, run ${last.runId})` : "aucun"}`,
      `Last event: ${last ? `${last.kind} (${last.ts}, run ${last.runId})` : "none"}`,
    ),
    t(
      `Dernier état de fin observé : ${state ? `${state.kind} ${state.status} (run ${state.runId})` : "aucun"}`,
      `Last observed completion status: ${state ? `${state.kind} ${state.status} (run ${state.runId})` : "none"}`,
    ),
    t(`Anomalies de lecture : ${issues.length}`, `Read issues: ${issues.length}`),
    ...issues.map((issue) =>
      t(
        `  ligne ${issue.line} : ${formatReason(issue.error, locale)}`,
        `  line ${issue.line}: ${formatReason(issue.error, locale)}`,
      ),
    ),
    t(
      `Dernières sorties déclarées tronquées (maximum ${MAX_EXCERPTS}) : ${outputs.length}`,
      `Recent outputs reported truncated (maximum ${MAX_EXCERPTS}): ${outputs.length}`,
    ),
    ...outputs.map((event) => {
      const excerpt = capOutput(event.output, MAX_EXCERPT_BYTES);
      return `  ${event.ts} | run ${event.runId} | ${event.toolUseId} | ${event.bytes} ${t("octets", "bytes")} | ${JSON.stringify(excerpt.output)}${excerpt.truncated ? " …" : ""}`;
    }),
    t(
      "Pistes ouvertes et appels fournisseur : indéterminables à partir de ce journal seul.",
      "Open leads and provider calls: cannot be determined from this journal alone.",
    ),
  ];
  return `${lines.join("\n")}\n`;
}
