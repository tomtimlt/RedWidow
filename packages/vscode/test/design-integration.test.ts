import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import type { Finding } from "@warband/core";
import { describe, expect, it } from "vitest";
import { createChatState } from "../src/logic/chat.js";
import { chatHtml } from "../src/logic/html.js";
import { missionReportPreview } from "../src/logic/mission-report.js";
import { PALETTES, paletteOf } from "../src/logic/palette.js";
import { parseStudioMessage } from "../src/logic/studio.js";

const PROJECT = "11111111-1111-4111-8111-111111111111";
describe("contrats de la refonte", () => {
  it("valide la palette avant son interpolation et n’ajoute aucune URI distante", () => {
    for (const [value] of PALETTES) expect(paletteOf(value)).toBe(value);
    for (const value of [null, [], {}, 'braise" onclick="x', "inconnue"])
      expect(paletteOf(value)).toBe("sentinelle");
    const html = chatHtml({
      nonce: "testNonce123",
      cspSource: "https://local.invalid",
      scriptUri: "https://local.invalid/chat.js",
      uiUri: "https://local.invalid/ui.js",
      styleUri: "https://local.invalid/chat.css",
      palette: 'braise" onclick="x',
    });
    expect(html).toContain('data-palette="sentinelle"');
    expect(html).not.toContain("onclick=");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('aria-label="Suivi du bas"');
  });
  it("date le début réel du tour sans renouveler la date lors des mises à jour", () => {
    const state = createChatState();
    expect(state.view().turnStartedAt).toBeNull();
    state.setBusy(true);
    const start = state.view().turnStartedAt;
    expect(start).toBeTypeOf("number");
    state.setBusy(true);
    expect(state.view().turnStartedAt).toBe(start);
    state.setBusy(false);
    expect(state.view().turnStartedAt).toBeNull();
    state.setBusy(true);
    state.clear();
    expect(state.view().turnStartedAt).toBeNull();
  });
  it("le rapport présente les notes réelles sans secrets ni gravité inventée", () => {
    const notes = [
      { id: "a", kind: "host", label: "Serveur confirmé", state: "confirmed" },
      { id: "b", kind: "step", label: "Hypothèse", state: "hypothesis" },
      { id: "c", kind: "credential", label: "ne pas exporter", state: "confirmed" },
      { id: "d", kind: "loot", label: "ne pas exporter non plus", state: "confirmed" },
    ] as Finding[];
    const preview = missionReportPreview({ id: PROJECT, name: "Projet réel" }, notes);
    expect(preview.findings).toHaveLength(2);
    expect(preview.findings.map((f) => f.severity)).toEqual(["unrated", "unrated"]);
    expect(JSON.stringify(preview)).not.toContain("ne pas exporter");
    expect(preview.findings[0]?.detail).toContain("Confirmé");
    expect(preview.findings[1]?.detail).toContain("Hypothèse");
    expect(parseStudioMessage({ type: "openReport", projectId: PROJECT })).toEqual({
      type: "openReport",
      projectId: PROJECT,
    });
    expect(
      parseStudioMessage({ type: "openReport", projectId: PROJECT, path: "/autre" }),
    ).toBeNull();
  });
  it("les indicateurs comptent la page sans déduire une progression d’intrusion", () => {
    const source = readFileSync(new URL("../media/ui.js", import.meta.url), "utf8");
    const sandbox: { WarbandUI?: { conversationActivity(view: unknown): unknown } } = {};
    runInNewContext(source, sandbox);
    const activity = sandbox.WarbandUI?.conversationActivity({
      items: [{ kind: "user" }, { kind: "tool", status: "pending" }],
      approvals: [{}],
      busy: true,
    });
    expect(activity).toEqual({
      phases: [
        { label: "1 message", state: "current" },
        { label: "1 outil · 1 en cours", state: "current" },
        { label: "1 accord en attente", state: "wait" },
      ],
    });
  });
});

it("l’appui maintenu attend 900 ms et s’annule si l’accord devient périmé", () => {
  const source = readFileSync(new URL("../media/chat.js", import.meta.url), "utf8");
  const start = source.indexOf("  function armButton(");
  const body = source.slice(start, source.indexOf("  function renderCard(", start));
  let seq = 0,
    confirmed = 0;
  const frames = new Map<number, (time: number) => void>();
  const events = new Map<string, ((event: Record<string, unknown>) => void)[]>();
  const button = {
    isConnected: true,
    disabled: false,
    classList: { add() {}, remove() {} },
    style: { setProperty() {} },
    addEventListener(type: string, listener: (event: Record<string, unknown>) => void) {
      events.set(type, [...(events.get(type) ?? []), listener]);
    },
  };
  const context = {
    holdToConfirm: true,
    HOLD_MS: 900,
    cancelHolds: new Set(),
    document: { hidden: false },
    requestAnimationFrame: (fn: (time: number) => void) => {
      frames.set(++seq, fn);
      return seq;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  };
  const arm = runInNewContext(`${body}\narmButton`, context) as (
    b: typeof button,
    hint: { textContent: string },
    confirm: () => void,
  ) => void;
  arm(button, { textContent: "" }, () => confirmed++);
  const fire = (type: string, event: Record<string, unknown> = {}) => {
    for (const fn of events.get(type) ?? []) fn(event);
  };
  const tick = (time: number) => {
    const active = [...frames.values()];
    frames.clear();
    for (const fn of active) fn(time);
  };
  fire("pointerdown", { button: 0 });
  tick(100);
  tick(999);
  expect(confirmed).toBe(0);
  fire("pointerup");
  tick(1100);
  expect(confirmed).toBe(0);
  fire("pointerdown", { button: 0 });
  tick(2000);
  button.isConnected = false;
  tick(3000);
  expect(confirmed).toBe(0);
  button.isConnected = true;
  fire("pointerdown", { button: 0 });
  tick(4000);
  context.document.hidden = true;
  tick(5000);
  expect(confirmed).toBe(0);
  context.document.hidden = false;
  fire("keydown", { key: " ", repeat: false, preventDefault() {} });
  tick(6000);
  tick(6900);
  expect(confirmed).toBe(1);
});
