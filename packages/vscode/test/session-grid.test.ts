import { describe, expect, it } from "vitest";
import type { ApprovalCard } from "../src/logic/approval.js";
import type { ChatItem, HistoryEntry } from "../src/logic/chat.js";
import {
  buildSessionGrid,
  filterSessionGrid,
  type SessionGridChat,
} from "../src/logic/session-grid.js";

const card = (id: string) => ({ toolUseId: id }) as ApprovalCard;
const entry = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: "h",
  title: "Titre",
  updatedAt: "2026-11-01T10:00:00.000Z",
  tools: 0,
  provider: "Claude",
  model: "modèle-x",
  current: true,
  projectKey: "p",
  projectLabel: "Laboratoire",
  ...over,
});
const errorItem: ChatItem = { id: 1, kind: "notice", level: "error", text: "échec" };
const chat = (
  id: string,
  over: {
    busy?: boolean;
    approvals?: string[];
    items?: ChatItem[];
    history?: HistoryEntry[];
    location?: "sidebar" | "editor";
  } = {},
): SessionGridChat => ({
  id,
  name: id,
  location: over.location ?? "editor",
  view: {
    busy: over.busy ?? false,
    approvals: (over.approvals ?? []).map(card),
    items: over.items ?? [],
    history: over.history ?? [entry()],
  },
});

describe("grille des sessions", () => {
  it("déduit les quatre états, l'approbation primant sur le tour en cours", () => {
    const tiles = buildSessionGrid([
      chat("repos"),
      chat("tour", { busy: true }),
      chat("attend", { busy: true, approvals: ["t1"] }),
      chat("erreur", { items: [errorItem] }),
    ]);
    const state = Object.fromEntries(tiles.map((t) => [t.id, t.state]));
    expect(state).toEqual({ repos: "idle", tour: "busy", attend: "approval", erreur: "error" });
  });

  it("une erreur suivie d'un message n'est plus une erreur ; un notice d'info n'en est pas une", () => {
    const user: ChatItem = { id: 2, kind: "user", text: "reprends" };
    const info: ChatItem = { id: 3, kind: "notice", level: "info", text: "ok" };
    const tiles = buildSessionGrid([
      chat("a", { items: [errorItem, user] }),
      chat("b", { items: [info] }),
    ]);
    expect(tiles.map((t) => t.state)).toEqual(["idle", "idle"]);
  });

  it("reprend nom, emplacement, modèle, projet, titre et date de l'entrée d'historique courante", () => {
    const [tile] = buildSessionGrid([
      chat("c1", {
        location: "sidebar",
        history: [entry({ current: false, model: "autre" }), entry()],
      }),
    ]);
    expect(tile).toMatchObject({
      id: "c1",
      location: "sidebar",
      model: "modèle-x",
      project: "Laboratoire",
      title: "Titre",
      updatedAt: "2026-11-01T10:00:00.000Z",
      approvals: 0,
    });
  });

  it("chat sans entrée d'historique : champs vides, date nulle, rangé en dernier", () => {
    const tiles = buildSessionGrid([chat("vide", { history: [] }), chat("daté")]);
    expect(tiles.map((t) => t.id)).toEqual(["daté", "vide"]);
    expect(tiles[1]).toMatchObject({ model: "", project: "", title: "", updatedAt: null });
  });

  it("trie : approbations (la plus ancienne en tête), erreurs, puis activité récente", () => {
    const old = entry({ updatedAt: "2026-11-01T08:00:00.000Z" });
    const recent = entry({ updatedAt: "2026-11-01T12:00:00.000Z" });
    const tiles = buildSessionGrid(
      [
        chat("ancien-repos", { history: [old] }),
        chat("recent-repos", { history: [recent] }),
        chat("erreur", { items: [errorItem], history: [old] }),
        chat("attend-recent", { approvals: ["a"], history: [recent] }),
        chat("attend-ancien", { approvals: ["b"], history: [old] }),
      ],
      ["attend-ancien", "attend-recent"],
    );
    expect(tiles.map((t) => t.id)).toEqual([
      "attend-ancien",
      "attend-recent",
      "erreur",
      "recent-repos",
      "ancien-repos",
    ]);
  });

  it("filtre « En attente de toi » : approbation ou erreur seulement", () => {
    const tiles = buildSessionGrid([
      chat("repos"),
      chat("tour", { busy: true }),
      chat("attend", { approvals: ["t"] }),
      chat("erreur", { items: [errorItem] }),
    ]);
    expect(
      filterSessionGrid(tiles, "awaiting")
        .map((t) => t.id)
        .sort(),
    ).toEqual(["attend", "erreur"]);
    expect(filterSessionGrid(tiles, "all")).toHaveLength(4);
    expect(filterSessionGrid([], "awaiting")).toEqual([]);
  });

  it("neutralise les caractères de contrôle et plafonne les textes", () => {
    const [tile] = buildSessionGrid([
      chat("x", { history: [entry({ title: `a\u0007b${"z".repeat(500)}` })] }),
    ]);
    expect(tile?.title).not.toContain("\u0007");
    expect((tile?.title.length ?? 0) <= 121).toBe(true);
  });
});
