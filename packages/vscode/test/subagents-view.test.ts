import type { EngineEvent } from "@warband/core";
import { describe, expect, it } from "vitest";
import { createChatState } from "../src/logic/chat.js";

const ev = (payload: Record<string, unknown>, id = "e"): EngineEvent =>
  ({
    v: 1,
    id,
    seq: 1,
    ts: "2026-11-27T00:00:00.000Z",
    runId: "r",
    parentId: null,
    ...payload,
  }) as EngineEvent;

const items = [
  { id: "s1", name: "Domaines", goal: "Énumérer les sous-domaines" },
  { id: "s2", name: "Fuzzing", goal: "Fuzzer les chemins du site" },
  { id: "s3", name: "API", goal: "Tester les routes de l'API" },
];
const proposed = (proposalId = "p1", list = items) =>
  ev({ kind: "subagents.proposed", proposalId, items: list }, `prop-${proposalId}`);
const decided = (payload: Record<string, unknown>) =>
  ev({ kind: "subagents.decided", note: undefined, ...payload }, `dec-${payload.proposalId}`);
const subagentsItems = (state: ReturnType<typeof createChatState>) =>
  state.view().items.filter((item) => item.kind === "subagents");

describe("élément « Sous-agents » du fil (ADR 0054)", () => {
  it("une proposition produit un élément en attente, sans sélection", () => {
    const state = createChatState();
    state.event(proposed());
    expect(subagentsItems(state)).toEqual([
      expect.objectContaining({
        kind: "subagents",
        proposalId: "p1",
        items,
        status: "pending",
        selected: [],
        source: "r/prop-p1",
      }),
    ]);
    expect(subagentsItems(state)[0]).not.toHaveProperty("note");
  });

  it("un accord donne le statut et les identifiants retenus, et efface la proposition vivante", () => {
    const state = createChatState();
    state.event(proposed());
    state.setSubagentsProposal({ proposalId: "p1", items });
    state.event(
      decided({
        proposalId: "p1",
        decision: "accepted",
        selected: [
          { id: "s1", description: "Domaines" },
          { id: "s3", description: "API" },
        ],
      }),
    );
    expect(subagentsItems(state)[0]).toMatchObject({ status: "accepted", selected: ["s1", "s3"] });
    expect(state.subagentsProposal).toBeNull();
    expect(state.view().subagentsProposal).toBeUndefined();
  });

  it("un refus avec une note donne la note, neutralisée et plafonnée", () => {
    const state = createChatState();
    state.event(proposed());
    state.event(
      decided({
        proposalId: "p1",
        decision: "declined",
        selected: [],
        note: `d'abord le scan\x1b[2K‮${"x".repeat(2500)}`,
      }),
    );
    const [item] = subagentsItems(state);
    expect(item).toMatchObject({ status: "declined", selected: [] });
    const note = item?.kind === "subagents" ? (item.note ?? "") : "";
    expect(note.startsWith("d'abord le scan")).toBe(true);
    expect(note.includes("\x1b")).toBe(false);
    expect(note.includes("‮")).toBe(false);
    expect(note).toHaveLength(2001);
    expect(note.endsWith("…")).toBe(true);
  });

  it("un refus sans note, ou avec une note vide, ne pose pas de note", () => {
    for (const note of [undefined, "", "  \x1b  "]) {
      const state = createChatState();
      state.event(proposed());
      state.event(decided({ proposalId: "p1", decision: "declined", selected: [], note }));
      expect(subagentsItems(state)[0]).toMatchObject({ status: "declined" });
      expect(subagentsItems(state)[0]).not.toHaveProperty("note");
    }
  });

  it("une réponse à une autre proposition ne change rien", () => {
    const state = createChatState();
    state.event(proposed());
    state.setSubagentsProposal({ proposalId: "p1", items });
    state.event(
      decided({
        proposalId: "autre",
        decision: "accepted",
        selected: [{ id: "s1", description: "Domaines" }],
        note: "x",
      }),
    );
    expect(subagentsItems(state)[0]).toMatchObject({ status: "pending", selected: [] });
    expect(subagentsItems(state)[0]).not.toHaveProperty("note");
    expect(state.subagentsProposal?.proposalId).toBe("p1");
  });

  it("chaque réponse vise sa proposition quand il y en a plusieurs", () => {
    const state = createChatState();
    state.event(proposed("p1"));
    state.event(
      decided({
        proposalId: "p1",
        decision: "accepted",
        selected: [{ id: "s2", description: "Fuzzing" }],
      }),
    );
    state.event(proposed("p2"));
    expect(subagentsItems(state).map((item) => item.kind === "subagents" && item.status)).toEqual([
      "accepted",
      "pending",
    ]);
  });

  it("un identifiant inconnu dans la sélection est ignoré", () => {
    const state = createChatState();
    state.event(proposed());
    state.event(
      decided({
        proposalId: "p1",
        decision: "accepted",
        selected: [
          { id: "inconnu", description: "Fantôme" },
          { id: "s2", description: "Fuzzing" },
        ],
      }),
    );
    expect(subagentsItems(state)[0]).toMatchObject({ status: "accepted", selected: ["s2"] });
  });

  it("une relecture sans réponse reste en attente", () => {
    const state = createChatState();
    state.event(proposed());
    state.event(ev({ kind: "run.finished", status: "success" }, "fin"));
    expect(subagentsItems(state)[0]).toMatchObject({ status: "pending", selected: [] });
    // Aucune proposition vivante : la webview affiche « restée sans réponse ».
    expect(state.view().subagentsProposal).toBeUndefined();
  });

  it("en lecture seule, la vue garde l'élément mais pas la proposition vivante", () => {
    const state = createChatState();
    state.event(proposed());
    state.setSubagentsProposal({ proposalId: "p1", items });
    expect(state.view().subagentsProposal).toMatchObject({ proposalId: "p1" });
    state.setReadonly({ id: "c", title: "t", invalid: 0, truncated: false, canResume: false });
    const view = state.view();
    expect(view.subagentsProposal).toBeUndefined();
    expect(view.items.filter((item) => item.kind === "subagents")).toHaveLength(1);
  });

  it("retire contrôles et bidi des noms et des objectifs, et plafonne leur longueur", () => {
    const state = createChatState();
    state.event(
      proposed("p1", [
        { id: "a", name: "Dom\x1b[2Kaines‮", goal: "Éner\u0007gie‮ ok" },
        { id: "b", name: "n".repeat(300), goal: "g".repeat(5000) },
      ]),
    );
    const [item] = subagentsItems(state);
    if (item?.kind !== "subagents") throw new Error("élément attendu");
    expect(item.items[0]).toEqual({ id: "a", name: "Domaines", goal: "Énergie ok" });
    expect(item.items[1]?.name).toHaveLength(201);
    expect(item.items[1]?.goal).toHaveLength(4001);
  });

  it("la proposition vivante reçoit la même neutralisation que l'élément du fil", () => {
    const state = createChatState();
    state.setSubagentsProposal({
      proposalId: "p1",
      items: [{ id: "a", name: "Dom\x1b[2Kaines‮", goal: "g".repeat(5000) }],
    });
    expect(state.view().subagentsProposal?.items[0]).toEqual({
      id: "a",
      name: "Domaines",
      goal: `${"g".repeat(4000)}…`,
    });
  });

  it("la fenêtre de 60 éléments évince l'élément comme les autres : une réponse tardive ne change rien", () => {
    const state = createChatState();
    state.event(proposed());
    for (let i = 0; i < 61; i++) state.notice(`n${i}`);
    expect(subagentsItems(state)).toHaveLength(0);
    state.event(
      decided({
        proposalId: "p1",
        decision: "accepted",
        selected: [{ id: "s1", description: "Domaines" }],
      }),
    );
    expect(subagentsItems(state)).toHaveLength(0);
  });
});
