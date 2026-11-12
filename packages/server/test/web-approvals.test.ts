import { describe, expect, it, vi } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: modules JS non typés
const load = (path: string): Promise<any> => import(new URL(path, import.meta.url).href);
const card = await load("../web/lib/approval-card.js");
const topbar = await load("../web/lib/topbar.js");
const { choicesFor, cardKey, createApprovalTracker, parseApprovalList, UNCONFIRMED_AFTER_MS } =
  card;

const item = (over: Record<string, unknown> = {}) => ({
  frame: "m1",
  toolUseId: "t1",
  tool: "Bash",
  summary: "ls -la",
  canRemember: true,
  confirming: false,
  ...over,
});

function setup(sendResult = true) {
  const send = vi.fn(() => sendResult);
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const tracker = createApprovalTracker({
    send,
    setTimer: (fn: () => void, ms: number) => {
      const t = { fn, ms, live: true };
      timers.push(t);
      return t;
    },
    clearTimer: (t: { live: boolean }) => {
      t.live = false;
    },
  });
  return { tracker, send, timers };
}

describe("choix proposés", () => {
  it("« Toujours » absent si la demande n'est pas mémorisable", () => {
    expect(choicesFor(item({ canRemember: false }))).toEqual(["once", "deny"]);
    expect(choicesFor(item({ canRemember: true }))).toEqual(["once", "deny", "always"]);
  });
});

describe("liste d'approbations reçue", () => {
  it("garde les formes valides, sans doublon, et jette le reste", () => {
    const list = parseApprovalList([
      item(),
      item(),
      item({ toolUseId: "t2", canRemember: "oui" }),
      { frame: "../x", toolUseId: "t3", tool: "a", summary: "b" },
      null,
      "x",
    ]);
    expect(list.map(cardKey)).toEqual(["m1/t1", "m1/t2"]);
    expect(list[1].canRemember).toBe(false);
    expect(parseApprovalList("pas une liste")).toEqual([]);
  });
});

