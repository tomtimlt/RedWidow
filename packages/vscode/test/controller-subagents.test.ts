import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineEvent, ErrorInfo } from "@warband/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createEngineController } from "../src/logic/controller.js";

/**
 * Moteur factice minimal (script Node) : à `start`, il envoie une proposition valide puis une
 * proposition mal formée ; il renvoie tel quel chaque `subagentsAnswer` reçu, en événement.
 */
const FAKE_ENGINE = `
const send = (m) => process.send(m);
const event = (text) => ({
  v: 1, id: "e" + Math.random(), seq: 0, ts: new Date().toISOString(), runId: "r", parentId: null,
  kind: "agent.text", text,
});
send({ v: 1, type: "ready" });
process.on("message", (m) => {
  if (m.type === "start") {
    send({ v: 1, type: "subagentsProposal", proposalId: "p1",
      items: [{ id: "s1", name: "Domaines", goal: "Énumérer" }, { id: "s2", name: "API", goal: "Routes" }] });
    send({ v: 1, type: "subagentsProposal", proposalId: "p2", items: [] });
  } else if (m.type === "subagentsAnswer") {
    send({ v: 1, type: "event", event: event("ANSWER " + JSON.stringify(m)) });
  } else if (m.type === "dispose") {
    setTimeout(() => process.exit(0), 10);
  }
});
`;

let dir: string;
let enginePath: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "warband-ctl-sub-"));
  enginePath = join(dir, "engine-fake.mjs");
  await writeFile(enginePath, FAKE_ENGINE);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("contrôleur : sous-agents (ADR 0054)", () => {
  it("relaie la proposition du moteur et lui renvoie la réponse (forme exacte)", async () => {
    const proposals: unknown[] = [];
    const events: EngineEvent[] = [];
    const errors: ErrorInfo[] = [];
    const ctl = createEngineController({
      enginePath,
      handlers: {
        onSubagentsProposal: (p) => void proposals.push(p),
        onEvent: (e) => void events.push(e),
        onError: (r) => void errors.push(r),
      },
    });
    await ctl.start({ cwd: dir, subagents: true });
    await vi.waitFor(() => expect(proposals).toHaveLength(1));
    expect(proposals[0]).toEqual({
      proposalId: "p1",
      items: [
        { id: "s1", name: "Domaines", goal: "Énumérer" },
        { id: "s2", name: "API", goal: "Routes" },
      ],
    });
    // La seconde proposition (sans élément) est rejetée par la validation, jamais relayée.
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toMatchObject({
      code: "ipc.invalidMessage",
      params: { field: "items" },
    });
    expect(proposals).toHaveLength(1);

    ctl.subagentsAnswer("p1", ["s2"], "ok pour l'API");
    ctl.subagentsAnswer("p1", []);
    const texts = () =>
      events.flatMap((e) => (e.kind === "agent.text" ? [e.text.replace(/^ANSWER /, "")] : []));
    await vi.waitFor(() => expect(texts()).toHaveLength(2));
    expect(JSON.parse(texts()[0] ?? "")).toEqual({
      v: 1,
      type: "subagentsAnswer",
      proposalId: "p1",
      selected: ["s2"],
      note: "ok pour l'API",
    });
    // Sans note : aucune clé `note`.
    expect(JSON.parse(texts()[1] ?? "")).toEqual({
      v: 1,
      type: "subagentsAnswer",
      proposalId: "p1",
      selected: [],
    });
    ctl.dispose();
    await ctl.exited;
  }, 30_000);
});
