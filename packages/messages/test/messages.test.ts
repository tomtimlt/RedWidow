import {
  createRecorder,
  DEFAULT_POLICY,
  DockerError,
  type EngineEvent,
  type EventKind,
  type EventPayload,
  evaluatePolicy,
  loadPolicy,
  parsePolicy,
  parseShell,
  REASON_CODES,
  ValidationError,
} from "@warband/core";
import { describe, expect, it } from "vitest";
import {
  describeAuth,
  en,
  eventLabel,
  formatError,
  formatReason,
  fr,
  MESSAGES,
  summarizeOutput,
} from "../src/index.js";

describe("catalogues", () => {
  it.each(REASON_CODES)("les catalogues ont un libellé pour %s", (code) => {
    expect(en.reasons[code], code).toBeTypeOf("function");
    expect(formatReason({ code, params: { x: 1 } }, "en")).not.toMatch(
      new RegExp(`^${code.replaceAll(".", "\\.")}( |$)`),
    );
    expect(fr.reasons[code], code).toBeTypeOf("function");
    // Aucun code connu ne tombe dans le repli `code + JSON params`.
    expect(formatReason({ code, params: { x: 1 } })).not.toMatch(
      new RegExp(`^${code.replaceAll(".", "\\.")}( |$)`),
    );
  });

  it("le catalogue fr ne contient aucun code inconnu du cœur", () => {
    const known = new Set<string>(REASON_CODES);
    for (const code of Object.keys(fr.reasons)) expect(known.has(code), code).toBe(true);
    for (const code of Object.keys(en.reasons)) expect(known.has(code), code).toBe(true);
  });

  it("les deux catalogues sont complets", () => {
    expect(Object.keys(en.reasons).sort()).toEqual(Object.keys(fr.reasons).sort());
    expect(Object.keys(en.events).sort()).toEqual(Object.keys(fr.events).sort());
    expect(formatReason({ code: "bash.empty" }, "en")).toBe("empty command");
    expect(formatReason({ code: "bash.empty" })).toBe("commande vide");
    expect(Object.keys(MESSAGES).sort()).toEqual(["en", "fr"]);
  });
});

