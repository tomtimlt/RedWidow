import { CodedError, type Finding, type PendingApproval } from "@warband/core";
import { formatReason, setUiLocale } from "@warband/messages";
import { afterEach, describe, expect, it } from "vitest";
import { alwaysConfirmText, toCard } from "../src/logic/approval.js";
import { attachmentMessage, withAttachments } from "../src/logic/attachments.js";
import { createChatState } from "../src/logic/chat.js";
import { buildControls, DEFAULT_PREFS } from "../src/logic/controls.js";
import { EFFORT_LEVELS, ultracodeTip } from "../src/logic/effort.js";
import { evidenceEditorReference } from "../src/logic/evidence-capture.js";
import { historyProject, titleFrom } from "../src/logic/history.js";
import { killchainImage } from "../src/logic/killchain-image.js";
import { missionReport, missionReportPreview } from "../src/logic/mission-report.js";
import { modelLoadFailure } from "../src/logic/model-load-error.js";
import { PALETTES, paletteOf } from "../src/logic/palette.js";
import { summarizeInput, toolLabel } from "../src/logic/present.js";
import { createChatSession } from "../src/logic/session.js";
import { readableTerminal, withTerminalContext } from "../src/logic/termlog.js";
import { displayToolOutput } from "../src/logic/tool-output.js";

afterEach(() => setUiLocale("fr"));

const project = { id: "project", name: "Hôte <test>" };
const findings: Finding[] = [
  { id: "a", label: "Commande <script>", kind: "host", state: "confirmed" },
  { id: "b", label: "Hypothèse", kind: "step", state: "hypothesis", from: ["a"], pathFrom: ["a"] },
  { id: "c", label: "SECRET", kind: "credential", state: "confirmed" },
  { id: "d", label: "SECRET-LOOT", kind: "loot", state: "confirmed" },
];
const date = new Date("2026-11-02T12:00:00Z");

describe("langue des exports de mission", () => {
  it("rend le Markdown FR/EN, conserve les données échappées et exclut les secrets", () => {
    const french = missionReport(project, findings, date, "fr");
    const english = missionReport(project, findings, date, "en");
    expect(french).toContain("# Rapport de mission — Hôte &lt;test&gt;");
    expect(english).toContain("# Mission report — Hôte &lt;test&gt;");
    expect(english).toContain("## Hypotheses to verify");
    expect(english).toContain("1 confirmed item(s), 1 hypothesis/hypotheses, 0 failed attempt(s)");
    expect(english).toContain("### Commande &lt;script&gt;");
    expect(english).toContain("type: Host; state: Confirmed");
    expect(english).toContain("severity/CVSS and recommendation: assess");
    expect(english).not.toMatch(/SECRET|<script>|CVSS: 9/);
    expect(english).toContain(date.toISOString());
    setUiLocale("en");
    expect(missionReport(project, findings, date)).toBe(english);
    expect(missionReport(project, findings, date, "fr")).toBe(french);
  });

  it("garde les gravités non évaluées dans l’aperçu EN et les libellés de notes intacts", () => {
    const preview = missionReportPreview(project, findings, "en");
    expect(preview.title).toBe("Project notes — Hôte <test>");
    expect(preview.description).toContain(
      "Severity, evidence and remediation still require assessment",
    );
    expect(preview.findings).toEqual([
      { label: "Commande <script>", severity: "unrated", detail: "Host · Confirmed" },
      { label: "Hypothèse", severity: "unrated", detail: "Step · Hypothesis" },
    ]);
  });

  it("rend le SVG FR/EN sans traduire les noms ni inférer la réussite des liens", () => {
    const french = killchainImage(project, findings, "fr");
    const english = killchainImage(project, findings, "en");
    expect(french).toContain("4 éléments");
    expect(english).toContain(
      "4 items. Green links show the selected path without inferring success.",
    );
    expect(english).toContain("Host / Site / Credential / Step / Loot");
    expect(english).toContain("States: Confirmed / Hypothesis / Failed");
    expect(english).toContain("Commande &lt;script&gt;");
    expect(english).toContain("Hypothèse");
    expect(english).not.toMatch(/<script>|<foreignObject|\shref=/);
    expect(english.match(/rx="10"/g)).toHaveLength(4);
    expect(english).toContain('marker-end="url(#path)"');
    setUiLocale("en");
    expect(killchainImage(project, findings)).toBe(english);
  });
});

