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
      expect(paletteOf(value)).toBe("widow");
    const html = chatHtml({
      nonce: "testNonce123",
      cspSource: "https://local.invalid",
      scriptUri: "https://local.invalid/chat.js",
      uiUri: "https://local.invalid/ui.js",
      styleUri: "https://local.invalid/chat.css",
      palette: 'braise" onclick="x',
    });
    expect(html).toContain('data-palette="widow"');
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

it("le message de palette accepte seulement les valeurs prévues et aucun champ supplémentaire", () => {
  for (const [palette] of PALETTES)
    expect(parseStudioMessage({ type: "setPalette", palette })).toEqual({
      type: "setPalette",
      palette,
    });
  for (const palette of ["bastion", "inconnue", 'multi" onclick="x', null, {}, []])
    expect(parseStudioMessage({ type: "setPalette", palette })).toBeNull();
  expect(parseStudioMessage({ type: "setPalette", palette: "multi", path: "/tmp" })).toBeNull();
  expect(paletteOf("bastion")).toBe("widow");
});

it("l’hôte, le manifeste et les cartes proposent les mêmes jeux de couleurs", () => {
  const js = readFileSync(new URL("../media/studio.js", import.meta.url), "utf8");
  const declaration = /const PALETTES = \[[\s\S]*?\n\];/.exec(js)?.[0];
  expect(declaration).toBeTruthy();
  const ids = PALETTES.map(([id]) => id);
  expect(runInNewContext(`${declaration}; PALETTES.map(([id]) => id)`)).toEqual(ids);
  const manifest = JSON.parse(
    readFileSync(new URL("../extension.manifest.json", import.meta.url), "utf8"),
  );
  expect(manifest.contributes.configuration.properties["warband.palette"].enum).toEqual(ids);
});