describe("formatReason", () => {
  it("traduit les codes auparavant absents du catalogue anglais", () => {
    expect(formatReason({ code: "process.emptyArgv" }, "en")).toBe("empty argv");
  });

  it("traduit les paramètres techniques et conserve les textes libres", () => {
    expect(
      formatReason({ code: "bash.hazard", params: { hazards: "substitution,background" } }, "en"),
    ).toBe("cannot be auto-approved: command substitution, background execution");
    expect(
      formatReason(
        { code: "sandbox.tarRejected", params: { reason: "symlink", entry: "entrée" } },
        "en",
      ),
    ).toBe("tar archive rejected (symbolic link): entrée, nothing written");
    expect(formatReason({ code: "integration.invalidConfig" }, "en")).toBe(
      "Invalid local MCP configuration.",
    );
    expect(
      formatReason({ code: "approval.noAsker", cause: { code: "process.emptyArgv" } }, "en"),
    ).toBe("empty argv (no interactive approver)");
    expect(
      formatReason({ code: "policy.rule.custom", params: { text: "français conservé" } }, "en"),
    ).toBe("français conservé");
    expect(formatReason({ code: "legacy", params: { text: "ancienne erreur" } }, "en")).toBe(
      "ancienne erreur",
    );
  });

  it("affiche un code inconnu sous la forme code + JSON des paramètres", () => {
    expect(formatReason({ code: "x.y", params: { a: 1, b: "z" } })).toBe('x.y {"a":1,"b":"z"}');
    expect(formatReason({ code: "x.y" })).toBe("x.y");
  });

  it("rend tel quel un texte d'ancien journal, brut ou `legacy`", () => {
    expect(formatReason("règle #2 deny Bash(rm *)")).toBe("règle #2 deny Bash(rm *)");
    expect(formatReason({ code: "legacy", params: { text: "ancien motif" } })).toBe("ancien motif");
  });

  it("conserve tel quel le motif libre écrit par l'utilisateur", () => {
    const custom = "à faire à la main {0} $1 \\n";
    expect(formatReason({ code: "policy.rule.custom", params: { text: custom } })).toBe(custom);
  });

  it("compose les motifs imbriqués", () => {
    const verdict = evaluatePolicy(
      DEFAULT_POLICY,
      "Bash",
      { command: "docker run nginx" },
      { cwd: "/ws", posixShell: true },
    );
    expect(formatReason({ code: "approval.noAsker", cause: verdict.reason })).toBe(
      "aucune règle pour « docker run nginx » (aucun approbateur interactif)",
    );
  });

  it("garde les libellés français des verdicts de la politique", () => {
    const why = (tool: string, input: Record<string, unknown>) =>
      formatReason(
        evaluatePolicy(DEFAULT_POLICY, tool, input, { cwd: "/ws", home: "/h", posixShell: true })
          .reason,
      );
    expect(why("Bash", { command: "docker ps -a" })).toBe("règle #3 allow Bash(docker ps *)");
    expect(why("Bash", { command: "rm -rf /" })).toBe("règle #10 deny Bash(rm *)");
    expect(why("mcp__docker__rm", {})).toBe("suppression de conteneur : à faire à la main");
    expect(why("Write", { file_path: "/ws/x" })).toBe("aucune règle pour l'outil Write");
    expect(why("Bash", { command: "docker ps $(id) > x" })).toBe(
      "non approuvable automatiquement : substitution de commande, redirection",
    );
    expect(why("Bash", { command: "docker run -v /:/h alpine" })).toBe(
      "conteneur avec accès à l'hôte (-v) : à faire à la main",
    );
    expect(why("Bash", { command: "echo 'x" })).toBe(
      "commande non analysable : guillemet ' non fermé",
    );
    expect(why("Bash", { command: "echo x\\" })).toBe("commande non analysable : backslash final");
    expect(why("Bash", { command: "" })).toBe("commande vide");
    expect(why("Bash", {})).toBe("commande absente");
    expect(why("Read", { file_path: "/h/.ssh/id_rsa" })).toBe("chemin sensible : /h/.ssh/id_rsa");
    expect(why("Read", { file_path: "/etc/hostname" })).toBe(
      "chemin hors de l'espace de travail : /etc/hostname",
    );
  });

  it("libelle les avertissements de politique de dépôt", () => {
    expect(
      formatReason({ code: "policy.repo.untrusted", params: { path: "/r/p.json", digest: "abc" } }),
    ).toBe(
      "politique du dépôt ignorée (non approuvée) : /r/p.json [sha256 abc]. Après relecture : warband policy trust",
    );
  });

  it("libelle les motifs de journal", () => {
    const parsed = parseShell("echo 'x");
    if (parsed.ok) throw new Error("attendu : échec");
    expect(formatReason(parsed.error)).toBe("guillemet ' non fermé");
  });
});

