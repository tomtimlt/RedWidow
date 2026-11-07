import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type ApprovalWatchState, createApprovalWatch } from "../src/logic/approval-watch.js";

const setup = (visible: string[] = []) => {
  const changes: ApprovalWatchState[] = [];
  const notified: string[] = [];
  const shown = new Set(visible);
  const watch = createApprovalWatch({
    isVisible: (id) => shown.has(id),
    onChange: (state) => changes.push(state),
    notify: (id) => notified.push(id),
  });
  return { watch, changes, notified, shown };
};

describe("suivi des approbations en attente", () => {
  it("compte l'arrivée, la résolution et la fermeture d'un chat", () => {
    const { watch, changes } = setup();
    watch.sync("a", ["t1"]);
    watch.sync("b", ["t2", "t3"]);
    expect(watch.state()).toEqual({ count: 3, oldest: "a" });
    watch.sync("a", []);
    expect(watch.state()).toEqual({ count: 2, oldest: "b" });
    watch.drop("b");
    expect(watch.state()).toEqual({ count: 0, oldest: null });
    expect(changes.map((c) => c.count)).toEqual([1, 3, 2, 0]);
  });

  it("annulation de tour : la vue vide les cartes, le compteur retombe à zéro", () => {
    const { watch } = setup();
    watch.sync("a", ["t1", "t2"]);
    watch.sync("a", []);
    expect(watch.state().count).toBe(0);
  });

  it("n'émet pas de changement quand rien ne change (rafraîchissements de vue)", () => {
    const { watch, changes } = setup();
    watch.sync("a", ["t1"]);
    watch.sync("a", ["t1"]);
    watch.sync("b", []);
    expect(changes).toHaveLength(1);
  });

  it("garde l'ordre : le plus ancien reste désigné, même si un autre chat arrive après", () => {
    const { watch } = setup();
    watch.sync("b", ["t1"]);
    watch.sync("a", ["t2"]);
    expect(watch.state().oldest).toBe("b");
    watch.sync("b", ["t1", "t3"]);
    expect(watch.state()).toEqual({ count: 3, oldest: "b" });
    watch.sync("b", ["t3"]);
    expect(watch.state().oldest).toBe("a");
  });

  it("notifie une seule fois par demande, et seulement si le chat n'est pas visible", () => {
    const { watch, notified, shown } = setup(["a"]);
    watch.sync("a", ["t1"]);
    expect(notified).toEqual([]);
    watch.sync("b", ["t2"]);
    watch.sync("b", ["t2"]);
    watch.sync("b", ["t2"]);
    expect(notified).toEqual(["b"]);
    shown.add("b");
    watch.sync("b", ["t2", "t3"]);
    expect(notified).toEqual(["b"]);
    shown.delete("b");
    watch.sync("b", ["t2", "t3", "t4"]);
    expect(notified).toEqual(["b", "b"]);
  });

  it("plusieurs demandes d'un coup : une notification chacune, aucune perdue", () => {
    const { watch, notified } = setup();
    watch.sync("a", ["t1", "t2"]);
    expect(notified).toEqual(["a", "a"]);
    expect(watch.state().count).toBe(2);
  });
});

describe("câblage hôte des approbations", () => {
  const extension = readFileSync(new URL("../src/extension/extension.ts", import.meta.url), "utf8");
  it("barre d'état cachée à zéro, fond d'avertissement standard, badge de la vue", () => {
    expect(extension).toMatch(/if \(state\.count === 0\) \{\s*barApprovals\.hide\(\);/);
    expect(extension).toContain('new vscode.ThemeColor("statusBarItem.warningBackground")');
    expect(extension).toContain("sidebarView.badge = { value: state.count");
    expect(extension).toContain('barApprovals.command = "warband.revealPendingApproval"');
  });
  it("le clic révèle le chat le plus ancien ; le chat latéral prend le focus", () => {
    expect(extension).toMatch(/const \{ oldest \} = approvalWatch\.state\(\);/);
    expect(extension).toContain('executeCommand("warband.chat.focus")');
    expect(extension).toContain("panel.reveal(undefined, false)");
  });
  it("la vue de chaque chat alimente le suivi, et sa fermeture le libère", () => {
    expect(extension).toContain("approvalWatch.sync(");
    expect(extension).toContain("approvalWatch.drop(id)");
  });
});
