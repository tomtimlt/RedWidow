import { mkdtemp, readdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentRunner,
  type ApprovalGate,
  type ApprovalOutcome,
  type ApprovalRequest,
  BYPASS_DEFAULT_MS,
  createCampaignPort,
  deskInstructions,
  INTEGRATION_GUIDANCE,
  LEARNING_SYSTEM_PROMPT,
  type Policy,
} from "@warband/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type EngineChannel, runEngine } from "../src/engine/engine.js";
import { SCAN_OUTPUT_GUIDANCE } from "../src/engine/scan-guidance.js";
import type { FromEngine } from "../src/logic/protocol.js";

/** Canal factice : le test joue le rôle du parent. */
function fakeChannel() {
  const sent: FromEngine[] = [];
  let onMessage: (raw: unknown) => void = () => {};
  let onDisconnect: () => void = () => {};
  const channel: EngineChannel = {
    send: async (m) => void sent.push(m),
    onMessage: (h) => {
      onMessage = h;
    },
    onDisconnect: (h) => {
      onDisconnect = h;
    },
  };
  return {
    channel,
    sent,
    receive: (raw: unknown) => onMessage(raw),
    disconnect: () => onDisconnect(),
  };
}

const idleRunner: AgentRunner = {
  run: ({ prompt }) =>
    new Promise((resolve) => {
      // Se termine quand le flux de consignes est clos (dispose, abort ou déconnexion).
      void (async () => {
        for await (const _ of prompt as AsyncIterable<string>) {
          // consignes ignorées
        }
        resolve({ status: "success", turns: 0, costUsd: 0, result: null });
      })();
    }),
};

let cwd: string;
beforeAll(async () => {
  cwd = await mkdtemp(join(tmpdir(), "warband-engine-"));
});
afterAll(() => rm(cwd, { recursive: true, force: true }));

const codes = (sent: FromEngine[]) =>
  sent.flatMap((m) => (m.type === "error" ? [m.reason.code] : []));

describe("moteur : validation des messages reçus", () => {
  it("signale et ignore messages inconnus, mal formés ou d'une autre version", async () => {
    const t = fakeChannel();
    const done = runEngine({ channel: t.channel, createRunner: () => idleRunner });
    t.receive({ v: 1, type: "rm -rf" });
    t.receive({ v: 2, type: "abort" });
    t.receive("garbage");
    t.receive({ v: 1, type: "start", cwd: "relatif" });
    t.receive({ v: 1, type: "dispose", env: { ANTHROPIC_API_KEY: "x" } });
    expect(codes(t.sent)).toEqual([
      "ipc.invalidMessage",
      "ipc.unsupportedVersion",
      "ipc.invalidMessage",
      "ipc.invalidMessage",
      "ipc.invalidMessage",
    ]);
    // Rien n'a démarré ni terminé : seul un dispose valide clôt le moteur.
    t.receive({ v: 1, type: "dispose" });
    expect(await done).toBe(0);
  });

  it("answer sur un toolUseId inconnu est sans effet et signalé ; prompt avant start refusé", async () => {
    const t = fakeChannel();
    const done = runEngine({ channel: t.channel, createRunner: () => idleRunner });
    t.receive({
      v: 1,
      type: "answer",
      toolUseId: "inconnu",
      decision: "allow",
      remember: "always",
    });
    t.receive({ v: 1, type: "prompt", text: "trop tôt" });
    expect(codes(t.sent)).toEqual(["ipc.invalidMessage", "ipc.invalidMessage"]);
    t.receive({ v: 1, type: "dispose" });
    await done;
  });

  it("un échec du runner (ex. binaire altéré) est signalé par un code et termine le moteur", async () => {
    const t = fakeChannel();
    const done = runEngine({
      channel: t.channel,
      createRunner: async () => {
        const { CodedError } = await import("@warband/core");
        throw new CodedError("extension.binaryMismatch");
      },
    });
    t.receive({ v: 1, type: "start", cwd });
    expect(await done).toBe(1);
    expect(t.sent.find((m) => m.type === "error")).toMatchObject({
      reason: { code: "extension.binaryMismatch" },
    });
    expect(t.sent.some((m) => m.type === "ended")).toBe(false);
  });

  it("une déconnexion annule le run et termine le moteur", async () => {
    const t = fakeChannel();
    const done = runEngine({ channel: t.channel, createRunner: () => idleRunner });
    t.receive({ v: 1, type: "start", cwd });
    await new Promise((r) => setTimeout(r, 200));
    t.disconnect();
    // Le run s'achève (flux de consignes clos) : le moteur rend la main sans attendre le délai de grâce.
    expect(await done).toBeTypeOf("number");
  });

  it("déconnexion sans réponse du run : arbre de processus tué à la fin du délai de grâce", async () => {
    const t = fakeChannel();
    const killTree = vi.fn();
    const stuck: AgentRunner = { run: () => new Promise(() => {}) };
    const done = runEngine({
      channel: t.channel,
      createRunner: () => stuck,
      disconnectGraceMs: 50,
      killTree,
    });
    t.receive({ v: 1, type: "start", cwd });
    await new Promise((r) => setTimeout(r, 200));
    t.disconnect();
    expect(await done).toBe(1);
    expect(killTree).toHaveBeenCalledOnce();
  });
});