describe("formatError", () => {
  it("libelle une erreur codée du cœur", () => {
    expect(formatError(new ValidationError("docker.invalidTail", { value: -1 }))).toBe(
      "tail invalide : -1",
    );
    expect(() => parsePolicy(null)).toThrow(ValidationError);
    try {
      parsePolicy({ default: "maybe", rules: [] });
    } catch (err) {
      expect(formatError(err)).toBe("politique invalide : default « maybe »");
    }
    const failed = new DockerError(
      { binary: "docker", command: "stop", exitCode: 1, stderr: "no such container" },
      { code: 1, signal: null, stdout: [], stderr: [], durationMs: 1 },
    );
    expect(formatError(failed)).toBe("docker stop a échoué (code 1) : no such container");
  });

  it("libelle l'erreur d'un événement : codée, inconnue (message brut) ou ancien texte", () => {
    expect(formatError({ code: "process.notFound", params: { binary: "docker" } })).toBe(
      "binaire introuvable : docker",
    );
    expect(formatError({ code: "error.unknown", message: "ECONNRESET" })).toBe("ECONNRESET");
    expect(formatError({ code: "legacy", params: { text: "vieille erreur" } })).toBe(
      "vieille erreur",
    );
    expect(
      formatError({ code: "guard.unrouted", params: { tool: "Bash", toolUseId: "t1" } }),
    ).toContain("non routé par la garde");
  });

  it("rend le message d'une exception ordinaire et le texte d'un ancien journal", () => {
    expect(formatError(new Error("boom"))).toBe("boom");
    expect(formatError("ancien message")).toBe("ancien message");
    expect(formatError(42)).toBe("42");
    const enoent = Object.assign(new Error("spawn x ENOENT"), { code: "ENOENT" });
    expect(formatError(enoent)).toBe("spawn x ENOENT");
  });

  it("libelle une erreur de chargement de politique", async () => {
    const err = await loadPolicy({
      cwd: "/nonexistent-warband-dir",
      explicit: "absent.json",
    }).catch((e: unknown) => e);
    expect(formatError(err)).toMatch(/ENOENT/);
  });
});

describe("summarizeOutput", () => {
  it("aplatit les blancs et coupe", () => {
    expect(summarizeOutput("a\n\n  b")).toBe("a b");
    expect(summarizeOutput("abcdef", 4)).toBe("abc…");
  });
});