describe("aucun approve sans clic", () => {
  it("n'envoie rien à l'arrivée d'une liste, à la reconnexion, ni sur minuterie", () => {
    const { tracker, send, timers } = setup();
    tracker.update([item(), item({ toolUseId: "t2" })]);
    tracker.update([item(), item({ toolUseId: "t2" }), item({ toolUseId: "t3" })]);
    tracker.connectionLost();
    tracker.update([item()]);
    for (const t of timers) t.fn();
    expect(send).not.toHaveBeenCalled();
  });

  it("un clic envoie un seul approve ; le suivant est ignoré tant que l'accusé manque", () => {
    const { tracker, send } = setup();
    tracker.update([item()]);
    expect(tracker.click("m1/t1", "once")).toBe("sent");
    expect(tracker.click("m1/t1", "once")).toBe("ignored");
    expect(tracker.click("m1/t1", "deny")).toBe("ignored");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("m1", "t1", "once");
    expect(tracker.status("m1/t1")).toBe("sent");
  });

  it("l'accusé est la disparition de la demande", () => {
    const { tracker } = setup();
    tracker.update([item()]);
    tracker.click("m1/t1", "once");
    tracker.update([]);
    expect(tracker.status("m1/t1")).toBeUndefined();
  });

  it("non confirmé après 10 s : réponse possible à nouveau, par un nouveau clic seulement", () => {
    const { tracker, send, timers } = setup();
    tracker.update([item()]);
    tracker.click("m1/t1", "once");
    expect((timers[0] as { ms: number }).ms).toBe(UNCONFIRMED_AFTER_MS);
    (timers[0] as { fn: () => void }).fn();
    expect(tracker.status("m1/t1")).toBe("unconfirmed");
    expect(send).toHaveBeenCalledTimes(1);
    expect(tracker.click("m1/t1", "deny")).toBe("sent");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("refuse « Toujours » quand la demande n'est pas mémorisable", () => {
    const { tracker, send } = setup();
    tracker.update([item({ canRemember: false })]);
    expect(tracker.click("m1/t1", "always")).toBe("ignored");
    expect(send).not.toHaveBeenCalled();
  });

  it("refuse tout choix inconnu et toute demande absente", () => {
    const { tracker, send } = setup();
    tracker.update([item()]);
    expect(tracker.click("m1/t1", "approve-all")).toBe("ignored");
    expect(tracker.click("m1/absente", "once")).toBe("ignored");
    expect(send).not.toHaveBeenCalled();
  });

  it("ignore un clic sur une confirmation en cours", () => {
    const { tracker, send } = setup();
    tracker.update([item({ confirming: true })]);
    expect(tracker.click("m1/t1", "once")).toBe("ignored");
    expect(send).not.toHaveBeenCalled();
  });

  it("hors ligne : « offline », rien en file, rien de rejoué", () => {
    const { tracker, send } = setup(false);
    tracker.update([item()]);
    expect(tracker.click("m1/t1", "once")).toBe("offline");
    expect(tracker.status("m1/t1")).toBe("offline");
    tracker.update([item()]);
    tracker.connectionLost();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("update renvoie seulement les demandes apparues", () => {
    const { tracker } = setup();
    expect(tracker.update([item()])).toHaveLength(1);
    expect(tracker.update([item(), item({ toolUseId: "t2" })]).map(cardKey)).toEqual(["m1/t2"]);
    expect(tracker.update([item()])).toHaveLength(0);
  });
});

describe("barre fixe", () => {
  it("titre, aperçu et libellés", () => {
    expect(topbar.titleFor(0)).toBe("RedWidow");
    expect(topbar.titleFor(3)).toBe("(3) RedWidow");
    const preview = topbar.oldestPreview([item({ summary: `${"x".repeat(300)}\nsuite` })]);
    expect(preview.startsWith("Bash — ")).toBe(true);
    expect(preview.length).toBeLessThan(140);
    expect(preview).not.toContain("\n");
    expect(topbar.oldestPreview([])).toBe("");
  });

  it("badge Bypass : illimité, temps restant, absent si inactif ou inconnu", () => {
    const now = 1_000_000;
    expect(topbar.bypassLabel(null, now)).toBeNull();
    expect(topbar.bypassLabel({ active: false, until: null }, now)).toBeNull();
    expect(topbar.bypassLabel({ active: true, until: null }, now)).toBe("Bypass illimité");
    expect(topbar.bypassLabel({ active: true, until: now + 47 * 60000 }, now)).toBe(
      "Bypass 47 min",
    );
    expect(topbar.bypassLabel({ active: true, until: now + 72 * 60000 }, now)).toBe(
      "Bypass 1 h 12 min",
    );
    expect(topbar.bypassLabel({ active: true, until: now - 1 }, now)).toBe("Bypass expiré");
  });

  it("messages bypass et halt : forme exacte ou rejet", () => {
    expect(topbar.parseBypass({ type: "bypass", active: true, until: null })).toEqual({
      active: true,
      until: null,
    });
    expect(topbar.parseBypass({ type: "bypass", active: "oui" })).toBeNull();
    expect(topbar.parseHalt({ type: "halt", active: true, since: 5 })).toEqual({
      active: true,
      since: 5,
    });
    expect(topbar.parseHalt({ type: "halt", active: 1 })).toBeNull();
  });

  it("le bouton d'arrêt reste proposé quand l'état serveur est inconnu", () => {
    expect(topbar.haltButton(null, false).state).toBe("idle");
    expect(topbar.haltButton(null, false).text).toBe("Arrêt d'urgence");
    expect(topbar.haltButton({ active: true, since: null }, false).text).toBe("Reprendre");
  });
});

describe("clic sur l'arrêt d'urgence", () => {
  const fakeEl = () => {
    const handlers: Record<string, () => void> = {};
    return {
      handlers,
      dataset: {} as Record<string, string>,
      classList: { toggle() {}, add() {}, remove() {} },
      setAttribute() {},
      addEventListener(type: string, fn: () => void) {
        handlers[type] = fn;
      },
      hidden: false,
      textContent: "",
      title: "",
      offsetWidth: 0,
    };
  };
  const refs = () => ({
    count: fakeEl(),
    preview: fakeEl(),
    conn: fakeEl(),
    bypass: fakeEl(),
    halt: fakeEl(),
    haltNote: fakeEl(),
  });

  it("un clic = un arrêt, sans confirmation ; actif : reprise", () => {
    const r = refs();
    const onHalt = vi.fn();
    const onResume = vi.fn();
    const bar = topbar.createTopbar(r, { onHalt, onResume, onOpenApprovals: () => {} });
    const model = {
      count: 0,
      preview: "",
      conn: "open",
      bypass: null,
      halt: null,
      haltRequested: false,
      haltNote: "",
      now: 0,
    };
    bar.render(model);
    (r.halt.handlers.click as () => void)();
    expect(onHalt).toHaveBeenCalledTimes(1);
    expect(onResume).not.toHaveBeenCalled();
    bar.render({ ...model, halt: { active: true, since: null } });
    (r.halt.handlers.click as () => void)();
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onHalt).toHaveBeenCalledTimes(1);
  });

  it("actif même hors ligne : l'échec d'envoi est signalé par le gestionnaire", () => {
    const r = refs();
    const onHalt = vi.fn();
    topbar.createTopbar(r, { onHalt, onResume: () => {}, onOpenApprovals: () => {} });
    (r.halt.handlers.click as () => void)();
    expect(onHalt).toHaveBeenCalledTimes(1);
  });
});
