import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentRunner,
  type ApprovalGate,
  type ApprovalOutcome,
  type ApprovalRequest,
  BYPASS_DEFAULT_MS,
  type Policy,
} from "@john-studio/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type EngineChannel, runEngine } from "../src/engine/engine.js";
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
  cwd = await mkdtemp(join(tmpdir(), "john-engine-"));
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
        const { CodedError } = await import("@john-studio/core");
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
  it("écrit dans journalDir (hors du dépôt) et consigne chaque consigne en user.message", async () => {
    const { readFile, readdir } = await import("node:fs/promises");
    const journalDir = await mkdtemp(join(tmpdir(), "john-journal-"));
    const repo = await mkdtemp(join(tmpdir(), "john-repo-"));
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
      await expect(readdir(join(repo, ".john-studio"))).rejects.toThrow();
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
        input: { file_path: "/etc/john-bypass-test", content: "x" },
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
    const repo = await mkdtemp(join(tmpdir(), "john-bp-"));
    const journalDir = await mkdtemp(join(tmpdir(), "john-bp-j-"));
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
    const repo = await mkdtemp(join(tmpdir(), "john-bp-"));
    const journalDir = await mkdtemp(join(tmpdir(), "john-bp-j-"));
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
    const repo = await mkdtemp(join(tmpdir(), "john-bp-"));
    const journalDir = await mkdtemp(join(tmpdir(), "john-bp-j-"));
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

  it("(u) bout à bout avec la gate réelle : deny, chemins, danger shell et hôte jamais auto-approuvés ; ordinaire oui", async () => {
    const repo = await mkdtemp(join(tmpdir(), "john-bp-"));
    const journalDir = await mkdtemp(join(tmpdir(), "john-bp-j-"));
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

      // Refus venus des gardes (et non de la politique) : danger shell et accès à l'hôte.
      for (const [id, code] of [
        ["hazard", "policy.rule"],
        ["shell", "bash.hazard"],
        ["host", "docker.hostAccess"],
      ] as const) {
        // Demande (verdict « ask » non bypassable) ou décision directe (refus de garde) : même motif.
        await vi.waitFor(() =>
          expect(
            eventsOf(t.sent).some(
              (e) =>
                e.toolUseId === id &&
                (e.kind === "approval.requested" || e.kind === "approval.decided"),
            ),
          ).toBe(true),
        );
        const first = eventsOf(t.sent).find(
          (e) =>
            e.toolUseId === id &&
            (e.kind === "approval.requested" || e.kind === "approval.decided"),
        );
        expect(first?.kind === "approval.requested" ? first.verdict : first?.reason).toMatchObject({
          code,
        });
      }
      for (const id of ["deny", "ssh", "outside", "hazard", "shell", "host"]) {
        await vi.waitFor(() =>
          expect(
            eventsOf(t.sent).some(
              (e) =>
                e.toolUseId === id &&
                (e.kind === "approval.requested" || e.kind === "approval.decided"),
            ),
          ).toBe(true),
        );
        const sources = eventsOf(t.sent).filter(
          (e) => e.kind === "approval.decided" && e.toolUseId === id,
        );
        expect(
          sources.map((e) => e.source),
          id,
        ).not.toContain("bypass");
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
    const repo = await mkdtemp(join(tmpdir(), "john-bp-"));
    const journalDir = await mkdtemp(join(tmpdir(), "john-bp-j-"));
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
