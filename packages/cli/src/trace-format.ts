import type { BlockClass, TraceEndCode, TraceReport, TruncationSign } from "@warband/core";
import { DEFAULT_LOCALE, type Locale } from "@warband/messages";
import { stripControl } from "./sanitize.js";

/** Libellés de la commande `trace` : le cœur ne fournit que des codes. */
const END_LABELS: Record<TraceEndCode, { fr: string; en: string }> = {
  "turn-finished": {
    fr: "tour terminé (le modèle s'est arrêté)",
    en: "turn finished (model stopped)",
  },
  "run-error": { fr: "erreur", en: "error" },
  quota: { fr: "quota ou limite d'usage atteint", en: "quota or usage limit reached" },
  aborted: { fr: "arrêt demandé", en: "aborted" },
  "journal-truncated": { fr: "journal plafonné (suite perdue)", en: "journal capped (rest lost)" },
  incomplete: {
    fr: "run incomplet (aucune fin enregistrée)",
    en: "incomplete run (no end recorded)",
  },
};

const CLASS_LABELS: Record<BlockClass, { fr: string; en: string }> = {
  A: {
    fr: "A : sorties tronquées proches de la fin (le modèle n'a pas vu les indices)",
    en: "A: truncated outputs near the end (the model did not see the clues)",
  },
  B: {
    fr: "B : le modèle s'est arrêté alors qu'il restait des pistes",
    en: "B: the model stopped with leads remaining",
  },
  C: {
    fr: "C : aucune recherche web et peu de diversité d'approches",
    en: "C: no web search and little diversity of approaches",
  },
};

const SIGN_LABELS: Record<TruncationSign, { fr: string; en: string }> = {
  flag: { fr: "drapeau", en: "flag" },
  lineMarker: { fr: "marqueur de lignes", en: "line marker" },
  cut16k: { fr: "coupe 16 Kio", en: "16 KiB cut" },
};

function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** Rendu texte du rapport (lignes sans retour à la ligne final). */
export function formatTraceReport(report: TraceReport, locale: Locale = DEFAULT_LOCALE): string[] {
  const en = locale === "en";
  const t = (fr: string, enText: string) => (en ? enText : fr);
  const out: string[] = [];
  const clean = (s: string) => stripControl(s);

  out.push(
    `${t("Trace du run", "Run trace")} ${report.runId ?? "?"} (${report.events} ${t("événements", "events")})`,
  );

  const v = report.volume;
  out.push("", t("1. Volume", "1. Volume"));
  out.push(
    `  ${t("tours", "turns")} : ${v.turns} · ${t("appels", "calls")} : ${v.calls} · ${t("durée", "duration")} : ${duration(v.durationMs)}`,
  );
  for (const [tool, n] of Object.entries(v.callsByTool).sort((a, b) => b[1] - a[1]))
    out.push(`  ${String(n).padStart(4)} × ${clean(tool)}`);
  for (const g of v.longestGaps)
    out.push(
      `  ${t("silence", "gap")} ${duration(g.ms)} ${t("après l'événement", "after event")} #${g.afterSeq}`,
    );

  const e = report.ending;
  out.push("", t("2. Fin du run", "2. End of run"));
  out.push(
    `  ${t("dernier événement", "last event")} : ${e.lastEvent ? `${e.lastEvent.kind} #${e.lastEvent.seq}` : "-"}`,
  );
  out.push(`  ${t("raison", "reason")} : ${END_LABELS[e.endCode][en ? "en" : "fr"]}`);
  out.push(
    `  ${t("appels depuis la dernière décision", "calls since the last decision")} : ${e.callsSinceLastDecision}${e.lastDecisionSeq === null ? ` (${t("aucune décision enregistrée", "no decision recorded")})` : ""}`,
  );

  const tr = report.truncation;
  out.push("", t("3. Troncatures", "3. Truncations"));
  out.push(
    `  ${tr.truncated}/${tr.results} ${t("résultats tronqués", "results truncated")} · ${tr.truncatedInTail} ${t("parmi les derniers", "among the last ones")}` +
      (tr.droppedProcessLines > 0
        ? ` · ${tr.droppedProcessLines} ${t("lignes de processus non journalisées", "process lines not journaled")}`
        : ""),
  );
  for (const r of tr.top) {
    const size =
      r.originalBytes === null
        ? `${r.loggedBytes} ${t("o", "B")} (${t("origine inconnue", "original unknown")})`
        : `${r.originalBytes} ${t("o", "B")}`;
    out.push(
      `  #${r.seq} ${clean(r.tool)} ${clean(r.command)} — ${size} [${r.signs.map((s) => SIGN_LABELS[s][en ? "en" : "fr"]).join(", ")}]`,
    );
  }

  const rep = report.repetition;
  out.push("", t("4. Répétition", "4. Repetition"));
  out.push(`  ${rep.approaches} ${t("approches distinctes", "distinct approaches")}`);
  for (const r of rep.repeated)
    out.push(
      `  ${clean(r.approach)} : ${r.calls} ${t("appels", "calls")}, ${r.similarResults} ${t("résultats quasi identiques", "near-identical results")}`,
    );

  const w = report.web;
  out.push("", t("5. Recherches web et couverture", "5. Web searches and coverage"));
  if (w.searches.length === 0) out.push(`  ${t("aucune recherche web", "no web search")}`);
  for (const s of w.searches)
    out.push(
      `  #${s.seq} ${s.ts} (${s.callsBefore} ${t("appels avant", "calls before")}) ${clean(s.query)}`,
    );
  if (w.coverage === null) out.push(`  ${t("pas de matrice de couverture", "no coverage matrix")}`);
  else {
    const counts = Object.entries(w.coverage.counts)
      .map(([k, n]) => `${k} ${n}`)
      .join(" · ");
    out.push(`  ${t("couverture", "coverage")} (${w.coverage.total}) : ${counts}`);
    for (const c of w.coverage.remaining)
      out.push(
        `  ${c.state} : ${clean(c.surface)}${c.parameter ? ` [${clean(c.parameter)}]` : ""} / ${clean(c.testClass)}`,
      );
  }

  const d = w.derivation;
  out.push(
    `  ${t("Dérivé / générique", "Derived / generic")} : ${d.derived} / ${d.generic} (${d.percent} %)`,
  );
  for (const row of d.genericPaths)
    out.push(`  ${t("chemin générique", "generic path")} : ${clean(row.path)} × ${row.calls}`);
  out.push(
    `  ${t("Familles de technique observées (heuristique)", "Observed technique families (heuristic)")} : ${d.techniqueFamilies.length} (${d.techniqueFamilies.map(clean).join(", ")})`,
  );

  out.push("", t("6. Classe de blocage (indicatif)", "6. Blocking class (indicative)"));
  const dom = report.blockClass.dominant;
  out.push(
    `  ${dom === null ? t("indéterminée", "undetermined") : CLASS_LABELS[dom][en ? "en" : "fr"]}`,
  );
  return out;
}