describe("moteur : journal de l'extension (F4)", () => {
  it("transfère le fil après résolution des cibles et journalise seulement la nouvelle consigne", async () => {
    const t = fakeChannel();
    const received: string[] = [];
    const seen: string[] = [];
    const runner: AgentRunner = {
      run: async ({ prompt }) => {
        for await (const text of prompt as AsyncIterable<string>) received.push(text);
        return { status: "success", turns: 0, costUsd: 0, result: null };
      },
    };
    const done = runEngine({
      channel: t.channel,
      createRunner: () => runner,
      onPrompt: (text) => {
        seen.push(text);
        return `${text} contexte des cibles vérifié`;
      },
    });
    t.receive({
      v: 1,
      type: "start",
      cwd,
      provider: "openai",
      conversationContext: {
        messages: [
          { role: "user", text: "Ancienne mention @autre-conteneur" },
          { role: "assistant", text: "Ancienne réponse" },
        ],
        truncated: false,
      },
    });
    t.receive({ v: 1, type: "prompt", text: "nouvelle consigne" });
    t.receive({ v: 1, type: "prompt", text: "suite" });
    t.receive({ v: 1, type: "dispose" });
    expect(await done).toBe(0);
    expect(seen).toEqual(["nouvelle consigne", "suite"]);
    expect(received[0]).toContain("Ancienne mention @autre-conteneur");
    expect(received[0]).toContain("nouvelle consigne contexte des cibles vérifié");
    expect(received[1]).toBe("suite contexte des cibles vérifié");
    expect(
      eventsOf(t.sent)
        .filter((event) => event.kind === "user.message")
        .map((event) => event.text),
    ).toEqual(seen);
  });
  it("trace la recherche demandée, ses deux résultats et ne répète pas l’instruction au tour suivant", async () => {
    const t = fakeChannel();
    const received: string[] = [];
    const runner: AgentRunner = {
      run: async ({ prompt }, { recorder }) => {
        for await (const text of prompt as AsyncIterable<string>) {
          received.push(text);
          if (received.length === 1) {
            for (const [id, tool] of [
              ["s", "search_web"],
              ["r", "read_url"],
            ] as const) {
              recorder.emit({
                kind: "tool.requested",
                toolUseId: id,
                tool: `mcp__web__${tool}`,
                input: {},
              });
              recorder.emit({
                kind: "tool.result",
                toolUseId: id,
                output: "source",
                isError: false,
                truncated: false,
                bytes: 6,
              });
            }
          }
          recorder.emit({
            kind: "turn.finished",
            turns: 1,
            costUsd: 0,
            status: "success",
            result: null,
          });
        }
        return { status: "success", turns: 2, costUsd: 0, result: null };
      },
    };
    const done = runEngine({ channel: t.channel, createRunner: () => runner });
    t.receive({ v: 1, type: "start", cwd, webSearch: true });
    t.receive({ v: 1, type: "prompt", text: "chercher", research: true });
    t.receive({ v: 1, type: "prompt", text: "suite" });
    t.receive({ v: 1, type: "dispose" });
    await done;
    expect(received[0]).toContain("search_web puis lis une source pertinente avec read_url");
    expect(received[1]).toBe("suite");
    expect(
      eventsOf(t.sent)
        .filter((event) => event.kind === "research.status")
        .map((event) => event.status),
    ).toEqual(["requested", "completed"]);
  });

  it("enrichit chaque consigne pour le modèle et conserve uniquement l'original dans le journal", async () => {
    const t = fakeChannel();
    const received: string[] = [];
    const seen: string[] = [];
    const runner: AgentRunner = {
      run: async ({ prompt }) => {
        for await (const text of prompt as AsyncIterable<string>) received.push(text);
        return { status: "success", turns: 0, costUsd: 0, result: null };
      },
    };
    const done = runEngine({
      channel: t.channel,
      createRunner: () => runner,
      onPrompt: (text) => {
        seen.push(text);
        return `${text} contexte vérifié`;
      },
    });
    t.receive({ v: 1, type: "start", cwd });
    t.receive({ v: 1, type: "prompt", text: "premier" });
    t.receive({ v: 1, type: "prompt", text: "second" });
    t.receive({ v: 1, type: "dispose" });
    expect(await done).toBe(0);
    expect(seen).toEqual(["premier", "second"]);
    expect(received).toEqual(["premier contexte vérifié", "second contexte vérifié"]);
    expect(
      eventsOf(t.sent)
        .filter((event) => event.kind === "user.message")
        .map((event) => event.text),
    ).toEqual(seen);
  });

  it("écrit dans journalDir (hors du dépôt) et consigne chaque consigne en user.message", async () => {
    const { readFile, readdir } = await import("node:fs/promises");
    const journalDir = await mkdtemp(join(tmpdir(), "warband-journal-"));
    const repo = await mkdtemp(join(tmpdir(), "warband-repo-"));
    try {
      const t = fakeChannel();
      const done = runEngine({ channel: t.channel, createRunner: () => idleRunner });
      t.receive({ v: 1, type: "start", cwd: repo, journalDir });
      t.receive({ v: 1, type: "prompt", text: "bonjour" });
      await vi.waitFor(() => expect(t.sent.some((m) => m.type === "started")).toBe(true));
      await vi.waitFor(async () => {
        const [name] = await readdir(journalDir);
        expect(await readFile(join(journalDir, name ?? "x"), "utf8")).toContain("user.message");
      });
      t.receive({ v: 1, type: "dispose" });
      t.receive({ v: 1, type: "abort" });
      await done;
      const files = await readdir(journalDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^[0-9a-f-]{36}\.jsonl$/);
      // Rien n'a été écrit dans le dépôt.
      await expect(readdir(join(repo, ".warband"))).rejects.toThrow();
    } finally {
      await rm(journalDir, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });
});

/** Événements du journal relayés au parent, sous forme souple (vérifications par champ). */
const eventsOf = (sent: FromEngine[]) =>
  sent.flatMap((m) => (m.type === "event" ? [m.event as unknown as Record<string, unknown>] : []));

/** Bornes d'un état du Bypass tel que l'hôte les envoie (instants absolus). */
const bypassMsg = (seq: number, since = Date.now(), span = BYPASS_DEFAULT_MS) => ({
  v: 1,
  type: "bypass",
  seq,
  state: { since, expiresAt: since + span },
});

describe("moteur : Bypass (ADR 0006, pont hôte → moteur)", () => {
  /** Demandes de test : la consigne qui porte leur identifiant déclenche la décision. */
  function requestsFor(repo: string): Record<string, ApprovalRequest> {
    return {
      ok: {
        toolUseId: "ok",
        tool: "Write",
        input: { file_path: join(repo, "ok.txt"), content: "x" },
      },
      deny: { toolUseId: "deny", tool: "Bash", input: { command: "rm -rf build" } },
      ssh: {
        toolUseId: "ssh",
        tool: "Write",
        input: { file_path: join(homedir(), ".ssh", "id_rsa"), content: "x" },
      },
      outside: {
        toolUseId: "outside",
        tool: "Write",
        input: { file_path: "/etc/warband-bypass-test", content: "x" },
      },
      lsok: { toolUseId: "lsok", tool: "Bash", input: { command: "ls" } },
      // Deux segments : verdict de la règle `ls`, refus par le garde multi-segments.
      hazard: { toolUseId: "hazard", tool: "Bash", input: { command: "ls; echo x" } },
      // Danger shell : refus par le garde `bash.hazard`, évalué avant les règles.
      shell: { toolUseId: "shell", tool: "Bash", input: { command: "ls $(echo x)" } },
      host: {
        toolUseId: "host",
        tool: "Bash",
        input: { command: "docker run -v /:/host alpine" },
      },
    };
  }

  /**
   * Politique de test : règles `ask` littérales sur `ls` et `docker`, sans règle pour les cas dangereux.
   * Ainsi, un refus de `ls; echo x` ou de `docker run -v /:/host` vient des gardes, pas de la politique.
   */
  const guardedPolicy: Policy = {
    default: "ask",
    rules: [
      { tool: "Bash", command: "ls", decision: "ask" },
      { tool: "Bash", command: "docker *", decision: "ask" },
      { tool: "Bash", command: "rm *", decision: "deny" },
    ],
  };
  const guardedLoader = async () => ({
    policy: guardedPolicy,
    source: null,
    origin: "builtin" as const,
  });

  /** Exécution factice : chaque consigne déclenche la décision de la demande qui porte son identifiant. */
  function bypassRunner(
    requests: Record<string, ApprovalRequest>,
    box: { gate?: ApprovalGate; outcomes: Map<string, ApprovalOutcome> },
  ): AgentRunner {
    return {
      run: ({ prompt }, { gate, signal }) =>
        new Promise((resolve) => {
          box.gate = gate;
          void (async () => {
            for await (const id of prompt as AsyncIterable<string>) {
              const request = requests[id];
              if (request !== undefined) {
                void gate
                  .decide(request, signal ?? new AbortController().signal)
                  .then((o) => box.outcomes.set(id, o));
              }
            }
            resolve({ status: "success", turns: 0, costUsd: 0, result: null });
          })();
        }),
    };
  }

  async function started(t: ReturnType<typeof fakeChannel>, cwd: string, journalDir: string) {
    t.receive({ v: 1, type: "start", cwd, journalDir });
    await vi.waitFor(() => expect(t.sent.some((m) => m.type === "started")).toBe(true));
  }

  const acks = (sent: FromEngine[]) => sent.flatMap((m) => (m.type === "bypassAck" ? [m] : []));

  it("(q) accusé = état retenu ; rejeu et seq non croissant ignorés sans accusé", async () => {
    const repo = await mkdtemp(join(tmpdir(), "warband-bp-"));
    const journalDir = await mkdtemp(join(tmpdir(), "warband-bp-j-"));
    try {
      const t = fakeChannel();
      const done = runEngine({ channel: t.channel, createRunner: () => idleRunner });
      await started(t, repo, journalDir);
      const msg = bypassMsg(1);
      t.receive(msg);
      await vi.waitFor(() => expect(acks(t.sent)).toHaveLength(1));
      expect(acks(t.sent)[0]).toEqual({
        v: 1,
        type: "bypassAck",
        seq: 1,
        state: msg.state,
      });
      // Rejeu du même seq : ignoré, aucun second accusé.
      t.receive(msg);
      t.receive(bypassMsg(1, msg.state.since + 5));
      t.receive({ v: 1, type: "dispose" });
      await done;
      expect(acks(t.sent)).toHaveLength(1);
    } finally {
      await rm(journalDir, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("(p) message forgé rejeté : erreur, et un Bypass déjà actif passe à « off »", async () => {
    const repo = await mkdtemp(join(tmpdir(), "warband-bp-"));
    const journalDir = await mkdtemp(join(tmpdir(), "warband-bp-j-"));
    try {
      const t = fakeChannel();
      const box = { outcomes: new Map<string, ApprovalOutcome>() };
      const requests = requestsFor(repo);
      const done = runEngine({
        channel: t.channel,
        createRunner: () => bypassRunner(requests, box),
      });
      await started(t, repo, journalDir);
      t.receive(bypassMsg(1));
      await vi.waitFor(() => expect(acks(t.sent)).toHaveLength(1));
      // Durée excessive, puis clé en trop : rejetés, et le miroir repasse à « off ».
      t.receive({ ...bypassMsg(2), state: { since: 1, expiresAt: 1 + 4 * 60 * 60 * 1000 + 1 } });
      await vi.waitFor(() => expect(codes(t.sent)).toContain("ipc.invalidMessage"));
      t.receive({ ...bypassMsg(3), extra: true });
      t.receive({ v: 1, type: "prompt", text: "ok" });
      // Sans Bypass, la demande ordinaire attend la réponse de l'utilisateur (jamais auto-approuvée).
      await vi.waitFor(() =>
        expect(
          eventsOf(t.sent).some((e) => e.kind === "approval.requested" && e.toolUseId === "ok"),
        ).toBe(true),
      );
      expect(
        eventsOf(t.sent).filter((e) => e.kind === "approval.decided" && e.toolUseId === "ok"),
      ).toEqual([]);
      expect(box.outcomes.has("ok")).toBe(false);
      t.receive({ v: 1, type: "dispose" });
      t.receive({ v: 1, type: "abort" });
      await done;
    } finally {
      await rm(journalDir, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("(r) bypass avant start ou pendant un sondage models : refusé, sans accusé", async () => {
    const t = fakeChannel();
    const done = runEngine({ channel: t.channel, createRunner: () => idleRunner });
    t.receive(bypassMsg(1));
    expect(codes(t.sent)).toContain("ipc.invalidMessage");
    expect(acks(t.sent)).toEqual([]);
    t.receive({ v: 1, type: "dispose" });
    await done;

    const probe = fakeChannel();
    const probing = runEngine({ channel: probe.channel, createRunner: () => idleRunner });
    probe.receive({ v: 1, type: "models", cwd: tmpdir() });
    await vi.waitFor(() => expect(probe.sent.some((m) => m.type === "models")).toBe(true));
    probe.receive(bypassMsg(1));
    expect(codes(probe.sent)).toContain("ipc.invalidMessage");
    expect(acks(probe.sent)).toEqual([]);
    await probing;
  });

  it("(s) coupure du canal : le Bypass s'éteint avant l'annulation, aucune décision « bypass » ensuite", async () => {
    const repo = await mkdtemp(join(tmpdir(), "warband-bp-"));
    const journalDir = await mkdtemp(join(tmpdir(), "warband-bp-j-"));
    try {
      const t = fakeChannel();
      const box = { outcomes: new Map<string, ApprovalOutcome>() } as {
        gate?: ApprovalGate;
        outcomes: Map<string, ApprovalOutcome>;
      };
      const requests = requestsFor(repo);
      const done = runEngine({
        channel: t.channel,
        createRunner: () => bypassRunner(requests, box),
      });
      await started(t, repo, journalDir);
      t.receive(bypassMsg(1));
      await vi.waitFor(() => expect(acks(t.sent)).toHaveLength(1));
      t.disconnect();
      const gate = box.gate;
      expect(gate).toBeDefined();
      const after: ApprovalRequest = { ...(requests.ok as ApprovalRequest), toolUseId: "after" };
      void gate?.decide(after, new AbortController().signal);
      await vi.waitFor(() =>
        expect(
          eventsOf(t.sent).some((e) => e.kind === "approval.requested" && e.toolUseId === "after"),
        ).toBe(true),
      );
      expect(
        eventsOf(t.sent).filter((e) => e.toolUseId === "after" && e.source === "bypass"),
      ).toEqual([]);
      await done;
    } finally {
      await rm(journalDir, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("(u) bout à bout avec la gate réelle : le Bypass universel lève aussi les refus durs (ADR 0017)", async () => {
    const repo = await mkdtemp(join(tmpdir(), "warband-bp-"));
    const journalDir = await mkdtemp(join(tmpdir(), "warband-bp-j-"));
    try {
      const requests = requestsFor(repo);
      const box = { outcomes: new Map<string, ApprovalOutcome>() };
      const t = fakeChannel();
      const done = runEngine({
        channel: t.channel,
        createRunner: () => bypassRunner(requests, box),
        policyLoader: guardedLoader,
      });
      await started(t, repo, journalDir);
      const since = Date.now();
      t.receive(bypassMsg(1, since));
      await vi.waitFor(() => expect(acks(t.sent)).toHaveLength(1));
      for (const id of Object.keys(requests)) t.receive({ v: 1, type: "prompt", text: id });

      await vi.waitFor(() => expect(box.outcomes.has("ok")).toBe(true));
      const okDecided = eventsOf(t.sent).filter(
        (e) => e.kind === "approval.decided" && e.toolUseId === "ok",
      );
      expect(okDecided).toMatchObject([
        { decision: "allow", source: "bypass", reason: { code: "approval.bypassed" } },
      ]);
      const change = eventsOf(t.sent).find((e) => e.kind === "bypass.changed");
      expect(change).toMatchObject({ state: "on", since, expiresAt: since + BYPASS_DEFAULT_MS });
      // Règle `ask` littérale sur `ls` : couverte par le Bypass (cause d'origine conservée).
      await vi.waitFor(() => expect(box.outcomes.has("lsok")).toBe(true));
      expect(box.outcomes.get("lsok")).toMatchObject({ source: "bypass" });

      // Refus durs (politique, chemin sensible/hors espace, danger shell, accès à l'hôte) : tous
      // levés une fois par l'override, jamais mémorisés ; la cause d'origine est conservée.
      for (const [id, code, origDecision] of [
        ["deny", "policy.rule", "deny"],
        ["ssh", "path.sensitive", "deny"],
        ["outside", "path.outside", "ask"],
        ["hazard", "policy.rule", "ask"],
        ["shell", "bash.hazard", "ask"],
        ["host", "docker.hostAccess", "deny"],
      ] as const) {
        await vi.waitFor(() => expect(box.outcomes.has(id)).toBe(true));
        const outcome = box.outcomes.get(id);
        expect(outcome, id).toMatchObject({
          decision: "allow",
          source: "bypass",
          reason: {
            code: origDecision === "deny" ? "approval.override" : "approval.bypassed",
            cause: { code },
          },
        });
        // Jamais via approval.requested : l'override intervient avant toute question à l'Asker.
        expect(
          eventsOf(t.sent).some((e) => e.kind === "approval.requested" && e.toolUseId === id),
        ).toBe(false);
      }
      t.receive({ v: 1, type: "dispose" });
      t.receive({ v: 1, type: "abort" });
      await done;
    } finally {
      await rm(journalDir, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("(v) expiration à l'horloge du moteur : plus de décision « bypass » après l'échéance, sans nouveau message", async () => {
    const repo = await mkdtemp(join(tmpdir(), "warband-bp-"));
    const journalDir = await mkdtemp(join(tmpdir(), "warband-bp-j-"));
    try {
      const requests = requestsFor(repo);
      requests.ok2 = { ...requests.ok, toolUseId: "ok2" } as ApprovalRequest;
      const box = { outcomes: new Map<string, ApprovalOutcome>() };
      let clock = 1_700_000_000_000;
      const t = fakeChannel();
      const done = runEngine({
        channel: t.channel,
        createRunner: () => bypassRunner(requests, box),
        now: () => clock,
      });
      await started(t, repo, journalDir);
      t.receive(bypassMsg(1, clock, 60_000));
      await vi.waitFor(() => expect(acks(t.sent)).toHaveLength(1));
      t.receive({ v: 1, type: "prompt", text: "ok" });
      await vi.waitFor(() => expect(box.outcomes.has("ok")).toBe(true));
      expect(box.outcomes.get("ok")?.source).toBe("bypass");

      clock += 60_000;
      t.receive({ v: 1, type: "prompt", text: "ok2" });
      await vi.waitFor(() =>
        expect(
          eventsOf(t.sent).some((e) => e.kind === "approval.requested" && e.toolUseId === "ok2"),
        ).toBe(true),
      );
      const last = eventsOf(t.sent)
        .filter((e) => e.kind === "bypass.changed")
        .at(-1);
      expect(last).toMatchObject({ state: "off", reason: { code: "bypass.expired" } });
      t.receive({ v: 1, type: "dispose" });
      t.receive({ v: 1, type: "abort" });
      await done;
    } finally {
      await rm(journalDir, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe("moteur : mode apprentissage (ADR 0010)", () => {
  const tools: ApprovalRequest[] = [
    { toolUseId: "bash", tool: "Bash", input: { command: "ls" } },
    { toolUseId: "read", tool: "Read", input: { file_path: "/etc/hostname" } },
    { toolUseId: "exec", tool: "mcp__exegol__exec", input: { command: "id" } },
    { toolUseId: "ps", tool: "mcp__docker__ps", input: {} },
    { toolUseId: "chercher", tool: "mcp__cours__chercher", input: { requete: "x" } },
    { toolUseId: "lire", tool: "mcp__cours__lire", input: { chemin: "a.md" } },
  ];

  /** Runner factice : interroge la gate pour chaque outil, consigne les entrées reçues. */
  function recordingRunner(box: {
    outcomes: Map<string, ApprovalOutcome>;
    input?: { systemPrompt?: string };
  }): AgentRunner {
    return {
      run: async (input, { gate, signal }) => {
        box.input = input;
        for (const request of tools) {
          box.outcomes.set(
            request.toolUseId,
            await gate.decide(request, signal ?? new AbortController().signal),
          );
        }
        return { status: "success", turns: 0, costUsd: 0, result: null };
      },
    };
  }

  /** Politique « ask » partout : si elle était chargée en apprentissage, le test le verrait. */
  const askLoader = async () => ({
    policy: { default: "ask", rules: [] } as Policy,
    source: null,
    origin: "builtin" as const,
  });

  const prep = async () => ({
    repo: await mkdtemp(join(tmpdir(), "warband-lr-")),
    journalDir: await mkdtemp(join(tmpdir(), "warband-lr-j-")),
  });

  it("(f)(i) Bypass actif : tout refusé par la politique sauf cours ; sans politique chargée", async () => {
    const { repo, journalDir } = await prep();
    try {
      const box = { outcomes: new Map<string, ApprovalOutcome>() } as Parameters<
        typeof recordingRunner
      >[0];
      const modes: unknown[] = [];
      const policyLoader = vi.fn(askLoader);
      const t = fakeChannel();
      const done = runEngine({
        channel: t.channel,
        createRunner: (mode) => {
          modes.push(mode);
          return recordingRunner(box);
        },
        policyLoader,
      });
      // Bypass reçu (sessionStarted) avant le premier tour du runner : start puis bypass dans la foulée.
      t.receive({ v: 1, type: "start", cwd: repo, journalDir, mode: "learning" });
      t.receive(bypassMsg(1));
      expect(await done).toBe(0);
      // Le Bypass est réellement actif : accusé reçu avec un état non nul.
      const ack = t.sent.flatMap((m) => (m.type === "bypassAck" ? [m] : []));
      expect(ack).toHaveLength(1);
      expect(ack[0]?.state).not.toBeNull();
      expect(ack[0]?.state?.expiresAt).toBeGreaterThan(Date.now());
      expect(modes).toEqual(["learning"]);
      expect(policyLoader).not.toHaveBeenCalled();
      expect(box.input?.systemPrompt).toBe(LEARNING_SYSTEM_PROMPT);
      for (const id of ["bash", "read", "exec", "ps"]) {
        expect(box.outcomes.get(id), id).toMatchObject({ decision: "deny", source: "policy" });
      }
      for (const id of ["chercher", "lire"]) {
        expect(box.outcomes.get(id), id).toMatchObject({ decision: "allow" });
      }
      const events = eventsOf(t.sent);
      expect(events.filter((e) => e.kind === "approval.requested")).toEqual([]);
      expect(events.some((e) => e.source === "bypass")).toBe(false);
      const startedMsg = t.sent.find((m) => m.type === "started");
      expect(startedMsg).toMatchObject({ policySource: null });
      expect(startedMsg).not.toHaveProperty("warning");
    } finally {
      await rm(journalDir, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("(j) un second start est rejeté ; un answer remember:always ne persiste rien", async () => {
    const { repo, journalDir } = await prep();
    try {
      const outcomes = new Map<string, ApprovalOutcome>();
      let runs = 0;
      const runner: AgentRunner = {
        run: async ({ prompt }, { gate, signal }) => {
          runs++;
          outcomes.set(
            "bash",
            await gate.decide(tools[0] as ApprovalRequest, signal ?? new AbortController().signal),
          );
          for await (const _ of prompt as AsyncIterable<string>) {
            // attend la clôture du flux
          }
          return { status: "success", turns: 0, costUsd: 0, result: null };
        },
      };
      const t = fakeChannel();
      const done = runEngine({ channel: t.channel, createRunner: () => runner });
      t.receive({ v: 1, type: "start", cwd: repo, journalDir, mode: "learning" });
      await vi.waitFor(() => expect(outcomes.has("bash")).toBe(true));
      expect(outcomes.get("bash")).toMatchObject({ decision: "deny", source: "policy" });
      // Second start : rejeté sans nouveau run.
      t.receive({ v: 1, type: "start", cwd: repo, journalDir, mode: "learning" });
      // Aucune demande n'existe en apprentissage : la réponse est signalée et sans effet.
      t.receive({
        v: 1,
        type: "answer",
        toolUseId: "bash",
        decision: "allow",
        remember: "always",
      });
      expect(codes(t.sent)).toEqual(["ipc.invalidMessage", "ipc.invalidMessage"]);
      expect(runs).toBe(1);
      expect(eventsOf(t.sent).some((e) => e.kind === "approval.requested")).toBe(false);
      t.receive({ v: 1, type: "dispose" });
      await done;
      // Rien de persisté : dépôt vide, seul le journal existe côté extension.
      expect(await readdir(repo)).toEqual([]);
      expect((await readdir(journalDir)).every((f) => f.endsWith(".jsonl"))).toBe(true);
    } finally {
      await rm(journalDir, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("(g) sans mode : politique chargée, systemPrompt de l'UI transmis, ask fourni", async () => {
    const { repo, journalDir } = await prep();
    try {
      const box = { outcomes: new Map<string, ApprovalOutcome>() } as Parameters<
        typeof recordingRunner
      >[0];
      const modes: unknown[] = [];
      const policyLoader = vi.fn(askLoader);
      const t = fakeChannel();
      const done = runEngine({
        channel: t.channel,
        createRunner: (mode) => {
          modes.push(mode);
          return recordingRunner(box);
        },
        policyLoader,
      });
      t.receive({ v: 1, type: "start", cwd: repo, journalDir, systemPrompt: "consigne UI" });
      // Verdict `ask` (aucune règle) : une demande part vers l'UI, preuve que `ask` est fourni.
      await vi.waitFor(() =>
        expect(eventsOf(t.sent).some((e) => e.kind === "approval.requested")).toBe(true),
      );
      expect(policyLoader).toHaveBeenCalledTimes(1);
      expect(modes).toEqual([undefined]);
      expect(box.input?.systemPrompt).toBe(
        `${SCAN_OUTPUT_GUIDANCE}\n\n${deskInstructions()}\n\n${INTEGRATION_GUIDANCE}\n\nconsigne UI`,
      );
      t.receive({ v: 1, type: "abort" });
      await done;
    } finally {
      await rm(journalDir, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("(i) le sondage models appelle createRunner(undefined)", async () => {
    const modes: unknown[] = [];
    const t = fakeChannel();
    const done = runEngine({
      channel: t.channel,
      createRunner: (...args) => {
        modes.push(args[0]);
        return { ...idleRunner, listModels: async () => [] };
      },
    });
    t.receive({ v: 1, type: "models", cwd });
    expect(await done).toBe(0);
    expect(modes).toEqual([undefined]);
  });
});

describe("moteur : dossier effectif du run", () => {
  const prep = async () => ({
    repo: await mkdtemp(join(tmpdir(), "warband-cwd-")),
    workspace: await mkdtemp(join(tmpdir(), "warband-ws-")),
    journalDir: await mkdtemp(join(tmpdir(), "warband-cwd-j-")),
  });

  const policyAt = (seen: string[]) =>
    vi.fn(async (dir: string) => {
      seen.push(dir);
      return {
        policy: { default: "deny", rules: [] } as Policy,
        source: null,
        origin: "builtin" as const,
      };
    });

  it("hors apprentissage, resolveCwd alimente la politique, la gate et le runner", async () => {
    const { repo, workspace, journalDir } = await prep();
    try {
      let runCwd = "";
      const seen: string[] = [];
      const resolveCwd = vi.fn(async (dir: string) => {
        expect(dir).toBe(repo);
        return workspace;
      });
      const t = fakeChannel();
      const done = runEngine({
        channel: t.channel,
        createRunner: () => ({
          run: async (input) => {
            runCwd = input.cwd;
            return { status: "success", turns: 0, costUsd: 0, result: null };
          },
        }),
        policyLoader: policyAt(seen),
        resolveCwd,
      });
      t.receive({ v: 1, type: "start", cwd: repo, journalDir });
      expect(await done).toBe(0);
      expect(resolveCwd).toHaveBeenCalledTimes(1);
      expect(seen).toEqual([workspace]);
      expect(runCwd).toBe(workspace);
      expect(await readdir(journalDir)).toHaveLength(1);
      await expect(readdir(join(workspace, ".warband"))).rejects.toThrow();
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
      await rm(journalDir, { recursive: true, force: true });
    }
  });

  it("retour inutilisable ou exception : on garde le cwd du start", async () => {
    const { repo, workspace, journalDir } = await prep();
    try {
      const cases: Array<(cwd: string) => Promise<string>> = [
        async () => "relatif",
        async () => "",
        async () => {
          throw new Error("lecture");
        },
      ];
      for (const resolveCwd of cases) {
        const seen: string[] = [];
        let runCwd = "";
        const t = fakeChannel();
        const done = runEngine({
          channel: t.channel,
          createRunner: () => ({
            run: async (input) => {
              runCwd = input.cwd;
              return { status: "success", turns: 0, costUsd: 0, result: null };
            },
          }),
          policyLoader: policyAt(seen),
          resolveCwd,
        });
        t.receive({ v: 1, type: "start", cwd: repo, journalDir });
        expect(await done).toBe(0);
        expect(seen).toEqual([repo]);
        expect(runCwd).toBe(repo);
      }
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
      await rm(journalDir, { recursive: true, force: true });
    }
  });

  it("le mode apprentissage n'appelle pas resolveCwd", async () => {
    const { repo, workspace, journalDir } = await prep();
    try {
      const resolveCwd = vi.fn(async () => repo);
      const policyLoader = vi.fn(async () => {
        throw new Error("politique");
      });
      const t = fakeChannel();
      const done = runEngine({
        channel: t.channel,
        createRunner: () => ({
          run: async () => ({ status: "success", turns: 0, costUsd: 0, result: null }),
        }),
        policyLoader,
        resolveCwd,
      });
      t.receive({ v: 1, type: "start", cwd: repo, journalDir, mode: "learning" });
      expect(await done).toBe(0);
      expect(resolveCwd).not.toHaveBeenCalled();
      expect(policyLoader).not.toHaveBeenCalled();
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
      await rm(journalDir, { recursive: true, force: true });
    }
  });
});

describe("moteur : conversations sans injection de mémoire du projet", () => {
  async function run(start: Record<string, unknown>): Promise<string | undefined> {
    const repo = await mkdtemp(join(tmpdir(), "warband-sm-"));
    const journalDir = await mkdtemp(join(tmpdir(), "warband-sm-j-"));
    try {
      let prompt: string | undefined;
      const runner: AgentRunner = {
        run: async (input) => {
          prompt = input.systemPrompt;
          return { status: "success", turns: 0, costUsd: 0, result: null };
        },
      };
      const t = fakeChannel();
      const done = runEngine({
        channel: t.channel,
        createRunner: () => runner,
        policyLoader: async () => ({
          policy: { default: "ask", rules: [] } as Policy,
          source: null,
          origin: "builtin" as const,
        }),
      });
      t.receive({ v: 1, type: "start", cwd: repo, journalDir, ...start });
      await done;
      return prompt;
    } finally {
      await rm(journalDir, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  }

  it.each([undefined, "sess-1"])(
    "conversation neuve ou reprise (%s) : consigne inchangée",
    async (resume) => {
      expect(await run({ ...(resume && { resume }), systemPrompt: "consigne UI" })).toBe(
        `${SCAN_OUTPUT_GUIDANCE}\n\n${deskInstructions()}\n\n${INTEGRATION_GUIDANCE}\n\nconsigne UI`,
      );
      expect(await run({ ...(resume && { resume }) })).toBe(
        `${SCAN_OUTPUT_GUIDANCE}\n\n${deskInstructions()}\n\n${INTEGRATION_GUIDANCE}`,
      );
    },
  );

  it.each([undefined, "sess-1"])(
    "apprentissage (%s) : seule la consigne pédagogique est transmise",
    async (resume) => {
      expect(await run({ mode: "learning", ...(resume && { resume }) })).toBe(
        LEARNING_SYSTEM_PROMPT,
      );
    },
  );
});

it.each([undefined, "learning"] as const)(
  "transmet les endpoints validés au runner, mode %s",
  async (mode) => {
    const t = fakeChannel();
    const opencodeProviders = {
      "venator-local": {
        npm: "@ai-sdk/openai-compatible" as const,
        options: { baseURL: "http://localhost:11434/v1" },
        models: { m: {} },
      },
    };
    const createRunner = vi.fn(() => idleRunner);
    const done = runEngine({ channel: t.channel, createRunner });
    t.receive({
      v: 1,
      type: "start",
      cwd,
      provider: "opencode",
      opencodeProviders,
      webSearch: false,
      profile: "htb",
      ...(mode && { mode }),
    });
    await vi.waitFor(() =>
      expect(createRunner).toHaveBeenCalledWith(
        mode,
        "opencode",
        undefined,
        undefined,
        opencodeProviders,
        false,
        "htb",
      ),
    );
    t.receive({ v: 1, type: "dispose" });
    expect(await done).toBe(0);
  },
);

it("transmet les endpoints validés au catalogue éphémère", async () => {
  const t = fakeChannel();
  const opencodeProviders = {
    "venator-local": {
      npm: "@ai-sdk/openai-compatible" as const,
      options: { baseURL: "http://localhost:11434/v1" },
      models: { m: {} },
    },
  };
  const createRunner = vi.fn(() => ({ ...idleRunner, listModels: async () => [] }));
  const done = runEngine({ channel: t.channel, createRunner });
  t.receive({ v: 1, type: "models", cwd, provider: "opencode", opencodeProviders });
  expect(await done).toBe(0);
  expect(createRunner).toHaveBeenCalledWith(
    undefined,
    "opencode",
    undefined,
    undefined,
    opencodeProviders,
  );
});

it("transporte l’image au seul tour demandé sans la journaliser", async () => {
  const t = fakeChannel();
  const received: unknown[] = [];
  const image = { name: "a.png", mimeType: "image/png", data: "iVBORw0KGgo=" };
  const runner: AgentRunner = {
    run: async ({ prompt }) => {
      for await (const item of prompt as AsyncIterable<unknown>) received.push(item);
      return { status: "success", turns: 0, costUsd: 0, result: null };
    },
  };
  const done = runEngine({
    channel: t.channel,
    createRunner: () => runner,
    onPrompt: (text) => `${text} contexte`,
  });
  t.receive({ v: 1, type: "start", cwd });
  t.receive({ v: 1, type: "prompt", text: "voir", images: [image] });
  t.receive({ v: 1, type: "prompt", text: "suite" });
  t.receive({ v: 1, type: "dispose" });
  await done;
  expect(received).toEqual([{ text: "voir contexte", images: [image] }, "suite contexte"]);
  expect(JSON.stringify(t.sent)).not.toContain(image.data);
});

describe("moteur : engagement, arrêt d'urgence et campagne transmis au runner (ADR 0041)", () => {
  const ID = "11111111-1111-4111-8111-111111111111";
  type Ctx = Parameters<AgentRunner["run"]>[1];

  const run = async (
    options: Partial<Parameters<typeof runEngine>[0]>,
    start: Record<string, unknown> = {},
  ) => {
    const t = fakeChannel();
    const seen: { ctx?: Ctx } = {};
    const runner: AgentRunner = {
      run: async ({ prompt }, ctx) => {
        seen.ctx = ctx;
        for await (const _ of prompt as AsyncIterable<unknown>) {
          // consignes ignorées
        }
        return { status: "success", turns: 0, costUsd: 0, result: null };
      },
    };
    const done = runEngine({ channel: t.channel, createRunner: () => runner, ...options });
    t.receive({ v: 1, type: "start", cwd, ...start });
    t.receive({ v: 1, type: "dispose" });
    await done;
    return seen.ctx;
  };

  it("le runner relit l'engagement et l'arrêt à chaque appel, et reçoit le port de campagne", async () => {
    const dir = await mkdtemp(join(tmpdir(), "warband-engine-campaign-"));
    let halted = false;
    const campaign = createCampaignPort(dir, () => ID);
    const ctx = await run({
      engagement: () => ({ status: { state: "none" }, halted }),
      campaign,
    });
    expect(ctx?.engagement?.()).toEqual({ state: "none" });
    expect(ctx?.halted?.()).toBe(false);
    halted = true;
    expect(ctx?.halted?.()).toBe(true);
    expect(ctx?.campaign).toBe(campaign);
    await rm(dir, { recursive: true, force: true });
  });

  it("sans projet actif, record_step et record_teardown échouent en project.absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "warband-engine-campaign-"));
    const ctx = await run({ campaign: createCampaignPort(dir, () => null) });
    // Le port refuse tout de suite (levée synchrone) : on l'observe comme un rejet.
    await expect(
      (async () => ctx?.campaign?.recordStep({ stepId: "s1", result: "success" }))(),
    ).rejects.toMatchObject({ code: "project.absent" });
    await expect(
      (async () => ctx?.campaign?.markTeardown({ itemId: "t1", proof: "ok" }))(),
    ).rejects.toMatchObject({ code: "project.absent" });
    await rm(dir, { recursive: true, force: true });
  });

  it("avec un projet actif mais sans plan approuvé, record_step est refusé", async () => {
    const dir = await mkdtemp(join(tmpdir(), "warband-engine-campaign-"));
    const ctx = await run({ campaign: createCampaignPort(dir, () => ID) });
    await expect(
      ctx?.campaign?.recordStep({ stepId: "s1", result: "success" }),
    ).rejects.toMatchObject({ code: "campaign.notApproved" });
    await rm(dir, { recursive: true, force: true });
  });

  it("rien n'est transmis sans option, ni en apprentissage", async () => {
    const none = await run({});
    expect(none?.engagement).toBeUndefined();
    expect(none?.halted).toBeUndefined();
    expect(none?.campaign).toBeUndefined();
    const learning = await run(
      {
        engagement: () => ({ status: { state: "none" }, halted: true }),
        campaign: createCampaignPort(cwd, () => ID),
      },
      { mode: "learning" },
    );
    expect(learning?.engagement).toBeUndefined();
    expect(learning?.halted).toBeUndefined();
    expect(learning?.campaign).toBeUndefined();
  });
});
