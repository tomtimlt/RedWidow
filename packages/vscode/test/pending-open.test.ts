import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  consumePendingOpen,
  PENDING_OPEN_KEY,
  PENDING_OPEN_TTL_MS,
  type PendingStore,
  resumeFromOtherProject,
} from "../src/logic/pending-open.js";

function store(initial?: unknown) {
  const data = new Map<string, unknown>();
  if (initial !== undefined) data.set(PENDING_OPEN_KEY, initial);
  const api: PendingStore & { data: Map<string, unknown> } = {
    data,
    get: (key) => data.get(key),
    update: (key, value) => {
      if (value === undefined) data.delete(key);
      else data.set(key, structuredClone(value));
    },
  };
  return api;
}

describe("reprise d'une conversation d'un autre projet (ADR 0049)", () => {
  const conversation = () => ({
    id: randomUUID(),
    projectKey: randomUUID(),
    projectLabel: "Cible",
  });
  const setup = (over: Partial<Parameters<typeof resumeFromOtherProject>[0]> = {}) => {
    const calls: string[] = [];
    const memory = store();
    const target = conversation();
    const deps: Parameters<typeof resumeFromOtherProject>[0] = {
      conversation: target,
      activeProjectId: randomUUID(),
      projectKnown: true,
      confirm: async (text, action) => {
        calls.push(`confirm:${text}|${action}`);
        return true;
      },
      inform: async (text) => {
        calls.push(`inform:${text}`);
      },
      store: memory,
      switchProject: async (projectId, beforeOpen) => {
        calls.push(`switch:${projectId}`);
        await beforeOpen();
        calls.push(`pending:${JSON.stringify(memory.get(PENDING_OPEN_KEY))}`);
        return true;
      },
      now: () => 1000,
      ...over,
    };
    return { deps, calls, memory, target };
  };

  it("même projet : aucun avertissement, la reprise suit son cours", async () => {
    const target = conversation();
    const { deps, calls } = setup({
      conversation: target,
      activeProjectId: target.projectKey,
    });
    expect(await resumeFromOtherProject(deps)).toBe("same-project");
    expect(calls).toEqual([]);
  });

  it("annulation : aucun changement de projet, aucune clé", async () => {
    const { deps, calls, memory } = setup({ confirm: async () => false });
    expect(await resumeFromOtherProject(deps)).toBe("cancelled");
    expect(calls).toEqual([]);
    expect(memory.data.size).toBe(0);
  });

  it("confirmation : avertissement nommant le projet, changement et clé mémorisée avant l'ouverture", async () => {
    const { deps, calls, memory, target } = setup();
    expect(await resumeFromOtherProject(deps)).toBe("switched");
    expect(calls[0]).toBe(
      "confirm:Cette conversation appartient au projet « Cible ». Changer de projet pour la reprendre ?|Changer de projet",
    );
    expect(calls[1]).toBe(`switch:${target.projectKey}`);
    expect(calls[2]).toBe(
      `pending:${JSON.stringify({ id: target.id, projectId: target.projectKey, at: 1000 })}`,
    );
    expect(memory.get(PENDING_OPEN_KEY)).toEqual({
      id: target.id,
      projectId: target.projectKey,
      at: 1000,
    });
  });

  it("changement refusé : la clé est effacée", async () => {
    const { deps, memory } = setup({
      switchProject: async (_id, beforeOpen) => {
        await beforeOpen();
        return false;
      },
    });
    expect(await resumeFromOtherProject(deps)).toBe("failed");
    expect(memory.data.size).toBe(0);
  });

  it("« Sans projet » ou projet disparu : avertissement sans action, aucun changement", async () => {
    for (const over of [
      { conversation: { id: randomUUID(), projectKey: "none", projectLabel: "Sans projet" } },
      { projectKnown: false },
    ]) {
      const { deps, calls, memory } = setup(over);
      expect(await resumeFromOtherProject(deps)).toBe("refused");
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatch(/^inform:/);
      expect(memory.data.size).toBe(0);
    }
  });

  describe("consommation de la clé", () => {
    const pending = (over: Record<string, unknown> = {}) => ({
      id: randomUUID(),
      projectId: randomUUID(),
      at: 10_000,
      ...over,
    });

    it("projet correspondant : ouvre la conversation puis efface la clé", async () => {
      const entry = pending();
      const memory = store(entry);
      const opened: string[] = [];
      const outcome = await consumePendingOpen(
        memory,
        entry.projectId,
        async (id) => {
          opened.push(id);
        },
        10_000 + 1000,
      );
      expect(outcome).toBe("opened");
      expect(opened).toEqual([entry.id]);
      expect(memory.data.has(PENDING_OPEN_KEY)).toBe(false);
    });

    it("expirée : rien n'est ouvert, la clé est effacée", async () => {
      const entry = pending();
      const memory = store(entry);
      const opened: string[] = [];
      const outcome = await consumePendingOpen(
        memory,
        entry.projectId,
        async (id) => {
          opened.push(id);
        },
        10_000 + PENDING_OPEN_TTL_MS + 1,
      );
      expect(outcome).toBe("expired");
      expect(opened).toEqual([]);
      expect(memory.data.has(PENDING_OPEN_KEY)).toBe(false);
    });

    it("autre projet : rien n'est ouvert, la clé reste pour la fenêtre concernée", async () => {
      const entry = pending();
      const memory = store(entry);
      const opened: string[] = [];
      const outcome = await consumePendingOpen(
        memory,
        randomUUID(),
        async (id) => {
          opened.push(id);
        },
        10_000 + 1000,
      );
      expect(outcome).toBe("other-project");
      expect(opened).toEqual([]);
      expect(memory.get(PENDING_OPEN_KEY)).toEqual(entry);
    });

    it("absente ou illisible : aucune ouverture", async () => {
      const opened: string[] = [];
      const open = async (id: string) => {
        opened.push(id);
      };
      expect(await consumePendingOpen(store(), randomUUID(), open)).toBe("none");
      const bad = store({ id: "../x", projectId: "y", at: 1 });
      expect(await consumePendingOpen(bad, randomUUID(), open)).toBe("expired");
      expect(bad.data.has(PENDING_OPEN_KEY)).toBe(false);
      expect(opened).toEqual([]);
    });
  });
});
