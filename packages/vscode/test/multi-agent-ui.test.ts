import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createUiTranslator } from "@warband/messages";
import { describe, expect, it } from "vitest";
import { parseWebviewMessage } from "../src/logic/approval.js";

const js = readFileSync(new URL("../media/chat.js", import.meta.url), "utf8");
const start = js.indexOf("  // Mode multi-agents (ADR 0054) : interrupteur");
const end = js.indexOf('  const bypassState = $("bypass-state");');
const slice = js.slice(start, end);

class N {
  hidden = false;
  disabled = false;
  value = "";
  title = "";
  textContent = "";
  className = "";
  children: N[] = [];
  attrs = new Map<string, string>();
  events = new Map<string, () => void>();
  constructor(readonly text?: string) {
    if (text !== undefined) this.textContent = text;
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  addEventListener(type: string, fn: () => void) {
    this.events.set(type, fn);
  }
  append(...n: N[]) {
    this.children.push(...n);
  }
  replaceChildren(...n: N[]) {
    this.children = n;
  }
}

function setup(locale: "fr" | "en" = "fr") {
  const nodes = new Map<string, N>();
  const $ = (id: string) => {
    let n = nodes.get(id);
    if (!n) {
      n = new N();
      nodes.set(id, n);
    }
    return n;
  };
  const sent: unknown[] = [];
  const block = new N();
  const context: Record<string, unknown> = {
    $,
    t: createUiTranslator(() => locale),
    el: (_tag: string, className: string, text?: string) => {
      const n = new N(text);
      n.className = className;
      return n;
    },
    document: {
      activeElement: null,
      documentElement: { lang: locale },
      querySelector: () => block,
    },
    vscode: { postMessage: (m: unknown) => sent.push(m) },
    ctl: null,
  };
  const api = runInNewContext(`${slice}\n({ paintMulti, paintCampaign })`, context) as {
    paintMulti(view: unknown): void;
    paintCampaign(view: unknown): void;
  };
  return { $, sent, block, context, api };
}

const controls = (multiAgent?: object, locked = false) => ({ locked, multiAgent });
const campaign = (finished = false) => ({
  objective: "Auditer l'API",
  finished,
  counts: { open: 1, claimed: 2, done: 3, blocked: 4, exhausted: 5 },
  workersMax: 3,
  spentUsd: 3.2,
  budgetUsd: 20,
  intents: [
    { id: "a", title: "Auth", state: "done", worker: 1, outcome: "reported" },
    { id: "b", title: "Upload", state: "open" },
  ],
});

describe("mode multi-agents : rendu de la webview (ADR 0054)", () => {
  it("sans campagne ni mode : rien de visible, rien d'envoyé", () => {
    const { $, block, context, api } = setup();
    context.ctl = controls();
    api.paintMulti({});
    api.paintCampaign({});
    expect($("multi-chip").hidden).toBe(true);
    expect(block.hidden).toBe(true);
    expect($("campaign").hidden).toBe(true);
  });

  it("mode actif : puce « Multi · N », interrupteur coché, nombre de workers", () => {
    const { $, context, api } = setup();
    context.ctl = controls({ enabled: true, workers: 4, available: true });
    api.paintMulti({});
    expect($("multi-chip").hidden).toBe(false);
    expect($("multi-chip-label").textContent).toBe("Multi · 4");
    expect($("multi-switch").attrs.get("aria-checked")).toBe("true");
    expect($("multi-workers").value).toBe("4");
    expect($("multi-workers").disabled).toBe(false);
  });

  it("désactivé si verrouillé, campagne en cours ou indisponible (avec le motif)", () => {
    const on = { enabled: false, workers: 3, available: true };
    for (const [ctl, view, disabled] of [
      [controls(on, true), {}, true],
      [controls(on), { campaign: campaign(false) }, true],
      [controls(on), { campaign: campaign(true) }, false],
      [
        controls({
          ...on,
          available: false,
          unavailableReason: "Indisponible en mode Apprentissage",
        }),
        {},
        true,
      ],
    ] as const) {
      const { $, context, api } = setup();
      context.ctl = ctl;
      api.paintMulti(view);
      expect($("multi-workers").disabled).toBe(disabled);
      expect($("multi-switch").attrs.get("aria-disabled")).toBe(String(disabled));
    }
    const { $, context, api } = setup("en");
    context.ctl = controls({
      enabled: false,
      workers: 3,
      available: false,
      unavailableReason: "Indisponible en mode Apprentissage",
    });
    api.paintMulti({});
    expect($("multi-help").hidden).toBe(false);
    expect($("multi-help").textContent).toBe("Unavailable in Learning mode");
  });

  it("le clic envoie setMultiAgent ; hors 1..8, rien n'est envoyé et le champ est invalide", () => {
    const { $, sent, context, api } = setup();
    context.ctl = controls({ enabled: false, workers: 3, available: true });
    api.paintMulti({});
    $("multi-switch").events.get("click")?.();
    expect(sent.pop()).toEqual({ type: "setMultiAgent", enabled: true, workers: 3 });
    for (const bad of ["0", "9", "", "2.5", "abc"]) {
      $("multi-workers").value = bad;
      $("multi-workers").events.get("input")?.();
      expect($("multi-workers").attrs.get("aria-invalid")).toBe("true");
      $("multi-workers").events.get("change")?.();
      $("multi-switch").events.get("click")?.();
    }
    expect(sent).toEqual([]);
    $("multi-workers").value = "8";
    $("multi-workers").events.get("input")?.();
    expect($("multi-workers").attrs.has("aria-invalid")).toBe(false);
    $("multi-workers").events.get("change")?.();
    expect(sent.pop()).toEqual({ type: "setMultiAgent", enabled: false, workers: 8 });
  });

  it("verrouillé : le clic n'envoie rien", () => {
    const { $, sent, context, api } = setup();
    context.ctl = controls({ enabled: false, workers: 3, available: true }, true);
    api.paintMulti({});
    $("multi-switch").events.get("click")?.();
    expect(sent).toEqual([]);
  });

  it("panneau de campagne : objectif, compteurs, lignes, arrêt sans confirmation", () => {
    const { $, sent, api } = setup();
    api.paintCampaign({ campaign: campaign() });
    expect($("campaign").hidden).toBe(false);
    expect($("campaign-objective").textContent).toBe("Auditer l'API");
    expect($("campaign-objective").title).toBe("Auditer l'API");
    expect($("campaign-n-blocked").textContent).toBe("4");
    expect($("campaign-budget").hidden).toBe(false);
    expect($("campaign-budget").textContent).toBe("3,20 $ / 20 $");
    expect($("campaign-stop").hidden).toBe(false);
    expect($("campaign-finished").hidden).toBe(true);
    const rows = $("campaign-list").children;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.children.map((c) => c.textContent)).toEqual([
      "Auth",
      "Terminée",
      "W 1",
      "Signalé",
    ]);
    $("campaign-stop").events.get("click")?.();
    expect(sent).toEqual([{ type: "stopCampaign" }]);
  });

  it("ligne de budget : anglais, et masquée sans budget connu", () => {
    const en = setup("en");
    en.api.paintCampaign({ campaign: campaign() });
    expect(en.$("campaign-budget").textContent).toBe("$3.20 / $20");
    const { $, api } = setup();
    const noBudget = { ...campaign(), budgetUsd: undefined };
    api.paintCampaign({ campaign: noBudget });
    expect($("campaign-budget").hidden).toBe(true);
  });

  it("campagne terminée : libellé affiché, bouton masqué ; au plus 50 lignes", () => {
    const { $, api } = setup();
    const many = campaign(true);
    many.intents = Array.from({ length: 80 }, (_, i) => ({
      id: String(i),
      title: `I${i}`,
      state: "open",
    })) as never;
    api.paintCampaign({ campaign: many });
    expect($("campaign-finished").hidden).toBe(false);
    expect($("campaign-stop").hidden).toBe(true);
    expect($("campaign-list").children).toHaveLength(50);
  });
});

describe("protocole webview → hôte : multi-agents", () => {
  it("accepte setMultiAgent de 1 à 8 et stopCampaign, refuse le reste", () => {
    expect(parseWebviewMessage({ type: "setMultiAgent", enabled: true, workers: 8 })).toEqual({
      type: "setMultiAgent",
      enabled: true,
      workers: 8,
    });
    expect(parseWebviewMessage({ type: "stopCampaign" })).toEqual({ type: "stopCampaign" });
    for (const bad of [
      { type: "setMultiAgent", enabled: true, workers: 0 },
      { type: "setMultiAgent", enabled: true, workers: 9 },
      { type: "setMultiAgent", enabled: true, workers: 1.5 },
      { type: "setMultiAgent", enabled: true, workers: "3" },
      { type: "setMultiAgent", enabled: "oui", workers: 3 },
      { type: "setMultiAgent", enabled: true },
      { type: "setMultiAgent", enabled: true, workers: 3, extra: 1 },
      { type: "stopCampaign", id: "x" },
    ])
      expect(parseWebviewMessage(bad)).toBeNull();
  });
});