describe("langue de la logique d’interface", () => {
  it("traduit les outils connus et conserve les outils, commandes et noms arbitraires", () => {
    expect(toolLabel("Read")).toBe("Lecture");
    setUiLocale("en");
    expect(toolLabel("Read")).toBe("Read");
    expect(toolLabel("mcp__sandbox__exec")).toBe("Sandbox · exec");
    expect(toolLabel("Lecture")).toBe("Lecture");
    expect(summarizeInput({ command: "Commande Hypothèse" })).toBe("Commande Hypothèse");
    expect(titleFrom("Projet inconnu")).toBe("Projet inconnu");
    expect(historyProject({}, []).label).toBe("No project");
    expect(historyProject({ projectId: "x" }, [{ id: "x", name: "Sans projet" }]).label).toBe(
      "Sans projet",
    );
  });

  it("relit la langue des infobulles et palettes après import, sans modifier les valeurs", () => {
    expect(EFFORT_LEVELS[0]?.tip).toContain("Réponses rapides");
    expect(PALETTES.find(([id]) => id === "sentinelle")?.[1]).toBe("Sentinelle");
    setUiLocale("en");
    expect(EFFORT_LEVELS[0]?.tip).toContain("Fast, economical responses");
    expect(ultracodeTip({ maxTurns: 90, maxBudgetUsd: 5 })).toContain(
      "at most 90 turns, spending capped at 5 USD",
    );
    expect(PALETTES.find(([id]) => id === "sentinelle")?.[1]).toBe("Sentinel");
    expect(paletteOf("sentinelle")).toBe("sentinelle");
    const controls = buildControls({
      prefs: DEFAULT_PREFS,
      models: [{ value: "opaque", displayName: "Projet", description: "Hypothèse" }],
      defaultModel: undefined,
      status: "ready",
      busy: false,
    });
    expect(controls.effortTip).toContain("no effort level is sent");
    expect(controls.models?.[0]).toEqual({
      value: "opaque",
      label: "Projet",
      description: "Hypothèse",
    });
    setUiLocale("fr");
    expect(PALETTES.find(([id]) => id === "sentinelle")?.[1]).toBe("Sentinelle");
  });

  it("traduit les motifs et confirmations sans traduire le détail d’action ni l’erreur brute", () => {
    setUiLocale("en");
    const pending: PendingApproval = {
      toolUseId: "tool",
      tool: "Bash",
      input: { command: "Commande" },
      verdict: { decision: "ask", rule: null, reason: { code: "bash.noRule" } },
    };
    const card = toCard(pending);
    expect(card.label).toBe("Command");
    expect(card.reason).toBe(formatReason(pending.verdict.reason, "en"));
    expect(alwaysConfirmText(card)).toContain("Allow “Bash” without asking again");
    expect(alwaysConfirmText(card)).toContain("Commande");
    const state = createChatState();
    state.error(new CodedError("project.absent"));
    state.error(new Error("Projet inconnu"));
    expect(state.view().items.at(-2)).toMatchObject({
      text: formatReason({ code: "project.absent" }, "en"),
    });
    expect(state.view().items.at(-1)).toMatchObject({ text: "Projet inconnu" });
    expect(modelLoadFailure(new CodedError("ipc.engineExited", { code: 7 }))).toContain(
      "stopped (exit code 7)",
    );
    expect(modelLoadFailure(new Error("SECRET-RAW"))).toContain("Unable to load models");
    expect(() => evidenceEditorReference("/project", "/elsewhere/a")).toThrow(
      "The selection must belong to the active project folder.",
    );
  });

  it("localise les enveloppes produit et garde les sorties, pièces jointes et prompts du modèle", () => {
    const files = [{ name: "Commande.txt", text: "Hypothèse" }];
    const before = withAttachments("Analyse", files);
    const terminalBefore = withTerminalContext("Analyse", [
      { token: "a", text: "Commande", container: "test" },
    ]);
    setUiLocale("en");
    expect(withAttachments("Analyse", files)).toBe(before);
    expect(
      withTerminalContext("Analyse", [{ token: "a", text: "Commande", container: "test" }]),
    ).toBe(terminalBefore);
    expect(attachmentMessage("Projet", files)).toBe("Projet\n\nAttachments:\n• Commande.txt");
    expect(attachmentMessage("", files)).toContain("Analyze the attached files.");
    expect(readableTerminal("", undefined, "en")).toBe("Empty buffer.");
    expect(readableTerminal("")).toBe("Tampon vide.");
    expect(readableTerminal("Tampon vide.", undefined, "en")).toBe("Tampon vide.");
    expect(displayToolOutput("Bash", "La commande a échoué.", 100).output).toBe(
      "La commande a échoué.",
    );
    const output = displayToolOutput(
      "mcp__kali__exec",
      JSON.stringify({ stdout: "Commande", stderr: "Hypothèse", return_code: 7 }),
      1000,
    );
    expect(output.output).toContain("Exit code: 7");
    expect(output.output).toContain("Commande\n\nStandard error:\nHypothèse");
  });

  it("localise les validations de session et conserve le texte utilisateur", async () => {
    setUiLocale("en");
    const views: ReturnType<ReturnType<typeof createChatState>["view"]>[] = [];
    const session = createChatSession({
      cwd: "/project",
      enginePath: "/unused",
      engineArgs: [],
      readSettings: () => ({}),
      getToken: async () => undefined,
      confirmAlways: async () => false,
      onView: (view) => views.push(view),
    });
    try {
      await session.setModel("invalid id");
      expect(views.at(-1)?.items.at(-1)).toMatchObject({
        text: "Model rejected: invalid identifier or missing from the list.",
      });
    } finally {
      session.dispose();
    }
  });
});