describe("eventLabel", () => {
  const r = createRecorder({ runId: "R", redact: false });
  const emit = (payload: EventPayload): EngineEvent => r.emit(payload);

  const payloads: Record<EventKind, EventPayload> = {
    "audit.test": {
      kind: "audit.test",
      claim: {
        objective: "Vérifier un accès",
        target: "lab.test",
        testContext: "anonyme",
        method: "HTTP GET",
        observed: "403 sur un chemin",
        conclusion: "not-observed",
        evidenceIds: ["event-1"],
      },
    },
    "mission.decision": {
      kind: "mission.decision",
      decision: { objective: "o", evidenceIds: [], nextAction: "n", successCriterion: "s" },
    },
    "research.status": { kind: "research.status", status: "requested" },
    "run.started": { kind: "run.started", prompt: "liste les conteneurs", cwd: "/w" },
    "session.started": {
      kind: "session.started",
      sessionId: "s",
      model: "m",
      tools: ["Read"],
      auth: { apiKeySource: "none" },
    },
    "auth.info": { kind: "auth.info", apiKeySource: "none", subscriptionType: "max" },
    "auth.status": { kind: "auth.status", isAuthenticating: false, error: "refusé" },
    "approval.requested": {
      kind: "approval.requested",
      toolUseId: "t",
      tool: "Bash",
      input: { command: "docker stop web" },
      verdict: { code: "bash.empty" },
    },
    "turn.finished": {
      kind: "turn.finished",
      turns: 2,
      costUsd: 0.25,
      status: "success",
      result: null,
    },
    "agent.text": { kind: "agent.text", text: "bonjour" },
    "user.message": { kind: "user.message", text: "salut" },
    "agent.thinking": { kind: "agent.thinking", text: "hmm", redacted: false },
    "tool.requested": {
      kind: "tool.requested",
      toolUseId: "t",
      tool: "Bash",
      input: { command: "ls" },
    },
    "approval.decided": {
      kind: "approval.decided",
      toolUseId: "t",
      decision: "deny",
      source: "policy",
      reason: { code: "bash.empty" },
    },
    "bypass.changed": {
      kind: "bypass.changed",
      state: "on",
      reason: { code: "bypass.enabled" },
      since: 0,
      expiresAt: 7_200_000,
    },
    "program.state": {
      kind: "program.state",
      projectId: "11111111-1111-4111-8111-111111111111",
      state: "invalidated",
      digest: "abcdef0123456789",
    },
    "permission.denied": { kind: "permission.denied", toolUseId: "t", tool: "x", message: "non" },
    "tool.result": {
      kind: "tool.result",
      toolUseId: "t",
      isError: false,
      output: "ok",
      truncated: false,
      bytes: 2,
    },
    "process.started": { kind: "process.started", argv: ["docker", "ps"], pid: 1 },
    "process.output": { kind: "process.output", stream: "stdout", line: "l" },
    "process.exited": { kind: "process.exited", code: 0, signal: null, durationMs: 3 },
    "api.retry": {
      kind: "api.retry",
      attempt: 1,
      maxRetries: 2,
      delayMs: 5,
      errorStatus: null,
      error: "e",
    },
    "task.updated": { kind: "task.updated", taskId: "k", phase: "started", description: "d" },
    "rate.limited": { kind: "rate.limited", status: "rejected" },
    "pace.adjusted": {
      kind: "pace.adjusted",
      host: "cible.example",
      fromRps: 1,
      toRps: 0.5,
      cause: "http429",
    },
    "pace.halted": { kind: "pace.halted", host: "cible.example", cause: "floor" },
    "run.finished": {
      kind: "run.finished",
      status: "success",
      turns: 3,
      costUsd: 0.5,
      result: null,
    },
    error: { kind: "error", code: "process.notFound", params: { binary: "docker" } },
    "sandbox.started": {
      kind: "sandbox.started",
      containerId: "c",
      image: "alpine",
      imageDigest: null,
      network: "none",
      limits: {},
    },
    "sandbox.stopped": { kind: "sandbox.stopped", containerId: "c", cause: "abort" },
    "sink.error": { kind: "sink.error", message: "m" },
    "journal.truncated": { kind: "journal.truncated", limitBytes: 1, droppedEvents: 2 },
  };

  it.each(Object.entries(payloads))("étiquette %s", (_kind, payload) => {
    expect(eventLabel(emit(payload)).length).toBeGreaterThan(0);
    expect(eventLabel(emit(payload), { locale: "en" }).length).toBeGreaterThan(0);
  });

  it("reprend les libellés français d'autrefois", () => {
    expect(eventLabel(emit(payloads["run.started"]))).toBe("run : liste les conteneurs");
    expect(eventLabel(emit(payloads["approval.decided"]))).toBe("deny (policy) : commande vide");
    expect(eventLabel(emit(payloads["run.finished"]))).toBe("success · 3 tours · $0.5000");
    expect(eventLabel(emit(payloads.error))).toBe("binaire introuvable : docker");
    expect(eventLabel(emit(payloads["agent.thinking"]))).toBe("réflexion : hmm");
    expect(eventLabel(emit(payloads["bypass.changed"]))).toBe(
      "bypass : bypass des approbations activé",
    );
    expect(eventLabel(emit(payloads["bypass.changed"]), { locale: "en" })).toBe(
      "bypass : approval bypass enabled",
    );
  });

  it("libelle program.state", () => {
    expect(eventLabel(emit(payloads["program.state"]))).toBe(
      "fiche programme : invalidated [abcdef012345]",
    );
  });

  it("décrit le mode d'authentification", () => {
    expect(describeAuth({ apiKeySource: "none", subscriptionType: "pro" })).toBe("abonnement pro");
    expect(describeAuth({ apiKeySource: "none" })).toBe("abonnement");
    expect(describeAuth({ apiKeySource: "ANTHROPIC_API_KEY" })).toBe("clé API");
    expect(describeAuth({ apiProvider: "bedrock" })).toBe("fournisseur cloud (bedrock)");
    expect(describeAuth({ subscriptionType: null })).toBe("inconnue");
    expect(describeAuth({ apiKeySource: "none", subscriptionType: "max" }, "en")).toBe(
      "subscription max",
    );
    expect(eventLabel(emit(payloads["auth.info"]))).toBe("authentification : abonnement max");
  });

  it("plafonne les libellés qui reprennent du texte libre", () => {
    const long = emit({ kind: "agent.text", text: "x".repeat(200) });
    expect(eventLabel(long, { maxLength: 10 })).toBe(`${"x".repeat(9)}…`);
    expect(eventLabel(long).length).toBe(80);
  });
});
